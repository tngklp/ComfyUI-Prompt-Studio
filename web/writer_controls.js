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

/**
 * Render the per-mode options a target declares.
 *
 * Options are registry data (see `targets.json`), so a target that declares none
 * renders nothing at all. `None` is a real choice for an opt-in option, so the
 * selected value is matched by id and never inferred from the label.
 *
 * An unselected option opens on its declared `default`, not on its first choice:
 * Anima's prompt style lists `tags` first but defaults to `hybrid`, and showing
 * the first choice would display a value the backend will not use.
 */
export function modeOptionsMarkup(icon, options, selected = {}, key = "image-options") {
  if (!Array.isArray(options) || !options.length) return "";
  return options.map((option) => {
    const chosen = selectedModeOptionChoice(option, selected);
    return `
      <label class="ps-field ps-choice" data-mode-option="${option.id}">
        <span>${option.label}</span>
        <button type="button" aria-expanded="false" data-choice-toggle="${key}-${option.id}"><b data-option-label>${chosen.label}</b><em data-option-description>${chosen.hint || ""}</em>${icon("chevron", 13)}</button>
        <div class="ps-choice-menu ps-option-menu" role="group" aria-label="${option.label}" data-choice-menu="${key}-${option.id}" hidden>
          ${option.choices.map((choice) => `<button type="button" aria-pressed="${choice.id === chosen.id}" data-mode-option-value="${choice.id}"><b>${choice.label}</b><em>${choice.hint || ""}</em></button>`).join("")}
        </div>
      </label>`;
  }).join("");
}

/**
 * The single source of truth for which choice is shown as active.
 *
 * Order matters: an explicit selection wins, then the declared default, and only
 * then the first choice. A `null` default means "no default", so the first choice -
 * conventionally the opt-out value - is the one to show.
 */
export function selectedModeOptionChoice(option, selected = {}) {
  const value = selected?.[option.id];
  const explicit = option.choices.find((choice) => choice.id === value);
  if (explicit) return explicit;
  const fallback = option.default === null || option.default === undefined ? null : option.default;
  return option.choices.find((choice) => choice.id === fallback) || option.choices[0];
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

/**
 * Bind every declared mode option to one change handler.
 *
 * `onChange(optionId, choiceId)` is called with the registry ids, never the
 * labels, so a relabelled choice cannot change stored state.
 */
export function bindModeOptions(field, options, selected, onChange) {
  if (!field || !Array.isArray(options) || !options.length) return;
  const nodes = [...field.querySelectorAll("[data-mode-option]")];
  for (const node of nodes) {
    const option = options.find((candidate) => candidate.id === node.dataset.modeOption);
    if (!option) continue;
    const toggle = node.querySelector("[data-choice-toggle]");
    const menu = node.querySelector("[data-choice-menu]");
    const label = node.querySelector("[data-option-label]");
    const description = node.querySelector("[data-option-description]");
    const close = () => { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); };
    const current = selectedModeOptionChoice(option, selected);
    label.textContent = current.label;
    description.textContent = current.hint || "";
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      const open = menu.hidden;
      field.querySelectorAll("[data-choice-menu]").forEach((other) => { other.hidden = true; });
      field.querySelectorAll("[data-choice-toggle]").forEach((other) => other.setAttribute("aria-expanded", "false"));
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });
    node.querySelectorAll("[data-mode-option-value]").forEach((choice) => {
      choice.addEventListener("click", (event) => {
        event.preventDefault();
        const picked = option.choices.find((candidate) => candidate.id === choice.dataset.modeOptionValue);
        if (!picked) return;
        label.textContent = picked.label;
        description.textContent = picked.hint || "";
        node.querySelectorAll("[data-mode-option-value]").forEach((other) => other.setAttribute("aria-pressed", String(other === choice)));
        close();
        onChange(option.id, picked.id);
      });
    });
  }
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

export function fitTextarea(editor, minimumHeight, borderHeight = 0) {
  // Measuring a collapsed textarea can clamp the surrounding panel's scroll offset.
  const scroll = [];
  for (let parent = editor.parentElement; parent; parent = parent.parentElement) {
    scroll.push([parent, parent.scrollTop]);
  }
  editor.style.height = "auto";
  editor.style.height = `${Math.max(minimumHeight, editor.scrollHeight + borderHeight)}px`;
  for (const [parent, top] of scroll) parent.scrollTop = top;
}

// Option labels and actions are trusted constants supplied by Prompt Studio views.
export function formatChoiceMarkup(label, options, selected) {
  return `<div class="ps-sequence-copy-choice" role="group" aria-label="${label}">${options.map(([action,text])=>`<button type="button" data-seq-action="${action}" aria-pressed="${action===selected}">${text}</button>`).join("")}</div>`;
}
