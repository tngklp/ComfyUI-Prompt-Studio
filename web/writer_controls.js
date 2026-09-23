export const ASPECT_RATIOS = [
  ["1:1", "Square"], ["2:3", "Portrait"], ["3:2", "Landscape"], ["3:4", "Portrait"],
  ["4:3", "Landscape"], ["9:16", "Vertical"], ["16:9", "Widescreen"], ["21:9", "Ultrawide"],
];

export function generationButtonMarkup(icon, busy, label) {
  return busy ? `<span class="ps-spinner"></span><span data-generate-label>Cancel</span>`
    : `${icon("spark", 16)}<span data-generate-label>${label}</span>`;
}

export function sequenceNotificationOptions(error) {
  return error.severity === "warning" ? {durationMs:8000} : {dismissOnWorkspaceClick:true};
}

export function aspectRatioMarkup(icon, key = "aspect") {
  return `<label class="ps-field ps-choice"><span>Aspect ratio</span><button type="button" aria-expanded="false" data-choice-toggle="${key}"><b data-aspect-label>16:9</b><em data-aspect-description>Widescreen</em>${icon("chevron", 13)}</button><div class="ps-choice-menu ps-aspect-menu" role="group" aria-label="Aspect ratio" data-choice-menu="${key}" hidden>${ASPECT_RATIOS.map(([value, label]) => `<button type="button" aria-pressed="false" data-aspect="${value}"><b>${value}</b><em>${label}</em></button>`).join("")}</div></label>`;
}

export function bindAspectRatio(field, value, onChange) {
  const toggle = field.querySelector("[data-choice-toggle]"), menu = field.querySelector("[data-choice-menu]");
  const close = () => { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); };
  const update = value => {
    const option = ASPECT_RATIOS.find(([v]) => v === value) || ASPECT_RATIOS[6];
    field.querySelector("[data-aspect-label]").textContent = option[0];
    field.querySelector("[data-aspect-description]").textContent = option[1];
    field.querySelectorAll("[data-aspect]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.aspect === option[0])));
  };
  toggle.addEventListener("click", event => {
    event.preventDefault();
    const open = menu.hidden;
    field.closest(".ps-root")?.querySelectorAll("[data-choice-menu]").forEach(m => { m.hidden = true; });
    field.closest(".ps-root")?.querySelectorAll("[data-choice-toggle]").forEach(b => b.setAttribute("aria-expanded", "false"));
    menu.hidden = !open; toggle.setAttribute("aria-expanded", String(open));
  });
  field.querySelectorAll("[data-aspect]").forEach(b => b.addEventListener("click", event => { event.preventDefault(); update(b.dataset.aspect); close(); onChange(b.dataset.aspect); }));
  update(value);
  return { close, update };
}

// Attribute strings and contents are trusted markup from the owning workspace.
export function splitMenuMarkup(icon, {label, primary, toggle, menu, contents, ariaLabel}) {
  return `<button class="ps-clear-primary" type="button" ${primary} aria-expanded="false">${label}</button>
    <button class="ps-clear-toggle" type="button" aria-label="${ariaLabel}" aria-expanded="false" ${toggle}>${icon("chevron", 12)}</button>
    <div class="ps-clear-menu" ${menu} hidden>${contents}</div>`;
}
export function setSplitMenuOpen(control, open) {
  if (!control) return;
  control.querySelector(".ps-clear-menu").hidden = !open;
  control.querySelectorAll(":scope > button").forEach(b => b.setAttribute("aria-expanded", String(open)));
}
export function copyButtonMarkup(icon, attributes, label = "", iconOnly = false) {
  return `<button class="${iconOnly ? "ps-icon-button" : "ps-secondary-button"}" type="button" ${attributes}>${icon("copy", 15)}${label ? ` ${label}` : ""}</button>`;
}

// Option labels and actions are trusted constants supplied by Prompt Studio views.
export function formatChoiceMarkup(label, options, selected) {
  return `<div class="ps-sequence-copy-choice" role="group" aria-label="${label}">${options.map(([action,text])=>`<button type="button" data-seq-action="${action}" aria-pressed="${action===selected}">${text}</button>`).join("")}</div>`;
}
