/**
 * Generation target selection screen.
 *
 * Shown on every launch, covering the whole studio. The user picks which model
 * the prompt is written *for*: MiniMax H3, MiniMax Music 3, Qwen Image 2.1 and
 * any target added to targets.json later.
 *
 * This is deliberately NOT about the prompt model (the LLM that writes the
 * prompt). That is chosen from the top-bar pill or Settings and is remembered
 * between sessions.
 *
 * The list is filled in by syncTargetSelection(); this module only owns the
 * static shell and its hooks.
 */

/** Markup for the screen. */
/**
 * Markup for the screen.
 *
 * The brand mark is a real <img> rather than a background image, so it inherits
 * the same asset the header and the README use. A background would need a second
 * copy of the path and would not announce itself to assistive tech.
 */
export function targetSelectionMarkup() {
  const mark = new URL("./assets/prompt-studio-launcher.svg", import.meta.url).href;
  return `
    <section class="ps-target-select-view" data-target-select-view hidden aria-label="Choose a generation target">
      <div class="ps-target-select-shell">
        <header class="ps-target-select-heading">
          <img class="ps-brand-mark" src="${mark}" alt="" width="52" height="52">
          <span>
            <strong>Choose a target</strong>
            <p>Pick the model you are writing the prompt for.</p>
          </span>
        </header>

        <div class="ps-target-select-list" data-target-select-list role="radiogroup" aria-label="Available targets"></div>

        <footer class="ps-target-select-actions">
          <span class="ps-target-select-status" data-target-select-status></span>
          <button class="ps-primary-button" type="button" data-target-select-confirm disabled>Continue</button>
        </footer>
      </div>
    </section>`;
}
