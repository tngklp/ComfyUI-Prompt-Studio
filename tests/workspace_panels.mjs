/**
 * Regression tests for the workspace panel switching.
 *
 * These guard the behaviour that was previously broken: choosing "Image" left the
 * video UI in place.
 *
 * Note on terminology: the *generation target* (MiniMax H3, Music 3, Qwen Image)
 * is what these tests are about. The *prompt model* (the LLM that writes the
 * prompt) is a separate concern and deliberately has no launch screen.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const mainSource = await read("../web/main.js");
const registrySource = await read("../web/target_registry.js");
const settingsSource = await read("../web/settings.js");
// The picker shell, which owns the action row. Read separately so a test can
// assert on the markup itself rather than on how main.js renders it.
const pickerMarkupSource = await read("../web/target_selection.js");
// Starter drafts, one per mode. Imported so the coverage test compares against
// the real map rather than against its source text.
const { MODE_DEFAULT_DRAFTS, defaultModeDraftFor } = await import("../web/mode_defaults.js");
// Stylesheets that can affect the workspace toolbar layout.
const styleModulesForLayout = {
  tokens: await read("../web/styles/tokens.css"),
  shell: await read("../web/styles/shell.css"),
  foundation: await read("../web/styles/foundation.css"),
  workbench: await read("../web/styles/workbench.css"),
  music: await read("../web/styles/music.css"),
  responsive: await read("../web/styles/responsive.css"),
  target_select: await read("../web/styles/target_select.css"),
};
const shellOrMusicStyles = styleModulesForLayout.shell
  + styleModulesForLayout.music
  + styleModulesForLayout.responsive;
const { allModeIds, defaultModeForTarget, defaultModeForWorkspace, modeDescriptor, panelForCategory, selectableModes, targetForMode, targetList } =
  await import("../web/target_registry.js");

/**
 * Mirror of targetCategoryGroups() in main.js, used to prove no target is lost.
 * Kept deliberately simple so a divergence shows up as a test failure.
 */
function targetCategoryGroupsFixture(targets, known) {
  const groups = [];
  for (const id of known) {
    const members = targets.filter((t) => t.category === id || (id === "image" && t.category === "image-edit"));
    if (members.length) groups.push(members);
  }
  const grouped = new Set(known);
  const rest = targets.filter((t) => !grouped.has(t.category) && t.category !== "image-edit");
  if (rest.length) groups.push(rest);
  return groups;
}

test("every workspace has a distinct panel and its own mode set", () => {
  const workspaces = [...new Set(targetList().map((target) => target.workspace))];
  assert.deepEqual(workspaces.sort(), ["image", "music", "video"]);

  const video = selectableModes(targetList().find((t) => t.workspace === "video")).map((m) => m.id);
  const image = selectableModes(targetList().find((t) => t.workspace === "image")).map((m) => m.id);
  assert.deepEqual(video, ["T2VA", "I2VA", "FL2VA", "L2VA", "Reference"]);
  assert.deepEqual(image, ["TextToImage", "ImageEdit"]);
  // The two workspaces must not share modes, or switching would not change modes.
  assert.equal(video.filter((id) => image.includes(id)).length, 0);
});

test("each target category maps to its own input panel", () => {
  assert.equal(panelForCategory("video"), "video");
  assert.equal(panelForCategory("audio"), "music");
  assert.equal(panelForCategory("image"), "image");
  assert.equal(panelForCategory("image-edit"), "image");
});

test("image modes resolve to the image panel and edit mode carries an instruction field", () => {
  assert.equal(targetForMode("TextToImage").workspace, "image");
  assert.equal(targetForMode("ImageEdit").workspace, "image");
  assert.equal(modeDescriptor("TextToImage").instruction_field, undefined);
  assert.equal(modeDescriptor("ImageEdit").instruction_field, "edit_instruction");
});

test("the image-edit mode accepts ten images and no other media type", () => {
  const edit = modeDescriptor("ImageEdit");
  assert.equal(edit.requires_media, true);
  assert.equal(edit.limits.image, 10);
  assert.equal(edit.limits.total, 10);
  // An image-edit model takes stills only: no video or audio slots at all.
  assert.equal(edit.limits.video, undefined);
  assert.equal(edit.limits.audio, undefined);
  // And the target itself declares image as its only capability.
  assert.deepEqual(targetForMode("ImageEdit").media_capabilities, ["image"]);
});

test("text-only modes declare no media requirement and no slots", () => {
  for (const modeId of ["TextToImage", "T2VA"]) {
    const mode = modeDescriptor(modeId);
    assert.equal(mode.requires_media, false, `${modeId} should not require media`);
    assert.deepEqual(mode.limits, {}, `${modeId} should offer no media slots`);
    assert.ok(mode.hint, `${modeId} should still explain itself in the hint line`);
  }
});

test("a mode without media renders no drop box and hides the Media label", () => {
  // renderMedia clears and hides the media container when requires_media is false,
  // instead of rendering the old "Start from a text description" placeholder.
  assert.match(mainSource, /const usesMedia = Boolean\(modeDescriptor\(mode\)\?\.requires_media\)/);
  assert.match(mainSource, /media\.innerHTML = "";[\s\S]{0,60}media\.hidden = true;/);
  assert.match(mainSource, /media\.hidden = false;/);
  assert.doesNotMatch(mainSource, /Start from a text description/);
  // The "Media" label under the mode title is hidden with the box.
  assert.match(mainSource, /if \(mediaLabel\) mediaLabel\.hidden = true;/);
  assert.match(mainSource, /if \(mediaLabel\) mediaLabel\.hidden = false;/);
  // `.ps-media` has a 150px min-height, so [hidden] must win for the space to collapse.
  assert.match(
    styleModulesForLayout.target_select,
    /\.ps-media\[hidden\][^{]*\{[^}]*display:\s*none/,
  );
});

test("the Media label sits under the mode title in both panels", () => {
  // <small>Media</small> follows the title, not precedes it.
  assert.match(mainSource, /<span><strong data-ps-mode-title><\/strong><small data-media-label>Media<\/small><\/span>/);
  assert.match(mainSource, /<span><strong data-ps-image-mode-title><\/strong><small data-media-label>Media<\/small><\/span>/);
  // The old order and the old image wording are gone.
  assert.doesNotMatch(mainSource, /<span><small>Media<\/small><strong/);
  assert.doesNotMatch(mainSource, /Source images/);
});

test("the hint paragraphs were removed from every panel", () => {
  assert.doesNotMatch(mainSource, /ps-section-hint/);
  assert.doesNotMatch(mainSource, /data-ps-mode-hint|data-ps-image-mode-hint/);
  // And no dead CSS is left behind.
  for (const [name, css] of Object.entries(styleModulesForLayout)) {
    assert.doesNotMatch(css, /\.ps-section-hint/, `${name} still styles the removed hint`);
  }
});

test("the header has no Official guides button or dropdown", () => {
  assert.doesNotMatch(mainSource, /Official guides/);
  assert.doesNotMatch(mainSource, /data-guide-toggle|data-guide-menu|data-guide-picker/);
  assert.doesNotMatch(mainSource, /isGuideMenuInteraction/);
  // The Settings button keeps the shared button class it always used.
  assert.match(mainSource, /class="ps-guide-button" type="button" data-open-settings-header>Settings<\/button>/);
  for (const [name, css] of Object.entries(styleModulesForLayout)) {
    assert.doesNotMatch(css, /\.ps-guide-menu|\.ps-guide-picker/, `${name} still styles the removed dropdown`);
  }
});

test("every aspect-ratio control is bound, not just the first", () => {
  // Both the video and image panels render `aspectRatioMarkup`. Binding with a
  // single querySelector() wired only the video copy, so the image panel's
  // dropdown did nothing. All controls must be bound and share one value.
  assert.match(mainSource, /aspectRatioControls = \[\];/);
  assert.match(mainSource, /root\.querySelectorAll\('\[data-choice-toggle\$="-aspect"\], \[data-choice-toggle="aspect"\]'\)\.forEach/);
  assert.match(mainSource, /aspectRatioControls\.push\(bindAspectRatio\(field, studio\.aspectRatio/);
  // Changing one control updates the others.
  assert.match(mainSource, /function syncAspectRatioControls\(value\)/);
  assert.match(mainSource, /for \(const control of aspectRatioControls\) control\?\.update\?\.\(value\)/);
  // A bare querySelector on the toggle must never come back.
  assert.doesNotMatch(mainSource, /bindAspectRatio\(root\.querySelector\('\[data-choice-toggle="aspect"\]'\)\.closest/);
  // The image panel uses its own key so the two controls do not collide.
  assert.match(mainSource, /aspectRatioMarkup\(icon, "image-aspect"\)/);
});

test("the prompt-model pill is the last child of the input panel and stays pinned", () => {
  // It must come after every workspace panel so it sits at the bottom.
  const panelStart = mainSource.indexOf('class="ps-input-panel"');
  const pillIndex = mainSource.indexOf("${generateModelSummaryMarkup(icon)}", panelStart);
  assert.ok(pillIndex > 0, "the pill must render inside the input panel");
  for (const marker of ["data-video-inputs", "data-music-inputs", "data-image-inputs"]) {
    const at = mainSource.indexOf(marker, panelStart);
    assert.ok(at > 0 && at < pillIndex, `${marker} must come before the pill`);
  }

  // The panel is a non-scrolling flex column: an inner scroller plus the pill.
  // `position: sticky` CANNOT work here — the pill is the last child, so there is
  // no scroll room below it and it never sticks. Making the panel itself
  // `flex column` is not enough either: every child becomes a flex item with
  // flex-shrink: 1, which compresses tall content so the panel stops scrolling.
  assert.match(mainSource, /<div class="ps-input-scroll" data-input-scroll>/);
  const css = styleModulesForLayout.workbench;
  assert.match(css, /\.ps-input-panel \{ display: flex; flex-direction: column; overflow: hidden; \}/);
  assert.match(css, /\.ps-input-scroll \{[^}]*flex: 1 1 auto/);
  assert.match(css, /\.ps-input-scroll \{[^}]*overflow: auto/);
  assert.match(css, /\.ps-input-panel > \.ps-active-model \{[^}]*flex: 0 0 auto/);
  // The sticky approach must not come back.
  assert.doesNotMatch(css, /\.ps-input-panel > \.ps-active-model \{[^}]*position:\s*sticky/);
  // The panel itself must not scroll, or it would scroll behind the pill.
  assert.doesNotMatch(css, /\.ps-input-panel, \.ps-output-panel \{ min-width: 0; min-height: 0; overflow: auto; \}/);
  // The pill's insets track the panel padding, so they follow every breakpoint.
  assert.match(css, /margin: 0 var\(--ps-input-panel-pad-inline\) var\(--ps-input-panel-pad-bottom\)/);
  assert.match(styleModulesForLayout.tokens, /--ps-input-panel-pad-bottom:/);
  assert.match(styleModulesForLayout.tokens, /--ps-input-panel-pad-inline:/);
});

test("the pill matches the input content width instead of overflowing it", () => {
  // The pill shares `.ps-active-model`, which is `width: 100%` for its other
  // usage. Inside the panel that width is measured BEFORE the inline margins
  // are subtracted, so the box overflowed the content column by exactly
  // 2 x --ps-input-panel-pad-inline. `width: auto` + `align-self: stretch`
  // lets the flex container resolve the width after the margins, so the pill's
  // left and right edges line up with the media inputs above it.
  const css = styleModulesForLayout.workbench;
  // Slice from the selector to the end of the block. A `[^}]*` body match would
  // stop at the `}` inside the explanatory comment this rule carries.
  const pillStart = css.indexOf(".ps-input-panel > .ps-active-model {");
  assert.ok(pillStart >= 0, "the pill override must exist");
  const pill = css.slice(pillStart, css.indexOf("}", css.indexOf("width: auto", pillStart)) + 1);
  assert.match(pill, /width: auto/);
  assert.match(pill, /align-self: stretch/);
  // A percentage width here is the bug: it ignores the inline margins. Compare
  // declarations only — the rule's own comment quotes the broken value.
  const declarations = pill.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(declarations, /width: 100%/);
  // The shared rule may keep 100%; only the panel-scoped one must override it.
  assert.match(css, /\.ps-active-model \{[^}]*width: 100%/);
});

test("the input scroller hides its scrollbar like the other panels", () => {
  // The scroller exists so the pill can stay pinned, which introduced a real
  // 16px scrollbar regression. It must be listed alongside the panels in both
  // the Firefox and WebKit scrollbar-suppression rules.
  const foundation = styleModulesForLayout.foundation;
  const suppression = foundation.match(/\.ps-input-panel,[^}]*\}/)?.[0];
  assert.ok(suppression, "the scrollbar suppression list must exist");
  assert.match(suppression, /\.ps-input-scroll/);
  assert.match(suppression, /scrollbar-width: none/);
  const webkit = foundation.match(/\.ps-input-panel::-webkit-scrollbar,[^}]*\}/)?.[0];
  assert.ok(webkit, "the WebKit scrollbar list must exist");
  assert.match(webkit, /\.ps-input-scroll::-webkit-scrollbar/);
  assert.match(webkit, /display: none/);
});

test("settings controls sit below the brief in both panels", () => {
  // Slice from the panel MARKUP, not the first mention of the hook: the draft
  // constants earlier in the file also contain these strings.
  const videoPanel = mainSource.slice(
    mainSource.indexOf('<div data-video-inputs'),
    mainSource.indexOf("<div class=\"ps-music-inputs\""),
  );
  assert.ok(videoPanel.length > 0, "video panel markup not found");
  assert.ok(videoPanel.indexOf("data-video-brief") < videoPanel.indexOf("ps-duration-field"),
    "Creative brief must precede the duration control");
  assert.ok(videoPanel.indexOf("data-video-brief") < videoPanel.indexOf("aspectRatioMarkup"),
    "Creative brief must precede the aspect-ratio control");

  // Image: briefs, then aspect ratio.
  const imagePanel = mainSource.slice(
    mainSource.indexOf('<div class="ps-image-inputs"'),
    mainSource.indexOf("${generateModelSummaryMarkup(icon)}"),
  );
  assert.ok(imagePanel.length > 0, "image panel markup not found");
  assert.ok(imagePanel.indexOf("data-image-brief") < imagePanel.indexOf("image-aspect"),
    "Image brief must precede the aspect-ratio control");
  assert.ok(imagePanel.indexOf("data-edit-instruction") < imagePanel.indexOf("image-aspect"),
    "Edit instruction must precede the aspect-ratio control");
});

test("Image Edit submits the edit instruction, never the hidden Image brief", () => {
  // The brief carries a class so it can be hidden; the instruction has the field.
  assert.match(mainSource, /<label class="ps-brief ps-image-brief">/);
  assert.match(mainSource, /const imageBrief = studio\.root\.querySelector\("\.ps-image-brief"\)/);
  assert.match(mainSource, /if \(imageBrief\) imageBrief\.hidden = edits;/);
  // Only the edit mode declares an instruction field.
  assert.equal(modeDescriptor("ImageEdit").instruction_field, "edit_instruction");
  assert.equal(modeDescriptor("TextToImage").instruction_field, undefined);
  // The brief is hidden in edit mode but currentBriefTextarea() still returned it,
  // so its stale default text was submitted as creative_brief without the user
  // being able to see or clear it.
  assert.match(mainSource, /if \(panel === "image" && modeDescriptor\(studio\.mode\)\?\.instruction_field\) \{/);
  assert.match(mainSource, /const instruction = studio\.root\.querySelector\("\[data-edit-instruction\]"\);\s*if \(instruction\) return instruction;/);
  // Text to Image still uses the Image brief, since it has no instruction field.
  assert.match(mainSource, /: panel === "image" \? "\[data-image-brief\]"/);
});

test("media drag-and-drop binds the container of the active panel", () => {
  // bindMediaActions() looked up [data-ps-media] unconditionally, which is the
  // video panel's container, so the image panel never got a drop handler.
  assert.match(mainSource, /const mediaSelector = panel === "image" \? "\[data-ps-image-media\]" : "\[data-ps-media\]";/);
  assert.match(mainSource, /const media = studio\.root\.querySelector\(mediaSelector\) \|\| studio\.root\.querySelector\("\[data-ps-media\]"\);/);
  // The bare lookup must not return.
  assert.doesNotMatch(mainSource, /function bindMediaActions\(mode\) \{\s*const media = studio\.root\.querySelector\("\[data-ps-media\]"\);/);
});

test("the image panel's media container exists for drops to bind to", () => {
  assert.match(mainSource, /<div class="ps-media" data-ps-image-media><\/div>/);
  assert.match(mainSource, /<div class="ps-media" data-ps-media><\/div>/);
});

test("the workspace markup provides a panel for every category", () => {
  // A panel per category, each tagged so syncWorkspace can show exactly one.
  assert.match(mainSource, /data-video-inputs data-workspace-panel="video"/);
  assert.match(mainSource, /data-image-inputs data-workspace-panel="image" hidden/);
  assert.match(mainSource, /data-music-inputs/);
  // And the image panel owns the fields the image contract needs.
  assert.match(mainSource, /data-ps-image-media/);
  assert.match(mainSource, /data-image-brief/);
  assert.match(mainSource, /data-edit-instruction/);
});

test("syncWorkspace resolves the panel from the target category, not a binary switch", () => {
  assert.match(mainSource, /const category = registryTarget\?\.category/);
  assert.match(mainSource, /const panel = category === "audio" \? "music" : category === "image" \|\| category === "image-edit" \? "image" : "video"/);
  // The old binary test must not come back.
  assert.doesNotMatch(mainSource, /const music = studio\.mode === "Music3" \|\| active\?\.dataset\.workspace === "music"/);
});

test("mode tabs re-render per target and rebind their clicks", () => {
  // The builder takes a TARGET, not a workspace. A workspace lookup returns the
  // first target in that workspace, so Krea 2 (sharing "image" with Qwen) would
  // render Qwen's T2I/Edit chips instead of its own.
  assert.match(mainSource, /function modeButtonsMarkup\(target\)/);
  assert.match(mainSource, /const modes = target \? selectableModes\(target\) : \[\]/);
  assert.doesNotMatch(mainSource, /function modeButtonsMarkup\(workspace\)/);
  // The initial markup must resolve a target too, not pass a workspace string.
  assert.match(mainSource, /\$\{modeButtonsMarkup\(defaultTarget\(\)\)\}/);
  assert.doesNotMatch(mainSource, /modeButtonsMarkup\("video"\)/);
  assert.match(mainSource, /function defaultTarget\(\)/);
  // Keyed on the resolved target, not the workspace, so two targets sharing a
  // workspace category cannot render each other's modes.
  assert.match(mainSource, /const targetKey = registryTarget\?\.id \|\| workspace/);
  assert.match(mainSource, /modeRow\.dataset\.rendered !== `\$\{targetKey\}:\$\{desired\}`/);
  assert.match(mainSource, /function bindModeButtons\(\)/);
  assert.match(mainSource, /function selectMode\(mode\)/);
});

test("every target renders its own mode chips, not its workspace's", () => {
  // The mode row must be per target. Two image targets must not produce the same
  // chip set, which is exactly what a workspace lookup would do.
  const renderChipsFor = (target) => (target ? selectableModes(target).map((m) => m.id) : []);
  const imageTargets = targetList().filter((t) => t.workspace === "image");
  assert.ok(imageTargets.length >= 2, "expected two image targets to tell apart");
  const rendered = imageTargets.map(renderChipsFor);
  assert.deepEqual(rendered, imageTargets.map((t) => t.modes.filter((m) => !m.output_only).map((m) => m.id)));
  assert.notDeepEqual(rendered[0], rendered[1], "two targets in one workspace must not share identical chips");
  // A null target renders nothing rather than throwing.
  assert.deepEqual(renderChipsFor(null), []);
});

test("confirming a target selects that target's default mode", () => {
  // The workspace tabs are gone, so this switching now happens only through the
  // picker. confirmTargetSelection must land on the target's declared default.
  assert.match(mainSource, /const nextMode = defaultModeForTarget\(target\.id\) \|\| defaultModeForWorkspace\(target\.workspace\)/);
  assert.match(mainSource, /defaultModeForTarget/);
  // Regression: the image workspace used to fall back to a video mode.
  assert.doesNotMatch(mainSource, /const nextMode = defaultModeForWorkspace\(workspace\) \|\| studio\.lastVideoMode;/);
  // And the old workspace-tab click handler must not come back, or there would be
  // two competing target selectors.
  assert.doesNotMatch(mainSource, /querySelectorAll\("\[data-workspace\]"\)\.forEach\(\(button\) => button\.addEventListener/);
});

test("two targets in one workspace each resolve to their own default mode", () => {
  // Qwen Image 2.1 and Krea 2 are both "image". Resolving a default mode by
  // workspace returned whichever came first in the list - Qwen's TextToImage -
  // even when Krea 2 was the target the user picked. That made the studio switch
  // to the wrong target and Krea 2 look like it had vanished from the menu.
  const imageTargets = targetList().filter((t) => t.workspace === "image");
  assert.ok(imageTargets.length >= 2, "expected Qwen and Krea 2 to share the image workspace");
  const defaults = imageTargets.map((t) => defaultModeForTarget(t.id));
  assert.deepEqual(
    defaults,
    imageTargets.map((t) => t.default_mode),
    "each target must resolve its own default mode",
  );
  // Distinct modes, or the lookup could not tell the two apart at all.
  assert.equal(new Set(defaults).size, defaults.length, "shared workspace needs distinct default modes");
  // And every one of them resolves back to the target it came from.
  for (const target of imageTargets) {
    assert.equal(targetForMode(target.default_mode).id, target.id, target.id);
  }
  // The ambiguous lookup still exists for callers that genuinely have no target,
  // but it must return the FIRST image target - proof the ambiguity is real.
  assert.equal(defaultModeForWorkspace("image"), imageTargets[0].default_mode);
});

test("an unknown target resolves to no default mode rather than a wrong one", () => {
  assert.match(registrySource, /export function defaultModeForTarget\(targetId\) \{\s*return targetById\(targetId\)\?\.default_mode \?\? null;/);
  assert.equal(defaultModeForTarget("not_a_target"), null);
});

test("renderMedia writes into the visible panel's container", () => {
  assert.match(mainSource, /const mediaSelector = panel === "image" \? "\[data-ps-image-media\]" : "\[data-ps-media\]"/);
  assert.match(mainSource, /const media = studio\.root\.querySelector\(mediaSelector\);\s*if \(!media\) return;/);
});

test("the brief field follows the active panel", () => {
  assert.match(mainSource, /const selector = panel === "music" \? "\[data-music-brief\]"/);
  assert.match(mainSource, /panel === "image" \? "\[data-image-brief\]"/);
  assert.doesNotMatch(mainSource, /isAudioMode\(studio\.mode\) \? "\[data-music-brief\]" : "\[data-video-brief\]"/);
});

test("the image workspace is styled and registered", () => {
  assert.match(mainSource, /studio\.root\.classList\.toggle\("is-image", image\)/);
  // Every style module referenced by main.js must exist on disk.
  const styleModules = [...mainSource.replace(/\r\n/g, "\n").matchAll(/^  "([a-z0-9-]+)",$/gm)].map((m) => m[1]);
  assert.ok(styleModules.length >= 10, "style module list should not be empty");
  assert.ok(!styleModules.includes("model_select"), "model_select.css was deleted and must not be listed");
});

// The prompt model (the LLM that writes prompts) must NOT have a launch screen.
// Only the generation target does. An earlier revision confused the two and
// built an LLM picker instead of a target picker.
test("there is no launch screen for the prompt model", () => {
  assert.doesNotMatch(mainSource, /modelSelectionMarkup|setModelSelectionOpen|confirmModelSelection/);
  assert.doesNotMatch(mainSource, /data-model-select|data-change-model/);
  // The original top-bar pill is restored and opens Settings, not a picker.
  assert.match(mainSource, /querySelector\("\[data-open-settings\]"\)\.addEventListener\("click", \(\) => setSettingsOpen\(true\)\)/);
  assert.match(settingsSource, /data-open-settings/);
  assert.doesNotMatch(settingsSource, /data-change-model|ps-model-summary-row/);
});

test("no mode is left without a workspace or panel", () => {
  for (const modeId of allModeIds()) {
    const target = targetForMode(modeId);
    assert.ok(target, `${modeId} has no target`);
    assert.ok(target.workspace, `${modeId} has no workspace`);
    assert.ok(panelForCategory(target.category), `${modeId} has no panel`);
  }
});

// The launch screen selects the *generation target* (H3 / Music 3 / Qwen Image),
// which is the only place that choice is made now that the mode tabs are gone.
test("the target picker leads on every launch and covers the whole studio", () => {
  assert.match(mainSource, /targetSelectionMarkup\(\)/);
  assert.match(mainSource, /setTargetSelectionOpen\(true\)/);
  // Covering the studio means hiding the workspace view, not merely overlapping it.
  assert.match(mainSource, /studio\.root\.querySelectorAll\("\[data-generate-view\]"\)\.forEach\(\(element\) => \{ element\.hidden = open; \}\)/);
  // It must not be gated behind a stored "seen" flag.
  assert.doesNotMatch(mainSource, /targetSelectionSeen|hasSeenTargetSelection/);
});

test("the picker is built from the registry, not a hardcoded target list", () => {
  assert.match(mainSource, /const targets = targetList\(\)/);
  assert.doesNotMatch(mainSource, /MINIMAX_H3_TARGETS|const TARGETS = \[/);
  // Every target in the registry must be offerable, with its selectable modes.
  for (const target of targetList()) {
    assert.ok(selectableModes(target).length > 0, `${target.id} has no selectable modes`);
    assert.ok(target.label, `${target.id} has no label to show in the picker`);
  }
  assert.ok(targetList().length >= 3, "expected at least the three shipped targets");
});

test("Krea 2 ships as a text-to-image-only image target", () => {
  const krea = targetList().find((t) => t.id === "krea_2");
  assert.ok(krea, "krea_2 must be in the built-in snapshot");
  assert.equal(krea.category, "image");
  assert.equal(krea.workspace, "image");
  // Text to image only: no editing mode and no input media.
  assert.deepEqual(selectableModes(krea).map((m) => m.id), ["Krea2TextToImage"]);
  assert.deepEqual(krea.media_capabilities, []);
  assert.equal(krea.default_mode, "Krea2TextToImage");
  // It sits beside Qwen under Image, and its mode label is the familiar T2I.
  assert.equal(modeDescriptor("Krea2TextToImage").label, "T2I");
  assert.equal(modeDescriptor("Krea2TextToImage").requires_media, false);
  assert.equal(panelForCategory(krea.category), "image");
  // Its mode id must be unique, so the same-mode lookup still resolves.
  assert.equal(targetForMode("Krea2TextToImage").id, "krea_2");
  assert.equal(targetForMode("TextToImage").id, "qwen_image_2.1");
});

test("a target is only offered when it has a selectable mode", () => {
  assert.match(mainSource, /function targetIsAvailable\(target\)/);
  assert.match(mainSource, /return selectableModes\(target\)\.length > 0/);
  // Confirm is disabled for an unavailable target so the studio cannot open empty.
  assert.match(mainSource, /confirm\.disabled = !chosen \|\| !targetIsAvailable\(chosen\)/);
});

test("confirming a target switches workspace and enters the studio", () => {
  assert.match(mainSource, /function confirmTargetSelection\(\)/);
  assert.match(mainSource, /const nextMode = defaultModeForTarget\(target\.id\)/);
  assert.match(mainSource, /setTargetSelectionOpen\(false\)/);
});

test("each target category resolves to a distinct icon", () => {
  // targetIconName must handle every category the registry actually ships.
  assert.match(mainSource, /function targetIconName\(target\)/);
  const iconFor = (category) => (category === "audio" ? "audio"
    : category === "image" || category === "image-edit" ? "image"
    : "video");
  for (const target of targetList()) {
    const expected = iconFor(target.category);
    if (expected === "video") continue; // the fallback branch, no comparison
    assert.match(
      mainSource,
      new RegExp(`category === "${target.category}"[^\\n]*"${expected}"`),
      `${target.id} (${target.category}) needs an icon branch returning "${expected}"`,
    );
  }
  // Distinct categories must not collapse onto one icon.
  const icons = new Set(targetList().map((t) => iconFor(t.category)));
  assert.ok(icons.size >= 2, "targets should not all share one icon");
});

test("the target indicator replaces the mode tabs' row and reopens the picker", () => {
  assert.match(mainSource, /function targetIndicatorMarkup\(\)/);
  assert.match(mainSource, /function syncTargetIndicator\(\)/);
  assert.match(mainSource, /data-open-target-select/);
  // One click must reopen the picker, so switching never costs a restart.
  assert.match(mainSource, /querySelector\("\[data-open-target-select\]"\)\.addEventListener\("click", \(\) => setTargetSelectionOpen\(true\)\)/);
  // The indicator lives in the toolbar that used to hold only the mode tabs.
  assert.match(mainSource, /class="ps-target-indicator" data-target-indicator/);
  // Mode chips survive beside it, so changing mode stays one click.
  assert.match(mainSource, /data-workspace-modes/);
});

test("the target indicator replaces ps-workspaces in the header", () => {
  // The Video / Music / Qwen Image 2.1 tab bar is gone, replaced in place.
  assert.doesNotMatch(mainSource, /ps-workspaces|workspaceButtonsMarkup|workspaceLabel/);
  assert.doesNotMatch(shellOrMusicStyles, /\.ps-workspaces/);
  // The indicator sits in the header, between the brand and the header meta,
  // which is exactly where ps-workspaces used to be.
  assert.match(mainSource, /<div class="ps-brand">[\s\S]{0,300}<div class="ps-target-indicator" data-target-indicator>[\s\S]{0,200}<div class="ps-header-meta">/);
  // Exactly one markup slot for the indicator, and no second copy in the toolbar.
  const slots = mainSource.split('<div class="ps-target-indicator" data-target-indicator>').length - 1;
  assert.equal(slots, 1, "expected exactly one indicator slot, in the header");
});

test("the indicator keeps its click handler across re-renders", () => {
  // syncTargetIndicator must update the existing button, not replace it: swapping
  // the element dropped the bound listener and left a dead Change Target button.
  assert.match(mainSource, /const button = slot\.querySelector\("\.ps-target-indicator-button"\)/);
  assert.match(mainSource, /if \(!button\) return;/);
  assert.doesNotMatch(mainSource, /slot\.insertAdjacentHTML\("afterbegin", targetIndicatorMarkup\(\)\)/);
  assert.doesNotMatch(mainSource, /const stale = slot\.querySelector\("\.ps-target-indicator-button"\)/);
  // The label is patched in place rather than re-created.
  assert.match(mainSource, /const label = button\.querySelector\("strong"\)/);
  assert.match(mainSource, /label\.textContent = target\.label \|\| target\.id/);
});

test("the picker groups targets under Image, Video and Audio", () => {
  assert.match(mainSource, /function targetCategoryGroups\(targets\)/);
  // Fixed order, with each heading labelled exactly as specified.
  const order = mainSource.slice(mainSource.indexOf("function targetCategoryGroups"));
  const imageAt = order.indexOf('label: "Image"');
  const videoAt = order.indexOf('label: "Video"');
  const audioAt = order.indexOf('label: "Audio"');
  assert.ok(imageAt >= 0 && videoAt > imageAt && audioAt > videoAt, "groups must be ordered Image, Video, Audio");
  // Every shipped target lands in exactly one group.
  const categories = new Set(targetList().map((t) => t.category));
  for (const category of categories) {
    assert.ok(
      ["image", "video", "audio", "image-edit"].includes(category),
      `unhandled category ${category} would fall into the "Other" bucket`,
    );
  }
  // Nothing may be silently dropped: unknown categories are appended, not hidden.
  assert.match(mainSource, /label: "Other"/);
  assert.match(mainSource, /const rest = targets/);
});

test("grouping keeps every shipped target visible", () => {
  // Mirror targetCategoryGroups() to prove no shipped target is lost.
  const known = ["image", "video", "audio"];
  const groups = targetCategoryGroupsFixture(targetList(), known);
  const shown = groups.flatMap((g) => g.map((t) => t.id)).sort();
  const expected = targetList().map((t) => t.id).sort();
  assert.deepEqual(shown, expected, "every target must appear in a group");
});

test("the picker lays the categories out as three side-by-side columns", () => {
  const css = styleModulesForLayout.target_select;
  // The list is the grid; each group is a column. `repeat(3, minmax(0, 1fr))`
  // keeps the columns equal and lets them shrink instead of overflowing.
  const list = css.match(/\.ps-target-select-list \{[^}]*\}/)?.[0];
  assert.ok(list, ".ps-target-select-list must be styled");
  assert.match(list, /display:\s*grid/);
  assert.match(list, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  // A short category must not stretch its card to the tallest column's height.
  assert.match(list, /align-items:\s*start/);
  // auto-fit would collapse to fewer columns as the shell narrows, which reads as
  // a broken layout rather than a deliberate one; the count must stay explicit.
  assert.doesNotMatch(list, /auto-fit/);

  const group = css.match(/\.ps-target-select-group \{[^}]*\}/)?.[0];
  assert.ok(group, ".ps-target-select-group must be styled");
  assert.match(group, /align-content:\s*start/);
  // min-width: 0 stops a long target name from forcing the column wider.
  assert.match(group, /min-width:\s*0/);

  // Cards stack one per row inside a column, not side by side.
  assert.match(css, /\.ps-target-select-group-items \{[^}]*grid-template-columns:\s*1fr/);

  // Narrow viewports stack the categories instead of squeezing three columns.
  assert.match(css, /@media \(max-width: 720px\)[\s\S]{0,160}\.ps-target-select-list \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("the picker shell is wide enough for three columns", () => {
  // 760px was sized for one stacked list; three tracks at that width leaves
  // ~230px per card, too narrow for a target label plus mode chips.
  const shell = styleModulesForLayout.target_select.match(/\.ps-target-select-shell \{[^}]*\}/)?.[0];
  assert.ok(shell, ".ps-target-select-shell must be styled");
  const width = Number(shell.match(/width:\s*min\((\d+)px,\s*100%\)/)?.[1] || 0);
  assert.ok(width >= 960, `shell width ${width}px is too narrow for three columns`);
});

test("no workspace injects a grid item ahead of the mode row", () => {
  // `.ps-workspace-toolbar` is a two-column grid holding [.ps-modes, .ps-output-toolbar].
  // A generated-content pseudo-element on that grid becomes an anonymous grid ITEM,
  // taking the first cell and pushing the mode row into the right column, which is
  // what put the Qwen and Music mode buttons above "Generated prompt".
  const toolbarPseudo = /\.ps-workspace-toolbar(?:::before|::after)\s*\{[^}]*content\s*:/;
  assert.doesNotMatch(mainSource, toolbarPseudo);
  for (const [name, css] of Object.entries(styleModulesForLayout)) {
    assert.doesNotMatch(
      css,
      toolbarPseudo,
      `${name} injects generated content into .ps-workspace-toolbar, which steals the first grid column`,
    );
  }
  // In particular the per-workspace labels must stay gone.
  assert.doesNotMatch(shellOrMusicStyles, /is-music \.ps-workspace-toolbar::before/);
  assert.doesNotMatch(shellOrMusicStyles, /is-image \.ps-workspace-toolbar::before/);
});

test("the toolbar grid is modes-then-output, matching every workspace", () => {
  // Both children must be in the source, in this order, with nothing between.
  const toolbar = mainSource.slice(
    mainSource.indexOf('class="ps-workspace-toolbar"'),
    mainSource.indexOf("</div>\n\n      <div class=\"ps-workspace\"") >= 0
      ? mainSource.indexOf("</div>\n\n      <div class=\"ps-workspace\"")
      : mainSource.indexOf("</div>", mainSource.indexOf('class="ps-workspace-toolbar"') + 2000),
  );
  const navIndex = toolbar.indexOf("ps-modes");
  const outputIndex = toolbar.indexOf("ps-output-toolbar");
  assert.ok(navIndex >= 0, "the mode row must live in the toolbar");
  assert.ok(outputIndex >= 0, "the output label must live in the toolbar");
  assert.ok(navIndex < outputIndex, "the mode row must come before the output label");
  // And the grid definition keeps modes in the first column.
  assert.match(styleModulesForLayout.shell + styleModulesForLayout.workbench, /\.ps-workspace-toolbar[^{]*\{[^}]*grid-template-columns/);
});

test("the picker has no Settings button and keeps Continue as its only action", () => {
  // The Settings button was removed: Settings is reachable from the studio once a
  // target is chosen, so advertising it up front was an extra way out of a screen
  // whose whole job is to pick one thing.
  assert.doesNotMatch(mainSource, /data-target-select-settings/);
  assert.doesNotMatch(pickerMarkupSource, /data-target-select-settings/);
  assert.match(mainSource, /querySelector\("\[data-target-select-confirm\]"\)\.addEventListener\("click", confirmTargetSelection\)/);
  // Continue is the only button, so it carries the primary style.
  assert.match(pickerMarkupSource, /class="ps-primary-button"[^>]*data-target-select-confirm/);
});

test("closing Settings cannot reveal the workspace behind the open picker", () => {
  // setSettingsOpen(false) re-shows [data-generate-view]; if the picker is still
  // open that would drop the workspace on top of it, so the flag must be honoured.
  assert.match(mainSource, /const workspaceHidden = open \|\| Boolean\(studio\.targetSelectionOpen\)/);
  assert.match(mainSource, /forEach\(\(element\) => \{ element\.hidden = workspaceHidden; \}\)/);
  // And opening the picker closes Settings so there is one thing on screen.
  assert.match(mainSource, /if \(open\) setSettingsOpen\(false\)/);
});

test("every registry mode has a starter draft relevant to its own target", () => {
  // Regression: an unmapped mode fell back to the FIRST entry in the map, so
  // Krea 2, Qwen T2I/Edit and Lyrics all opened with the H3 bicycle-courier
  // VIDEO prompt, complete with [Shot 1] markers and an overall_soundscape
  // section that only make sense for a video target.
  const modes = [];
  for (const target of targetList()) {
    for (const mode of target.modes) modes.push({ target, mode });
  }
  assert.ok(modes.length >= 10, "expected the full shipped mode set");

  for (const { target, mode } of modes) {
    const draft = MODE_DEFAULT_DRAFTS[mode.id];
    assert.ok(draft, `${target.id}/${mode.id} has no starter draft`);
    assert.equal(typeof draft.brief, "string", `${mode.id}.brief`);
    assert.equal(typeof draft.prompt, "string", `${mode.id}.prompt`);

    // An output-only mode (Lyrics) writes into the lyrics field instead of a
    // caption, so it is the one legitimate case with an empty prompt.
    if (mode.output_only) {
      assert.ok((draft.lyrics || "").trim(), `${mode.id} needs starter lyrics`);
      continue;
    }
    assert.ok(draft.brief.trim(), `${mode.id} has no starter brief`);
    assert.ok(draft.prompt.trim(), `${mode.id} has no starter prompt`);
  }

  assert.deepEqual(
    Object.keys(MODE_DEFAULT_DRAFTS).sort(),
    [...new Set(modes.map((m) => m.mode.id))].sort(),
    "the draft map and the registry must list the same modes",
  );
});

test("a starter prompt never leaks another target's contract", () => {
  const VIDEO_ONLY = /\[Shot\s+\d+\]|overall_soundscape|non_diegetic_music|retention_analysis/;
  const AUDIO_ONLY = /###\s+(?:Global Metadata|Vocal Details|Arrangement)/;

  for (const target of targetList()) {
    for (const mode of target.modes) {
      const draft = MODE_DEFAULT_DRAFTS[mode.id];
      if (!draft || mode.output_only) continue;
      const text = `${draft.brief}\n${draft.prompt}`;
      if (target.category !== "video") {
        assert.doesNotMatch(
          text,
          VIDEO_ONLY,
          `${target.id}/${mode.id} uses video-only sections; an image or audio starter must not`,
        );
      }
      if (target.category !== "audio") {
        assert.doesNotMatch(
          text,
          AUDIO_ONLY,
          `${target.id}/${mode.id} uses the music caption headings outside an audio target`,
        );
      }
    }
  }
});

test("an unmapped mode gets empty fields rather than a borrowed example", () => {
  // A wrong example is worse than none: it invites the model to answer in
  // another target's shape.
  assert.deepEqual(defaultModeDraftFor("NotAMode"), { brief: "", prompt: "", lyrics: "" });
  assert.match(mainSource, /return defaultModeDraftFor\(mode\)/);
  // The first-entry fallback must not come back.
  assert.doesNotMatch(mainSource, /Object\.values\(MODE_DEFAULT_DRAFTS\)\[0\]/);
});
