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
 *
 * The picker deliberately reports nothing about the dataset itself. The catalogue is
 * fetched automatically on first launch, so there is no user action to prompt for and
 * no state worth surfacing: an empty index simply yields no results.
 */

import { escapeHtml } from "./html.js";

const SEARCH_DEBOUNCE_MS = 180;

export function characterPickerMarkup() {
  return `
    <div class="ps-characters ps-field" data-characters hidden aria-label="Characters">
      <span>Characters<small data-character-count hidden></small></span>
      <div class="ps-character-search">
        <input type="search" data-character-search autocomplete="off" spellcheck="false"
               placeholder="Search a character, e.g. miku" aria-label="Search characters">
      </div>
      <div class="ps-character-picked" data-character-picked></div>
      <div class="ps-character-results" data-character-results role="listbox" aria-label="Character results"></div>
    </div>`;
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

/**
 * One selected character, as a bubble.
 *
 * The bubble shows the display name and carries the full trigger as its title, so the
 * exact string that will reach the prompt is still discoverable by hovering without
 * every bubble wrapping onto several lines.
 */
function pickedMarkup(entry) {
  return `<span class="ps-character-chip" data-character-chip="${escapeHtml(entry.character)}" title="${escapeHtml(entry.trigger)}">
    <strong>${escapeHtml(entry.display_name)}</strong>
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
  const countLabel = root?.querySelector("[data-character-count]");

  /** Selected characters, keyed by slug so order is stable and duplicates impossible. */
  const selected = new Map();
  /** The current result list, kept so a toggle can re-render the ticks in place. */
  let lastResults = [];
  let searchTimer = null;
  let searchToken = 0;

  /**
   * Show how many characters are searchable.
   *
   * A hint only, so it is terse and stays out of the way: it answers "is the dataset
   * actually here?" without becoming the status panel this picker deliberately does
   * not have. A count of zero stays hidden rather than advertising an empty index.
   */
  function renderCount(status) {
    if (!countLabel) return;
    const count = Number(status?.count || 0);
    countLabel.hidden = count <= 0;
    countLabel.textContent = count > 0 ? `${count.toLocaleString()} available` : "";
  }

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
      // Toggle with the full result entry, not the data attributes. The attributes
      // carry only the slug and trigger, so a bubble built from them had no
      // display_name and rendered blank until a refresh re-hydrated it from storage.
      button.addEventListener("click", () => {
        const entry = lastResults.find((item) => item.character === button.dataset.characterPick);
        toggle(entry || {
          character: button.dataset.characterPick,
          trigger: button.dataset.characterTrigger,
        });
      });
    });
  }

  /**
   * Normalise an entry into one a bubble can render.
   *
   * A bubble always needs a label, and entries arrive from three places with
   * different fields: a search result (full), a restored stored selection (full), and
   * a bare slug/trigger pair. Filling the gap here means none of those can produce a
   * blank bubble, which is what happened when a click rebuilt the entry from the
   * button's data attributes and lost `display_name`.
   */
  function bubbleEntry(entry) {
    const trigger = entry.trigger || "";
    return {
      ...entry,
      display_name: entry.display_name || trigger.split(",")[0].trim() || entry.character,
    };
  }

  function toggle(entry) {
    if (selected.has(entry.character)) {
      selected.delete(entry.character);
    } else {
      selected.set(entry.character, bubbleEntry(entry));
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
      renderResults(payload?.results || []);
    } catch {
      if (token !== searchToken) return;
      renderResults([]);
    }
  }

  /**
   * Read the dataset size once.
   *
   * An empty query returns no results but does return the status, so this is the
   * cheapest way to ask "how big is the catalogue?" without inventing a second
   * endpoint. It is deliberately silent on failure: the count is a nicety and must
   * never surface an error or block the picker.
   */
  async function loadCount() {
    try {
      const payload = await search("");
      renderCount(payload?.status);
    } catch {
      renderCount(null);
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
    loadCount,
    validate,
    toggle,
    /** Restore a persisted selection, in the stored order. */
    restore(entries) {
      selected.clear();
      for (const entry of entries || []) {
        if (entry?.character) selected.set(entry.character, bubbleEntry(entry));
      }
      renderPicked();
    },
    get selection() { return [...selected.values()]; },
    elements: { host, input, results, picked },
  };
}
