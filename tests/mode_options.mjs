/**
 * Regression tests for the Settings tabs, the media-blind switch, and the
 * per-mode option controls.
 *
 * Three behaviours are pinned here.
 *
 * 1. Settings is split into a **Prompt model** tab and a **Media handling** tab, so
 *    the two concerns are not interleaved in one long scroll.
 * 2. **Media-blind mode** withholds attached media from the prompt model. It is a
 *    persisted preference, and it has to reach the generation payload rather than
 *    being a display-only toggle.
 * 3. **Mode options** (Anima's content rating and prompt style) render from the
 *    registry snapshot and are persisted per mode with the rest of the draft.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const mainSource = await read("../web/main.js");
const settingsSource = await read("../web/settings.js");
const stateSource = await read("../web/studio_state.js");
const controlsSource = await read("../web/writer_controls.js");
const settingsCss = await read("../web/styles/settings.css");
const mediaCss = await read("../web/styles/media.css");

const settingsEncoded = Buffer.from(settingsSource).toString("base64");
const { settingsMarkup } = await import(`data:text/javascript;base64,${settingsEncoded}`);
const { modeOptionsMarkup, selectedModeOptionChoice } = await import("../web/writer_controls.js");
const { targetList, modeDescriptor } = await import("../web/target_registry.js");

const markup = settingsMarkup(() => "<svg></svg>");

test("Settings exposes a Prompt model tab and a Media handling tab", () => {
  assert.match(markup, /data-settings-tab="model"/);
  assert.match(markup, /data-settings-tab="media"/);
  // The model tab is the default, so Settings opens where it always did.
  // `aria-selected` is written before the hook in the markup.
  assert.match(markup, /aria-selected="true" data-settings-tab="model"/);
  assert.match(markup, /aria-selected="false" data-settings-tab="media"/);
  // One panel per tab, with the media panel hidden until chosen.
  assert.match(markup, /data-settings-panel="model"/);
  assert.match(markup, /data-settings-panel="media" hidden/);
  // Providers, models and runtime belong to the model tab.
  assert.match(markup, /data-provider-option="direct"/);
  assert.match(markup, /Installed models/);
  assert.match(markup, /KV cache/);
  // A [hidden] panel must not still occupy grid space.
  assert.match(settingsCss, /\.ps-settings-content\[hidden\] \{ display:none; \}/);
});

test("switching tabs shows exactly one panel and updates the subtitle", () => {
  assert.match(mainSource, /function setSettingsTab\(tab\)/);
  assert.match(mainSource, /studio\.root\.querySelectorAll\("\[data-settings-panel\]"\)/);
  assert.match(mainSource, /panel\.hidden = panel\.dataset\.settingsPanel !== target/);
  assert.match(mainSource, /data-settings-subtitle/);
  assert.match(mainSource, /function syncMediaSettings\(\)/);
  // Opening Settings applies the remembered tab rather than always resetting.
  assert.match(mainSource, /setSettingsTab\(studio\.settingsTab \|\| "model"\)/);
});

test("the Settings tab is session-scoped, not persisted into preferences", () => {
  // A reload should not drop the user into a sub-tab they did not choose.
  assert.match(stateSource, /settingsTab: "model"/);
  const preferencesBlock = stateSource.slice(stateSource.indexOf("export function saveUserPreferences"));
  assert.doesNotMatch(preferencesBlock.slice(0, 2000), /settings_tab/);
});

test("Media handling carries the media-blind switch with an explanation", () => {
  assert.match(markup, /data-blind-media/);
  assert.match(markup, /Media-blind mode/);
  assert.match(markup, /data-blind-media-hint/);
  // The copy must state the two consequences the user is accepting.
  assert.match(markup, /not sent to the prompt model/);
  assert.match(markup, /must not invent its contents/);
  // And it must distinguish itself from a declared reference, which needs no model.
  assert.match(markup, /Plan a picture/);
  assert.match(markup, /already text-only and needs no vision model/);
  assert.match(settingsCss, /\.ps-field-notes/);
});

test("the media-blind switch is persisted and reaches the generation payload", () => {
  assert.match(mainSource, /data-blind-media/);
  assert.match(mainSource, /studio\.blindMedia = blindMediaToggle\.checked/);
  assert.match(mainSource, /saveUserPreferences\(localStorage, studio\)/);
  // It changes what the model receives, so it must travel with the request.
  assert.match(stateSource, /if \(state\.blindMedia === true\) payload\.blind_media = true/);
  // It is persisted in preferences and restored on load.
  assert.match(stateSource, /blind_media: state\.blindMedia === true/);
  assert.match(stateSource, /blindMedia: preferences\?\.blind_media === true/);
});

test("turning the switch explains the change and refreshes the workspace", () => {
  assert.match(mainSource, /"Media-blind mode on" : "Media-blind mode off"/);
  assert.match(mainSource, /Attached media stays in the workspace but is not sent to the prompt model/);
  assert.match(mainSource, /a vision model is required/);
  // The media note is derived from the setting, so it must be re-rendered.
  assert.match(mainSource, /renderMedia\(studio\.mode\);\s*\n\s*showToast\(/);
});

test("the media box explains when a reference is not being shown to the model", () => {
  assert.match(mainSource, /function mediaModeNoticeMarkup\(mode\)/);
  assert.match(mainSource, /declared reference\$\{declared === 1 \? "" : "s"\} written from your description, not from media/);
  assert.match(mainSource, /withheld from the prompt model by Media-blind mode/);
  assert.match(mainSource, /data-media-mode-note/);
  // No note when every reference is ordinary and visible to the model.
  assert.match(mainSource, /if \(!notes\.length\) return ""/);
  assert.match(mediaCss, /\.ps-media-mode-note/);
});

test("a target that declares no options renders no option controls", () => {
  assert.match(controlsSource, /export function modeOptionsMarkup\(icon, options, selected = \{\}, key = "image-options"\)/);
  assert.match(controlsSource, /if \(!Array\.isArray\(options\) \|\| !options\.length\) return ""/);
  assert.equal(modeOptionsMarkup(() => "", [], {}), "");
  assert.equal(modeOptionsMarkup(() => "", undefined, {}), "");
});

test("the option control renders one labelled menu per declared option", () => {
  const options = modeDescriptor("AnimaTextToImage").options;
  assert.ok(Array.isArray(options) && options.length === 2, "Anima should declare two options");
  const html = modeOptionsMarkup(() => "<svg></svg>", options, { content_rating: "nsfw", prompt_style: "tags" });
  for (const option of options) {
    assert.match(html, new RegExp(`data-mode-option="${option.id}"`));
    for (const choice of option.choices) {
      assert.match(html, new RegExp(`data-mode-option-value="${choice.id}"`));
    }
  }
  // The selected value is matched by id, not by label, so relabelling is safe.
  assert.match(html, /aria-pressed="true" data-mode-option-value="nsfw"/);
  assert.match(html, /aria-pressed="true" data-mode-option-value="tags"/);
  assert.match(html, /aria-pressed="false" data-mode-option-value="hybrid"/);
});

test("an unset option opens on its declared default, not its first choice", () => {
  const options = modeDescriptor("AnimaTextToImage").options;
  const html = modeOptionsMarkup(() => "", options, {});
  // The rating has a null default and its first choice is the explicit "None".
  assert.match(html, /aria-pressed="true" data-mode-option-value="none"/);
  // The style default is now tags; assert it comes from the declared default rather
  // than from a positional fallback.
  assert.equal(options.find((option) => option.id === "prompt_style").default, "tags");
  assert.match(html, /aria-pressed="true" data-mode-option-value="tags"/);
  assert.match(html, /data-option-label>Tags</);
});

test("the active choice resolver prefers selection, then default, then first", () => {
  const style = modeDescriptor("AnimaTextToImage").options.find((option) => option.id === "prompt_style");
  assert.equal(style.default, "tags");
  assert.equal(selectedModeOptionChoice(style, { prompt_style: "hybrid" }).id, "hybrid");
  assert.equal(selectedModeOptionChoice(style, {}).id, "tags");
  assert.equal(selectedModeOptionChoice(style, { prompt_style: "not_a_choice" }).id, "tags");
  const rating = modeDescriptor("AnimaTextToImage").options.find((option) => option.id === "content_rating");
  assert.equal(selectedModeOptionChoice(rating, { content_rating: "nsfw" }).id, "nsfw");
  assert.equal(selectedModeOptionChoice(rating, {}).id, "none");
  // A stale value falls back rather than selecting nothing.
  assert.equal(selectedModeOptionChoice(rating, { content_rating: "sfw" }).id, "none");
});

// The default is not necessarily the first choice, which is the case this guards.
test("the declared default is honoured even when it is not the first choice", () => {
  const synthetic = {
    id: "synthetic",
    default: "third",
    choices: [
      { id: "first", label: "First" },
      { id: "second", label: "Second" },
      { id: "third", label: "Third" },
    ],
  };
  assert.equal(selectedModeOptionChoice(synthetic, {}).id, "third");
  const html = modeOptionsMarkup(() => "", [synthetic], {});
  assert.match(html, /aria-pressed="true" data-mode-option-value="third"/);
  assert.match(html, /aria-pressed="false" data-mode-option-value="first"/);
});

test("a null default falls back to the first choice", () => {
  const synthetic = {
    id: "synthetic",
    default: null,
    choices: [{ id: "optout", label: "None" }, { id: "on", label: "On" }],
  };
  assert.equal(selectedModeOptionChoice(synthetic, {}).id, "optout");
});

test("every Anima rating and style reaches the registry with a prompt tag", () => {
  const options = modeDescriptor("AnimaTextToImage").options;
  const rating = options.find((option) => option.id === "content_rating");
  assert.deepEqual(rating.choices.map((choice) => choice.id), ["none", "safe", "sensitive", "nsfw", "explicit"]);
  // `none` deliberately carries no tag: choosing it means "emit nothing".
  assert.equal(rating.choices[0].prompt_tag, null);
  assert.deepEqual(
    rating.choices.slice(1).map((choice) => choice.prompt_tag),
    ["safe", "sensitive", "nsfw", "explicit"],
  );
  assert.equal(rating.default, null);
  const style = options.find((option) => option.id === "prompt_style");
  assert.deepEqual(style.choices.map((choice) => choice.id), ["tags", "natural_language", "hybrid"]);
  assert.equal(style.default, "tags");
});

test("only the Anima target declares mode options", () => {
  const withOptions = targetList().filter((target) => (target.modes || []).some((mode) => (mode.options || []).length));
  assert.deepEqual(withOptions.map((target) => target.id), ["anima"]);
});

test("option selections are stored per mode and only known values are sent", () => {
  // Selections ride with the mode's own draft, so switching mode and returning
  // restores that mode's rating and style.
  assert.match(mainSource, /const draft = studio\.modeDrafts\[mode\] \|\| defaultModeDraft\(mode\)/);
  assert.match(mainSource, /studio\.modeDrafts\[mode\] = \{ \.\.\.draft, options \}/);
  assert.match(mainSource, /saveModeDrafts\(localStorage, studio\.modeDrafts\)/);
  // And a value the registry no longer declares is dropped rather than forwarded.
  assert.match(mainSource, /normalizeModeOptionSelection\(mode, \{ \.\.\.\(draft\.options \|\| \{\}\), \[optionId\]: choiceId \}\)/);
  // The payload builder reads the draft, not a separate store.
  assert.match(stateSource, /state\.modeDrafts\?\.\[state\.mode\]\?\.options \|\| \{\}/);
});

test("the option container is not rebuilt on every render", () => {
  // Rebuilding would close an open menu mid-interaction, so the markup is only
  // replaced when the option set itself changes.
  assert.match(mainSource, /if \(studio\.renderedModeOptions !== `\$\{studio\.mode\}:\$\{signature\}`\)/);
  assert.match(mainSource, /function syncModeOptionLabels\(host, options, selected\)/);
  assert.doesNotMatch(mainSource, /function syncModeOptions\(\)[\s\S]{0,900}host\.innerHTML = "";[\s\S]{0,200}host\.innerHTML = modeOptionsMarkup/);
});

test("changing an option warns that the generated prompt is now stale", () => {
  assert.match(mainSource, /Generate again to apply it to the prompt/);
  assert.match(mainSource, /if \(studio\.lastModelPrompt\) \{/);
});

test("the image panel hosts the option controls alongside the aspect ratio", () => {
  assert.match(mainSource, /<div class="ps-control-grid ps-mode-options" data-mode-options><\/div>/);
  assert.match(mainSource, /function syncModeOptions\(\)/);
  // The image panel is the only panel that renders them, so it must call the sync.
  // main.js uses CRLF, so the slice is generous and newline-agnostic.
  const panel = mainSource.slice(mainSource.indexOf("function syncImagePanel()"), mainSource.indexOf("function syncModeAvailability()"));
  assert.match(panel, /syncModeOptions\(\)/);
});
