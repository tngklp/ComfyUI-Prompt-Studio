/**
 * Anima character picker.
 *
 * Anima is trained on Danbooru-style captions where a character must be named with
 * its exact spelling followed by its series - `hatsune miku, vocaloid`. Typing that
 * from memory is error-prone, and a wrong or reordered name degrades the result with
 * no visible error. This picker resolves a name the user knows ("miku") into the
 * exact pair, from the same dataset the community uses.
 *
 * Behaviour:
 *
 * * multi-select, so a scene with several characters is one interaction;
 * * type-ahead search against the backend index, debounced, with the previous
 *   request superseded rather than left to race;
 * * selections are the source of truth and are re-resolved on every change, so the
 *   trigger list sent to the backend always matches what is on screen.
 */

import { escapeHtml } from "./html.js";

const SEARCH_DEBOUNCE_MS = 180;

export function characterPickerMarkup() {
  return `
    <section class="ps-characters" data-characters hidden aria-label="Characters">
      <div class="ps-characters-head">
        <span><strong>Characters</strong><small data-characters-status>Anima character reference</small></span>
      </div>
      <div class="ps-character-search">
        <input type="search" data-character-search autocomplete="off" spellcheck="false"
               placeholder="Search a character, e.g. miku" aria-label="Search characters">
      </div>
      <div class="ps-character-picked" data-character-picked></div>
      <div class="ps-character-results" data-character-results role="listbox" aria-label="Character results"></div>
      <p class="ps-character-hint" data-character-hint hidden></p>
    </section>`;
}

/** One selectable result row. */
function resultMarkup(entry, selected) {
  const series = entry.series ? `<em>${escapeHtml(entry.series)}</em>` : "";
  return `<button type="button" role="option" aria-selected="${selected}" class="ps-character-result ${selected ? "is-selected" : ""}"
      data-character-pick="${escapeHtml(entry.character)}" data-character-trigger="${escapeHtml(entry.trigger)}">
    <span class="ps-character-result-copy">
      <strong>${escapeHtml(entry.display_name)}</strong>
      ${series}
    </span>
    <code>${escapeHtml(entry.trigger)}</code>
  </button>`;
}

/** One selected character chip. */
function pickedMarkup(entry) {
  return `<span class="ps-character-chip" data-character-chip="${escapeHtml(entry.character)}">
    <span><strong>${escapeHtml(entry.display_name)}</strong><small>${escapeHtml(entry.trigger)}</small></span>
    <button type="button" data-character-remove="${escapeHtml(entry.character)}" aria-label="Remove ${escapeHtml(entry.display_name)}" title="Remove">×</button>
  </span>`;
}

/**
 * Create the picker controller.
 *
 * `search` and `resolve` are injected so the controller never imports the API layer,
 * which keeps it evaluable in tests without a network or a DOM harness.
 */
export function createCharacterPicker({
  root,
  search,
  resolve,
  onChange = () => {},
} = {}) {
  const host = root?.querySelector("[data-characters]");
  const input = root?.querySelector("[data-character-search]");
  const results = root?.querySelector("[data-character-results]");
  const picked = root?.querySelector("[data-character-picked]");
  const status = root?.querySelector("[data-characters-status]");
  const hint = root?.querySelector("[data-character-hint]");

  /** Selected characters, keyed by slug so order is stable and duplicates impossible. */
  const selected = new Map();
  let searchTimer = null;
  let searchToken = 0;
  let statusPayload = null;

  function renderPicked() {
    if (!picked) return;
    picked.innerHTML = [...selected.values()].map(pickedMarkup).join("");
    picked.hidden = selected.size === 0;
    picked.querySelectorAll("[data-character-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        selected.delete(button.dataset.characterRemove);
        renderPicked();
        renderResults(lastResults);
        emitChange();
      });
    });
  }

  function renderResults(entries) {
    lastResults = entries;
    if (!results) return;
    if (!entries.length) {
      results.innerHTML = "";
      results.hidden = true;
      return;
    }
    results.hidden = false;
    results.innerHTML = entries.map((entry) => resultMarkup(entry, selected.has(entry.character))).join("");
    results.querySelectorAll("[data-character-pick]").forEach((button) => {
      button.addEventListener("click", () => toggle({
        character: button.dataset.characterPick,
        trigger: button.dataset.characterTrigger,
      }));
    });
  }

  let lastResults = [];

  function toggle(entry) {
    if (selected.has(entry.character)) {
      selected.delete(entry.character);
    } else {
      selected.set(entry.character, entry);
    }
    renderPicked();
    renderResults(lastResults);
    emitChange();
  }

  function emitChange() {
    onChange({
      characters: [...selected.keys()],
      triggers: [...selected.values()].map((entry) => entry.trigger),
    });
  }

  function setHint(message, tone = "") {
    if (!hint) return;
    hint.textContent = message || "";
    hint.hidden = !message;
    hint.classList.toggle("is-warning", tone === "warning");
  }

  function renderStatus(payload) {
    statusPayload = payload;
    if (status) {
      const count = payload?.count ?? 0;
      status.textContent = `${count.toLocaleString()} character${count === 1 ? "" : "s"} · ${payload?.source || "unknown source"}`;
    }
    // The catalogue is downloaded rather than shipped, so an unavailable index is a
    // normal first-launch state, not a fault. Say which it is so the user knows
    // whether to wait or to retry the download in Settings.
    if (!payload || payload.downloaded === false) {
      const offline = (payload?.count ?? 0) > 0;
      setHint(
        offline
          ? `The AnimaDex catalogue is still downloading, so only ${payload.count} offline placeholder `
            + "characters are searchable. It finishes in the background; Settings → Characters has a retry."
          : "The AnimaDex character catalogue has not been downloaded yet. "
            + "Download it from Settings → Characters to search characters.",
        "warning",
      );
    } else {
      setHint("");
    }
  }

  async function runSearch(query) {
    const token = ++searchToken;
    if (!query.trim()) {
      renderResults([]);
      return;
    }
    try {
      const payload = await search(query);
      // A newer keystroke owns the results; a late reply must not overwrite them.
      if (token !== searchToken) return;
      if (payload?.status) renderStatus(payload.status);
      renderResults(payload?.results || []);
    } catch {
      if (token !== searchToken) return;
      renderResults([]);
      setHint("Character search is unavailable right now.", "warning");
    }
  }

  function syncVisibility(targetId) {
    if (!host) return;
    // Characters only make sense for Anima, whose guide defines the tag order the
    // trigger has to fit into. Other targets would get a meaningless block.
    host.hidden = targetId !== "anima";
  }

  function attach() {
    input?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const value = input.value;
      searchTimer = setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
    });
    // Selecting a result with the keyboard should not submit anything.
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") input.value = "";
    });
  }

  /**
   * Re-resolve the selection against the index.
   *
   * Called before generating so a stale stored selection (a slug the current index
   * no longer knows) is dropped rather than sent as an unknown name.
   */
  async function validate() {
    if (!selected.size) return { characters: [], dropped: [] };
    try {
      const payload = await resolve([...selected.keys()]);
      const known = new Set((payload?.characters || []).map((entry) => entry.character));
      const dropped = [...selected.keys()].filter((key) => !known.has(key));
      for (const key of dropped) selected.delete(key);
      if (dropped.length) {
        renderPicked();
        setHint(`Removed ${dropped.length} character(s) the index no longer knows.`, "warning");
        emitChange();
      }
      return { characters: [...selected.keys()], dropped };
    } catch {
      // A failed check must not silently drop the user's selection.
      return { characters: [...selected.keys()], dropped: [], failed: true };
    }
  }

  return {
    attach,
    syncVisibility,
    renderStatus,
    validate,
    toggle,
    /** Restore a persisted selection, in the stored order. */
    restore(entries) {
      selected.clear();
      for (const entry of entries || []) {
        if (entry?.character) selected.set(entry.character, entry);
      }
      renderPicked();
    },
    get selection() { return [...selected.values()]; },
    get status() { return statusPayload; },
    elements: { host, input, results, picked, status, hint },
  };
}
