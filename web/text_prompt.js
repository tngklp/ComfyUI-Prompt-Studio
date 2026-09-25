/**
 * A single-field text prompt.
 *
 * Built as a plain overlay inside the studio root rather than with `window.prompt`,
 * because the studio suppresses native dialogs and because a native prompt cannot
 * show the explanatory detail these flows depend on.
 *
 * Resolves with the entered text, or `null` when the user cancels. Callers must
 * treat `null` as "no change" rather than as an empty answer.
 */
export function promptForText({
  root,
  title,
  detail = "",
  confirm = "Save",
  value = "",
  placeholder = "",
  multiline = true,
  limit = 1000,
} = {}) {
  if (!root) return Promise.resolve(null);
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ps-text-prompt-overlay";
    overlay.innerHTML = `
      <section class="ps-text-prompt" role="dialog" aria-modal="true">
        <header class="ps-text-prompt-head">
          <strong></strong>
          <small></small>
        </header>
        ${multiline
          ? `<textarea class="ps-text-prompt-field" rows="4"></textarea>`
          : `<input class="ps-text-prompt-field" type="text">`}
        <footer class="ps-text-prompt-actions">
          <span class="ps-text-prompt-count"></span>
          <button type="button" class="ps-ghost-button" data-text-prompt-cancel>Cancel</button>
          <button type="button" class="ps-primary-button" data-text-prompt-confirm></button>
        </footer>
      </section>`;
    const titleNode = overlay.querySelector(".ps-text-prompt-head strong");
    const detailNode = overlay.querySelector(".ps-text-prompt-head small");
    const field = overlay.querySelector(".ps-text-prompt-field");
    const count = overlay.querySelector(".ps-text-prompt-count");
    const confirmButton = overlay.querySelector("[data-text-prompt-confirm]");
    const cancelButton = overlay.querySelector("[data-text-prompt-cancel]");

    titleNode.textContent = title || "";
    detailNode.textContent = detail;
    detailNode.hidden = !detail;
    confirmButton.textContent = confirm;
    field.value = value;
    if (placeholder) field.setAttribute("placeholder", placeholder);
    if (!multiline) field.setAttribute("type", "text");
    field.setAttribute("maxlength", String(limit));

    const syncEnabled = () => {
      const length = field.value.trim().length;
      confirmButton.disabled = length === 0;
      count.textContent = `${length}/${limit}`;
    };

    const close = (result) => {
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      resolve(result);
    };
    const submit = () => {
      const text = field.value.trim();
      if (!text) return;
      close(text);
    };
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(null);
      } else if (event.key === "Enter" && !multiline) {
        event.preventDefault();
        submit();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit();
      }
    }

    field.addEventListener("input", syncEnabled);
    cancelButton.addEventListener("click", () => close(null));
    confirmButton.addEventListener("click", submit);
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) close(null);
    });
    // Capture phase so the studio's own Escape handling does not close a panel
    // behind the prompt instead of the prompt itself.
    document.addEventListener("keydown", onKeyDown, true);

    root.append(overlay);
    syncEnabled();
    field.focus();
    if (multiline) field.setSelectionRange(field.value.length, field.value.length);
  });
}
