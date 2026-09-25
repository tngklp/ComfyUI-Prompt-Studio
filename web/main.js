import { createDesktopNotifications } from "./desktop_notifications.js";
import { promptHighlightMarkup } from "./prompt_highlights.js";
import { MODE_DEFAULT_DRAFTS, defaultModeDraftFor } from "./mode_defaults.js";
import { fitTextarea, generationButtonMarkup, sequenceNotificationOptions, aspectRatioMarkup, bindAspectRatio, modeOptionsMarkup, bindModeOptions, selectedModeOptionChoice, splitMenuMarkup, setSplitMenuOpen, copyButtonMarkup } from "./writer_controls.js";
import { mediaVisualDescriptor } from "./media_visual.js";
import { createSequenceWorkspace } from "./sequence_workspace.js";
import { generateSequence, cancelSequence } from "./api/sequence.js";
import { app } from "/scripts/app.js";
import { cancel, clearMedia, createMediaPlaceholder, diagnoseGGUFRuntime, disconnectApiProvider, freeComfyVram, generate, getApiProviderModels, getApiProviderPresets, getModels, getOllamaStatus, getStatus, getTargets, probeApiProvider, probeExternalServer, refine, removeMedia, reorderMedia, resolveCharacters, searchCharacters, selectProjector, unloadModel, updateMediaPlaceholder, uploadMedia } from "./api/prompt_studio.js";
import { comfyVramIsAlreadyEmpty, createSessionId, fileCountFromDataTransfer, insertReferenceAtCaret, isChoiceMenuInteraction, isRuntimeMenuInteraction, moveOntoTarget, replacementTargetForFileDrop, replaceEventListener, vramReleaseReachedTarget } from "./compat.js";
import { generateModelSummaryMarkup, settingsMarkup } from "./settings.js";
import { targetSelectionMarkup } from "./target_selection.js";
import {
  buildGeneratePayload,
  buildLyricsRefinePayload,
  buildRefinePayload,
  audioWasAdded,
  clearPromptDraft,
  createStudioState,
  isGenerationModeAvailable,
  isPersistedDraftMode,
  isTextOnlyDirectModel,
  DEFAULT_OLLAMA_HOST,
  INTERFACE_SIZES,
  loadOllamaModel,
  loadOllamaHost,
  loadUserPreferences,
  normalizeModeOptionSelection,
  normalizeOllamaHost,
  saveApiProviderConfig,
  saveExternalServerConfig,
  saveOllamaHost,
  saveOllamaModel,
  saveModeDrafts,
  saveUserPreferences,
  restoredModelAfterDiscovery,
  selectModelState,
} from "./studio_state.js";
import { autoVramControlMarkup, createVramHandoffCoordinator, installVramHandoff, isLocalOllamaHost, releaseComfyVramWhenIdle, unloadWriterModels } from "./vram_handoff.js";
import { draftFile, draftFilename, parseDraft } from "./draft_files.js";
import { referenceTextRemapper } from "./reference_labels.js";
import { createLazyMediaTool } from "./media_tools.js";
import { promptForText } from "./text_prompt.js";
import { guardAgainstStaleBundle } from "./bundle_guard.js";
import { characterPickerMarkup, createCharacterPicker } from "./character_picker.js";
import { escapeHtml as escapeHtmlShared } from "./html.js";

import { editMedia } from "./api/prompt_studio.js";
import {
  adoptTargetCatalog,
  allModeIds,
  defaultModeForTarget,
  defaultModeForWorkspace,
  describesAudio,
  modeBriefLimit,
  modeDescriptor,
  modeLyricsLimit,
  panelForCategory,
  selectableModes,
  targetForMode,
  targetList,
} from "./target_registry.js";

const EXTENSION_NAME = "prompt.studio";
const LAUNCHER_SCHEMA_VERSION = "2";
// The version this bundle was built as. Kept in sync with `backend/version.py` by
// `tests/frontend_regressions.mjs`, so a stale module can be detected at load time
// by comparing it with the version the backend reports.
const EXTENSION_VERSION = "1.1.0";
const VRAM_HANDOFF_SUPPORTED = typeof app?.queuePrompt === "function";
const HOST_CAPABILITIES = { windowed: true, comfyMemory: VRAM_HANDOFF_SUPPORTED, workflowMedia: true, ...app.psHost };
const vramHandoffCoordinator = createVramHandoffCoordinator();
const INSTALLATION_GUIDE_URL = "https://github.com/tngklp/ComfyUI-Prompt-Studio/blob/main/docs/INSTALLATION.md";
const TROUBLESHOOTING_GUIDE_URL = "https://github.com/tngklp/ComfyUI-Prompt-Studio/blob/main/docs/TROUBLESHOOTING.md";

// Mode presentation for the video workspace, derived from the generation-target
// registry. `limit` is the image-slot count the media panel enforces.
const MODES = Object.fromEntries(
  selectableModes(targetList().find((target) => target.workspace === "video"))
    .map((mode) => [mode.id, {
      title: mode.title,
      hint: mode.hint,
      assets: [],
      ...(mode.limits?.image != null ? { limit: mode.limits.image } : {}),
    }]),
);

/** Image-slot limit for a mode, or null when the mode is unlimited. */
function modeImageLimit(mode) {
  return modeDescriptor(mode)?.limits?.image ?? null;
}

/** Labels of the modes a text-only prompt model can still run. */
function textOnlyModeLabels() {
  const labels = selectableModes()
    .filter((mode) => !mode.requires_media)
    .map((mode) => mode.label || mode.id);
  return labels.length ? labels.join(" and ") : "text modes";
}

/** The workspace of the currently selected mode. */
function currentWorkspace() {
  if (!studio) return "video";
  return targetForMode(studio.mode)?.workspace
    || targetList()[0]?.workspace
    || "video";
}

/** The target backing a workspace. */
function targetForWorkspace(workspace) {
  return targetList().find((target) => target.workspace === workspace) || targetList()[0] || null;
}

/**
 * The target the studio opens on when no target is chosen yet.
 *
 * Prefers the video target, matching the historical default mode, then falls back
 * to whatever the registry lists first so an empty or video-less registry still
 * renders a mode row.
 */
function defaultTarget() {
  return targetForWorkspace("video") || targetList()[0] || null;
}

/** The target the current mode belongs to. */
function activeTarget() {
  return targetForMode(studio?.mode) || targetForWorkspace(currentWorkspace());
}

/** Icon name for a target category. */
function targetIconName(target) {
  if (target?.category === "audio") return "audio";
  if (target?.category === "image" || target?.category === "image-edit") return "image";
  return "video";
}

/**
 * Compact indicator in the toolbar row, showing which generation target is
 * active. Clicking it reopens the picker with the current target preselected,
 * so switching stays one click even though the picker is the only selector.
 */
function targetIndicatorMarkup() {
  const target = activeTarget();
  if (!target) return "";
  return `<button class="ps-target-indicator-button" type="button" data-open-target-select title="Change generation target">
    ${icon(targetIconName(target), 15)}
    <strong>${escapeHtml(target.label || target.id)}</strong>
    <em>Change</em>
  </button>`;
}

/**
 * Re-render the indicator in place.
 *
 * Replaces only the inner markup so the button element itself survives. Swapping
 * the element would drop the click listener bound during setup and leave a dead
 * button, which is exactly what happened when this used insertAdjacentHTML.
 */
function syncTargetIndicator() {
  if (!studio?.root) return;
  const slot = studio.root.querySelector("[data-target-indicator]");
  if (!slot) return;
  const button = slot.querySelector(".ps-target-indicator-button");
  if (!button) return;
  const target = activeTarget();
  if (!target) return;
  const label = button.querySelector("strong");
  if (label) label.textContent = target.label || target.id;
  button.title = `Generation target: ${target.label || target.id}. Click to change.`;
  const glyph = button.querySelector("svg");
  if (glyph && targetIconName(target) !== glyph.dataset.targetIcon) {
    glyph.outerHTML = icon(targetIconName(target), 15);
  }
  const next = button.querySelector("svg");
  if (next) next.dataset.targetIcon = targetIconName(target);
}

/** True when the target has at least one selectable mode. */
function targetIsAvailable(target) {
  return selectableModes(target).length > 0;
}

/**
 * Render the generation target picker. Targets come from the registry, so a
 * target added to targets.json appears here without any code change.
 */
function syncTargetSelection() {
  if (!studio?.root) return;
  const view = studio.root.querySelector("[data-target-select-view]");
  if (!view) return;

  const targets = targetList();
  const list = view.querySelector("[data-target-select-list]");
  // Grouped under Image, Video and Audio. Any category the registry introduces
  // that is not one of these is appended rather than dropped, so a new target is
  // never invisible just because the headings have not been updated.
  list.innerHTML = targetCategoryGroups(targets).map((group) => `
    <section class="ps-target-select-group" aria-label="${escapeHtml(group.label)}">
      <header class="ps-target-select-group-heading">
        ${icon(group.icon, 15)}
        <strong>${escapeHtml(group.label)}</strong>
        <small>${group.targets.length} target${group.targets.length === 1 ? "" : "s"}</small>
      </header>
      <div class="ps-target-select-group-items">
        ${group.targets.map((target) => targetSelectItemMarkup(target)).join("")}
      </div>
    </section>`).join("");

  const chosen = targets.find((target) => target.id === studio.targetSelectChoice) || null;
  const confirm = view.querySelector("[data-target-select-confirm]");
  confirm.disabled = !chosen || !targetIsAvailable(chosen);

  const status = view.querySelector("[data-target-select-status]");
  status.textContent = `${targets.length} target(s) available`;
}

/**
 * Targets grouped for display, in a fixed Image / Video / Audio order.
 *
 * Categories outside that list are appended in registry order so nothing is
 * silently hidden.
 */
function targetCategoryGroups(targets) {
  const known = [
    { id: "image", label: "Image", icon: "image" },
    { id: "video", label: "Video", icon: "video" },
    { id: "audio", label: "Audio", icon: "audio" },
  ];
  const byLabel = (a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id));
  const groups = [];
  for (const entry of known) {
    const members = targets
      .filter((target) => target.category === entry.id
        || (entry.id === "image" && target.category === "image-edit"))
      .sort(byLabel);
    if (members.length) groups.push({ ...entry, targets: members });
  }
  const grouped = new Set(known.map((entry) => entry.id));
  const rest = targets
    .filter((target) => !grouped.has(target.category) && !(target.category === "image-edit"))
    .sort(byLabel);
  if (rest.length) groups.push({ id: "__other", label: "Other", icon: "grid", targets: rest });
  return groups;
}

/** One selectable target card. */
function targetSelectItemMarkup(target) {
  const selected = target.id === studio.targetSelectChoice;
  const available = targetIsAvailable(target);
  const modes = selectableModes(target).map((mode) => escapeHtml(mode.label || mode.id));
  return `<button type="button" role="radio" aria-checked="${selected}" class="ps-target-select-item ${selected ? "is-selected" : ""} ${available ? "" : "is-unavailable"}" ${available ? "" : "disabled"} data-target-select-id="${escapeHtml(target.id)}">
    <span class="ps-target-select-item-head">
      ${icon(targetIconName(target), 16)}
      <strong>${escapeHtml(target.label || target.id)}</strong>
      ${selected ? icon("check", 14) : ""}
    </span>
    <span class="ps-target-select-modes">${modes.map((mode) => `<span>${mode}</span>`).join("")}</span>
  </button>`;
}

/**
 * Show or hide the target picker. It covers the whole studio, so the workspace
 * behind it is hidden rather than merely inert.
 */
function setTargetSelectionOpen(open) {
  if (!studio?.root) return;
  const view = studio.root.querySelector("[data-target-select-view]");
  if (!view) return;
  studio.targetSelectionOpen = open;
  view.hidden = !open;
  studio.root.querySelectorAll("[data-generate-view]").forEach((element) => { element.hidden = open; });
  // Settings is a sibling row, so it wins on paint order; close it on open so the
  // picker is what the user actually sees. The picker's own Settings button
  // closes the picker before opening Settings, so the two never fight.
  if (open) setSettingsOpen(false);
  studio.root.classList.toggle("is-target-select-open", open);
  if (open) {
    // Preselect whatever is already active so reopening is not disorienting.
    studio.targetSelectChoice = activeTarget()?.id || targetList()[0]?.id || null;
    syncTargetSelection();
  }
}

/** Apply the chosen target: switch to its workspace and enter the studio. */
function confirmTargetSelection() {
  if (!studio) return;
  const target = targetList().find((candidate) => candidate.id === studio.targetSelectChoice);
  if (!target || !targetIsAvailable(target)) return;
  // The chosen TARGET's own default mode, not its workspace's: Qwen Image 2.1 and
  // Krea 2 both live in the "image" workspace, so a workspace lookup would return
  // whichever of the two is listed first and select the wrong target's mode.
  const nextMode = defaultModeForTarget(target.id) || defaultModeForWorkspace(target.workspace);
  if (nextMode && nextMode !== studio.mode) {
    stashCurrentModeDraft();
    studio.mode = nextMode;
    if (!describesAudio(nextMode)) studio.lastVideoMode = nextMode;
  }
  setTargetSelectionOpen(false);
  syncWorkspace();
  syncTargetIndicator();
  restoreModeDraft(studio.mode);
  renderMedia(studio.mode);
  syncRuntimeSummary();
  saveUserPreferences(localStorage, studio);
}

/**
 * Mode tabs for one target, excluding output-only companion modes.
 *
 * Takes a target, not a workspace: two targets can share a workspace (Qwen Image
 * 2.1 and Krea 2 are both "image"), so a workspace lookup returns whichever is
 * listed first and renders the wrong target's modes.
 */
function modeButtonsMarkup(target) {
  const modes = target ? selectableModes(target) : [];
  return modes
    .map((mode) => `<button type="button" role="tab" data-mode="${escapeHtml(mode.id)}">${escapeHtml(mode.label || mode.id)}</button>`)
    .join("");
}

/** Rebind clicks after the mode row is re-rendered for a new workspace. */
function bindModeButtons() {
  if (!studio?.root) return;
  studio.root.querySelectorAll("[data-mode]").forEach((button) => {
    if (button.dataset.modeBound === "true") return;
    button.dataset.modeBound = "true";
    button.addEventListener("click", () => selectMode(button.dataset.mode));
  });
}

/** Switch the active mode, keeping drafts and the workspace panel in sync. */
function selectMode(mode) {
  if (!studio || !mode) return;
  if (!isGenerationModeAvailable(studio.selectedModel, mode)) return;
  if (mode === studio.mode) return;
  stashCurrentModeDraft();
  studio.mode = mode;
  if (!describesAudio(mode)) studio.lastVideoMode = mode;
  syncWorkspace();
  restoreModeDraft(studio.mode);
  renderMedia(studio.mode);
  syncRuntimeSummary();
  saveUserPreferences(localStorage, studio);
}

/**
 * Mode descriptor for the current registry. Falls back to the built-in MODES
 * table so a mode the server does not know still renders.
 */
function modeData(mode) {
  const descriptor = modeDescriptor(mode);
  if (descriptor) {
    return {
      title: descriptor.title,
      hint: descriptor.hint,
      limit: descriptor.limits?.image ?? undefined,
      tabTitle: descriptor.tabTitle,
    };
  }
  return MODES[mode] || { title: mode, hint: "", assets: [] };
}

/** True when the mode belongs to an audio target. */
function isAudioMode(mode) {
  return describesAudio(mode);
}

const SAMPLE_PROMPT = MODE_DEFAULT_DRAFTS.Reference.prompt;
let studio;
let workflowRevision = 0;
// One entry per rendered aspect-ratio control (video panel and image panel).
// Each exposes { close, update } from bindAspectRatio().
let aspectRatioControls = [];
let mediaPanelRequest = 0;
let ggufRuntimeDiagnosticsPromise = null;
let referenceInsertTarget = null;
let studioReturnFocus = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function countWords(value) {
  return String(value).trim().match(/\S+/gu)?.length || 0;
}

function promptLengthMeta(value) {
  return `${value.length.toLocaleString()} characters · ${countWords(value).toLocaleString()} words`;
}

function formatGenerationMeta(result) {
  const peakVram = result.peak_vram_mb ? ` · ${(result.peak_vram_mb / 1024).toFixed(1)} GB peak` : "";
  const load = Number(result.model_load_seconds || 0).toFixed(1);
  const media = Number(result.media_processing_seconds || 0).toFixed(1);
  const llm = Number(result.generation_seconds || 0).toFixed(1);
  const fallback = result.thinking_fallback ? " · Thinking fallback" : "";
  const memory = result.context_tokens ? ` · ${Math.round(result.context_tokens / 1024)}K/${String(result.kv_cache).toUpperCase()}` : "";
  const timing = result.api_provider
    ? `${result.total_seconds.toFixed(1)}s total (${media}s media · ${llm}s provider)`
    : result.external_server
    ? `${result.total_seconds.toFixed(1)}s total (${media}s media · ${llm}s server)`
    : `${result.total_seconds.toFixed(1)}s total (${load}s load · ${media}s media · ${llm}s LLM)`;
  const speed = Number.isFinite(result.tokens_per_second) ? ` · ${result.tokens_per_second.toFixed(1)} tok/s` : "";
  const apiRequests = result.api_provider ? ` · ${result.provider_request_count || 1} API request${result.provider_request_count === 1 ? "" : "s"}` : "";
  const cost = Number.isFinite(result.provider_cost_usd) ? ` · $${result.provider_cost_usd.toFixed(4)} reported` : "";
  const usage = result.api_provider && result.usage_source ? ` · usage ${result.usage_source}` : "";
  return `${promptLengthMeta(result.prompt)} · ${timing}${speed}${apiRequests}${cost}${usage}${peakVram}${memory}${fallback}`;
}

function syncOutputLengthMeta() {
  if (!studio) return;
  const output = studio.root.querySelector("[data-output]");
  const meta = studio.root.querySelector(".ps-editor-meta span:last-child");
  const suffix = meta.textContent.replace(/^[\d,.]+ (?:chars|characters)(?: · [\d,.]+ words)?(?: · )?/i, "");
  meta.textContent = `${promptLengthMeta(output.value)}${suffix ? ` · ${suffix}` : ""}`;
}

function newGenerationSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
}

function renderPromptHighlights() {
  if (!studio) return;
  const editor = studio.root.querySelector("[data-output]");
  const layer = studio.root.querySelector("[data-prompt-highlights]");
  if (!editor || !layer) return;
  // The Anima highlighter needs the resolved character triggers to tell a character
  // tag from an ordinary one, and the target id to know which projection to use.
  layer.innerHTML = promptHighlightMarkup(editor.value, "official", {
    targetId: targetForMode(studio.mode)?.id || null,
    characters: (studio.characters || []).map((entry) => entry.trigger),
  }) + "\n";
  layer.scrollTop = editor.scrollTop;
  layer.scrollLeft = editor.scrollLeft;
}

function syncModifiedState() {
  if (!studio) return;
  const output = studio.root.querySelector("[data-output]");
  const hasBaseline = typeof studio.lastModelPrompt === "string";
  const modified = hasBaseline ? output.value !== studio.lastModelPrompt : true;
  studio.outputModified = modified;
  studio.root.querySelector("[data-undo-edits]").hidden = !modified || !hasBaseline;
}

const STYLE_MODULES = [
  "tokens",
  "themes/dark",
  "themes/light",
  "foundation",
  "shell",
  "workbench",
  "media",
  "composer",
  "editor",
  "floating-media",
  "settings",
  "models",
  "providers",
  "prompts",
  "overlays",
  "music",
  "target_select",
  "responsive",
  "sequence",
  "text_prompt",
  "characters",
];

/**
 * Cache-busting token for assets this module injects by URL.
 *
 * ComfyUI serves the extension's `WEB_DIRECTORY` through its own static handler
 * with no `Cache-Control`, so a browser may reuse a cached stylesheet or module
 * until the user hard-refreshes. An injected `<link>` is fetched by our own code,
 * so we can append a token and sidestep the browser cache entirely; the extension
 * version is the natural token because it changes exactly when the files do.
 *
 * `main.js` itself is imported by the host and cannot be cache-busted from inside,
 * so an out-of-date *module* is caught by `bundle_guard.js` instead.
 */
let assetToken = null;

function setAssetToken(token) {
  assetToken = typeof token === "string" && token ? token : null;
}

function brandedAssetUrl(relative) {
  const url = new URL(relative, import.meta.url);
  if (assetToken) url.searchParams.set("v", assetToken);
  return url.href;
}

function injectStyles() {
  for (const name of STYLE_MODULES) {
    const existing = document.querySelector(`link[data-ps-style="${name}"]`);
    const href = brandedAssetUrl(`./styles/${name}.css`);
    // Replace a link whose URL predates the current token. Without this the first
    // render of a session would pin the old stylesheet for the whole session.
    if (existing) {
      if (existing.dataset.psStyleHref === href) continue;
      existing.remove();
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.psStyle = name;
    link.dataset.psStyleHref = href;
    document.head.appendChild(link);
  }
}

function icon(name, size = 16) {
  const paths = {
    spark: '<path d="M12 2l1.25 3.75L17 7l-3.75 1.25L12 12l-1.25-3.75L7 7l3.75-1.25L12 2Z"/><path d="M5 12l.8 2.2L8 15l-2.2.8L5 18l-.8-2.2L2 15l2.2-.8L5 12Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-4-4L5 20"/>',
    video: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2v-4Z"/>',
    audio: '<path d="M4 12h2m2-4v8m4-12v16m4-13v10m4-7v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    play: '<path d="m9 7 8 5-8 5V7Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 6v12M16 6v12" stroke-width="3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.35 5.65L20 14"/><path d="M20 7v4h-4"/>',
    memory: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/>',
    collapse: '<path d="M8 8H3V3m13 5h5V3M8 16H3v5m13-5h5v5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
    moon: '<path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3Z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
    edit: '<path d="M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4Z"/><path d="m14.5 5.5 4 4"/>',
  };
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="--ps-icon-size:${size}px" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}

function isPlaceholderAsset(asset) {
  return Boolean(asset) && asset.status === "placeholder";
}

/** Collect a reference description through the shared text prompt. */
function promptForReferenceDescription(options) {
  return promptForText({
    root: studio.root,
    multiline: true,
    limit: 1000,
    placeholder: "e.g. a red delivery bicycle leaning against a brick wall",
    ...options,
  });
}

function renderAsset(asset, index) {
  const destructiveDisabled = studio.requestBusy ? "disabled" : "";
  const tagDisabled = studio.requestBusy ? "disabled" : "";
  const draggable = studio.requestBusy ? "false" : "true";
  // A declared slot has no file, so it renders as a prompt card rather than a
  // broken thumbnail: the description IS the content.
  if (isPlaceholderAsset(asset)) {
    return `
    <div class="ps-asset is-placeholder" tabindex="0" role="group" aria-label="Declared reference slot" draggable="${draggable}" data-asset-index="${index}" data-asset-id="${asset.id}" data-replace-label="Add the file for ${escapeHtml(asset.reference || asset.filename)}">
      <span class="ps-asset-preview ps-placeholder" aria-hidden="true">${icon("plus", 18)}</span>
      <span class="ps-asset-copy">
        <strong>${asset.reference ? `<button type="button" class="ps-media-tag is-${asset.type}" data-media-tag="${escapeHtml(asset.reference)}" ${tagDisabled} title="Insert reference at text cursor">${escapeHtml(asset.reference)}</button>` : escapeHtml(asset.type)}</strong>
        <small class="ps-placeholder-note">Not attached yet · ${escapeHtml(asset.description || "no description")}</small>
      </span>
      <button class="ps-edit-placeholder" type="button" data-edit-placeholder="${asset.id}" title="Edit the description of ${escapeHtml(asset.reference || asset.filename)}" aria-label="Edit the description of ${escapeHtml(asset.reference || asset.filename)}" ${destructiveDisabled}>${icon("edit", 12)}</button>
      <button class="ps-replace-asset" type="button" data-replace-asset="${asset.id}" title="Attach the real file for ${escapeHtml(asset.reference || asset.filename)}" aria-label="Attach the real file for ${escapeHtml(asset.reference || asset.filename)}" ${destructiveDisabled}>${icon("refresh", 12)}</button>
      <button class="ps-remove-asset" type="button" data-remove-asset="${asset.id}" title="Remove ${escapeHtml(asset.reference || asset.filename)}" aria-label="Remove ${escapeHtml(asset.reference || asset.filename)}" ${destructiveDisabled}>${icon("close", 12)}</button>
    </div>`;
  }
  const visual = asset.type === "audio"
    ? `<div class="ps-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>`
    : asset.preview_url
      ? `<span class="ps-thumb-backdrop" style="background-image:url('${asset.preview_url}')"></span><img class="ps-real-thumb" src="${asset.preview_url}" alt="">`
      : `<div class="ps-thumb-art ps-tone-${asset.tone || "blue"}"><span></span></div>`;
  const overlay = asset.type === "video" ? `<span class="ps-play">${icon("play", 18)}</span>` : "";
  const duration = formatDuration(asset.duration);
  return `
    <div class="ps-asset" tabindex="0" role="group" aria-label="Media inspector" draggable="${draggable}" data-asset-index="${index}" data-asset-id="${asset.id}" data-replace-label="Replace ${escapeHtml(asset.reference || asset.filename)}">
      <span class="ps-asset-preview ps-${asset.type}">${visual}${overlay}</span>
      <span class="ps-asset-copy">
        <strong>${asset.reference ? `<button type="button" class="ps-media-tag is-${asset.type}" data-media-tag="${escapeHtml(asset.reference)}" ${tagDisabled} title="Insert reference at text cursor">${escapeHtml(asset.reference || asset.filename)}</button>` : (asset.status === "needs_edit" ? "Trim required" : escapeHtml(asset.type))}</strong>
        <small>${escapeHtml(asset.filename)}</small>
      </span>
      ${duration ? `<span class="ps-duration">${duration}</span>` : ""}
      <button class="ps-replace-asset" type="button" data-replace-asset="${asset.id}" title="Replace ${escapeHtml(asset.reference || asset.filename)}" aria-label="Replace ${escapeHtml(asset.reference || asset.filename)}" ${destructiveDisabled}>${icon("refresh", 12)}</button>
      <button class="ps-remove-asset" type="button" data-remove-asset="${asset.id}" title="Remove ${escapeHtml(asset.reference || asset.filename)}" aria-label="Remove ${escapeHtml(asset.reference || asset.filename)}" ${destructiveDisabled}>${icon("close", 12)}</button>
    </div>`;
}

/**
 * Declare a reference slot with no file attached.
 *
 * This is the escape hatch for "I know there will be images here": the user gets
 * the tag, writes what the media will contain, and the prompt model writes from
 * that description instead of refusing until a vision model is loaded.
 */
async function addMediaPlaceholder(kind = "image") {
  if (studio.requestBusy) return;
  const mode = studio.sequence?.mediaMode(studio.mode) ?? studio.mode;
  if (!modeDescriptor(mode)?.requires_media) return;
  const description = await promptForReferenceDescription({
    title: `Plan a ${kind === "video" ? "Video" : "Picture"} reference`,
    detail: "Describe what this reference will contain. The prompt model writes from your words, so nothing about it is invented.",
    confirm: "Declare reference",
  });
  if (description === null) return;
  try {
    const result = await createMediaPlaceholder(studio.sessionId, mode, kind, description);
    studio.sessionId = result.session_id;
    acceptMediaAssets(result.assets);
    renderMedia(studio.mode);
    showToast(
      `${result.asset.reference} declared`,
      "Write the tag in your brief, then attach the file when you have it.",
      null, null, { dismissOnWorkspaceClick: true },
    );
  } catch (error) {
    showToast(error.code || "Could not declare the reference", error.message, error.details);
  }
}

async function editMediaPlaceholder(assetId) {
  const asset = studio.assets.find((item) => item.id === assetId);
  if (!asset || studio.requestBusy) return;
  const description = await promptForReferenceDescription({
    title: `Describe ${asset.reference || "this reference"}`,
    detail: "The prompt model writes from this description and is told it has not seen the media.",
    confirm: "Save description",
    value: asset.description || "",
  });
  if (description === null || description === (asset.description || "")) return;
  try {
    const result = await updateMediaPlaceholder(studio.sessionId, assetId, description);
    acceptMediaAssets(result.assets);
    renderMedia(studio.mode);
  } catch (error) {
    showToast(error.code || "Could not update the description", error.message, error.details);
  }
}

function referenceComposerAssets() {
  return studio.assets.filter((asset) => asset.mode === "Reference" && mediaVisualDescriptor(asset));
}

function composerAddState() {
  const assets = studio.assets.filter((asset) => asset.mode === "Reference");
  const pictureCount = assets.filter((asset) => asset.type === "image").length;
  if (studio.requestBusy) return { allowed: false, message: "Wait for the current Prompt Studio request to finish." };
  if (pictureCount >= 9) return { allowed: false, message: "Remove a Picture before adding the composition." };
  if (assets.length >= 12) return { allowed: false, message: "Remove a reference before adding the composition." };
  return { allowed: true, reference: `<Picture ${pictureCount + 1}>` };
}

function syncComposerControl(mode = studio.mode) {
  const panel = studio.root.querySelector("[data-media-panel-action]");
  if (panel) {
    panel.disabled = !studio.assets.some(asset => ["image", "video", "audio"].includes(asset.type) && asset.content_url);
    panel.title = panel.disabled ? "Add media first" : "Open Media panel";
  }
  const button = studio.root.querySelector("[data-open-composer]");
  if (!button) return;
  const sources = mode === "Reference" ? referenceComposerAssets() : [];
  button.disabled = studio.requestBusy || !sources.length;
  button.title = mode !== "Reference" ? "Switch to Reference mode"
    : studio.requestBusy ? "Wait for the current request to finish"
    : sources.length ? `Compose a new Picture from ${sources.length} media source${sources.length === 1 ? "" : "s"}`
    : "Add a Picture or Video first";
}

async function addComposedPicture({ blob, width, height, mimeType, filename, sources }) {
  const file = new File([blob], filename, { type: mimeType });
  const result = await uploadMedia(studio.sessionId, "Reference", [file]);
  studio.sessionId = result.session_id;
  studio.assets = [...studio.assets, ...result.assets];
  studio.mediaFilter = studio.mediaFilter === "image" ? "image" : "all";
  renderMedia("Reference");
  const added = result.assets[0];
  showToast(
    `${added.reference} added`,
    `Composed from ${sources.length} source${sources.length === 1 ? "" : "s"} · ${width}×${height} PNG.`,
  );
}

function openMediaComposer(trigger) {
  if (studio.mode !== "Reference" || studio.requestBusy) return;
  const assets = referenceComposerAssets();
  if (!assets.length) return;
  setClearMenuOpen(false);
  studio.mediaComposer.open({ assets, trigger: studio.root.querySelector("[data-actions-menu-toggle]") });
}

function notifyMediaCompatibility() {
  const pending=studio.assets.filter(a=>a.status==="needs_edit");
  const total=studio.assets.filter(a=>a.mode==="Reference"&&a.type==="video"&&a.status!=="needs_edit").reduce((sum,a)=>sum+(a.duration||0),0);
  const signature=pending.map(a=>a.id).join("|")+":"+(total>15);
  if(signature===studio.mediaCompatibilityNotice)return;
  studio.mediaCompatibilityNotice=signature;
  const messages=[];
  if(pending.length)messages.push("Trim the video source to 2–15 seconds and Apply to use it as a reference.");
  if(total>15)messages.push("Reference videos exceed 15 seconds in total. Prompt generation is still available; check the target model's limits.");
  if(messages.length)showToast("Reference media",messages.join(" "),null,null,{dismissOnWorkspaceClick:true});
}

/**
 * A one-line note under the media box when media handling changes what the prompt
 * model will actually receive. Both states change the meaning of an attached
 * reference, and neither is visible from the cards alone.
 */
function mediaModeNoticeMarkup(mode) {
  const assets = studio.assets.filter((asset) => asset.mode === mode);
  if (!assets.length) return "";
  const declared = assets.filter(isPlaceholderAsset).length;
  const attached = assets.length - declared;
  const notes = [];
  if (declared) {
    notes.push(`${declared} declared reference${declared === 1 ? "" : "s"} written from your description, not from media.`);
  }
  if (attached && studio.blindMedia) {
    notes.push(`${attached} attached file${attached === 1 ? "" : "s"} withheld from the prompt model by Media-blind mode.`);
  }
  if (!notes.length) return "";
  return `<p class="ps-media-mode-note" data-media-mode-note>${icon("info", 12)}<span>${notes.join(" ")}</span></p>`;
}

/**
 * Adopt a new asset list, rewriting Single Reference tags so they keep pointing at
 * the same media. Sequence keeps its own chunk-local labels and is left alone.
 */
function acceptMediaAssets(next) {
  const previous = studio.assets;
  const remap = referenceTextRemapper(previous, next);
  studio.assets = next;
  if (studio.mode !== "Reference") return;
  const fields = ["[data-video-brief]", "[data-output]", "[data-refine-instruction]"];
  for (const selector of fields) {
    const field = studio.root.querySelector(selector);
    if (field) field.value = remap(field.value);
  }
  studio.lastModelPrompt = remap(studio.lastModelPrompt);
  for (const draft of Object.values(studio.modeDrafts || {})) {
    draft.brief = remap(draft.brief);
    draft.prompt = remap(draft.prompt);
  }
  if (studio.refineRestore) {
    studio.refineRestore.prompt = remap(studio.refineRestore.prompt);
    studio.refineRestore.lastModelPrompt = remap(studio.refineRestore.lastModelPrompt);
  }
  updateBriefLayout();
  renderPromptHighlights();
  syncModifiedState();
  saveCurrentModeDraft();
  studio.root.querySelector(".ps-editor-meta span:last-child").textContent = promptLengthMeta(studio.root.querySelector("[data-output]").value);
  if (previous.length && next.length && previous.length !== next.length) {
    showToast("References updated", "Reference labels follow the current media order. Check the tags in your brief and prompt.");
  }
}

function renderMedia(mode) {
  mode = studio.sequence?.mediaMode(mode) ?? mode;
  studio.floatingMedia?.refresh();
  if (isAudioMode(mode)) {
    studio.root.querySelectorAll("[data-mode]").forEach((button) => button.classList.remove("is-active"));
    syncComposerControl(mode);
    syncModeAvailability();
    return;
  }
  const data = modeData(mode);
  const assets = studio.assets.filter((asset) => asset.mode === mode);
  // Each workspace panel owns its own media container and title slots.
  const target = targetForMode(mode);
  const panel = target ? panelForCategory(target.category) : "video";
  const mediaSelector = panel === "image" ? "[data-ps-image-media]" : "[data-ps-media]";
  const titleSelector = panel === "image" ? "[data-ps-image-mode-title]" : "[data-ps-mode-title]";
  const media = studio.root.querySelector(mediaSelector);
  if (!media) return;
  studio.root.querySelector(titleSelector).textContent = data.title;
  studio.root.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  // A mode that does not use media renders no drop box at all, and the "Media"
  // label under the mode title is hidden with it, since there is no media.
  const usesMedia = Boolean(modeDescriptor(mode)?.requires_media);
  // Resolve the label inside the panel this mode renders into, not the first on
  // the page: both panels declare one, and only the active panel is visible.
  const panelSelector = panel === "image" ? "[data-image-inputs]" : "[data-video-inputs]";
  const mediaLabel = studio.root.querySelector(`${panelSelector} [data-media-label]`);
  if (!usesMedia) {
    media.innerHTML = "";
    media.hidden = true;
    if (mediaLabel) mediaLabel.hidden = true;
  } else {
    media.hidden = false;
    if (mediaLabel) mediaLabel.hidden = false;
    const isReference = mode === "Reference";
    const filter = isReference ? studio.mediaFilter : "all";
    const visibleAssets = filter === "all" ? assets : assets.filter((asset) => asset.type === filter);
    const counts = assets.reduce((result, asset) => ({ ...result, [asset.type]: (result[asset.type] || 0) + 1 }), {});
    const filters = isReference ? `
      <div class="ps-media-filters" aria-label="Reference type">
        <button type="button" data-media-filter="all" class="${filter === "all" ? "is-active" : ""}">All <b>${assets.length}/12</b></button>
        <button type="button" data-media-filter="image" class="${filter === "image" ? "is-active" : ""}">${icon("image", 13)} Images <b>${counts.image || 0}/9</b></button>
        <button type="button" data-media-filter="video" class="${filter === "video" ? "is-active" : ""}">${icon("video", 13)} Video <b>${counts.video || 0}/3</b></button>
        <button type="button" data-media-filter="audio" class="${filter === "audio" ? "is-active" : ""}">${icon("audio", 13)} Audio <b>${counts.audio || 0}/3</b></button>
      </div>` : "";
    const addLabel = !isReference || filter === "image" ? "Add image" : filter === "video" ? "Add video" : filter === "audio" ? "Add audio" : "Add media";
    const canAdd = isReference || assets.length < data.limit;
    // A slot can be declared before its file exists, so a prompt can be written
    // while the media is still being produced. Only offered where media is.
    const planMarkup = usesMedia
      ? `<div class="ps-placeholder-actions">
          <button type="button" class="ps-plan-reference" data-add-placeholder="image" ${studio.requestBusy ? "disabled" : ""} title="Reserve a reference tag and describe what will go there">${icon("image", 13)}<span>Plan a picture</span></button>
          ${isReference ? `<button type="button" class="ps-plan-reference" data-add-placeholder="video" ${studio.requestBusy ? "disabled" : ""} title="Reserve a reference tag for a video you have not attached yet">${icon("video", 13)}<span>Plan a video</span></button>` : ""}
        </div>`
      : "";
    media.innerHTML = `
      ${filters}
      <div class="ps-assets ${isReference ? "is-reference" : ""}">${visibleAssets.map((asset) => renderAsset(asset, assets.indexOf(asset))).join("")}
        ${canAdd ? `<button class="${assets.length ? "ps-add-asset" : "ps-empty-drop"}" type="button" data-add-media ${studio.requestBusy ? "disabled" : ""}>${icon("plus", 18)}<span>${addLabel}</span><small>Drop files here</small></button>` : ""}
      </div>
      ${planMarkup}
      ${mediaModeNoticeMarkup(mode)}`;
  }
  notifyMediaCompatibility();
  bindMediaActions(mode);
  syncComposerControl(mode);

  syncModeAvailability();
  studio.sequence?.refresh();
}

function rememberReferenceInsertTarget(editor) {
  if (!studio || isAudioMode(studio.mode) || !editor) return;
  referenceInsertTarget = { editor, caret: editor.selectionStart ?? editor.value.length };
}

function insertSelectedReference(reference, assetId) {
  if (studio.sequence?.insert(assetId)) return;
  if (isAudioMode(studio.mode)) return;
  const fallback = studio.root.querySelector("[data-output]");
  const target = referenceInsertTarget?.editor?.isConnected ? referenceInsertTarget : { editor: fallback, caret: fallback.selectionStart };
  target.editor.setSelectionRange(target.caret, target.caret);
  if (insertReferenceAtCaret(target.editor, reference, target.caret)) {
    rememberReferenceInsertTarget(target.editor);
  }
}

function bindMediaActions(mode) {
  // Bind the container for the panel this mode renders into. Using a bare
  // [data-ps-media] lookup always returned the video panel, so the image panel
  // never received a drop handler and drag-and-drop silently did nothing there.
  const target = targetForMode(mode);
  const panel = target ? panelForCategory(target.category) : "video";
  const mediaSelector = panel === "image" ? "[data-ps-image-media]" : "[data-ps-media]";
  const media = studio.root.querySelector(mediaSelector) || studio.root.querySelector("[data-ps-media]");
  if (!media) return;
  studio.root.querySelectorAll("[data-media-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      studio.mediaFilter = button.dataset.mediaFilter;
      renderMedia(mode);
    });
  });
  studio.root.querySelectorAll("[data-asset-index]").forEach((button) => {
    button.addEventListener("keydown",event=>{
      if(event.target===button && ["Enter"," "].includes(event.key)){event.preventDefault();button.click();}
    });
    button.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const asset = studio.assets.find((item) => item.id === button.dataset.assetId);
      if(asset.type === "image" || asset.type === "video"){if(!studio.requestBusy)studio.mediaEditor.open(asset,button);}
      else previewAsset(asset);
    });
  });
  studio.root.querySelectorAll("[data-replace-asset]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      button.blur();
      chooseMedia(mode, button.dataset.replaceAsset);
    });
  });
  studio.root.querySelectorAll("[data-media-tag]").forEach(button=>{
    button.addEventListener("pointerdown",e=>e.preventDefault());
    button.addEventListener("click",e=>{e.stopPropagation();if(!studio.requestBusy)insertSelectedReference(button.dataset.mediaTag,button.closest("[data-asset-id]")?.dataset.assetId);});
  });
  studio.root.querySelectorAll("[data-remove-asset]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        const result = await removeMedia(studio.sessionId, button.dataset.removeAsset);
        acceptMediaAssets(result.assets);
        renderMedia(studio.mode);
      } catch (error) {
        showToast(error.code || "Remove failed", error.message, error.details);
      }
    });
  });
  studio.root.querySelectorAll("[data-add-media]").forEach((button) => {
    button.addEventListener("click", () => chooseMedia(mode));
  });
  studio.root.querySelectorAll("[data-add-placeholder]").forEach((button) => {
    button.addEventListener("click", () => addMediaPlaceholder(button.dataset.addPlaceholder));
  });
  studio.root.querySelectorAll("[data-edit-placeholder]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      editMediaPlaceholder(button.dataset.editPlaceholder);
    });
  });
  studio.root.querySelectorAll("[data-asset-id]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      if (studio.requestBusy) {
        event.preventDefault();
        return;
      }
      studio.draggedAssetId = card.dataset.assetId;
      media.classList.add("is-reordering");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-ps-asset", card.dataset.assetId);
      const ghost = document.createElement("canvas");
      ghost.width = ghost.height = 1;
      ghost.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;pointer-events:none";
      studio.root.appendChild(ghost);
      studio.dragGhost = ghost;
      event.dataTransfer.setDragImage(ghost, 0, 0);
      requestAnimationFrame(() => card.classList.add("is-dragging"));
    });
    card.addEventListener("dragend", () => {
      studio.draggedAssetId = null;
      media.classList.remove("is-reordering");
      studio.dragGhost?.remove();
      studio.dragGhost = null;
      studio.root.querySelectorAll(".is-dragging, .is-drop-before, .is-drop-after, .is-file-replace-target").forEach((item) => item.classList.remove("is-dragging", "is-drop-before", "is-drop-after", "is-file-replace-target"));
    });
    card.addEventListener("dragover", (event) => {
      if (!studio.draggedAssetId && [...(event.dataTransfer.types || [])].includes("Files")) {
        event.preventDefault();
        studio.root.querySelectorAll(".is-file-replace-target").forEach((item) => item.classList.remove("is-file-replace-target"));
        if (replacementTargetForFileDrop(card.dataset.assetId, fileCountFromDataTransfer(event.dataTransfer))) {
          card.classList.add("is-file-replace-target");
        }
        event.dataTransfer.dropEffect = "copy";
        return;
      }
      if (!studio.draggedAssetId || studio.draggedAssetId === card.dataset.assetId) return;
      studio.root.querySelectorAll(".is-drop-before, .is-drop-after").forEach((item) => item.classList.remove("is-drop-before", "is-drop-after"));
      const modeAssets = studio.assets.filter((asset) => asset.mode === mode);
      const sourceIndex = modeAssets.findIndex((asset) => asset.id === studio.draggedAssetId);
      const targetIndex = modeAssets.findIndex((asset) => asset.id === card.dataset.assetId);
      const after = sourceIndex < targetIndex;
      card.classList.add(after ? "is-drop-after" : "is-drop-before");
    });
    card.addEventListener("dragleave", (event) => {
      if (!card.contains(event.relatedTarget)) card.classList.remove("is-file-replace-target");
    });
  });
  replaceEventListener(media, "dragover", "media", (event) => {
    event.preventDefault();
    if (studio.draggedAssetId) event.dataTransfer.dropEffect = "move";
  });
  replaceEventListener(media, "drop", "media", async (event) => {
    event.preventDefault();
    if (studio.requestBusy) return;
    const sourceId = event.dataTransfer.getData("application/x-ps-asset") || studio.draggedAssetId;
    const targetId = event.target.closest("[data-asset-id]")?.dataset.assetId;
    studio.root.querySelectorAll(".is-file-replace-target").forEach((item) => item.classList.remove("is-file-replace-target"));
    if (sourceId) {
      if (!targetId || sourceId === targetId) return;
      const modeAssets = studio.assets.filter((asset) => asset.mode === mode);
      const reorderedAssets = moveOntoTarget(modeAssets, sourceId, targetId);
      try {
        const result = await reorderMedia(studio.sessionId, mode, reorderedAssets.map((asset) => asset.id));
        acceptMediaAssets(result.assets);
        renderMedia(studio.mode);
      } catch (error) {
        showToast(error.code || "Reorder failed", error.message, error.details);
      }
      return;
    }
    const files = [...event.dataTransfer.files];
    uploadFiles(mode, files, replacementTargetForFileDrop(targetId, files.length));
  });
}

function previewAsset(asset) {
  if (!asset) return;
  showToast(asset.reference, `${formatDuration(asset.duration)} audio reference loaded.`);
}

function chooseMedia(mode, replaceAssetId = null) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = !replaceAssetId && (mode === "Reference" || mode === "FL2VA");
  input.accept = mode === "Reference" ? "image/*,video/*,audio/*" : "image/*";
  input.addEventListener("change", () => uploadFiles(mode, [...input.files], replaceAssetId));
  input.click();
}

async function uploadFiles(mode, files, replaceAssetId = null) {
  if (!files.length || studio.requestBusy) return;
  const existing = studio.assets.filter((asset) => asset.mode === mode);
  // studio.modeLimits is supplied by the caller; the media panel fills it from
  // the registry. Leave it absent to skip the slot check.
  const modeAssetLimit = studio.modeLimits?.[mode]?.image ?? null;
  if (modeAssetLimit != null && !replaceAssetId && existing.length + files.length > modeAssetLimit) {
    showToast("Reference slot is full", "Use Replace on the existing image.");
    return;
  }
  showToast("Processing media", "Creating previews and the ordered contact sheet…");
  const previousAssets = [...studio.assets];
  try {
    const result = await uploadMedia(studio.sessionId, mode, files, replaceAssetId);
    studio.sessionId = result.session_id;
    acceptMediaAssets(replaceAssetId ? result.assets : [...studio.assets, ...result.assets]);
    hideToast();
    if (audioWasAdded(previousAssets, studio.assets)) {
      showToast(
        "Audio added",
        "The prompt model can't hear audio files. Describe how the audio references should be used in the Creative Brief.",
        null,
        null,
        { durationMs: 6000 },
      );
    }
    renderMedia(studio.mode);
  } catch (error) {
    renderMedia(studio.mode);
    showToast(error.code || "Upload failed", error.message, error.details);
  }
}

function showToast(title, message, details = null, action = null, options = {}) {
  const toast = studio.root.querySelector("[data-ps-toast]");
  const durationMs = Number.isFinite(options.durationMs) ? options.durationMs : null;
  const dismissOnWorkspaceClick = options.dismissOnWorkspaceClick === true
    || (details != null && durationMs == null);
  const dismissGeneration = (studio.toastDismissGeneration || 0) + 1;
  studio.toastDismissGeneration = dismissGeneration;
  studio.toastDismissOnWorkspaceClick = false;
  setTimeout(() => {
    if (
      studio.toastDismissGeneration === dismissGeneration
      && toast.classList.contains("is-visible")
    ) {
      studio.toastDismissOnWorkspaceClick = dismissOnWorkspaceClick;
    }
  }, 0);
  toast.querySelector("[data-toast-title]").textContent = title;
  toast.querySelector("[data-toast-message]").textContent = message;
  const technical = toast.querySelector("[data-toast-details]");
  technical.hidden = details == null;
  technical.open = false;
  technical.querySelector("pre").textContent = details == null ? "" : typeof details === "string" ? details : JSON.stringify(details, null, 2);
  toast.classList.toggle("has-details", details != null);
  const actionButton = toast.querySelector("[data-toast-action]");
  actionButton.hidden = !action;
  actionButton.textContent = action?.label || "";
  actionButton.onclick = action ? () => { action.onClick(); hideToast(); } : null;
  toast.classList.toggle("has-action", Boolean(action));
  toast.classList.toggle("is-persistent", dismissOnWorkspaceClick);
  toast.classList.add("is-visible");
  clearTimeout(studio.toastTimer);
  if (durationMs != null || !dismissOnWorkspaceClick) {
    studio.toastTimer = setTimeout(
      hideToast,
      durationMs ?? (action ? 12000 : details == null ? 2800 : 7000),
    );
  }
}

/**
 * Starter draft for a mode, resolved by mode id.
 *
 * The per-mode map lives in ./mode_defaults.js. There is deliberately no
 * "first entry" fallback: an unmapped mode gets empty fields rather than
 * another target's example, because a video-shaped prompt in an image or audio
 * mode is actively misleading.
 */
function defaultModeDraft(mode) {
  return defaultModeDraftFor(mode);
}

function currentDraftFields() {
  return {
    brief: currentBriefTextarea().value,
    lyrics: studio.root.querySelector("[data-music-lyrics]")?.value ?? "",
    prompt: studio.root.querySelector("[data-output]").value,
    // Character selection rides with the draft, so switching mode and returning
    // restores it alongside the brief and prompt.
    ...(studio.characters?.length ? { characters: studio.characters } : {}),
  };
}

/**
 * Current Lyrics field value for a mode, or "" when the mode has no lyrics or
 * the field is not mounted yet. Deliberately self-contained: the isolated
 * function-level tests evaluate this alongside its callers.
 */
function lyricsFieldValue(mode) {
  const field = studio?.root?.querySelector?.("[data-music-lyrics]");
  if (!field) return "";
  return typeof field.value === "string" ? field.value : "";
}

/**
 * The textarea that supplies `creative_brief` for the active mode.
 *
 * Image Edit is instruction-driven and hides the descriptive Image brief, so the
 * edit instruction is the brief in that mode. Returning the hidden brief here
 * would submit its stale text, which is a real bug: the field is not rendered and
 * the user cannot see or clear what is being sent.
 */
function currentBriefTextarea() {
  const target = targetForMode(studio.mode);
  const panel = target ? panelForCategory(target.category) : "video";
  if (panel === "image" && modeDescriptor(studio.mode)?.instruction_field) {
    const instruction = studio.root.querySelector("[data-edit-instruction]");
    if (instruction) return instruction;
  }
  const selector = panel === "music" ? "[data-music-brief]"
    : panel === "image" ? "[data-image-brief]"
    : "[data-video-brief]";
  return studio.root.querySelector(selector) || studio.root.querySelector("[data-video-brief]");
}

async function copyPromptText(text, music = false) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(music ? "Caption copied" : "Prompt copied", music ? "The generated Music 3 caption is on your clipboard." : "The generated prompt is on your clipboard.");
  } catch (error) {
    showToast("Copy failed", "Clipboard access was denied.", error.message);
  }
}

function setClearMenuOpen(open) {
  if (!studio) return;
  setSplitMenuOpen(studio.root.querySelector("[data-clear-control]"), open);
}

function clearCurrentPrompts({ notify = true } = {}) {
  if (!studio || studio.requestBusy) return false;
  const draft = clearPromptDraft(currentDraftFields());
  const output = studio.root.querySelector("[data-output]");
  currentBriefTextarea().value = draft.brief;
  output.value = draft.prompt;
  studio.lastModelPrompt = null;
  studio.lastModelMeta = null;
  studio.refineRestore = null;
  studio.root.querySelector("[data-refine-restore]").hidden = true;
  toggleRefine(false);

  studio.root.querySelector(".ps-editor-meta span:last-child").textContent = promptLengthMeta(output.value);
  updateBriefLayout();
  renderPromptHighlights();
  syncModifiedState();

  saveCurrentModeDraft();
  if (notify) {
    const detail = isAudioMode(studio.mode)
      ? "The Music Brief and generated caption were cleared. Lyrics and media were kept."
      : "The Creative Brief and generated prompt were cleared. Media was kept.";
    showToast("Prompts cleared", detail);
  }
  return true;
}

async function clearCurrentMedia({ notify = true } = {}) {
  if (!studio || studio.requestBusy) return false;
  try {
    const result = await clearMedia(studio.sessionId, studio.sequence?.mediaMode(studio.mode) ?? studio.mode);
    acceptMediaAssets(result.assets);
    renderMedia(studio.mode);
    if (notify) showToast("Media cleared", "The temporary session files were removed.");
    return true;
  } catch (error) {
    showToast(error.code || "Clear failed", error.message, error.details);
    return false;
  }
}

async function clearEverything() {
  const mode = studio.mode;
  const submittedDraft = currentDraftFields();
  if (!await clearCurrentMedia({ notify: false })) return;
  const currentDraft = currentDraftFields();
  if (studio.mode !== mode || currentDraft.brief !== submittedDraft.brief || currentDraft.prompt !== submittedDraft.prompt) {
    showToast("Media cleared", "Your current prompts were kept because the workspace changed.");
    return;
  }
  clearCurrentPrompts({ notify: false });
  const detail = isAudioMode(studio.mode)
    ? "Media, Music Brief and generated caption were removed. Lyrics were kept."
    : "Media, Creative Brief and generated prompt were removed.";
  showToast("Everything cleared", detail);
}

function saveCurrentModeDraft() {
  if (!studio || !isPersistedDraftMode(studio.mode)) return;
  studio.modeDrafts[studio.mode] = currentDraftFields();
  saveModeDrafts(localStorage, studio.modeDrafts);
}

function stashCurrentModeDraft() {
  if (!studio) return;
  saveCurrentModeDraft();
}

function updateBriefLayout() {
  if (!studio) return;
  const brief = currentBriefTextarea();
  const compactHeight = window.innerHeight <= 800;
  const largeCanvas = window.innerWidth >= 3000 && window.innerHeight >= 1600;
  const minimumHeight = compactHeight ? 80 : largeCanvas ? 125 : 105;
  const briefLimit = modeBriefLimit(studio.mode);
  brief.closest(".ps-brief").querySelector(".ps-char-count").textContent = briefLimit ? `${brief.value.length.toLocaleString()} / ${briefLimit.toLocaleString()}` : `${brief.value.length.toLocaleString()} characters`;
  // The brief grows with its content; the panel scrolls instead of the textarea.
  fitTextarea(brief, minimumHeight, 2);
}

function saveTextDraft() {
  if (!studio) return;
  try {
    const kind = studio.sequence?.active ? "sequence" : "single";
    const content = kind === "sequence"
      ? studio.sequence.state
      : { mode: studio.mode, aspectRatio: studio.aspectRatio, duration: studio.durationSeconds, ...currentDraftFields(),
          instructions: null };
    const media = studio.assets.filter(a => a.mode === "Reference").map(a => `${a.reference || a.filename}: ${a.filename}`);
    const value = draftFile(kind, content, media);
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = draftFilename(kind); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showToast("Draft saved", `${kind === "sequence" ? "Sequence" : "Single"} text draft downloaded. Media is not included.`);
  } catch (error) {
    showToast("Save draft", error.message);
  }
}

async function loadTextDraft() {
  if (!studio || studio.requestBusy) return;
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    let draft;
    try {
      draft = parseDraft(await file.text());
    } catch (error) {
      showToast("Load draft", error.message);
      return;
    }
    setGenerationState("busy");
    let cleared = false;
    try {
      cleared = await clearCurrentMedia({ notify: false });
    } finally {
      if (!cleared) {
        setGenerationState("idle");
        showToast("Load draft", "The current media could not be cleared.");
        return;
      }
    }
    if (draft.kind === "sequence") {
      studio.sequence.state.brief = draft.content.brief;
      studio.sequence.loadDraft(draft.content);
    } else {
      studio.modeDrafts[draft.content.mode] = { brief: draft.content.brief, prompt: draft.content.prompt };
      selectMode(draft.content.mode);
      studio.aspectRatio = draft.content.aspectRatio;
      studio.durationSeconds = draft.content.duration;
      syncAspectRatioControls(studio.aspectRatio);
      studio.root.querySelector("[data-duration-slider]").value = String(studio.durationSeconds);
      studio.root.querySelector("[data-duration-slider]").style.setProperty("--ps-range", `${(studio.durationSeconds - 1) / 19 * 100}%`);
      studio.root.querySelector("[data-duration-label]").textContent = `${studio.durationSeconds} seconds`;
      restoreModeDraft(studio.mode);
      saveUserPreferences(localStorage, studio);
    }
    setGenerationState("idle");
    const media = draft.media.length ? ` Reattach: ${draft.media.join(", ")}.` : "";
    showToast("Draft loaded", `Media was cleared.${media}`);
  };
  input.click();
}

function updateMusicLyricsCount() {
  if (!studio) return;
  const lyrics = studio.root.querySelector("[data-music-lyrics]");
  if (lyrics) {
    lyrics.closest(".ps-brief").querySelector(".ps-char-count").textContent =
      `${lyrics.value.length.toLocaleString()} / ${modeLyricsLimit(studio.mode).toLocaleString()}`;
  }
  const instruction = studio.root.querySelector("[data-edit-instruction]");
  if (instruction) {
    const limit = studio.root.querySelector(".ps-edit-instruction .ps-char-count");
    if (limit) limit.textContent = `${instruction.value.length.toLocaleString()} / 4,000`;
  }
}

function restoreModeDraft(mode) {
  if (!studio) return;
  const draft = studio.modeDrafts[mode] || defaultModeDraft(mode);
  const output = studio.root.querySelector("[data-output]");
  currentBriefTextarea().value = draft.brief;
  if (isAudioMode(mode)) studio.root.querySelector("[data-music-lyrics]").value = draft.lyrics || "";
  output.value = draft.prompt;
  // Restore the stored characters for this mode and clear any that the index no
  // longer knows, so a stale selection cannot survive a mode switch.
  studio.characters = Array.isArray(draft.characters) ? draft.characters : [];
  studio.characterPicker?.restore(studio.characters);
  studio.lastModelPrompt = draft.prompt;
  studio.lastModelMeta = promptLengthMeta(draft.prompt);
  studio.refineRestore = null;
  studio.root.querySelector("[data-refine-restore]").hidden = true;
  studio.lyricsRestore = null;
  studio.root.querySelector("[data-lyrics-refine-restore]").hidden = true;
  studio.root.querySelector(".ps-editor-meta span:last-child").textContent = promptLengthMeta(output.value);
  updateBriefLayout();
  updateMusicLyricsCount();
  renderPromptHighlights();
  syncModifiedState();
}

function syncWorkspace() {
  if (!studio) return;
  // Resolve the target locally so this function stays evaluable in isolation:
  // the isolated function-level tests mount a partial DOM without the registry.
  const registryTarget = typeof targetForMode === "function" ? targetForMode(studio.mode) : null;
  const workspace = registryTarget?.workspace
    || (studio.mode === "Music3" ? "music" : "video");
  const category = registryTarget?.category
    || (workspace === "music" ? "audio" : workspace === "image" ? "image" : "video");
  const panel = category === "audio" ? "music" : category === "image" || category === "image-edit" ? "image" : "video";
  const music = panel === "music";
  const image = panel === "image";

  studio.root.classList.toggle("is-music", music);
  studio.root.classList.toggle("is-image", image);

  // Mode tabs follow the workspace, so switching workspace re-labels the row.
  const modeRow = studio.root.querySelector("[data-workspace-modes]") || studio.root.querySelector("[data-video-modes]");
  if (modeRow) {
    // Key the row on the resolved target, not the workspace: two targets could
    // share a workspace category, and the row must show the active one's modes.
    const targetKey = registryTarget?.id || workspace;
    const desired = typeof modeButtonsMarkup === "function"
      ? selectableModes(registryTarget || targetForWorkspace(workspace))
          .map((mode) => `<button type="button" role="tab" data-mode="${escapeHtml(mode.id)}">${escapeHtml(mode.label || mode.id)}</button>`)
          .join("")
      : null;
    if (desired && modeRow.dataset.rendered !== `${targetKey}:${desired}`) {
      modeRow.innerHTML = desired;
      modeRow.dataset.rendered = `${targetKey}:${desired}`;
      bindModeButtons();
    }
    modeRow.hidden = music;
  }

  // The indicator names the active target, so it follows every workspace change.
  // Optional guard: isolated tests mount a partial DOM without this hook.
  if (typeof syncTargetIndicator === "function" && studio.root.querySelector?.("[data-target-indicator]")) {
    syncTargetIndicator();
  }

  // Show exactly the panel this target category uses. Panels are optional so a
  // partial test DOM does not throw here.
  studio.root.querySelectorAll("[data-workspace-panel]").forEach((section) => {
    section.hidden = section.dataset.workspacePanel !== panel;
  });
  const videoPanel = studio.root.querySelector("[data-video-inputs]");
  if (videoPanel && !videoPanel.dataset.workspacePanel) videoPanel.hidden = music || image;
  const musicPanel = studio.root.querySelector("[data-music-inputs]");
  if (musicPanel) musicPanel.hidden = !music;

  const outputLabel = music ? "Generated caption" : image ? "Generated image prompt" : "Generated prompt";
  studio.root.querySelector("[data-output-label]").textContent = outputLabel;
  const mobileLabel = studio.root.querySelector("[data-output-mobile-label]");
  if (mobileLabel) mobileLabel.textContent = outputLabel;
  studio.root.querySelector("[data-output]").setAttribute("aria-label", outputLabel);
  studio.root.querySelector("[data-copy-label]").textContent = music ? "Copy caption" : "Copy prompt";
  studio.root.querySelector("[data-generate-label]").textContent = music ? "Generate caption" : "Generate prompt";
  studio.root.querySelector("[data-refine-media-note]").textContent = music ? "Lyrics stay separate" : "No media re-upload";
  studio.root.querySelector("[data-refine-title]").textContent = music ? "Refine caption" : "Refine prompt";
  studio.root.querySelector("[data-refine-helper]").textContent = music ? "Describe the musical change" : "Describe only what should change";
  studio.root.querySelector("[data-refine-instruction]").placeholder = music
    ? "For example: keep the verses sparse and let the final chorus open wider."
    : "For example: make the camera movement slower and keep the ending more ambiguous.";
  if (!music) rememberReferenceInsertTarget(studio.root.querySelector("[data-output]"));
  else referenceInsertTarget = null;

  // Lyrics refinement only applies to the audio workspace.
  if (!music) toggleLyricsRefine(false);

  if (image) syncImagePanel();
  syncModeAvailability();
}

/**
 * Render the active mode's declared options into the image panel.
 *
 * The container is rebuilt only when the option set changes, because a rebuild
 * would close an open menu mid-interaction. Options are registry data, so a mode
 * that declares none leaves the container empty and hidden.
 */
function syncModeOptions() {
  if (!studio?.root) return;
  const host = studio.root.querySelector("[data-mode-options]");
  if (!host) return;
  const declared = targetForMode(studio.mode)?.modes?.find((mode) => mode.id === studio.mode)?.options;
  const options = Array.isArray(declared) ? declared : [];
  const signature = JSON.stringify(options.map((option) => option.id));
  if (!options.length) {
    host.innerHTML = "";
    host.hidden = true;
    studio.renderedModeOptions = null;
    return;
  }
  host.hidden = false;
  const selected = studio.modeDrafts?.[studio.mode]?.options || {};
  if (studio.renderedModeOptions !== `${studio.mode}:${signature}`) {
    studio.renderedModeOptions = `${studio.mode}:${signature}`;
    host.innerHTML = modeOptionsMarkup(icon, options, selected);
    bindModeOptions(host, options, selected, (optionId, choiceId) => {
      setModeOption(optionId, choiceId);
    });
    return;
  }
  // Same option set: only refresh the labels, so an open menu is left alone.
  syncModeOptionLabels(host, options, selected);
}

function syncModeOptionLabels(host, options, selected) {
  for (const option of options) {
    const field = host.querySelector(`[data-mode-option="${option.id}"]`);
    if (!field) continue;
    // Resolved through the same helper the markup uses, so the label and the
    // highlighted choice cannot disagree about which value is active.
    const chosen = selectedModeOptionChoice(option, selected);
    const label = field.querySelector("[data-option-label]");
    const description = field.querySelector("[data-option-description]");
    if (label) label.textContent = chosen.label;
    if (description) description.textContent = chosen.hint || "";
    field.querySelectorAll("[data-mode-option-value]").forEach((choice) => {
      choice.setAttribute("aria-pressed", String(choice.dataset.modeOptionValue === chosen.id));
    });
  }
}

/** Record one option selection on the active mode's draft and persist it. */
function setModeOption(optionId, choiceId) {
  const mode = studio.mode;
  const draft = studio.modeDrafts[mode] || defaultModeDraft(mode);
  const declared = targetForMode(mode)?.modes?.find((entry) => entry.id === mode)?.options || [];
  const options = normalizeModeOptionSelection(mode, { ...(draft.options || {}), [optionId]: choiceId }) || {};
  studio.modeDrafts[mode] = { ...draft, options };
  const option = declared.find((entry) => entry.id === optionId);
  const choice = option?.choices?.find((entry) => entry.id === choiceId);
  // The selection feeds the prompt, so a stale generated prompt no longer matches
  // the settings shown. Surface that rather than leaving the editor silently wrong.
  if (studio.lastModelPrompt) {
    showToast(
      `${option?.label || "Option"} set to ${choice?.label || choiceId}`,
      "Generate again to apply it to the prompt.",
      null, null, { dismissOnWorkspaceClick: true },
    );
  }
  saveModeDrafts(localStorage, studio.modeDrafts);
  syncModeOptionLabels(studio.root.querySelector("[data-mode-options]"), declared, options);
  syncModifiedState();
}

/** Title, brief, and edit fields for the image panel, from the mode descriptor. */
function syncImagePanel() {
  if (!studio?.root) return;
  const descriptor = modeDescriptor(studio.mode);
  const title = studio.root.querySelector("[data-ps-image-mode-title]");
  if (title) title.textContent = descriptor?.title || "";
  // Edit mode is instruction-driven: it takes the source images and the change to
  // make, so the descriptive Image brief is hidden rather than duplicated.
  const edits = Boolean(descriptor?.instruction_field);
  const instruction = studio.root.querySelector(".ps-edit-instruction");
  if (instruction) instruction.hidden = !edits;
  const imageBrief = studio.root.querySelector(".ps-image-brief");
  if (imageBrief) imageBrief.hidden = edits;
  syncModeOptions();
  studio.characterPicker?.syncVisibility(targetForMode(studio.mode)?.id || null);
}

function syncModeAvailability() {
  if (!studio?.root) return;
  const textOnlyDirect = isTextOnlyDirectModel(studio.selectedModel);
  studio.root.querySelectorAll("[data-mode]").forEach((control) => {
    const unavailable = !isGenerationModeAvailable(studio.selectedModel, control.dataset.mode);
    control.disabled = studio.requestBusy || unavailable;
    control.setAttribute("aria-disabled", String(control.disabled));
    control.title = unavailable && textOnlyDirect
      ? "This Direct GGUF is text-only. Add its matching mmproj to enable visual modes."
      : "";
  });
  // The target indicator is the only way to switch target, so it must stay usable
  // while a request runs; only the mode chips are gated on the busy flag.
  const indicator = studio.root.querySelector("[data-open-target-select]");
  if (indicator) {
    indicator.disabled = false;
    indicator.setAttribute("aria-disabled", "false");
  }
}

function generationModeIsAvailable() {
  if (isGenerationModeAvailable(studio.selectedModel, studio.mode)) return true;
  showToast(
    "Text-only Direct GGUF",
    `Use ${textOnlyModeLabels()}, or add the matching mmproj to enable visual modes.`,
  );
  return false;
}

function hideToast() {
  if (!studio) return;
  clearTimeout(studio.toastTimer);
  studio.toastDismissOnWorkspaceClick = false;
  const toast = studio.root.querySelector("[data-ps-toast]");
  const actionButton = toast.querySelector("[data-toast-action]");
  actionButton.onclick = null;
  actionButton.textContent = "";
  actionButton.hidden = true;
  toast.classList.remove("is-visible", "is-persistent", "has-action");
}

function thinkingFallbackMessage(result, outputLabel) {
  if (
    result.thinking_budget_reduced
    && studio.selectedModel?.family === "gguf"
    && Number(result.context_tokens || 0) < 24_576
  ) {
    return `Thinking used all the space available in the selected context. The ${outputLabel} was completed in standard mode. A larger Context setting can give Thinking more room.`;
  }
  return `Thinking used its full token budget. The ${outputLabel} was completed in standard mode.`;
}

function setGenerationState(state, label, detail) {
  const button = studio.root.querySelector("[data-generate]");
  const status = studio.root.querySelector("[data-status]");
  const statusDetail = studio.root.querySelector("[data-status-detail]");
  const busy = state === "busy";
  const wasBusy = studio.requestBusy;
  studio.requestBusy = busy;
  syncModeAvailability();
  studio.root.querySelectorAll("[data-clear-media], [data-clear-menu-toggle], [data-actions-menu-toggle], [data-clear-action], [data-save-draft], [data-load-draft]").forEach((control) => { control.disabled = busy; });
  if (busy) setClearMenuOpen(false);
  studio.root.querySelector("[data-lyrics-refine-toggle]").disabled = busy;
  const comfyMemory = studio.root.querySelector("[data-comfy-memory-action]");
  comfyMemory.disabled = busy || !HOST_CAPABILITIES.comfyMemory;
  comfyMemory.title = busy
    ? "Available after the active Prompt Studio request finishes"
    : "Unload models held by ComfyUI without clearing cached workflow results";
  button.classList.toggle("is-cancel", busy);
  // Resolve the label locally so this function stays evaluable in isolation
  // (the regression tests evaluate it without the registry in scope).
  const audioMode = studio.mode === "Music3"
    || (typeof describesAudio === "function" && describesAudio(studio.mode));
  if (!busy || !wasBusy) button.innerHTML = generationButtonMarkup(icon, busy, audioMode ? "Generate caption" : "Generate prompt");
  renderMedia(studio.mode);
  syncLifecycleActions();
  status.hidden = !busy;
  status.classList.toggle("is-busy", busy);
  if (busy) {
    if (label === "Generating") {
      studio.generationDotCount = ((studio.generationDotCount || 0) % 3) + 1;
      status.querySelector("strong").textContent = `${label}${".".repeat(studio.generationDotCount)}`;
    } else {
      studio.generationDotCount = 0;
      status.querySelector("strong").textContent = label;
    }
    statusDetail.textContent = detail;
  } else {
    studio.generationDotCount = 0;
  }
}

function updatePromptResidency(status) {
  const residency = status?.prompt_residency;
  if (!residency) return;
  studio.promptResidency = {
    direct: residency.direct?.loaded ? { modelId: residency.direct.model_id || null } : null,
    external: Array.isArray(residency.external?.targets) ? residency.external.targets : [],
    ollama: Array.isArray(residency.ollama?.models) ? residency.ollama.models.filter(Boolean) : [],
  };
}

function selectedModelSupportsVramHandoff() {
  const model = studio?.selectedModel;
  return ["gguf", "external"].includes(model?.family)
    || (model?.family === "ollama" && isLocalOllamaHost(studio.ollamaHost));
}

function vramHandoffIsEnabled() {
  if (!VRAM_HANDOFF_SUPPORTED) return false;
  if (studio) return studio.vramHandoff;
  const preferences = loadUserPreferences(localStorage);
  return preferences?.vram_handoff === true;
}

function vramHandoffOllamaHost() {
  return studio?.ollamaHost || loadOllamaHost(localStorage);
}

function writerAutoVramApplies() {
  return vramHandoffIsEnabled() && selectedModelSupportsVramHandoff();
}

function writerAttemptIsCurrent(token) {
  return token == null || vramHandoffCoordinator.isWriterAttemptCurrent(token);
}

async function prepareWriterVram(token) {
  if (token == null) return true;
  studio.vramHandoffInFlight = true;
  setGenerationState("busy", "Freeing VRAM", "Preparing ComfyUI memory for the prompt model");
  try {
    await releaseComfyVramWhenIdle({
      getStatus,
      freeComfyVram,
      ollamaHost: studio.ollamaHost,
      isCurrent: () => writerAttemptIsCurrent(token),
      onStatus: (status) => {
        studio.gpuMemory = status.gpu_memory || studio.gpuMemory;
        updatePromptResidency(status);
      },
    });
    return writerAttemptIsCurrent(token);
  } catch (error) {
    if (error.code !== "WRITER_PREPARATION_CANCELLED") {
      showToast("Auto VRAM could not prepare memory", error.message, error.details);
    }
    setGenerationState("idle", "", "");
    return false;
  } finally {
    studio.vramHandoffInFlight = false;
  }
}

async function prepareWriterRequest() {
  const token = writerAutoVramApplies() ? vramHandoffCoordinator.beginWriterAttempt() : null;
  if (!await inspectDirectRuntime() || !writerAttemptIsCurrent(token)) return false;
  if (!await prepareWriterVram(token)) return false;
  if (writerAttemptIsCurrent(token)) return true;
  setGenerationState("idle", "", "");
  return false;
}

function markActiveWriterRequest() {
  studio.activeRequestFamily = studio.selectedModel.family;
  studio.activeRequestModelId = studio.selectedModel.family === "ollama" ? studio.selectedModel.remote_model : studio.selectedModel.id;
  studio.activeRequestOllamaHost = studio.selectedModel.family === "ollama" ? studio.ollamaHost : null;
}

function clearActiveWriterRequest() {
  studio.activeRequestFamily = null;
  studio.activeRequestModelId = null;
  studio.activeRequestOllamaHost = null;
}

async function unloadWriterModelsBeforeQueue(signal) {
  const ollamaHost = vramHandoffOllamaHost();
  const activeRequest = vramHandoffCoordinator.activeWriterRequest();
  const activeFamily = studio?.activeRequestFamily;
  const activeLocal = activeFamily === "gguf"
    || (activeFamily === "external" && studio?.selectedModel?.lifecycle_supported)
    || (activeFamily === "ollama" && isLocalOllamaHost(studio?.activeRequestOllamaHost || ollamaHost));
  const requiredTargets = [];
  if (activeRequest && activeLocal) {
    const target = {
      family: activeFamily,
      model_id: studio.activeRequestModelId,
      ollama_host: activeFamily === "ollama" ? (studio.activeRequestOllamaHost || ollamaHost) : null,
    };
    if(activeFamily === "external") requiredTargets.push(target);
    const result = await unloadModel(target);
    if (result?.unload_requested === false) throw new Error("Prompt Studio could not stop and unload its local model.");
    try { await activeRequest; } catch {}
  }
  signal?.throwIfAborted();
  await unloadWriterModels({
    signal,
    requiredTargets,
    getStatus,
    unloadModel,
    ollamaHost,
    onStatus: (status) => { if (studio) updatePromptResidency(status); },
  });
  if (studio) syncLifecycleActions();
}

function showVramHandoffQueueError(error) {
  const message = error.message || "Prompt Studio could not release its local model.";
  if (studio?.root.classList.contains("is-open")) {
    showToast("Queue continuing without VRAM release", message, error.details);
  } else {
    app.extensionManager?.toast?.add({severity:"warn", summary:"Auto VRAM: Queue continuing", detail:message, life:8000});
  }
}

function lifecycleTargets() {
  const targets = [];
  if (studio.promptResidency.direct) targets.push({ family: "gguf", modelId: studio.promptResidency.direct.modelId });
  studio.promptResidency.ollama.forEach((modelId) => targets.push({ family: "ollama", modelId, endpoint: studio.ollamaHost }));
  const selected = studio.selectedModel;
  const external = (studio.promptResidency.external || []).filter(t => t.writer_owned || t.model_id === selected?.id);
  if (selected?.family === "external" && selected.lifecycle_supported && !external.some(t => t.model_id === selected.id)) {
    external.push({model_id:selected.id, state:"unknown", writer_owned:false});
  }
  external.forEach(target => targets.push({family:"external", modelId:target.model_id, state:target.state, writerOwned:target.writer_owned}));
  return targets;
}

function lifecycleButtonMarkup(target, { stop = false } = {}) {
  const provider = target.family === "external" ? "external" : target.family === "ollama" ? "ollama" : "direct";
  const disabled = target.family === "external" && (["loading","unloading","unloaded"].includes(target.state) || (target.state === "unknown" && !target.writerOwned));
  const label = target.state === "unloading" ? "Unloading…" : target.state === "loading" ? "Loading…" : stop ? "Stop & unload" : target.family === "external" ? "Unload" : target.family === "ollama" ? "Unload Ollama" : "Unload Direct";
  const title = stop
    ? "Cancel the active request and unload its prompt model"
    : `Unload ${target.modelId || (target.family === "ollama" ? "the Ollama model" : "the Direct model")}`;
  return `<button class="ps-memory-action ps-prompt-lifecycle-action" type="button" data-lifecycle-family="${target.family}" ${disabled ? "disabled" : ""} ${target.modelId ? `data-lifecycle-model="${escapeHtml(target.modelId)}"` : ""} data-lifecycle-stop="${stop}" title="${escapeHtml(title)}"><span class="ps-provider-icon" data-provider-icon="${provider}" aria-hidden="true"></span>${label}</button>`;
}

function syncLifecycleActions() {
  const slot = studio.root.querySelector("[data-prompt-lifecycle-actions]");
  const directStatus = studio.root.querySelector("[data-model-lifecycle]");
  if (directStatus) directStatus.hidden = !studio.promptResidency.direct;
  const activeFamily = studio.activeRequestFamily;
  const activeLocal = studio.requestBusy && (["gguf", "ollama"].includes(activeFamily) || (activeFamily === "external" && studio.selectedModel?.lifecycle_supported));
  const activeTarget = activeLocal && activeFamily !== "external" ? { family: activeFamily, modelId: studio.activeRequestModelId } : null;
  const background = lifecycleTargets().filter((target) => {
    if (!activeTarget) return true;
    if (activeTarget.family === "gguf" && target.family === "gguf") return false;
    return target.family !== activeTarget.family || target.modelId !== activeTarget.modelId;
  });
  const backgroundMarkup = background.length > 1
    ? `<details class="ps-prompt-models-menu"><summary class="ps-memory-action">${icon("memory", 15)}Prompt models · ${background.length}</summary><span>${background.map((target) => lifecycleButtonMarkup(target)).join("")}</span></details>`
    : background.map((target) => lifecycleButtonMarkup(target)).join("");
  slot.innerHTML = `${activeTarget ? lifecycleButtonMarkup(activeTarget, { stop: true }) : ""}${backgroundMarkup}`;
  slot.querySelectorAll("[data-lifecycle-family]").forEach((button) => button.addEventListener("click", runLifecycleAction));
}

async function releaseComfyVram({ retry = null, requiredFreeMb = null } = {}) {
  if (!HOST_CAPABILITIES.comfyMemory) return;
  const button = studio.root.querySelector("[data-comfy-memory-action]");
  if (button.disabled || studio.comfyVramReleaseInFlight) return;
  let shouldRetry = false;
  studio.comfyVramReleaseInFlight = true;
  button.disabled = true;
  button.innerHTML = `<span class="ps-spinner"></span>Releasing…`;
  try {
    const before = await getStatus(studio.ollamaHost);
    const beforeFree = Number(before.gpu_memory?.free_mb);
    const requiredFree = requiredFreeMb == null ? null : Number(requiredFreeMb);
    if (typeof retry !== "function" && requiredFree == null && comfyVramIsAlreadyEmpty(before)) {
      studio.gpuMemory = before.gpu_memory || studio.gpuMemory;
      showToast("No ComfyUI models loaded", "VRAM is already free for Prompt Studio.");
      return;
    }
    await freeComfyVram();

    let latest = before;
    let targetReached = vramReleaseReachedTarget(beforeFree, beforeFree, requiredFree);
    for (let attempt = 0; attempt < 60 && !targetReached; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      latest = await getStatus(studio.ollamaHost);
      const currentFree = Number(latest.gpu_memory?.free_mb);
      targetReached = vramReleaseReachedTarget(beforeFree, currentFree, requiredFree);
    }
    studio.gpuMemory = latest.gpu_memory || studio.gpuMemory;
    const afterFree = Number(latest.gpu_memory?.free_mb);
    const releasedMb = Number.isFinite(beforeFree) && Number.isFinite(afterFree) ? Math.max(0, afterFree - beforeFree) : 0;
    if (typeof retry === "function") {
      shouldRetry = targetReached;
      if (!targetReached) {
        const freeText = Number.isFinite(afterFree) ? `${(afterFree / 1024).toFixed(1)} GB is free.` : "Free VRAM could not be measured.";
        const requiredText = Number.isFinite(requiredFree) ? ` About ${(requiredFree / 1024).toFixed(1)} GB is required.` : "";
        showToast("VRAM release is still completing", `${freeText}${requiredText} Generate again after ComfyUI finishes unloading.`);
      }
    } else if (releasedMb >= 64) {
      showToast("ComfyUI VRAM released", `${(releasedMb / 1024).toFixed(1)} GB freed. Workflow and cached node results were kept.`);
    } else {
      showToast("ComfyUI VRAM release requested", "No immediate VRAM change was detected. No workflow model may be loaded, or an active workflow must finish first.");
    }
  } catch (error) {
    showToast("VRAM release failed", error.message);
  } finally {
    studio.comfyVramReleaseInFlight = false;
    button.disabled = false;
    button.innerHTML = `${icon("memory", 15)}Free ComfyUI VRAM`;
    syncLifecycleActions();
  }
  if (shouldRetry) await retry();
}

function showVramRetry(error, retry) {
  const freeGb = Number(error.details?.free_mb) / 1024;
  const requiredGb = Number(error.details?.required_free_mb) / 1024;
  const message = Number.isFinite(freeGb) && Number.isFinite(requiredGb)
    ? `${freeGb.toFixed(1)} GB is free; this runtime needs about ${requiredGb.toFixed(1)} GB.`
    : error.message;
  const action = !HOST_CAPABILITIES.comfyMemory || writerAutoVramApplies()
    ? null
    : { label: "Free ComfyUI VRAM & retry", onClick: () => releaseComfyVram({ retry, requiredFreeMb: error.details?.required_free_mb }) };
  showToast("Not enough free VRAM", message, null, action);
}

async function runLifecycleAction(event) {
  const button = event.currentTarget;
  if (button.disabled) return;
  const family = button.dataset.lifecycleFamily;
  const modelId = button.dataset.lifecycleModel || null;
  const stop = button.dataset.lifecycleStop === "true";
  if (stop) setGenerationState("busy", "Stopping & unloading", "Cancelling the request and unloading its prompt model");
  button.disabled = true;
  if (family === "external") {
    const target = studio.promptResidency.external?.find(t => t.model_id === modelId);
    if (target) target.state = "unloading";
    button.textContent = "Unloading…";
  }
  try {
    await unloadModel({ family, model_id: modelId, ollama_host: family === "ollama" ? studio.ollamaHost : null });
    if (family === "gguf") studio.promptResidency.direct = null;
    else if(family === "external" && !stop) studio.promptResidency.external = (studio.promptResidency.external||[]).map(t=>t.model_id===modelId ? {...t,state:"unloaded",writer_owned:false} : t);
    else if(family === "ollama") studio.promptResidency.ollama = studio.promptResidency.ollama.filter((name) => name !== modelId);
    showToast(
      stop ? "Stop & unload requested" : family === "external" ? "External model unloaded" : family === "ollama" ? "Ollama model unloaded" : "Direct model unloaded",
      stop ? "The request will stop and release its model at the next safe point." : "GPU memory used by the prompt model was released.",
    );
  } catch (error) {
    if (family === "external") {
      const target = studio.promptResidency.external?.find(t => t.model_id === modelId);
      if (target) target.state = "unknown";
    }
    showToast(error.code || "Unload failed", error.message, error.details);
  } finally {
    button.disabled = false;
    syncLifecycleActions();
  }
}

async function startGenerationPreview() {
  if (studio.vramHandoffInFlight) return;
  if (studio.requestBusy) {
    setGenerationState("busy", "Cancelling", "Stopping after the current token");
    await cancel();
    return;
  }
  if (!studio.selectedModel) {
    showToast("No prompt model selected", "Choose a local model, connect llama.cpp, or configure an API provider.");
    return;
  }
  if (!studio.selectedModel.runtime_ready) {
    showToast("Model setup is incomplete", studio.selectedModel.setup_message || `Missing: ${studio.selectedModel.missing_dependencies.join(", ")}. Open the model menu to finish setup.`);
    return;
  }
  if (!generationModeIsAvailable()) return;
  // Drop any character the index no longer knows before it reaches the prompt, so a
  // stale selection cannot contribute a trigger the index never held.
  if (studio.characterPicker) await studio.characterPicker.validate();
  saveCurrentModeDraft();
  if (!await prepareWriterRequest()) return;
  const modelName = studio.selectedModel.name.split("/").pop();
  const external = studio.selectedModel.family === "external";
  const apiProvider = studio.selectedModel.family === "api";
  const remote = external || apiProvider;
  markActiveWriterRequest();
  const generationDetail = external ? `${modelName} · the server may load its model if idle` : apiProvider ? `${modelName} · ${studio.selectedModel.api_preset}` : modelName;
  setGenerationState("busy", remote ? "Contacting provider" : "Loading model", generationDetail);
  let pollingActive = true;
  studio.statusTimer = setInterval(async () => {
    try {
      const status = await getStatus(studio.ollamaHost);
      if (!pollingActive) return;
      const labels = { loading_model: remote ? "Contacting provider" : "Loading model", processing_media: "Processing references", generating: "Generating", cancelling: "Cancelling" };
      if (labels[status.phase]) setGenerationState("busy", labels[status.phase], generationDetail);
    } catch {}
  }, 650);
  try {
    const result = await vramHandoffCoordinator.trackWriterRequest(generate(buildGeneratePayload(studio, {
      creativeBrief: currentBriefTextarea().value,
      lyrics: studio.root.querySelector("[data-music-lyrics]")?.value ?? "",
      seed: newGenerationSeed(),
    })));
    const output = studio.root.querySelector("[data-output]");
    output.value = result.prompt;
    studio.lastModelPrompt = result.prompt;
    renderPromptHighlights();
    studio.lastModelMeta = formatGenerationMeta(result);
    syncRuntimeSummary(result);
    studio.root.querySelector(".ps-editor-meta span:last-child").textContent = studio.lastModelMeta;
    syncModifiedState();
    saveCurrentModeDraft();
    studio.refineRestore = null;
    studio.root.querySelector("[data-refine-restore]").hidden = true;
    if (result.thinking_fallback) {
      showToast("Prompt completed", thinkingFallbackMessage(result, "final prompt"), null, null, { dismissOnWorkspaceClick: true });
    } else if (result.format_repair_applied) {
      const repairDetail = result.format_repair_multimodal
        ? "the existing uploaded references were checked again and the prompt was corrected"
        : `${result.format_repair_method} corrected it without re-uploading media`;
      showToast("Prompt generated", `The first draft failed ${result.format_repair_reason}; ${repairDetail}.`, null, null, { dismissOnWorkspaceClick: true });
    } else if (result.format_repair_failure) {
      showToast("Prompt generated with a format warning", `The first draft failed ${result.format_repair_reason}; the safe repair was rejected because ${result.format_repair_failure}.`, null, null, { dismissOnWorkspaceClick: true });
    } else {
      const details = [
        `${result.total_seconds.toFixed(1)}s`,
        `${result.tokens_per_second.toFixed(1)} tok/s`,
        result.api_provider ? "Reasoning provider managed" : external ? null : `Thinking ${result.thinking ? "on" : "off"}`,
      ];
      showToast(isAudioMode(studio.mode) ? "Caption generated" : "Prompt generated", details.filter(Boolean).join(" · "));
    }
    studio.desktopNotifications.notify("Generation finished. Your prompt is ready.");
    if (result.lifecycle_warning) showToast("Model cleanup", result.lifecycle_warning, null, null, {dismissOnWorkspaceClick:true});
  } catch (error) {
    if (error.code !== "GENERATION_CANCELLED") studio.desktopNotifications.notify("Generation failed. Open Prompt Studio for details.");
    if (error.code === "GENERATION_CANCELLED") {
      showToast("Generation cancelled", "The active request stopped.");
    } else if (error.code === "INSUFFICIENT_FREE_VRAM") {
      showVramRetry(error, startGenerationPreview);
    } else if (error.code === "EXTERNAL_VISION_REQUIRED") {
      showToast("Vision model required", `${error.message} ${error.details?.suggestion || ""}`.trim());
    } else if (error.code === "CONTEXT_BUDGET_EXCEEDED" && error.details?.suggested_context_profile && studio.selectedModel?.family === "gguf") {
      const target = error.details.suggested_context_profile;
      const targetLabel = CONTEXT_LABELS[target] || target;
      showToast(
        "More context is needed",
        `This request needs at least ${targetLabel} context. ${CONTEXT_LABELS[studio.contextProfile]} cannot fit the current references.`,
        null,
        { label: `Use ${targetLabel}`, onClick: () => {
          studio.contextProfile = target;
          rememberRuntimePreferences();
          saveUserPreferences(localStorage, studio);
          syncRuntimeSummary();
          syncThinkingAvailability();
        } },
      );
    } else {
      showToast(error.code || "Generation failed", error.message, error.details);
    }
  } finally {
    pollingActive = false;
    clearInterval(studio.statusTimer);
    studio.statusTimer = null;
    try {
      const status = await getStatus(studio.ollamaHost);
      updatePromptResidency(status);
    } catch {}
    clearActiveWriterRequest();
    setGenerationState("idle", "", "");
  }
}

function modelVramLabel(model) {
  if (["external", "api"].includes(model?.family)) return "";
  const name = model?.name?.toLowerCase() || "";
  if (/e4b/.test(name)) return "8 GB VRAM";
  if (/12b/.test(name) && /q4/.test(name)) return "12 GB VRAM";
  if (/12b/.test(name)) return "16 GB VRAM";
  if (/26b/.test(name)) return "24 GB VRAM";
  if (/31b/.test(name)) return "32 GB VRAM";
  return "";
}

function detectedVramTier() {
  const totalMb = studio.gpuMemory?.total_mb;
  if (!Number.isFinite(totalMb)) return null;
  const totalGb = totalMb / 1024;
  if (totalGb >= 31) return 32;
  if (totalGb >= 23) return 24;
  if (totalGb >= 15) return 16;
  if (totalGb >= 11) return 12;
  if (totalGb >= 7) return 8;
  return null;
}

function renderModelSetupRows() {
  const tier = detectedVramTier();
  return studio.modelSetup.map((model, index) => {
    const modelSize = model.vram_gb ? `${model.vram_gb} GB VRAM` : "Large model · measure locally";
    const contextLabel = ({ low: "8K", standard: "16K", extended: "24K", large: "32K", maximum: "48K" })[model.recommended_context] || "Auto";
    const runtimeLabel = model.minimum_runtime ? ` · llama-cpp-python ${model.minimum_runtime}+` : "";
    return `
    <div class="ps-model-setup-row ${model.vram_gb === tier ? "fits-detected-vram" : ""}" ${model.vram_gb === tier ? 'title="Fits the detected total VRAM tier"' : ""}>
      <span><strong>${escapeHtml(model.name)}</strong><small>${modelSize} · ${contextLabel}${runtimeLabel}${model.vram_gb === tier ? " · Fits detected VRAM" : ""}</small><small class="ps-model-source">${escapeHtml(model.source_label)}</small></span>
      <span class="ps-model-files"><button type="button" data-model-files-toggle="${index}">Files ↗</button><span data-model-files-menu="${index}" hidden><a href="${model.model_url}" target="_blank" rel="noopener noreferrer">Model file ↗</a><a href="${model.projector_url}" target="_blank" rel="noopener noreferrer">Projector file ↗</a></span></span>
    </div>`;
  }).join("");
}

function modelDiscoveryDetails() {
  const roots = studio.modelDiscovery?.roots || [];
  if (!roots.length) return "";
  const lines = [];
  for (const root of roots) {
    lines.push(root.path);
    lines.push(`  Model GGUF: ${root.model_files.length}`);
    for (const path of root.model_files) lines.push(`    ${path}`);
    lines.push(`  Vision projector GGUF: ${root.projector_files.length}`);
    for (const path of root.projector_files) lines.push(`    ${path}`);
    for (const issue of root.issues) lines.push(`  Issue: ${issue}`);
  }
  return lines.join("\n");
}

function renderModelScanDetails() {
  const discovery = modelDiscoveryDetails();
  return discovery ? `<details class="ps-model-scan"><summary>Scan details</summary><pre>${escapeHtml(discovery)}</pre></details>` : "";
}

function renderModelSetup() {
  const directory = studio.modelDirectory || "ComfyUI/models/LLM/";
  return `
    <div class="ps-model-setup ps-direct-model-empty">
      <strong>No compatible local model found</strong>
      <p>Open the two verified Hugging Face pages, download both files, then place them in:</p>
      <button type="button" class="ps-model-path" data-copy-model-path><code>${escapeHtml(directory)}</code>${icon("copy", 13)}</button>
      <p>Keep compatible model GGUFs and their vision projector together. One projector can serve several quant files from the same model family.</p>
    </div>`;
}

function directRuntimeActionCommand() {
  const actions = studio.ggufRuntimeDiagnostics?.actions || {};
  const onboarding = studio.ggufRuntimeDiagnostics?.onboarding || {};
  return typeof actions.install_or_upgrade_command === "string"
    ? actions.install_or_upgrade_command
    : typeof onboarding.install_command === "string"
      ? onboarding.install_command
      : "";
}

function renderDirectRuntimeCommand(command, action = "installation") {
  if (!command) return "";
  return `<div class="ps-direct-runtime-command"><code>${escapeHtml(command)}</code><button type="button" data-copy-direct-runtime-command="${escapeHtml(command)}" title="Copy ${escapeHtml(action)} command" aria-label="Copy ${escapeHtml(action)} command">${icon("copy", 13)}</button></div><small>Close ComfyUI, run this from your ComfyUI Portable folder containing <code>python_embeded</code>, then restart ComfyUI.</small>`;
}

function renderDirectRuntimeStatus() {
  const diagnostics = studio.ggufRuntimeDiagnostics;
  if (!diagnostics) {
    return studio.ggufRuntimeDiagnosticsLoading
      ? `<section class="ps-direct-runtime-state is-checking"><header><span><small>Runtime</small><strong>Checking llama-cpp-python…</strong></span></header></section>`
      : "";
  }
  const onboarding = diagnostics.onboarding || {};
  if (onboarding.state === "ready") return "";
  if (onboarding.state === "missing") {
    const command = directRuntimeActionCommand();
    return `<section class="ps-direct-runtime-state is-missing">
      <header><span><small>Runtime</small><strong>llama-cpp-python is not installed.</strong></span></header>
      <p>Direct GGUF needs an additional native runtime. Ollama and API providers work without it.</p>
      ${renderDirectRuntimeCommand(command)}
      <div class="ps-direct-runtime-links"><a href="${INSTALLATION_GUIDE_URL}" target="_blank" rel="noopener noreferrer">Installation guide ↗</a><a href="${TROUBLESHOOTING_GUIDE_URL}" target="_blank" rel="noopener noreferrer">Troubleshooting guide ↗</a></div>
    </section>`;
  }
  const version = diagnostics.package_version ? ` Version ${escapeHtml(diagnostics.package_version)} was detected.` : "";
  return `<section class="ps-direct-runtime-state is-broken">
    <header><span><small>Runtime</small><strong>llama-cpp-python is installed, but the runtime is not usable.</strong></span></header>
    <p>The installed package does not match the Direct GGUF runtime requirements.${version}</p>
    <a href="${TROUBLESHOOTING_GUIDE_URL}" target="_blank" rel="noopener noreferrer">Troubleshooting ↗</a>
  </section>`;
}

function localRuntimeLabel() {
  const diagnostics = studio?.ggufRuntimeDiagnostics;
  if (!diagnostics) return "Local GGUF · llama-cpp-python";
  if (diagnostics.status !== "ok") return "Runtime could not be inspected";
  const offload = diagnostics.gpu_offload === true
    ? "GPU offload available"
    : diagnostics.gpu_offload === false
      ? "GPU offload unavailable"
      : "Runtime detected";
  const version = diagnostics.package_version ? ` ${diagnostics.package_version}` : "";
  return `${offload === "Runtime detected" ? `Runtime${version} detected` : `${offload}${version}`}${diagnostics.backend ? ` · ${diagnostics.backend}` : ""}`;
}

function syncSelectedModelSourceLabel() {
  if (!studio) return;
  const localModel = studio.selectedModel?.family === "gguf"
    ? studio.selectedModel
    : studio.models.find((model) => model.family === "gguf" && model.runtime_ready) || studio.models.find((model) => model.family === "gguf");
  studio.root.querySelector("[data-model-source-label]").textContent = localModel ? localRuntimeLabel() : "No compatible Direct GGUF model";
  studio.root.querySelector("[data-active-model-source]").textContent = studio.selectedModel?.family === "external"
    ? "External server"
    : studio.selectedModel?.family === "ollama"
      ? "Ollama · local service"
      : studio.selectedModel?.family === "api"
        ? `${studio.selectedModel.api_preset} · API provider`
      : studio.selectedModel
        ? localRuntimeLabel()
        : "No prompt model";
}

function syncActiveModelSummary(runtimeSummary = null) {
  if (!studio) return;
  const model = studio.selectedModel;
  const modelIcon = studio.root.querySelector("[data-active-model-icon]");
  const providerIcon = model?.family === "external"
    ? "external"
    : model?.family === "ollama"
      ? "ollama"
      : model?.family === "api"
        ? `api-${model.api_preset || studio.apiProviderConfig?.preset || "custom"}`
        : "direct";
  modelIcon.textContent = "";
  modelIcon.dataset.providerIcon = providerIcon;
  studio.root.querySelector("[data-active-model-name]").textContent = model ? model.name.split("/").pop() : "No compatible prompt model";
  studio.root.querySelector("[data-active-model-source]").textContent = model?.family === "external"
    ? "External server"
    : model?.family === "ollama"
      ? "Ollama · local service"
      : model?.family === "api"
        ? `${model.api_preset} · API provider`
      : model ? localRuntimeLabel() : "Open Settings to configure";
  if (runtimeSummary != null) studio.root.querySelector("[data-active-runtime-summary]").textContent = runtimeSummary;
}

async function inspectDirectRuntime() {
  if (studio.selectedModel?.family !== "gguf") return true;
  if (!studio.ggufRuntimeDiagnostics) {
    try {
      await loadGGUFRuntimeDiagnostics();
    } catch (error) {
      showToast("Runtime could not be inspected", "The package preflight was unavailable. Generation will continue with the existing runtime behavior.", error.details || error.message);
      return true;
    }
    syncSelectedModelSourceLabel();
  }

  const diagnostics = studio.ggufRuntimeDiagnostics;
  const blocking = diagnostics.onboarding?.state === "broken" || diagnostics.status === "crashed" || diagnostics.status === "unavailable";
  if (blocking) {
    const warning = diagnostics.warnings?.[0];
    showToast(
      warning ? "Native runtime configuration issue" : "Native runtime compatibility check failed",
      warning?.message || diagnostics.message,
      diagnostics,
    );
    return false;
  }
  if (diagnostics.status !== "ok" && !studio.runtimeWarningShown) {
    studio.runtimeWarningShown = true;
    showToast("Runtime could not be inspected", diagnostics.message, diagnostics);
  } else if (diagnostics.gpu_offload === false && !studio.runtimeWarningShown) {
    studio.runtimeWarningShown = true;
    showToast("GPU offload unavailable", "This llama.cpp build may generate on CPU and can be much slower. Install a GPU-enabled wheel that matches ComfyUI's Python and runtime.", diagnostics);
  }
  return true;
}

function renderOtherModelsTrigger() {
  return `
    <button class="ps-other-models-trigger" type="button" data-other-models-toggle aria-expanded="false">
      <span><strong>Browse verified models</strong><small>Model and projector download pairs</small></span>${icon("chevron", 14)}
    </button>`;
}

function renderExternalServerControl() {
  const connected = studio.externalModel;
  const config = studio.externalServerConfig || { url: "http://127.0.0.1:8080", model: "" };
  const title = connected ? connected.name.split("/").pop() : "External llama.cpp server";
  const contextLabel = connected?.context_verified !== false && Number.isFinite(connected?.server_context_tokens)
    ? ` · ${Math.round(connected.server_context_tokens / 1024)}K context`
    : "";
  const state = connected
    ? `${connected.endpoint}${contextLabel}`
    : studio.externalServerError
      ? "Saved server is offline"
      : "Connect to a model already running in llama-server";
  return `
    <div class="ps-external-connection ${connected ? "is-connected" : ""}">
      <div class="ps-external-connection-status">
        <span class="ps-provider-icon" data-provider-icon="external" aria-hidden="true"></span>
        <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(state)}</small></span>
        <em>${connected ? "Connected" : studio.externalServerError ? "Offline" : "Not connected"}</em>
      </div>
      <form data-external-server-form>
        <label><span>Server URL</span><input name="url" type="url" value="${escapeHtml(config.url)}" placeholder="http://127.0.0.1:8080" required></label>
        <label><span>Model ID <em>optional</em></span><input name="model" type="text" value="${escapeHtml(config.model)}" placeholder="Required when the server lists multiple models"></label>
        <label><span>API key <em>optional</em></span><input name="api_key" type="password" autocomplete="off" placeholder="Blank reuses the key held in server memory"></label>
        <small>Localhost only. Context and KV cache stay server-managed. Model lifecycle controls require a llama.cpp router.</small>
        <div><button type="button" data-external-server-disconnect ${connected || studio.externalServerConfig ? "" : "hidden"}>Disconnect</button><span></span><button type="submit">${connected ? "Reconnect" : "Connect"}</button></div>
      </form>
    </div>`;
}

function ollamaModels() {
  return Array.isArray(studio.ollamaStatus?.compatible_models) ? studio.ollamaStatus.compatible_models : [];
}

function ollamaModelForSettings() {
  const models = ollamaModels();
  if (studio.selectedModel?.family === "ollama" && studio.selectedModel.endpoint === studio.ollamaHost) {
    return models.find((model) => model.id === studio.selectedModel.id) || studio.selectedModel;
  }
  return models.find((model) => model.remote_model === studio.ollamaModelName) || models[0] || null;
}

function ollamaHostControlMarkup(hostValue = studio.ollamaHost) {
  const custom = studio.ollamaHost !== DEFAULT_OLLAMA_HOST;
  return `<details class="ps-ollama-host-settings" data-ollama-host-settings ${studio.ollamaHostSettingsOpen ? "open" : ""}>
    <summary>${custom ? `Remote host · ${escapeHtml(studio.ollamaHost)}` : "Use Ollama on another computer"}</summary>
    <form data-ollama-host-form>
      <label><span>Host URL</span><input name="host" type="url" value="${escapeHtml(hostValue)}" placeholder="${DEFAULT_OLLAMA_HOST}" required></label>
      <button type="submit">Apply</button>
    </form>
    <small>Keep the default URL for Ollama on this computer. Remote hosts must allow connections from this machine.</small>
  </details>`;
}

function ollamaJourneyMarkup(step) {
  const steps = [["service", "Ollama"], ["model", "Prompt model"], ["ready", "Ready"]];
  const current = steps.findIndex(([name]) => name === step);
  return `<ol class="ps-ollama-journey">${steps.map(([name, label], index) => `
    <li class="${index < current ? "is-complete" : index === current ? "is-current" : ""}"><span>${index + 1}</span><em>${label}</em></li>`).join("")}</ol>`;
}

function ollamaDetectedTier() {
  const totalMb = studio.gpuMemory?.total_mb;
  if (!Number.isFinite(totalMb)) return null;
  return detectedVramTier() || "under-8";
}

function renderOllamaModelTiers(status) {
  const tiers = Array.isArray(status.model_tiers) ? status.model_tiers : [];
  const detected = ollamaDetectedTier();
  return `<div class="ps-ollama-tier-list">${tiers.map((tier) => {
    const vramTiers = Array.isArray(tier.vram_tiers) ? tier.vram_tiers : [];
    const isDetected = detected === "under-8" ? vramTiers.length === 0 : vramTiers.includes(detected);
    const command = `ollama pull ${tier.model}`;
    return `<div class="ps-ollama-tier-row ${isDetected ? "is-detected" : ""}">
      <span class="ps-ollama-tier-vram">${escapeHtml(tier.label)}</span>
      <code>${escapeHtml(command)}</code>
      ${isDetected ? "<em>Detected</em>" : "<span></span>"}
      <button type="button" data-copy-ollama-command="${escapeHtml(command)}" title="Copy ${escapeHtml(command)}" aria-label="Copy ${escapeHtml(command)}">${icon("copy", 13)}</button>
    </div>`;
  }).join("")}</div>`;
}

function renderOllamaProviderControl(hostValue) {
  const status = studio.ollamaStatus;
  const hostControl = ollamaHostControlMarkup(hostValue);
  const remoteHost = studio.ollamaHost !== DEFAULT_OLLAMA_HOST;
  const serviceLabel = remoteHost ? "Remote service" : "Local service";
  if (!status) {
    return `<header class="ps-settings-section-heading"><span><small>${serviceLabel}</small><strong>Ollama</strong></span></header>
      ${ollamaJourneyMarkup("service")}<div class="ps-ollama-state"><span class="ps-spinner"></span><span class="ps-ollama-state-copy"><strong>Checking Ollama…</strong><p>${remoteHost ? "Looking for the selected service and installed models." : "Looking for the local service and installed models."}</p></span></div>${hostControl}`;
  }
  const ready = status.state === "ready";
  const refresh = ready ? `<button type="button" data-ollama-refresh>${icon("refresh", 13)} Refresh</button>` : "";
  const header = `<header class="ps-settings-section-heading"><span><small>${serviceLabel}</small><strong>Ollama</strong></span>${refresh}</header>`;
  if (status.state === "not_installed") {
    return `${header}${ollamaJourneyMarkup("service")}<div class="ps-ollama-state">
      <span class="ps-ollama-state-icon">1</span><span class="ps-ollama-state-copy"><strong>Get Ollama</strong>
      <p>Install the official Ollama app, open it once, then return here. This page will detect it automatically.</p></span>
      <a class="ps-ollama-primary" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Official download ↗</a>
    </div>${hostControl}`;
  }
  if (status.state === "not_running") {
    return `${header}${ollamaJourneyMarkup("service")}<div class="ps-ollama-state">
      <span class="ps-ollama-state-icon">1</span><span class="ps-ollama-state-copy"><strong>Start Ollama</strong>
      <p>${remoteHost ? `The Ollama service at ${escapeHtml(studio.ollamaHost)} is not responding.` : "Ollama is installed, but its local service is not responding. Open the Ollama app; this page checks automatically."}</p></span>
      <button class="ps-ollama-primary" type="button" data-ollama-refresh>Check now</button>
    </div>${hostControl}`;
  }
  if (status.state === "error") {
    return `${header}${ollamaJourneyMarkup("service")}<div class="ps-ollama-state is-error">
      <span class="ps-ollama-state-icon">!</span><span class="ps-ollama-state-copy"><strong>Ollama could not be inspected</strong>
      <p>${escapeHtml(status.error?.message || "The service returned an unexpected response.")}</p></span>
      <button class="ps-ollama-primary" type="button" data-ollama-refresh>Try again</button>
    </div>${hostControl}`;
  }
  const models = ollamaModels();
  if (!models.length) {
    return `${header}${ollamaJourneyMarkup("model")}<div class="ps-ollama-state ps-ollama-model-state">
      <span class="ps-ollama-state-copy"><strong>Add a compatible prompt model</strong>
      <p>Ollama is running, but no installed model reports both vision and text generation support.</p>
      <div class="ps-ollama-tier-heading">Choose a model for your GPU</div>
      ${renderOllamaModelTiers(status)}
      <small>Copy a command and run it in Terminal or PowerShell. This page detects the model automatically.</small>
      <details class="ps-ollama-storage-help" data-ollama-storage-help ${studio.ollamaStorageHelpOpen ? "open" : ""}><summary>Need models on another drive?</summary><p>Ollama manages one global model store. Set <code>OLLAMA_MODELS</code> before pulling a model, then restart Ollama. <a href="https://docs.ollama.com/windows#changing-model-location" target="_blank" rel="noopener noreferrer">Official instructions ↗</a></p></details></span>
    </div>${hostControl}`;
  }
  const selected = ollamaModelForSettings();
  const tested = selected?.tested_for_target === true;
  const addModelOpen = studio.ollamaAddModelOpen === true;
  return `${header}${ollamaJourneyMarkup("ready")}<div class="ps-ollama-ready">
    <div class="ps-ollama-ready-heading"><span class="ps-provider-icon" data-provider-icon="ollama" aria-hidden="true"></span><span><strong>Ollama is ready</strong><small>Version ${escapeHtml(status.version || "unknown")} · ${remoteHost ? escapeHtml(studio.ollamaHost) : "local service"}</small></span><em>Running</em></div>
    <div class="ps-ollama-model-heading"><span>Prompt model</span><button class="ps-ollama-add-model-toggle" type="button" data-ollama-add-model aria-expanded="${String(addModelOpen)}">${addModelOpen ? "− Hide models" : "+ Add model"}</button></div>
    <label class="ps-ollama-model-select"><select data-ollama-model>${models.map((model) => `<option value="${escapeHtml(model.remote_model)}" ${model.remote_model === selected?.remote_model ? "selected" : ""}>${escapeHtml(model.name)}${model.parameter_size ? ` · ${escapeHtml(model.parameter_size)}` : ""}${model.quantization_level ? ` · ${escapeHtml(model.quantization_level)}` : ""}</option>`).join("")}</select></label>
    ${addModelOpen ? `<div class="ps-ollama-add-model"><strong>Choose another tested model</strong>${renderOllamaModelTiers(status)}<small>Copy a command and run it in Terminal or PowerShell. Select Refresh after the pull completes.</small></div>` : ""}
    <div class="ps-ollama-badges"><span>Vision</span><span>${selected?.thinking_detected ? "Thinking detected" : "Standard generation"}</span><span class="${tested ? "is-tested" : ""}">${tested ? "Tested with Prompt Studio" : "Compatible · not yet tested"}</span></div>
    <p>${tested ? "This exact Ollama tag passed the focused Generate and Refine smoke test for the writing contracts Prompt Studio ships." : "Compatibility comes from Ollama model metadata. It is not a quality guarantee for any generation target."}</p>
    <small>Use “Keep model loaded” on the Generate page to control whether Ollama retains this model after each request.</small>
  </div>${hostControl}`;
}

const API_PROVIDER_UI = {
  gemini: { name: "Gemini", icon: "api-gemini", note: "Google API", keyUrl: "https://aistudio.google.com/api-keys" },
  openai: { name: "OpenAI", icon: "api-openai", note: "OpenAI API", keyUrl: "https://platform.openai.com/api-keys" },
  openrouter: { name: "OpenRouter", icon: "api-openrouter", note: "Multi-provider gateway", keyUrl: "https://openrouter.ai/settings/keys" },
  custom: { name: "Custom", icon: "api-custom", note: "Generic OpenAI-compatible", keyUrl: null },
};

function apiProviderModelForSettings() {
  if (studio.selectedModel?.family === "api") {
    return studio.apiProviderModels.find((model) => model.id === studio.selectedModel.id) || studio.selectedModel;
  }
  const requested = studio.apiProviderConfig?.model_id;
  return studio.apiProviderModels.find((model) => model.remote_model === requested)
    || studio.apiProviderModels.find((model) => model.capabilities?.images === true)
    || studio.apiProviderModels[0]
    || null;
}

function renderApiProviderControl() {
  const config = studio.apiProviderConfig;
  const selectedPreset = API_PROVIDER_UI[config.preset] || API_PROVIDER_UI.gemini;
  const providerMetadata = studio.apiProviderPresets.find((provider) => provider.id === config.preset) || {};
  const connection = studio.apiProviderConnection;
  const model = apiProviderModelForSettings();
  const providerChoices = Object.entries(API_PROVIDER_UI).map(([id, provider]) => `
    <button type="button" class="ps-api-preset ${id === config.preset ? "is-selected" : ""}" data-api-preset="${id}">
      <span class="ps-provider-icon" data-provider-icon="${provider.icon}" aria-hidden="true"></span><span><strong>${provider.name}</strong><small>${provider.note}</small></span>${icon("check", 13)}
    </button>`).join("");
  const header = `<header class="ps-settings-section-heading"><span><small>OpenAI-compatible</small><strong>API providers</strong></span></header>`;
  const disclosure = `<div class="ps-api-disclosure"><strong>What leaves this computer</strong><p>The provider receives your brief, the writing instructions for the current target, prepared images and one derived contact sheet per video in the current manifest. Original videos and audio bytes are not uploaded.</p>${config.preset === "openrouter" ? "<small>OpenRouter forwards the request to an upstream model provider with its own data policy.</small>" : ""}</div>`;
  const policyLinks = [
    providerMetadata.pricing_url ? `<a href="${escapeHtml(providerMetadata.pricing_url)}" target="_blank" rel="noopener noreferrer">Pricing ↗</a>` : "",
    providerMetadata.privacy_url ? `<a href="${escapeHtml(providerMetadata.privacy_url)}" target="_blank" rel="noopener noreferrer">Data policy ↗</a>` : "",
  ].filter(Boolean).join("");
  if (connection) {
    const models = studio.apiProviderModels.length ? studio.apiProviderModels : model ? [model] : [];
    return `${header}<div class="ps-api-layout">
      <div class="ps-api-preset-list">${providerChoices}</div>
      <div class="ps-api-setup">
        <div class="ps-api-connected">
          <span class="ps-provider-icon" data-provider-icon="${selectedPreset.icon}" aria-hidden="true"></span>
          <span><strong>${escapeHtml(connection.provider_name)}</strong><small>${escapeHtml(connection.base_url)} · ${escapeHtml(connection.key_hint || "no key")}${connection.compatibility_profile === "lm_studio" ? " · LM Studio detected" : ""}</small></span>
          <em>${connection.connection_verified ? "Connected" : "Configured"}</em>
        </div>
        <label class="ps-api-model-select"><span>Model</span><select data-api-model>${models.map((item) => `<option value="${escapeHtml(item.remote_model)}" ${item.remote_model === model?.remote_model ? "selected" : ""}>${escapeHtml(item.name)}${item.model_context_limit ? ` · ${Math.round(item.model_context_limit / 1024)}K` : ""}</option>`).join("")}</select></label>
        <div class="ps-api-badges"><span class="${model?.capabilities?.images ? "is-ready" : ""}">${model?.capabilities?.images ? "Vision" : "Text only / unknown"}</span><span>${config.preset === "gemini" ? `Thinking ${escapeHtml(connection.reasoning_effort || "minimal")}` : "Reasoning provider managed"}</span><span>Provider managed</span></div>
        <div class="ps-api-actions"><span>${policyLinks}</span><button type="button" data-api-model-refresh>${icon("refresh", 13)} Refresh models</button><button type="button" data-api-disconnect>Disconnect</button></div>
        ${disclosure}
        <p class="ps-api-cancel-note">Stop aborts Prompt Studio's connection. The remote provider may continue processing or billing.</p>
      </div>
    </div>`;
  }
  return `${header}<div class="ps-api-layout">
    <div class="ps-api-preset-list">${providerChoices}</div>
    <form class="ps-api-setup" data-api-provider-form>
      <div class="ps-api-intro"><strong>Connect ${selectedPreset.name}</strong><p>One shared Chat Completions backend. Provider-specific fields are applied by the selected preset.</p></div>
      ${config.preset === "custom" ? `<label><span>API base URL</span><input name="base_url" type="url" value="${escapeHtml(config.base_url)}" placeholder="https://host.example/v1 or http://localhost:8000/v1" required><small>Public endpoints require HTTPS; loopback and private LAN addresses may use HTTP.</small></label>` : ""}
      <label><span>API key ${config.preset === "custom" ? "<em>optional</em>" : ""}</span><input name="api_key" type="password" value="" placeholder="Paste key for this session" autocomplete="off" spellcheck="false" ${config.preset === "custom" ? "" : "required"}><small>The key is sent once to the local Prompt Studio backend, kept only in memory, and never saved in localStorage.</small></label>
      <label><span>Model ID <em>optional before connect</em></span><input name="model_id" type="text" value="${escapeHtml(config.model_id)}" placeholder="Choose from provider list or enter an exact ID" spellcheck="false"></label>
      ${config.preset === "gemini" ? `<label><span>Thinking level</span><select name="gemini_reasoning_effort"><option value="minimal" ${config.gemini_reasoning_effort === "minimal" ? "selected" : ""}>Minimal</option><option value="low" ${config.gemini_reasoning_effort === "low" ? "selected" : ""}>Low</option><option value="medium" ${config.gemini_reasoning_effort === "medium" ? "selected" : ""}>Medium</option><option value="high" ${config.gemini_reasoning_effort === "high" ? "selected" : ""}>High</option></select><small>Gemini manages the reasoning and output budget. Higher levels can use more tokens and take longer.</small></label>` : ""}
      ${config.preset === "custom" ? `<div class="ps-api-custom-options"><label><input name="custom_images" type="checkbox" ${config.custom_images ? "checked" : ""}><span>Endpoint accepts image_url inputs</span></label><label><span>Known context <em>optional</em></span><input name="custom_context_tokens" type="number" min="4096" step="1024" value="${config.custom_context_tokens || ""}" placeholder="32768"></label></div>` : ""}
      ${studio.apiProviderError ? `<div class="ps-api-error"><strong>${escapeHtml(studio.apiProviderError.code || "Connection failed")}</strong><span>${escapeHtml(studio.apiProviderError.message)}</span></div>` : ""}
      ${disclosure}
      <div class="ps-api-actions"><span>${selectedPreset.keyUrl ? `<a href="${selectedPreset.keyUrl}" target="_blank" rel="noopener noreferrer">Create or manage key ↗</a>` : ""}${policyLinks}</span><button class="ps-api-primary" type="submit">Connect &amp; test</button></div>
    </form>
  </div>`;
}

function setOtherModelsPopover(open) {
  if (!studio) return;
  const popover = studio.root.querySelector("[data-other-models-popover]");
  const backdrop = studio.root.querySelector("[data-other-models-backdrop]");
  const trigger = studio.root.querySelector("[data-other-models-toggle]");
  if (!popover) return;
  popover.hidden = !open;
  if (backdrop) backdrop.hidden = !open;
  trigger?.setAttribute("aria-expanded", String(open));
  if (open) {
    requestAnimationFrame(() => {
      popover.querySelector("[data-other-models-close]")?.focus();
    });
  } else if (popover.contains(document.activeElement)) {
    trigger?.focus();
  }
}

function localModels() {
  return studio.models.filter((model) => model.family === "gguf");
}

/** Reflect one aspect ratio across every rendered control. */
function syncAspectRatioControls(value) {
  for (const control of aspectRatioControls) control?.update?.(value);
}

function directModelForSettings() {
  const models = localModels();
  if (studio.selectedModel?.family === "gguf") {
    return models.find((model) => model.id === studio.selectedModel.id) || studio.selectedModel;
  }
  return models.find((model) => model.runtime_ready) || models[0] || null;
}

function syncProviderSettings() {
  const provider = ["direct", "external", "ollama", "api"].includes(studio.settingsProvider) ? studio.settingsProvider : "direct";
  studio.root.querySelectorAll("[data-provider-option]").forEach((button) => {
    const selected = button.dataset.providerOption === provider;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  studio.root.querySelectorAll("[data-provider-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.providerPanel !== provider;
  });
  const runtimeSettings = studio.root.querySelector(".ps-runtime-settings");
  runtimeSettings.hidden = !["direct", "ollama"].includes(provider);
}

function directModelRuntimeSuffix(model) {
  const requirement = model.runtime_requirement || {};
  if (requirement.state === "update_required") {
    return `Runtime ${requirement.minimum_version}+ required`;
  }
  if (requirement.state === "missing") return "Runtime required";
  if (requirement.state === "incompatible") return "Runtime incompatible";
  return "";
}

function renderDirectModelRuntimeUpdate(model) {
  const requirement = model.runtime_requirement || {};
  const installed = requirement.installed_version || studio.ggufRuntimeDiagnostics?.package_version || "unknown";
  const minimum = requirement.minimum_version || "a newer version";
  const command = directRuntimeActionCommand();
  return `<section class="ps-direct-runtime-state is-missing">
    <header><span><small>Runtime</small><strong>Runtime update required</strong></span></header>
    <p>Installed llama-cpp-python ${escapeHtml(installed)}. ${escapeHtml(model.name)} requires ${escapeHtml(minimum)} or newer.</p>
    ${renderDirectRuntimeCommand(command, "update")}
    ${command ? "" : `<div class="ps-direct-runtime-links"><a href="${INSTALLATION_GUIDE_URL}" target="_blank" rel="noopener noreferrer">Installation guide ↗</a><a href="${TROUBLESHOOTING_GUIDE_URL}" target="_blank" rel="noopener noreferrer">Troubleshooting guide ↗</a></div>`}
  </section>`;
}

// Only offered when several compatible projectors share the model folder; a single
// match is paired automatically and an unresolved model stays text-only.
function renderDirectProjector(model) {
  const candidates = model?.projector_candidates || [];
  if (!model || candidates.length < 2) return "";
  const active = model.selected_projector || model.projector || "";
  return `<label class="ps-projector-control"><span>Vision projector</span><select data-direct-projector-select>
    ${candidates.map((path) => `<option value="${escapeHtml(path)}" ${path === active ? "selected" : ""}>${escapeHtml(path.split(/[\\/]/).pop())}</option>`).join("")}
  </select><small>Remembered for this model and checked again before generation.</small></label>`;
}

async function selectDirectProjector(modelId, projector) {
  const response = await selectProjector(modelId, projector);
  studio.models = studio.models.map((item) => (item.id === response.model.id ? response.model : item));
  studio.selectedModel = studio.selectedModel?.id === response.model.id ? response.model : studio.selectedModel;
  renderInferenceSettings();
  syncActiveModelSummary();
  showToast("Vision projector", "The selected projector will be used for this model.");
}

function renderInferenceSettings() {
  const ollamaHostDraft = studio.root.querySelector('[data-ollama-host-form] input[name="host"]')?.value;
  const models = localModels();
  const directModel = directModelForSettings();
  const select = studio.root.querySelector("[data-installed-model]");
  select.disabled = !models.length;
  select.innerHTML = models.length
    ? models.map((model) => {
      const modelFileNeedsSetup = model.model_ready === false;
      const suffix = [
        modelVramLabel(model),
        model.format,
        modelFileNeedsSetup ? "Needs setup" : "",
        directModelRuntimeSuffix(model),
        isTextOnlyDirectModel(model) ? "Text only" : "",
      ].filter(Boolean).join(" · ");
      return `<option value="${escapeHtml(model.id)}" ${model.id === directModel?.id ? "selected" : ""}>${escapeHtml(model.name.split("/").pop())}${suffix ? ` — ${escapeHtml(suffix)}` : ""}</option>`;
    }).join("")
    : "<option>No compatible model found</option>";
  studio.root.querySelector("[data-direct-runtime-status]").innerHTML = renderDirectRuntimeStatus();
  const directStatus = studio.root.querySelector("[data-direct-model-status]");
  if (!models.length) {
    directStatus.innerHTML = renderModelSetup();
  } else if (directModel) {
    const runtimeRequirement = directModel.runtime_requirement || {};
    directStatus.innerHTML = directModel.model_ready === false
      ? `<div class="ps-direct-model-warning"><strong>Model needs attention</strong><span>${escapeHtml(directModel.setup_message || "The GGUF metadata or architecture is not supported.")}</span></div>`
      : runtimeRequirement.state === "update_required"
        ? renderDirectModelRuntimeUpdate(directModel)
        : isTextOnlyDirectModel(directModel)
          ? `<div class="ps-direct-model-note"><strong>Text-only model · ${escapeHtml(textOnlyModeLabels())} available</strong><span>${escapeHtml(directModel.capability_message || "No compatible vision projector is active.")}</span></div>`
          : "";
  } else {
    directStatus.innerHTML = "";
  }
  studio.root.querySelector("[data-model-scan-slot]").innerHTML = renderModelScanDetails();
  studio.root.querySelector("[data-direct-projector]").innerHTML = renderDirectProjector(directModel);
  studio.root.querySelector("[data-verified-models-slot]").innerHTML = studio.modelSetup.length ? renderOtherModelsTrigger() : "";
  studio.root.querySelector("[data-external-provider-control]").innerHTML = renderExternalServerControl();
  studio.root.querySelector("[data-ollama-provider-control]").innerHTML = renderOllamaProviderControl(ollamaHostDraft);
  studio.root.querySelector("[data-api-provider-control]").innerHTML = renderApiProviderControl();
  const catalog = studio.root.querySelector("[data-other-models-catalog]");
  catalog.innerHTML = `<div class="ps-model-setup-list">${renderModelSetupRows()}</div>`;
  syncSelectedModelSourceLabel();
  syncProviderSettings();
}

async function loadGGUFRuntimeDiagnostics(force = false) {
  if (studio.ggufRuntimeDiagnostics && !force) return studio.ggufRuntimeDiagnostics;
  if (ggufRuntimeDiagnosticsPromise) return ggufRuntimeDiagnosticsPromise;
  studio.ggufRuntimeDiagnosticsLoading = true;
  if (studio.root) renderInferenceSettings();
  ggufRuntimeDiagnosticsPromise = diagnoseGGUFRuntime(force)
    .then((result) => {
      studio.ggufRuntimeDiagnostics = result.diagnostics;
      return result.diagnostics;
    })
    .finally(() => {
      studio.ggufRuntimeDiagnosticsLoading = false;
      ggufRuntimeDiagnosticsPromise = null;
      if (studio.root) renderInferenceSettings();
    });
  return ggufRuntimeDiagnosticsPromise;
}

async function refreshGGUFRuntimeDiagnostics(force = false) {
  try {
    await loadGGUFRuntimeDiagnostics(force);
  } catch (error) {
    studio.ggufRuntimeDiagnostics = {
      status: "unavailable",
      message: error.message || "The native runtime could not be inspected.",
      onboarding: { state: "broken", install_command: null },
    };
    renderInferenceSettings();
  }
}

function selectSettingsProvider(provider) {
  studio.modelSelectionRevision = (studio.modelSelectionRevision || 0) + 1;
  setOtherModelsPopover(false);
  rememberRuntimePreferences();
  studio.settingsProvider = ["direct", "external", "ollama", "api"].includes(provider) ? provider : "direct";
  applyRuntimePreferences(studio.settingsProvider);
  syncOllamaAutoDetection();
  if (studio.settingsProvider === "external" && studio.externalModel) {
    selectModel(studio.externalModel);
    return;
  }
  if (studio.settingsProvider === "direct") {
    const model = directModelForSettings();
    if (model && studio.selectedModel?.id !== model.id) {
      selectModel(model);
      return;
    }
  }
  if (studio.settingsProvider === "ollama") {
    studio.contextProfile = "auto";
    studio.kvCache = "auto";
    const model = ollamaModelForSettings();
    if (model && studio.selectedModel?.id !== model.id) {
      selectModel(model);
      return;
    }
  }
  if (studio.settingsProvider === "api") {
    studio.contextProfile = "auto";
    studio.kvCache = "auto";
    const model = apiProviderModelForSettings();
    if (studio.apiProviderConnection && model && studio.selectedModel?.id !== model.id) {
      selectModel(model);
      return;
    }
  }
  renderInferenceSettings();
  syncRuntimeSummary();
  saveUserPreferences(localStorage, studio);
}

function selectModel(model, { preserveSettingsProvider = false } = {}) {
  studio.modelSelectionRevision = (studio.modelSelectionRevision || 0) + 1;
  rememberRuntimePreferences();
  selectModelState(studio, model, { preserveSettingsProvider });
  // A text-only model cannot run the mode the user is on. Switch to the video
  // workspace's default mode and remember that we did, so the caller can explain
  // the fallback. The flag was lost in an earlier refactor while this use of it
  // survived, which threw "switchedToT2VA is not defined" on every model select.
  const switchedToTextOnlyMode = !isGenerationModeAvailable(model, studio.mode);
  if (switchedToTextOnlyMode) {
    stashCurrentModeDraft();
    studio.mode = defaultModeForWorkspace("video") || allModeIds()[0];
    studio.lastVideoMode = studio.mode;
    syncWorkspace();
    restoreModeDraft(studio.mode);
  }
  applyRuntimePreferences(studio.settingsProvider);
  if (model?.family === "gguf") {
    const availableContexts = model.context_profiles || ["low", "standard", "extended"];
    if (studio.contextProfile !== "auto" && studio.contextProfile !== "custom" && !availableContexts.includes(studio.contextProfile)) {
      studio.contextProfile = "auto";
      studio.directContextProfile = "auto";
    }
  }
  if (model?.family === "gguf") studio.preferredDirectModelId = model.id;
  const remote = ["external", "api"].includes(model?.family);
  if (model?.family !== "gguf") {
    studio.contextProfile = "auto";
    studio.kvCache = "auto";
  }
  if (model?.family === "ollama") {
    studio.ollamaModelName = model.remote_model;
    saveOllamaModel(localStorage, model.remote_model, studio.ollamaHost);
  }
  if (model?.family === "api") {
    studio.contextProfile = "auto";
    studio.kvCache = "auto";
    studio.thinking = false;
    studio.apiProviderConfig.model_id = model.remote_model;
    saveApiProviderConfig(localStorage, studio.apiProviderConfig);
  }
  const keepLoaded = studio.root.querySelector("[data-keep-loaded]");
  const keepLoadedControl = studio.root.querySelector("[data-keep-loaded-control]");
  const vramHandoff = studio.root.querySelector("[data-vram-handoff]");
  const vramHandoffControl = studio.root.querySelector("[data-vram-handoff-control]");
  keepLoadedControl.hidden = remote && !model?.lifecycle_supported;
  keepLoaded.checked = studio.keepModelLoaded;
  if (vramHandoffControl && vramHandoff) {
    vramHandoffControl.hidden = !selectedModelSupportsVramHandoff();
    vramHandoff.checked = studio.vramHandoff;
  }
  renderInferenceSettings();
  renderMedia(studio.mode);
  setOtherModelsPopover(false);
  syncRuntimeSummary();
  syncThinkingAvailability();
  saveUserPreferences(localStorage, studio);
  if (switchedToTextOnlyMode && !studio.preferencesRestoring) {
    showToast(
      "Switched mode",
      model?.capability_message
        || `The selected model cannot run the previous mode, so ${modeData(studio.mode).title || studio.mode} was selected.`,
    );
  }
}

function rememberRuntimePreferences(provider = studio.settingsProvider) {
  if (studio.preferencesRestoring) return;
  if (provider === "direct") {
    studio.directContextProfile = studio.contextProfile;
    studio.directContextTokens = studio.contextTokens;
    studio.directKvCache = studio.kvCache;
    studio.directGenerationBudget = studio.generationBudget;
    studio.directGenerationBudgetTokens = studio.generationBudgetTokens;
    studio.directReasoningEffort = studio.reasoningEffort;
  }
}

function applyRuntimePreferences(provider) {
  if (provider === "direct") {
    studio.contextProfile = studio.directContextProfile;
    studio.contextTokens = studio.directContextTokens;
    studio.kvCache = studio.directKvCache;
    studio.generationBudget = studio.directGenerationBudget;
    studio.generationBudgetTokens = studio.directGenerationBudgetTokens;
    studio.reasoningEffort = studio.directReasoningEffort;
  } else {
    studio.contextProfile = "auto";
    studio.contextTokens = null;
    studio.kvCache = "auto";
    studio.generationBudget = "auto";
    studio.generationBudgetTokens = null;
    studio.reasoningEffort = "auto";
  }
}

function syncThinkingAvailability() {
  if (!studio) return;
  const apiManaged = studio.selectedModel?.family === "api";
  const externalManaged = studio.selectedModel?.family === "external";
  const context = studio.contextProfile;
  const resolved = context === "auto" ? (studio.selectedModel?.recommended_context || "standard") : context;
  const input = studio.root.querySelector("[data-thinking]");
  const label = input.closest("label");
  const unsupported = ["ollama", "gguf"].includes(studio.selectedModel?.family)
    && studio.selectedModel.thinking !== true;
  const customTooSmall = context === "custom" && Number(studio.contextTokens || 0) < 16384;
  const disabled = apiManaged || externalManaged || unsupported || (context !== "auto" && (resolved === "low" || customTooSmall));
  if (disabled) input.checked = false;
  if (disabled) studio.thinking = false;
  input.checked = studio.thinking;
  input.disabled = disabled;
  label.hidden = apiManaged;
  label.classList.toggle("is-disabled", disabled);
  label.title = externalManaged
    ? "Thinking is controlled by the external llama.cpp server. Start it with --reasoning on --reasoning-effort low to enable, or --reasoning off to disable."
    : unsupported
    ? "This provider model does not report thinking controls."
    : disabled ? "Thinking needs 16K or larger Context." : "";
}

const CONTEXT_LABELS = { auto: "Auto", low: "8K", standard: "16K", extended: "24K", large: "32K", maximum: "48K", custom: "Custom" };
const KV_LABELS = { auto: "Auto", q8: "Q8", f16: "F16" };
const BUDGET_LABELS = { auto: "Auto", 2048: "2K", 4096: "4K", 8192: "8K", custom: "Custom" };

function syncContextAvailability() {
  const profiles = studio.selectedModel?.family === "gguf"
    ? (studio.selectedModel.context_profiles || ["low", "standard", "extended"])
    : [];
  studio.root.querySelectorAll('[data-runtime-option="context"]').forEach((button) => {
    const unavailable = studio.selectedModel?.family === "gguf"
      && button.dataset.value !== "auto"
      && button.dataset.value !== "custom"
      && !profiles.includes(button.dataset.value);
    button.disabled = unavailable;
    button.setAttribute("aria-disabled", String(unavailable));
    button.title = unavailable ? "This Context tier is not available for the selected Direct model." : "";
  });
}

function syncAdvancedRuntimeControls() {
  const direct = studio.selectedModel?.family === "gguf";
  const advanced = studio.root.querySelector("[data-direct-runtime-advanced]");
  advanced.hidden = !direct;
  const customContext = studio.root.querySelector("[data-custom-context]");
  customContext.hidden = !direct || studio.contextProfile !== "custom";
  const contextInput = studio.root.querySelector("[data-custom-context-input]");
  contextInput.value = studio.contextTokens || "";
  const nativeContext = studio.selectedModel?.native_context_tokens;
  if (Number.isInteger(nativeContext) && nativeContext > 0) contextInput.max = String(nativeContext);
  else contextInput.removeAttribute("max");

  const customBudget = studio.root.querySelector("[data-custom-generation-budget]");
  customBudget.hidden = !direct || studio.generationBudget !== "custom";
  studio.root.querySelector("[data-custom-generation-budget-input]").value = studio.generationBudgetTokens || "";

  const values = direct ? (studio.selectedModel?.reasoning_effort_values || []) : [];
  if (studio.reasoningEffort !== "auto" && !values.includes(studio.reasoningEffort)) {
    studio.reasoningEffort = "auto";
    studio.directReasoningEffort = "auto";
  }
  const reasoningControl = studio.root.querySelector("[data-reasoning-effort-control]");
  reasoningControl.hidden = values.length === 0;
  const generationBudgetOverride = studio.generationBudget !== "auto"
    && (studio.generationBudget !== "custom"
      || (Number.isInteger(studio.generationBudgetTokens) && studio.generationBudgetTokens > 0));
  const overrideCount = Number(studio.kvCache !== "auto")
    + Number(generationBudgetOverride)
    + Number(studio.reasoningEffort !== "auto" && values.includes(studio.reasoningEffort));
  studio.root.querySelector("[data-direct-advanced-summary]").textContent = overrideCount
    ? `${overrideCount} override${overrideCount === 1 ? "" : "s"}`
    : "Auto";
  const menu = studio.root.querySelector('[data-runtime-menu="reasoning"]');
  menu.innerHTML = ["auto", ...values].map((value) => `<button type="button" data-runtime-option="reasoning" data-value="${escapeHtml(value)}">${value === "auto" ? "Auto" : escapeHtml(value[0].toUpperCase() + value.slice(1))}</button>`).join("");
  menu.querySelectorAll('[data-runtime-option="reasoning"]').forEach((button) => button.addEventListener("click", (event) => applyRuntimeOption(button, event)));
}

function setRuntimeMenuOpen(name, open, restoreFocus = false) {
  if (!studio) return;
  const menu = studio.root.querySelector(`[data-runtime-menu="${name}"]`);
  const toggle = studio.root.querySelector(`[data-runtime-toggle="${name}"]`);
  if (!menu) return;
  menu.hidden = !open;
  toggle?.setAttribute("aria-expanded", String(open));
  if (!open && restoreFocus) toggle?.focus({ preventScroll: true });
}

function closeRuntimeMenus(exceptName = null) {
  if (!studio) return;
  studio.root.querySelectorAll("[data-runtime-menu]").forEach((menu) => {
    if (menu.dataset.runtimeMenu !== exceptName) setRuntimeMenuOpen(menu.dataset.runtimeMenu, false);
  });
}

function applyRuntimeOption(button, event) {
  event.preventDefault();
  if (button.dataset.runtimeOption === "context") studio.contextProfile = button.dataset.value;
  else if (button.dataset.runtimeOption === "kv") studio.kvCache = button.dataset.value;
  else if (button.dataset.runtimeOption === "budget") studio.generationBudget = button.dataset.value;
  else studio.reasoningEffort = button.dataset.value;
  setRuntimeMenuOpen(button.dataset.runtimeOption, false, true);
  syncRuntimeSummary();
  syncThinkingAvailability();
  rememberRuntimePreferences();
  saveUserPreferences(localStorage, studio);
}

function syncRuntimeSummary(result = null) {
  if (!studio) return;
  syncContextAvailability();
  syncAdvancedRuntimeControls();
  const customContextLabel = studio.contextTokens ? `${Number(studio.contextTokens).toLocaleString()}` : "Custom";
  studio.root.querySelector('[data-runtime-label="context"]').textContent = CONTEXT_LABELS[studio.contextProfile];
  studio.root.querySelector('[data-runtime-label="kv"]').textContent = KV_LABELS[studio.kvCache];
  studio.root.querySelector('[data-runtime-label="budget"]').textContent = BUDGET_LABELS[studio.generationBudget];
  studio.root.querySelector('[data-runtime-label="reasoning"]').textContent = studio.reasoningEffort === "auto"
    ? "Auto"
    : studio.reasoningEffort[0].toUpperCase() + studio.reasoningEffort.slice(1);
  let activeSummary;
  if (studio.selectedModel?.family === "external") {
    const tokens = result?.context_tokens || studio.selectedModel.server_context_tokens;
    activeSummary = tokens ? `Server · ${Math.round(tokens / 1024)}K` : "Server managed";
  } else if (studio.selectedModel?.family === "ollama") {
    const tokens = result?.context_tokens || (studio.contextProfile === "auto" ? null : ({ low: 8192, standard: 16384, extended: 24576, large: 32768, maximum: 49152 }[studio.contextProfile]));
    activeSummary = tokens ? `Ollama · ${Math.round(tokens / 1024)}K` : "Ollama · Auto";
  } else if (studio.selectedModel?.family === "api") {
    const tokens = result?.context_limit_known ? result.context_tokens : studio.selectedModel.model_context_limit;
    activeSummary = tokens ? `API · ${Math.round(tokens / 1024)}K` : "API · Provider managed";
  } else if (result && studio.contextProfile === "auto") {
    activeSummary = `Auto → ${Math.round(result.context_tokens / 1024)}K · ${String(result.kv_cache).toUpperCase()}`;
  } else {
    activeSummary = studio.contextProfile === "auto" ? "Runtime · Auto" : `${studio.contextProfile === "custom" ? customContextLabel : CONTEXT_LABELS[studio.contextProfile]} · ${KV_LABELS[studio.kvCache]}`;
  }
  syncActiveModelSummary(activeSummary);
  studio.root.querySelectorAll("[data-runtime-option]").forEach((button) => {
    const selected = button.dataset.runtimeOption === "context"
      ? studio.contextProfile
      : button.dataset.runtimeOption === "kv"
        ? studio.kvCache
        : button.dataset.runtimeOption === "budget"
          ? studio.generationBudget
          : studio.reasoningEffort;
    button.classList.toggle("is-selected", button.dataset.value === selected);
  });
}

function setSettingsTab(tab) {
  if (!studio?.root) return;
  const target = tab === "media" ? "media" : "model";
  studio.settingsTab = target;
  studio.root.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.settingsTab === target));
  });
  studio.root.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== target;
  });
  const subtitle = studio.root.querySelector("[data-settings-subtitle]");
  if (subtitle) {
    subtitle.textContent = target === "media"
      ? "How references reach the prompt model"
      : "Inference, runtime and prompt behavior";
  }
  if (target === "media") syncMediaSettings();
}

/** Keep the media-handling controls in step with the stored setting. */
function syncMediaSettings() {
  if (!studio?.root) return;
  const toggle = studio.root.querySelector("[data-blind-media]");
  if (toggle) toggle.checked = studio.blindMedia === true;
}

function setSettingsOpen(open) {
  if (!studio) return;
  setOtherModelsPopover(false);
  const selectedProvider = studio.selectedModel?.family === "external" ? "external" : studio.selectedModel?.family === "ollama" ? "ollama" : studio.selectedModel?.family === "api" ? "api" : studio.selectedModel?.family === "gguf" ? "direct" : null;
  if (!open && selectedProvider) studio.settingsProvider = selectedProvider;
  studio.root.querySelector("[data-settings-view]").hidden = !open;
  // Closing Settings must not reveal the workspace while the target picker is
  // still up, or the picker would stop covering the studio.
  const workspaceHidden = open || Boolean(studio.targetSelectionOpen);
  studio.root.querySelectorAll("[data-generate-view]").forEach((element) => { element.hidden = workspaceHidden; });
  studio.root.querySelector("[data-open-settings-header]").hidden = open;
  studio.root.classList.toggle("is-settings-open", open);
  if (open) {
    if (selectedProvider) studio.settingsProvider = selectedProvider;
    setSettingsTab(studio.settingsTab || "model");
    syncMediaSettings();
    renderInferenceSettings();
    syncRuntimeSummary();
  }
  syncOllamaAutoDetection();
}

function syncOllamaAutoDetection() {
  clearTimeout(studio?.ollamaPollTimer);
  if (!studio) return;
  studio.ollamaPollTimer = null;
  const settingsOpen = studio.root.classList.contains("is-settings-open");
  const needsDetection = studio.settingsProvider === "ollama" && studio.ollamaStatus?.state !== "ready";
  if (!settingsOpen || !needsDetection) return;
  studio.ollamaPollTimer = setTimeout(() => refreshOllama({ automatic: true }), 4000);
}

async function connectExternalServer(form) {
  studio.modelSelectionRevision = (studio.modelSelectionRevision || 0) + 1;
  const attempt = (studio.externalConnectionAttempt || 0) + 1;
  studio.externalConnectionAttempt = attempt;
  const selectionRevision = studio.modelSelectionRevision || 0;
  const submit = form.querySelector('[type="submit"]');
  const config = {
    url: form.elements.url.value.trim(),
    model: form.elements.model.value.trim(),
    ...(form.elements.api_key.value.trim() ? {api_key:form.elements.api_key.value.trim()} : {}),
  };
  submit.disabled = true;
  submit.textContent = "Connecting…";
  try {
    const result = await probeExternalServer(config);
    if (studio.externalConnectionAttempt !== attempt || (studio.modelSelectionRevision || 0) !== selectionRevision) return;
    const saved = { url: result.model.endpoint, model: result.model.remote_model };
    studio.externalServerConfig = saved;
    studio.externalServerError = null;
    studio.externalModel = result.model;
    saveExternalServerConfig(localStorage, saved);
    studio.models = [...studio.models.filter((model) => model.family !== "external"), result.model];
    selectModel(result.model);
    const context = result.model.context_verified !== false
      ? ` · ${Math.round(result.model.server_context_tokens / 1024)}K context` : "";
    showToast("llama.cpp connected", `${result.model.name}${context}`);
  } catch (error) {
    if (studio.externalConnectionAttempt !== attempt || (studio.modelSelectionRevision || 0) !== selectionRevision) return;
    studio.externalServerError = error;
    showToast(error.code || "Connection failed", error.message, error.details);
    renderInferenceSettings();
  } finally {
    if (studio.externalConnectionAttempt === attempt) {
      submit.disabled = false;
      submit.textContent = "Connect";
    }
  }
}

function disconnectExternalServer() {
  studio.externalConnectionAttempt = (studio.externalConnectionAttempt || 0) + 1;
  const wasSelected = studio.selectedModel?.family === "external";
  studio.externalServerConfig = null;
  studio.externalServerError = null;
  studio.externalModel = null;
  saveExternalServerConfig(localStorage, null);
  studio.models = studio.models.filter((model) => model.family !== "external");
  if (wasSelected) selectModel(studio.models.find((model) => model.runtime_ready) || studio.models[0] || null);
  studio.settingsProvider = "external";
  renderInferenceSettings();
  syncRuntimeSummary();
  saveUserPreferences(localStorage, studio);
  showToast("External server disconnected", "The llama.cpp process was left running and unchanged.");
}

async function connectConfiguredApiProvider(form) {
  studio.modelSelectionRevision = (studio.modelSelectionRevision || 0) + 1;
  const attempt = (studio.apiConnectionAttempt || 0) + 1;
  studio.apiConnectionAttempt = attempt;
  const selectionRevision = studio.modelSelectionRevision || 0;
  const submit = form.querySelector('[type="submit"]');
  const contextValue = Number(form.elements.custom_context_tokens?.value || 0);
  const config = {
    preset: studio.apiProviderConfig.preset,
    base_url: form.elements.base_url?.value.trim() || "",
    model_id: form.elements.model_id.value.trim(),
    gemini_reasoning_effort: form.elements.gemini_reasoning_effort?.value || studio.apiProviderConfig.gemini_reasoning_effort || "minimal",
    custom_images: Boolean(form.elements.custom_images?.checked),
    custom_context_tokens: Number.isInteger(contextValue) && contextValue >= 4096 ? contextValue : null,
  };
  submit.disabled = true;
  submit.textContent = "Connecting…";
  try {
    const result = await probeApiProvider({
      preset: config.preset,
      base_url: config.base_url,
      model_id: config.model_id,
      credential: {
        source: "session",
        value: form.elements.api_key?.value || "",
      },
      custom_capabilities: {
        images: config.custom_images,
        context_tokens: config.custom_context_tokens,
      },
      provider_options: {
        reasoning_effort: config.gemini_reasoning_effort,
      },
    });
    if (studio.apiConnectionAttempt !== attempt || (studio.modelSelectionRevision || 0) !== selectionRevision) {
      if (result.connection.id !== studio.apiProviderConnection?.id) {
        await disconnectApiProvider(result.connection.id).catch(() => {});
      }
      return;
    }
    if (studio.apiProviderConnection?.id && studio.apiProviderConnection.id !== result.connection.id) {
      disconnectApiProvider(studio.apiProviderConnection.id).catch(() => {});
    }
    studio.apiProviderConfig = config;
    studio.apiProviderConnection = result.connection;
    studio.apiProviderModels = result.models || [];
    studio.apiProviderError = null;
    saveApiProviderConfig(localStorage, config);
    studio.models = [...studio.models.filter((model) => model.family !== "api"), ...studio.apiProviderModels];
    const model = result.model || apiProviderModelForSettings();
    if (model) selectModel(model);
    else {
      renderInferenceSettings();
      syncRuntimeSummary();
      saveUserPreferences(localStorage, studio);
    }
    showToast(
      `${result.connection.provider_name} connected`,
      model ? `${model.name} · ${model.capabilities?.images ? "vision ready" : "text only or vision unknown"}${result.connection.connection_verified ? "" : " · endpoint unverified"}` : "Connected. Enter an exact model ID or refresh the model list.",
    );
  } catch (error) {
    if (studio.apiConnectionAttempt !== attempt || (studio.modelSelectionRevision || 0) !== selectionRevision) return;
    studio.apiProviderError = error;
    showToast(error.code || "API connection failed", error.message, error.details);
    renderInferenceSettings();
  } finally {
    if (studio.apiConnectionAttempt === attempt) {
      submit.disabled = false;
      submit.textContent = "Connect & test";
    }
  }
}

async function disconnectConfiguredApiProvider({ announce = true } = {}) {
  studio.apiConnectionAttempt = (studio.apiConnectionAttempt || 0) + 1;
  const connection = studio.apiProviderConnection;
  const wasSelected = studio.selectedModel?.family === "api";
  studio.apiProviderConnection = null;
  studio.apiProviderModels = [];
  studio.apiProviderError = null;
  studio.models = studio.models.filter((model) => model.family !== "api");
  if (wasSelected) selectModel(studio.models.find((model) => model.runtime_ready) || studio.models[0] || null);
  studio.settingsProvider = "api";
  renderInferenceSettings();
  syncRuntimeSummary();
  saveUserPreferences(localStorage, studio);
  if (announce) showToast("API provider disconnected", "The session credential was removed from backend memory.");
  if (connection?.id) {
    try {
      await disconnectApiProvider(connection.id);
    } catch {}
  }
}

async function chooseApiProviderPreset(preset) {
  if (!API_PROVIDER_UI[preset] || preset === studio.apiProviderConfig.preset) return;
  // Invalidate pending attempts even before the first connection exists.
  void disconnectConfiguredApiProvider({ announce: false });
  studio.apiProviderConfig = {
    ...studio.apiProviderConfig,
    preset,
    base_url: "",
    model_id: "",
    gemini_reasoning_effort: "minimal",
    custom_images: false,
    custom_context_tokens: null,
  };
  saveApiProviderConfig(localStorage, studio.apiProviderConfig);
  studio.settingsProvider = "api";
  renderInferenceSettings();
}

async function refreshApiProviderModels() {
  if (!studio.apiProviderConnection) return;
  const attempt = (studio.apiConnectionAttempt || 0) + 1;
  studio.apiConnectionAttempt = attempt;
  const selectionRevision = studio.modelSelectionRevision || 0;
  try {
    const result = await getApiProviderModels(studio.apiProviderConnection.id);
    if (studio.apiConnectionAttempt !== attempt || (studio.modelSelectionRevision || 0) !== selectionRevision) return;
    const selectedRemote = studio.selectedModel?.family === "api" ? studio.selectedModel.remote_model : studio.apiProviderConfig.model_id;
    studio.apiProviderConnection = result.connection;
    studio.apiProviderModels = result.models || [];
    studio.models = [...studio.models.filter((model) => model.family !== "api"), ...studio.apiProviderModels];
    const model = studio.apiProviderModels.find((item) => item.remote_model === selectedRemote) || apiProviderModelForSettings();
    if (model) selectModel(model);
    else renderInferenceSettings();
    showToast("API models refreshed", `${studio.apiProviderModels.length} model${studio.apiProviderModels.length === 1 ? "" : "s"} reported.`);
  } catch (error) {
    if (studio.apiConnectionAttempt !== attempt || (studio.modelSelectionRevision || 0) !== selectionRevision) return;
    studio.apiProviderError = error;
    showToast(error.code || "Model refresh failed", error.message, error.details);
  }
}

async function refreshModels() {
  const attempt = (studio.modelDiscoveryAttempt || 0) + 1;
  studio.modelDiscoveryAttempt = attempt;
  const selectionRevision = studio.modelSelectionRevision || 0;
  const externalAttempt = studio.externalConnectionAttempt || 0;
  try {
    // The target catalog is optional: a caller may not provide the client, and a
    // failed request must not block model discovery. The built-in snapshot keeps
    // the UI rendering either way.
    const targetCatalog = typeof getTargets === "function"
      ? await getTargets().catch(() => null)
      : null;
    const [result, status, ollamaStatus, apiPresets] = await Promise.all([
      getModels(),
      getStatus(studio.ollamaHost),
      getOllamaStatus(studio.ollamaHost).catch((error) => ({ state: "error", running: false, compatible_models: [], error: { code: error.code, message: error.message } })),
      getApiProviderPresets().catch(() => ({ presets: [] })),
    ]);
    if (studio.modelDiscoveryAttempt !== attempt || (studio.modelSelectionRevision || 0) !== selectionRevision) return;
    if (targetCatalog) adoptTargetCatalog(targetCatalog);
    const selectedId = studio.selectedModel?.id;
    const selectedBeforeRefresh = studio.selectedModel;
    const models = [...result.models, ...(ollamaStatus.compatible_models || []), ...studio.apiProviderModels];
    let externalModel = null;
    let externalServerError = null;
    if (studio.externalServerConfig) {
      try {
        const external = await probeExternalServer(studio.externalServerConfig);
        if (studio.modelDiscoveryAttempt !== attempt || (studio.modelSelectionRevision || 0) !== selectionRevision || (studio.externalConnectionAttempt || 0) !== externalAttempt) return;
        externalModel = external.model;
        models.push(external.model);
      } catch (error) {
        if (studio.modelDiscoveryAttempt !== attempt || (studio.modelSelectionRevision || 0) !== selectionRevision || (studio.externalConnectionAttempt || 0) !== externalAttempt) return;
        externalServerError = error;
      }
    }
    studio.ollamaStatus = ollamaStatus;
    studio.ollamaError = ollamaStatus.error || null;
    studio.apiProviderPresets = apiPresets.presets || [];
    studio.models = models;
    studio.externalModel = externalModel;
    studio.externalServerError = externalServerError;
    studio.modelSetup = result.setup || [];
    studio.modelDiscovery = result.discovery || null;
    studio.modelDirectory = result.model_directory || "ComfyUI/models/LLM/";
    studio.gpuMemory = status.gpu_memory;
    if (!studio.requestBusy) updatePromptResidency(status);
    const restoredModel = !selectedBeforeRefresh ? restoredModelAfterDiscovery(studio) : null;
    selectModel(
      restoredModel
      || studio.models.find((model) => model.id === selectedId)
      || (selectedBeforeRefresh?.family === "ollama" && selectedBeforeRefresh.endpoint === studio.ollamaHost ? selectedBeforeRefresh : null)
      || (selectedBeforeRefresh?.family === "api" ? selectedBeforeRefresh : null)
      || restoredModelAfterDiscovery(studio),
      { preserveSettingsProvider: studio.root.classList.contains("is-settings-open") },
    );
    studio.preferencesRestoring = false;
    if (!studio.requestBusy) setGenerationState("idle", "", "");
    refreshGGUFRuntimeDiagnostics();
  } catch (error) {
    if (studio.modelDiscoveryAttempt !== attempt || (studio.modelSelectionRevision || 0) !== selectionRevision) return;
    studio.preferencesRestoring = false;
    showToast(error.code || "Model scan failed", error.message, error.details);
  } finally {
    // A newer selection can invalidate the result, but must not leave startup
    // restoration active. A newer discovery owns its own completion instead.
    if (studio.modelDiscoveryAttempt === attempt) {
      studio.preferencesRestoring = false;
    }
  }
}

async function configureOllamaHost(form) {
  const submit = form.querySelector('[type="submit"]');
  const requestedHost = normalizeOllamaHost(form.elements.host.value);
  submit.disabled = true;
  submit.textContent = "Checking…";
  try {
    const status = await getOllamaStatus(requestedHost);
    const endpoint = normalizeOllamaHost(status.endpoint || requestedHost);
    const changed = endpoint !== studio.ollamaHost;
    const ollamaWasSelected = studio.selectedModel?.family === "ollama";
    studio.ollamaHost = endpoint;
    studio.ollamaModelName = loadOllamaModel(localStorage, endpoint);
    studio.ollamaStatus = status;
    studio.ollamaError = status.error || null;
    studio.ollamaHostSettingsOpen = false;
    studio.ollamaStorageHelpOpen = false;
    saveOllamaHost(localStorage, endpoint);
    form.elements.host.value = endpoint;
    studio.models = [...studio.models.filter((model) => model.family !== "ollama"), ...(status.compatible_models || [])];
    studio.promptResidency.ollama = [];
    const model = ollamaModelForSettings();
    if (studio.settingsProvider === "ollama" && model) {
      selectModel(model);
    } else if (ollamaWasSelected) {
      selectModel(
        studio.models.find((candidate) => candidate.family !== "ollama" && candidate.runtime_ready) || null,
        { preserveSettingsProvider: true },
      );
    } else {
      renderInferenceSettings();
      syncRuntimeSummary();
    }
    syncOllamaAutoDetection();
    showToast(
      changed ? "Ollama host updated" : "Ollama host checked",
      endpoint === DEFAULT_OLLAMA_HOST ? "Using Ollama on this computer." : `Using ${endpoint}.`,
    );
  } catch (error) {
    showToast(error.code || "Invalid Ollama host", error.message, error.details);
    renderInferenceSettings();
  } finally {
    submit.disabled = false;
    submit.textContent = "Apply";
  }
}

async function refreshOllama({ automatic = false } = {}) {
  if (studio.ollamaRefreshBusy) return;
  studio.ollamaRefreshBusy = true;
  clearTimeout(studio.ollamaPollTimer);
  studio.ollamaPollTimer = null;
  const control = studio.root.querySelector("[data-ollama-provider-control]");
  const refreshButton = control?.querySelector("[data-ollama-refresh]");
  if (refreshButton && !automatic) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Checking…";
  }
  try {
    const requestedHost = studio.ollamaHost;
    const status = await getOllamaStatus(requestedHost);
    if (requestedHost !== studio.ollamaHost) return;
    studio.ollamaStatus = status;
    studio.ollamaError = status.error || null;
    studio.models = [...studio.models.filter((model) => model.family !== "ollama"), ...(status.compatible_models || [])];
    const model = ollamaModelForSettings();
    if (model && studio.settingsProvider === "ollama") selectModel(model);
    else renderInferenceSettings();
    if (!automatic && status.state !== "ready") {
      showToast(
        status.state === "not_installed" ? "Ollama is not installed" : "Ollama is not running",
        studio.ollamaHost !== DEFAULT_OLLAMA_HOST
          ? `The Ollama service at ${studio.ollamaHost} is not responding.`
          : status.state === "not_installed"
          ? "Install the official Ollama app, then return here."
          : "Open the Ollama app, wait for its local service to start, then select Check now again.",
      );
    }
  } catch (error) {
    studio.ollamaStatus = { state: "error", running: false, compatible_models: [], error: { code: error.code, message: error.message } };
    studio.ollamaError = error;
    renderInferenceSettings();
    if (!automatic) showToast("Ollama check failed", error.message, error.details);
  } finally {
    studio.ollamaRefreshBusy = false;
    syncOllamaAutoDetection();
  }
}

function toggleRefine(open) {
  const panel = studio.root.querySelector("[data-refine-panel]");
  const outputPanel = studio.root.querySelector(".ps-output-panel");
  if (open && isAudioMode(studio.mode)) toggleLyricsRefine(false);
  panel.hidden = !open;
  outputPanel.classList.toggle("is-refining", open);
  if (open) requestAnimationFrame(() => panel.querySelector("textarea").focus({ preventScroll: true }));
}

function toggleLyricsRefine(open) {
  if (!studio) return;
  const panel = studio.root.querySelector("[data-lyrics-refine-panel]");
  if (open) toggleRefine(false);
  panel.hidden = !open;
  if (open) requestAnimationFrame(() => panel.querySelector("textarea").focus({ preventScroll: true }));
}

async function cancelLyricsRefinement() {
  if (!studio.lyricsRequestBusy) {
    toggleLyricsRefine(false);
    return;
  }
  const submit = studio.root.querySelector("[data-lyrics-refine-submit]");
  submit.innerHTML = `<span class="ps-spinner"></span>Cancelling…`;
  try {
    await cancel();
  } catch (error) {
    showToast(error.code || "Cancel failed", error.message, error.details);
  }
}

async function submitLyricsRefinement() {
  const panel = studio.root.querySelector("[data-lyrics-refine-panel]");
  const submit = panel.querySelector("[data-lyrics-refine-submit]");
  const instruction = panel.querySelector("[data-lyrics-refine-instruction]").value.trim();
  const lyrics = studio.root.querySelector("[data-music-lyrics]");
  const currentLyrics = lyrics.value;
  const useMusicBrief = panel.querySelector("[data-lyrics-use-brief]").checked;
  const musicBrief = studio.root.querySelector("[data-music-brief]").value.trim();
  if (submit.disabled || studio.requestBusy) return;
  if (currentLyrics.trim() && !instruction) {
    showToast("Add a revision note", "Describe how the existing Lyrics should change.");
    return;
  }
  if (!currentLyrics.trim() && !instruction && (!useMusicBrief || !musicBrief)) {
    showToast("Describe the Lyrics", "Add an instruction or include a Music Brief to create new Lyrics.");
    return;
  }
  if (!studio.selectedModel) {
    showToast("No prompt model selected", "Choose a local model, connect llama.cpp, or configure an API provider.");
    return;
  }
  if (!studio.selectedModel.runtime_ready) {
    showToast("Model setup is incomplete", studio.selectedModel.setup_message || `Missing: ${studio.selectedModel.missing_dependencies.join(", ")}.`);
    return;
  }
  if (!generationModeIsAvailable()) return;
  if (!await prepareWriterRequest()) return;

  markActiveWriterRequest();
  studio.lyricsRequestBusy = true;
  submit.disabled = true;
  submit.innerHTML = `<span class="ps-spinner"></span>${currentLyrics.trim() ? "Refining…" : "Creating…"}`;
  setGenerationState("busy", currentLyrics.trim() ? "Refining lyrics" : "Creating lyrics", studio.selectedModel.name.split("/").pop());
  try {
    const result = await vramHandoffCoordinator.trackWriterRequest(refine(buildLyricsRefinePayload(studio, {
      currentLyrics,
      instruction,
      useMusicBrief,
      creativeBrief: musicBrief,
      seed: newGenerationSeed(),
    })));
    if (lyrics.value !== currentLyrics) {
      showToast("Lyrics kept", "The rewrite was not applied because you edited the Lyrics.");
      return;
    }
    studio.lyricsRestore = { lyrics: currentLyrics };
    lyrics.value = result.prompt;
    const restore = panel.querySelector("[data-lyrics-refine-restore]");
    restore.textContent = currentLyrics.trim() ? "Restore previous" : "Remove generated";
    restore.hidden = false;
    updateMusicLyricsCount();
    saveCurrentModeDraft();
    studio.desktopNotifications.notify("Lyrics request finished.");
    showToast(
      currentLyrics.trim() ? "Lyrics rewritten" : "Lyrics created",
      `${result.total_seconds.toFixed(1)}s · ${result.tokens_per_second.toFixed(1)} tok/s`,
    );
  } catch (error) {
    if (error.code !== "GENERATION_CANCELLED") studio.desktopNotifications.notify("Lyrics request failed. Open Prompt Studio for details.");
    if (error.code === "GENERATION_CANCELLED") showToast("Lyrics request cancelled", "The previous Lyrics were kept.");
    else if (error.code === "INSUFFICIENT_FREE_VRAM") showVramRetry(error, submitLyricsRefinement);
    else showToast(error.code || "Lyrics request failed", error.message, error.details);
  } finally {
    studio.lyricsRequestBusy = false;
    submit.disabled = false;
    submit.innerHTML = `${icon("spark", 13)} Refine`;
    try {
      const status = await getStatus(studio.ollamaHost);
      updatePromptResidency(status);
    } catch {}
    clearActiveWriterRequest();
    setGenerationState("idle", "", "");
  }
}

async function submitRefinement() {
  const panel = studio.root.querySelector("[data-refine-panel]");
  const submit = panel.querySelector("[data-refine-submit]");
  const instruction = panel.querySelector("textarea").value.trim();
  const output = studio.root.querySelector("[data-output]");
  if (submit.disabled || studio.requestBusy) return;
  if (!instruction) {
    showToast("Add a revision note", "Tell the model what should change in the current prompt.");
    return;
  }
  if (!studio.selectedModel) {
    showToast("No prompt model selected", "Choose a local model, connect llama.cpp, or configure an API provider.");
    return;
  }
  if (!studio.selectedModel.runtime_ready) {
    showToast("Model setup is incomplete", studio.selectedModel.setup_message || `Missing: ${studio.selectedModel.missing_dependencies.join(", ")}.`);
    return;
  }
  if (!generationModeIsAvailable()) return;
  if (!await prepareWriterRequest()) return;

  const previousPrompt = output.value;
  const previousMeta = studio.root.querySelector(".ps-editor-meta span:last-child").textContent;
  markActiveWriterRequest();
  submit.disabled = true;
  submit.innerHTML = `<span class="ps-spinner"></span>Refining…`;
  setGenerationState("busy", "Refining prompt", studio.selectedModel.name.split("/").pop());
  try {
    const result = await vramHandoffCoordinator.trackWriterRequest(refine(buildRefinePayload(studio, {
      currentPrompt: previousPrompt,
      instruction,
      creativeBrief: currentBriefTextarea().value.trim(),
      lyrics: studio.root.querySelector("[data-music-lyrics]")?.value ?? "",
      seed: newGenerationSeed(),
    })));
    if (output.value !== previousPrompt) {
      showToast("Prompt kept", "The rewrite was not applied because you edited the prompt.");
      return;
    }
    studio.refineRestore = {
      prompt: previousPrompt,
      meta: previousMeta,
      lastModelPrompt: studio.lastModelPrompt,
      lastModelMeta: studio.lastModelMeta,
    };
    output.value = result.prompt;
    studio.lastModelPrompt = result.prompt;
    renderPromptHighlights();
    if (panel.querySelector("textarea").value.trim() === instruction) {
      panel.querySelector("textarea").value = "";
    }
    panel.querySelector("[data-refine-restore]").hidden = false;
    studio.lastModelMeta = formatGenerationMeta(result);
    syncRuntimeSummary(result);
    studio.root.querySelector(".ps-editor-meta span:last-child").textContent = studio.lastModelMeta;
    syncModifiedState();
    saveCurrentModeDraft();
    studio.desktopNotifications.notify("Refinement finished. Your prompt is ready.");
    showToast(
      result.thinking_fallback ? "Rewrite completed" : "Prompt rewritten",
      result.thinking_fallback
        ? thinkingFallbackMessage(result, "rewrite")
        : result.format_repair_applied
          ? result.format_repair_multimodal
            ? `The first draft failed ${result.format_repair_reason}; the existing references were checked again and repaired once.`
            : `The first draft failed ${result.format_repair_reason}; its format was repaired once without media.`
        : result.format_repair_failure
          ? `Format warning: ${result.format_repair_reason}; safe repair rejected because ${result.format_repair_failure}.`
        : `${result.total_seconds.toFixed(1)}s · ${result.tokens_per_second.toFixed(1)} tok/s · no media re-upload`,
    );
  } catch (error) {
    if (error.code !== "GENERATION_CANCELLED") studio.desktopNotifications.notify("Refinement failed. Open Prompt Studio for details.");
    if (error.code === "INSUFFICIENT_FREE_VRAM") showVramRetry(error, submitRefinement);
    else showToast(error.code || "Refinement failed", error.message, error.details);
  } finally {
    submit.disabled = false;
    submit.innerHTML = `${icon("spark", 13)} Refine`;
    try {
      const status = await getStatus(studio.ollamaHost);
      updatePromptResidency(status);
    } catch {}
    clearActiveWriterRequest();
    setGenerationState("idle", "", "");
  }
}

function syncFullscreenState() {
  if (!studio) return;
  studio.root.classList.toggle("is-fullscreen", studio.fullscreen);
  const button = studio.root.querySelector("[data-fullscreen-toggle]");
  button.setAttribute("aria-pressed", String(studio.fullscreen));
  button.setAttribute("aria-label", studio.fullscreen ? "Exit fullscreen" : "Enter fullscreen");
  button.title = studio.fullscreen ? "Exit fullscreen" : "Enter fullscreen";
  button.innerHTML = icon(studio.fullscreen ? "collapse" : "expand", 17);
}

function syncTheme() {
  if (!studio) return;
  studio.root.dataset.theme = studio.theme;
  studio.floatingMedia?.refresh();
  const button = studio.root.querySelector("[data-theme-toggle]");
  if (!button) return;
  const light = studio.theme === "light";
  button.innerHTML = icon(light ? "moon" : "sun", 17);
  button.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
  button.title = light ? "Switch to dark theme" : "Switch to light theme";
  button.setAttribute("aria-pressed", String(light));
}

function setTheme(theme) {
  if (!studio) return;
  studio.theme = theme === "light" ? "light" : "dark";
  syncTheme();
  saveUserPreferences(localStorage, studio);
}

function syncInterfaceSize() {
  if (!studio) return;
  const size = INTERFACE_SIZES.includes(studio.interfaceSize) ? studio.interfaceSize : "100";
  const index = INTERFACE_SIZES.indexOf(size);
  studio.interfaceSize = size;
  studio.root.dataset.interfaceSize = size;
  studio.floatingMedia?.refresh();
  const slider = studio.root.querySelector("[data-interface-size-range]");
  const output = studio.root.querySelector("[data-interface-size-value]");
  const button = studio.root.querySelector("[data-interface-size-toggle]");
  if (slider) {
    slider.value = String(index);
    slider.setAttribute("aria-valuetext", `${size}%`);
    slider.style.setProperty("--ps-range", `${index / (INTERFACE_SIZES.length - 1) * 100}%`);
  }
  if (output) output.textContent = `${size}%`;
  if (button) {
    button.setAttribute("aria-label", `Interface size ${size}%`);
    button.title = `Interface size ${size}%`;
  }
}

function setInterfaceSize(size) {
  if (!studio) return;
  studio.interfaceSize = INTERFACE_SIZES.includes(String(size)) ? String(size) : "100";
  syncInterfaceSize();
  saveUserPreferences(localStorage, studio);
}

function setInterfaceSizeMenuOpen(open, restoreFocus = false) {
  if (!studio) return;
  const menu = studio.root.querySelector("[data-interface-size-menu]");
  const button = studio.root.querySelector("[data-interface-size-toggle]");
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  if (restoreFocus) button.focus();
}

function setFullscreen(fullscreen) {
  if (!HOST_CAPABILITIES.windowed) fullscreen = true;
  if (!studio || studio.fullscreen === fullscreen) return;
  studio.fullscreen = fullscreen;
  syncFullscreenState();
  requestAnimationFrame(updateBriefLayout);
  saveUserPreferences(localStorage, studio);
}

function createStudio() {
  if (studio) return studio;
  injectStyles();
  const studioBrandIcon = brandedAssetUrl("./assets/prompt-studio-launcher.svg");
  const root = document.createElement("div");
  root.className = "ps-root";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <div class="ps-backdrop" data-close-studio></div>
    <section class="ps-modal" role="dialog" aria-label="Prompt Studio" hidden>
      <header class="ps-header">
        <div class="ps-brand">
          <img class="ps-brandmark" src="${studioBrandIcon}" alt="Prompt Studio">
          <span><strong>Prompt Studio</strong></span>
        </div>
        <div class="ps-target-indicator" data-target-indicator>
          ${targetIndicatorMarkup()}
        </div>
        <div class="ps-header-meta">
          <button class="ps-guide-button" type="button" data-open-settings-header>Settings</button>
          ${supportsWorkflowMedia() ? `<button class="ps-icon-button" type="button" data-open-floating-media title="Media panel" aria-label="Media panel">${icon("grid", 17)}</button>` : ""}
          <button class="ps-icon-button" type="button" title="Switch to light theme" aria-label="Switch to light theme" aria-pressed="false" data-theme-toggle>${icon("sun", 17)}</button>
          <div class="ps-interface-size-picker" data-interface-size-picker>
            <button class="ps-icon-button ps-interface-size-button" type="button" title="Interface size 100%" aria-label="Interface size 100%" aria-haspopup="true" aria-expanded="false" data-interface-size-toggle>Aa</button>
            <div class="ps-interface-size-menu" data-interface-size-menu hidden>
              <header><strong>Interface Size</strong><output data-interface-size-value>100%</output></header>
              <input type="range" min="0" max="3" step="1" value="0" aria-label="Interface size" data-interface-size-range>
              <div class="ps-interface-size-marks" aria-hidden="true"><span>100%</span><span>110%</span><span>120%</span><span>125%</span></div>
            </div>
          </div>
          <button class="ps-icon-button" type="button" title="Enter fullscreen" aria-label="Enter fullscreen" aria-pressed="false" data-fullscreen-toggle>${icon("expand", 17)}</button>
          <button class="ps-icon-button" type="button" title="Close" data-close-studio>${icon("close", 18)}</button>
        </div>
      </header>

      ${targetSelectionMarkup()}

      ${settingsMarkup(icon)}

      <div class="ps-workspace-toolbar" data-generate-view>
        <nav class="ps-modes" role="tablist" aria-label="Generation mode" data-workspace-modes>
          ${modeButtonsMarkup(defaultTarget())}
        </nav>        <div class="ps-output-toolbar">
          <span data-output-label>Generated prompt</span>
          <div class="ps-output-badges"><button type="button" data-undo-edits hidden>Undo</button></div>
        </div>
      </div>

      <div class="ps-workspace" data-generate-view>
        <section class="ps-input-panel">
          <div class="ps-input-scroll" data-input-scroll>
          <div data-video-inputs data-workspace-panel="video">
          <div class="ps-section-heading">
            <span><strong data-ps-mode-title></strong><small data-media-label>Media</small></span>
            <div class="ps-section-actions">

              <div class="ps-clear-control" data-clear-control>
                ${splitMenuMarkup(icon, {label: "Actions", primary: "data-actions-menu-toggle", toggle: "data-clear-menu-toggle", menu: "data-clear-menu", ariaLabel: "Media actions", contents: `
                  ${supportsWorkflowMedia() ? `<button type="button" data-open-floating-media data-media-panel-action disabled title="Add media first"><strong>Media panel</strong><small>ADD TO WORKFLOW</small></button>` : ""}
                  <button type="button" data-open-composer disabled><strong>Compose</strong><small>Create collage</small></button>
                  <hr data-compose-separator>
                  <button type="button" data-clear-action data-save-draft><strong>Save text draft</strong><small>JSON backup</small></button>
                  <button type="button" data-clear-action data-load-draft><strong>Load text draft</strong><small>Replaces this draft</small></button>
                  <hr data-draft-separator>
                  <button type="button" data-clear-action data-clear-media><strong>Clear media</strong><small>Keep prompts</small></button>
                  <button type="button" data-clear-action data-clear-prompts><strong>Clear prompts</strong><small>Keep media</small></button>
                  <button class="is-destructive" type="button" data-clear-action data-clear-all><strong>Clear all</strong><small>Media and prompts</small></button>
                `})}
              </div>
            </div>
          </div>
          <div class="ps-media" data-ps-media></div>

          <label class="ps-brief">
            <span><strong>Creative brief</strong><small>Describe what should happen in the video</small></span>
            <textarea spellcheck="true" maxlength="8000" data-video-brief>Use identity and wardrobe from Picture 1 and the slow lateral camera movement from Video 1. A solitary character waits at a rain-soaked tram stop at blue hour, notices an approaching light and turns into the wind. End on a quiet, unresolved look; keep the shot cinematic, realistic and restrained.</textarea>
            <small class="ps-char-count">0 / 8,000</small>
          </label>

          <div class="ps-control-grid">
            <label class="ps-field ps-duration-field"><span>Duration <b data-duration-label>10 seconds</b></span><div><input type="range" min="1" max="20" step="1" value="10" style="--ps-range:47.37%" data-duration-slider><i></i></div></label>
            ${aspectRatioMarkup(icon)}
          </div>
          </div>

          <div class="ps-music-inputs" data-music-inputs hidden>
            <label class="ps-brief">
              <span><strong>Music brief</strong><small>Describe the sound, vocals, mood, arrangement or production</small></span>
              <textarea spellcheck="true" maxlength="2000" data-music-brief>${MODE_DEFAULT_DRAFTS.Music3.brief}</textarea>
              <small class="ps-char-count">0 / 2,000</small>
            </label>
            <label class="ps-brief ps-lyrics">
              <span><strong>Lyrics</strong><small>Optional</small></span>
              <textarea spellcheck="true" maxlength="4000" data-music-lyrics placeholder="[Verse 1]&#10;...&#10;&#10;[Chorus]&#10;..."></textarea>
              <small class="ps-char-count">0 / 4,000</small>
            </label>
            <div class="ps-lyrics-refine-tools">
              <button class="ps-secondary-button" type="button" title="Refine Lyrics with the selected prompt model" data-lyrics-refine-toggle>${icon("spark", 15)} Refine</button>
            </div>
            <section class="ps-refine ps-lyrics-refine" data-lyrics-refine-panel hidden>
              <div class="ps-refine-heading">
                <span><strong>Refine lyrics</strong><small>Create new Lyrics or rewrite the current text</small></span>
                <label class="ps-lyrics-brief-option"><input type="checkbox" data-lyrics-use-brief checked>Use Music Brief</label>
              </div>
              <textarea rows="2" data-lyrics-refine-instruction placeholder="Leave Lyrics empty to create new lyrics, or describe how to rewrite the existing lyrics."></textarea>
              <div class="ps-refine-actions">
                <button type="button" class="ps-text-button" data-lyrics-refine-restore hidden>Restore previous</button>
                <span></span>
                <button type="button" class="ps-text-button" data-lyrics-refine-cancel>Cancel</button>
                <button type="button" class="ps-refine-submit" data-lyrics-refine-submit>${icon("spark", 13)} Refine</button>
              </div>
            </section>
          </div>

          <div class="ps-image-inputs" data-image-inputs data-workspace-panel="image" hidden>
            <div class="ps-section-heading">
              <span><strong data-ps-image-mode-title></strong><small data-media-label>Media</small></span>
            </div>
            <div class="ps-media" data-ps-image-media></div>

            <label class="ps-brief ps-image-brief">
              <span><strong>Image brief</strong><small data-image-brief-label>Describe the image to generate</small></span>
              <textarea spellcheck="true" maxlength="8000" data-image-brief></textarea>
              <small class="ps-char-count">0 / 8,000</small>
            </label>

            <label class="ps-brief ps-edit-instruction" hidden>
              <span><strong>Edit instruction</strong><small>What should change, and what must stay</small></span>
              <textarea spellcheck="true" maxlength="4000" data-edit-instruction></textarea>
              <small class="ps-char-count">0 / 4,000</small>
            </label>

            <div class="ps-control-grid ps-image-controls">
              ${aspectRatioMarkup(icon, "image-aspect")}
            </div>

            <div class="ps-control-grid ps-mode-options" data-mode-options></div>

            ${characterPickerMarkup()}
          </div>
          </div>

          ${generateModelSummaryMarkup(icon)}
        </section>

        <section class="ps-output-panel" aria-label="Generated result">
          <div class="ps-output-mobile-toolbar" aria-hidden="true"><span data-output-mobile-label>Generated prompt</span></div>
          <div class="ps-editor-wrap">
            <div class="ps-editor-highlight" data-prompt-highlights aria-hidden="true"></div>
            <textarea class="ps-editor" aria-label="Generated prompt" spellcheck="false" data-output>${SAMPLE_PROMPT}</textarea>
            <div class="ps-reference-peek" data-reference-peek hidden></div>
            <div class="ps-editor-meta"><span>${promptLengthMeta(SAMPLE_PROMPT)}</span></div>
          </div>
          <div class="ps-refine" data-refine-panel hidden>
            <div class="ps-refine-heading">
              <span><strong data-refine-title>Refine prompt</strong><small><span data-refine-helper>Describe only what should change</span><em data-refine-media-note>No media re-upload</em></small></span>
              <div class="ps-refine-heading-actions">
                <button type="button" class="ps-text-button" data-refine-restore hidden>Restore original</button>
                <button type="button" class="ps-text-button" data-refine-cancel>Cancel</button>
                <button type="button" class="ps-refine-submit" data-refine-submit>${icon("spark", 13)} Refine</button>
              </div>
            </div>
            <textarea rows="2" data-refine-instruction placeholder="For example: make the camera movement slower and keep the ending more ambiguous."></textarea>
          </div>
          <div class="ps-output-actions">
            <span class="ps-output-primary-actions">
              <button class="ps-secondary-button" type="button" title="Refine with local LLM" data-refine-toggle>${icon("spark", 15)} Refine</button>
            </span>
            ${copyButtonMarkup(icon, "data-copy", '<span data-copy-label>Copy prompt</span>')}
          </div>
        </section>
      </div>

      <footer class="ps-footer" data-generate-view>
        <div class="ps-footer-memory-actions">
          <button class="ps-memory-action" type="button" data-comfy-memory-action title="Unload models held by ComfyUI without clearing cached workflow results">${icon("memory", 15)}Free ComfyUI VRAM</button>
          <span class="ps-prompt-lifecycle-actions" data-prompt-lifecycle-actions></span>
        </div>
        <div class="ps-status is-busy" role="status" aria-live="polite" aria-atomic="true" data-status hidden><span><strong></strong><small data-status-detail></small></span></div>
        <div class="ps-footer-actions">
          <span class="ps-generation-options">
            <label class="ps-toggle-control"><input type="checkbox" data-thinking><span></span>Thinking</label>
            <label class="ps-toggle-control" data-keep-loaded-control title="Keep the prompt model in VRAM for the next prompt"><input type="checkbox" data-keep-loaded><span></span>Keep model loaded</label>
            ${autoVramControlMarkup(VRAM_HANDOFF_SUPPORTED)}
          </span>
          <button class="ps-primary-button" type="button" data-generate>${icon("spark", 16)}<span data-generate-label>Generate prompt</span></button>
        </div>
      </footer>
    </section>

    <div class="ps-other-models-backdrop" aria-hidden="true" data-other-models-backdrop hidden></div>
    <section class="ps-other-models-popover" role="dialog" aria-modal="true" aria-label="Other verified models" data-other-models-popover hidden>
      <header><span><strong>Other verified models</strong><small>Recommended GGUF and projector pairs</small></span><button class="ps-icon-button" type="button" aria-label="Close verified models" data-other-models-close>${icon("close", 16)}</button></header>
      <div class="ps-other-models-catalog" data-other-models-catalog></div>
    </section>

    <div class="ps-toast" role="status" aria-live="polite" aria-atomic="true" data-ps-toast><span class="ps-toast-icon">${icon("info", 17)}</span><span><strong data-toast-title>Notice</strong><span data-toast-message></span><button type="button" class="ps-toast-action" data-toast-action hidden></button><details data-toast-details hidden><summary>Technical details</summary><pre></pre></details></span></div>`;
  document.body.appendChild(root);

  studio = { root, ...createStudioState({ sessionId: createSessionId(), storage: localStorage }) };
  // Per-mode media limits, resolved once from the registry for the media panel.
  studio.modeLimits = Object.fromEntries(
    selectableModes().map((mode) => [mode.id, { ...(mode.limits || {}) }]),
  );
  // Anima character selection. `studio.characters` holds the resolved entries (slug,
  // trigger, display name) so both the payload and the highlighter read one list.
  studio.characters = [];
  studio.characterPicker = createCharacterPicker({
    root,
    search: (query) => searchCharacters(query),
    resolve: (names) => resolveCharacters(names),
    onChange: ({ characters, triggers }) => {
      studio.characters = triggers.map((trigger, index) => ({
        character: characters[index],
        trigger,
        display_name: trigger.split(",")[0].trim() || characters[index],
      }));
      // The trigger list changed, so the character regions in an existing prompt may
      // no longer match. Repaint rather than leaving stale colours behind.
      renderPromptHighlights();
      saveCurrentModeDraft();
    },
  });
  studio.characterPicker.attach();
  // Read the catalogue size once so the picker can show how many characters are
  // searchable. Deliberately not awaited: the count is a hint, and the studio must
  // not wait on a request to render.
  void studio.characterPicker.loadCount();
  root.querySelector("[data-comfy-memory-action]").hidden = !HOST_CAPABILITIES.comfyMemory;
  if (!HOST_CAPABILITIES.windowed) {
    studio.fullscreen = true;
    root.querySelectorAll("[data-close-studio], [data-fullscreen-toggle]").forEach(control => { control.hidden = true; });
  }
  const onMediaToolOpenChange = (open) => {
    const modal = root.querySelector(".ps-modal");
    modal.inert = open;
    if (open) modal.removeAttribute("aria-modal");
    else if (root.classList.contains("is-open")) modal.setAttribute("aria-modal", "true");
  };
  const mediaToolUnavailable = (message) => showToast("Media tool unavailable", message);
  studio.mediaComposer = createLazyMediaTool(root, async () => {
    const { createMediaComposer } = await import("./media_composer.js");
    return createMediaComposer({
      root,
      icon,
      onAddPicture: addComposedPicture,
      getAddState: composerAddState,
      notify: (kind, message) => showToast(kind === "error" ? "Composer failed" : "Media Composer", message),
      onOpenChange: onMediaToolOpenChange,
    });
  }, mediaToolUnavailable);
  studio.mediaEditor = createLazyMediaTool(root, async () => {
    const { createMediaEditor } = await import("./media_editor.js");
    return createMediaEditor({
      root,
      icon,
      onAddFrame: async (blob, filename) => {
        const file = new File([blob], filename, { type: "image/png" });
        const result = await uploadMedia(studio.sessionId, "Reference", [file]);
        studio.assets.push(...result.assets);
        showToast("Picture added", result.assets[0].reference);
        renderMedia(studio.mode);
      },
      onAddAudio: async (blob, filename) => {
        const file = new File([blob], filename, { type: "audio/wav" });
        const result = await uploadMedia(studio.sessionId, "Reference", [file]);
        studio.assets.push(...result.assets);
        showToast("Audio added", result.assets[0].reference);
        renderMedia(studio.mode);
      },
      request: (assetId, options) => editMedia(studio.sessionId, assetId, options),
      onSaved: (result) => {
        acceptMediaAssets(result.assets);
        showToast("Media applied", "Crop and trim applied. The original source is preserved.");
        renderMedia(studio.mode);
      },
      notify: (message) => showToast("Media Editor", message),
      onOpenChange: onMediaToolOpenChange,
    });
  }, mediaToolUnavailable);
  root.querySelector("[data-lyrics-use-brief]").checked = studio.musicLyricsUseBrief;
  const durationSlider = root.querySelector("[data-duration-slider]");
  durationSlider.value = String(studio.durationSeconds);
  durationSlider.style.setProperty("--ps-range", `${(studio.durationSeconds - 1) / 19 * 100}%`);
  root.querySelector("[data-duration-label]").textContent = `${studio.durationSeconds} seconds`;
  // Both the video and image panels render an aspect-ratio control. Binding only
  // the first match (the video one) left the image copy inert, so every control
  // on the page is bound and they all drive the same shared state.
  aspectRatioControls = [];
  root.querySelectorAll('[data-choice-toggle$="-aspect"], [data-choice-toggle="aspect"]').forEach((toggle) => {
    const field = toggle.closest(".ps-choice");
    if (!field) return;
    aspectRatioControls.push(bindAspectRatio(field, studio.aspectRatio, value => {
      studio.aspectRatio = value;
      saveUserPreferences(localStorage, studio);
      // Keep the other copies showing the same value.
      syncAspectRatioControls(value);
    }));
  });
  syncTheme();
  syncInterfaceSize();
  syncFullscreenState();
  root.querySelectorAll("[data-close-studio]").forEach((el) => el.addEventListener("click", closeStudio));
  root.querySelector("[data-fullscreen-toggle]").addEventListener("click", () => setFullscreen(!studio.fullscreen));
  root.querySelector("[data-theme-toggle]").addEventListener("click", () => setTheme(studio.theme === "light" ? "dark" : "light"));
  root.querySelectorAll("[data-open-floating-media]").forEach(button => button.addEventListener("click", openFloatingMedia));
  root.querySelector("[data-open-composer]").addEventListener("click", (event) => openMediaComposer(event.currentTarget));
  root.querySelector("[data-interface-size-toggle]").addEventListener("click", () => {
    const menu = root.querySelector("[data-interface-size-menu]");
    setInterfaceSizeMenuOpen(menu.hidden);
  });
  root.querySelector("[data-interface-size-range]").addEventListener("input", (event) => {
    setInterfaceSize(INTERFACE_SIZES[Number(event.target.value)] || "100");
  });
  root.addEventListener("click", (event) => {
    if (studio.toastDismissOnWorkspaceClick && !event.target.closest("[data-ps-toast]")) hideToast();
    if (!event.target.closest("[data-other-models-toggle], [data-other-models-popover]")) setOtherModelsPopover(false);
    if (!isRuntimeMenuInteraction(event.target)) closeRuntimeMenus();
    if (!isChoiceMenuInteraction(event.target)) {
      root.querySelectorAll("[data-choice-menu]").forEach((menu) => { menu.hidden = true; });
      root.querySelectorAll("[data-choice-toggle]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    }
    if (!event.target.closest("[data-interface-size-picker]")) setInterfaceSizeMenuOpen(false);
    if (!event.target.closest("[data-model-files-toggle], [data-model-files-menu]")) {
      root.querySelectorAll("[data-model-files-menu]").forEach((menu) => { menu.hidden = true; });
    }
    if (!event.target.closest("[data-clear-control]")) setClearMenuOpen(false);
  });
  bindModeButtons();
  root.querySelector("[data-open-target-select]").addEventListener("click", () => setTargetSelectionOpen(true));
  root.querySelector("[data-target-select-confirm]").addEventListener("click", confirmTargetSelection);
  root.querySelector("[data-target-select-view]").addEventListener("click", (event) => {
    const item = event.target.closest("[data-target-select-id]");
    if (!item || item.disabled) return;
    studio.targetSelectChoice = item.dataset.targetSelectId;
    syncTargetSelection();
  });
  root.querySelector("[data-open-settings-header]").addEventListener("click", () => setSettingsOpen(true));
  root.querySelector("[data-open-settings]").addEventListener("click", () => setSettingsOpen(true));
  root.querySelector("[data-close-settings]").addEventListener("click", () => setSettingsOpen(false));
  root.querySelectorAll("[data-settings-tab]").forEach((tab) => tab.addEventListener("click", () => setSettingsTab(tab.dataset.settingsTab)));
  const blindMediaToggle = root.querySelector("[data-blind-media]");
  if (blindMediaToggle) {
    blindMediaToggle.addEventListener("change", () => {
      studio.blindMedia = blindMediaToggle.checked;
      saveUserPreferences(localStorage, studio);
      // The workspace hint is derived from this setting, so refresh it now rather
      // than waiting for the next media change.
      renderMedia(studio.mode);
      showToast(
        blindMediaToggle.checked ? "Media-blind mode on" : "Media-blind mode off",
        blindMediaToggle.checked
          ? "Attached media stays in the workspace but is not sent to the prompt model."
          : "Attached media is sent to the prompt model again; a vision model is required.",
        null, null, { dismissOnWorkspaceClick: true },
      );
    });
  }
  root.querySelector("[data-save-draft]").addEventListener("click", () => {
    setClearMenuOpen(false);
    saveTextDraft();
  });
  root.querySelector("[data-load-draft]").addEventListener("click", () => {
    setClearMenuOpen(false);
    loadTextDraft();
  });
  root.querySelector("[data-clear-media]").addEventListener("click", () => {
    setClearMenuOpen(false);
    clearCurrentMedia();
  });
  root.querySelectorAll("[data-clear-menu-toggle], [data-actions-menu-toggle]").forEach(toggle => toggle.addEventListener("click", () => {
    const menu = root.querySelector("[data-clear-menu]");
    setClearMenuOpen(menu.hidden);
  }));
  root.querySelector("[data-clear-prompts]").addEventListener("click", () => {
    setClearMenuOpen(false);
    clearCurrentPrompts();
  });
  root.querySelector("[data-clear-all]").addEventListener("click", () => {
    setClearMenuOpen(false);
    clearEverything();
  });
  root.querySelector("[data-generate]").addEventListener("click", startGenerationPreview);
  studio.desktopNotifications = createDesktopNotifications({ storage: localStorage, document, window });
  const notificationsToggle = root.querySelector("[data-desktop-notifications]");
  const syncNotifications = () => {
    notificationsToggle.checked = studio.desktopNotifications.enabled;
    root.querySelector("[data-desktop-notifications-hint]").textContent = studio.desktopNotifications.hint;
  };
  notificationsToggle.addEventListener("change", async () => {
    notificationsToggle.disabled = true;
    try { await studio.desktopNotifications.setEnabled(notificationsToggle.checked); }
    finally { notificationsToggle.disabled = false; syncNotifications(); }
  });
  syncNotifications();
  root.querySelector("[data-comfy-memory-action]").addEventListener("click", () => releaseComfyVram());

  root.querySelector("[data-duration-slider]").addEventListener("input", (event) => {
    studio.durationSeconds = Number(event.target.value);
    root.querySelector("[data-duration-label]").textContent = `${studio.durationSeconds} seconds`;
    event.target.style.setProperty("--ps-range", `${(studio.durationSeconds - 1) / 19 * 100}%`);
    saveUserPreferences(localStorage, studio);
  });
  root.querySelectorAll("[data-runtime-toggle]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    const name = button.dataset.runtimeToggle;
    const menu = root.querySelector(`[data-runtime-menu="${name}"]`);
    const open = menu.hidden;
    closeRuntimeMenus();
    setRuntimeMenuOpen(name, open);
  }));
  root.querySelectorAll("[data-runtime-option]").forEach((button) => button.addEventListener("click", (event) => applyRuntimeOption(button, event)));
  root.querySelector("[data-custom-context-input]").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    studio.contextTokens = Number.isInteger(value) && value > 0 ? value : null;
    syncRuntimeSummary();
    syncThinkingAvailability();
    rememberRuntimePreferences();
    saveUserPreferences(localStorage, studio);
  });
  root.querySelector("[data-custom-generation-budget-input]").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    studio.generationBudgetTokens = Number.isInteger(value) && value > 0 ? value : null;
    syncRuntimeSummary();
    rememberRuntimePreferences();
    saveUserPreferences(localStorage, studio);
  });
  syncRuntimeSummary();
  root.querySelector("[data-thinking]").addEventListener("change", (event) => {
    studio.thinking = event.target.checked;
    syncRuntimeSummary();
  });
  root.querySelector("[data-keep-loaded]").addEventListener("change", (event) => {
    studio.keepModelLoaded = event.target.checked;
  });
  root.querySelector("[data-vram-handoff]")?.addEventListener("change", (event) => {
    studio.vramHandoff = event.target.checked;
    saveUserPreferences(localStorage, studio);
  });
  const updateBriefCount = () => {
    updateBriefLayout();
    saveCurrentModeDraft();
  };
  root.querySelectorAll("[data-video-brief], [data-music-brief], [data-image-brief], [data-edit-instruction]").forEach((brief) => brief.addEventListener("input", updateBriefCount));
  root.querySelector("[data-music-lyrics]").addEventListener("input", () => {
    updateMusicLyricsCount();
    saveCurrentModeDraft();
  });
  root.querySelector("[data-lyrics-use-brief]").addEventListener("change", (event) => {
    studio.musicLyricsUseBrief = event.target.checked;
    saveUserPreferences(localStorage, studio);
  });

  root.querySelectorAll("[data-provider-option]").forEach((button) => button.addEventListener("click", () => {
    selectSettingsProvider(button.dataset.providerOption);
  }));
  root.querySelector("[data-model-refresh]").addEventListener("click", async () => {
    await refreshModels();
    const count = localModels().length;
    showToast("Models refreshed", `${count} supported local model${count === 1 ? "" : "s"} found.`);
  });
  root.querySelector("[data-installed-model]").addEventListener("change", (event) => {
    selectModel(localModels().find((model) => model.id === event.target.value));
  });
  root.querySelector("[data-direct-projector]").addEventListener("change", async (event) => {
    const select = event.target.closest("[data-direct-projector-select]");
    if (!select) return;
    try {
      await selectDirectProjector(studio.selectedModel?.id || directModelForSettings()?.id, select.value);
    } catch (error) {
      showToast("Vision projector", error.message);
      renderInferenceSettings();
    }
  });
  root.querySelector("[data-provider-detail]").addEventListener("click", (event) => {
    const ollamaHostSummary = event.target.closest("[data-ollama-host-settings] summary");
    if (ollamaHostSummary) {
      studio.ollamaHostSettingsOpen = !ollamaHostSummary.closest("details").open;
      return;
    }
    const ollamaStorageSummary = event.target.closest("[data-ollama-storage-help] summary");
    if (ollamaStorageSummary) {
      studio.ollamaStorageHelpOpen = !ollamaStorageSummary.closest("details").open;
      return;
    }
    const apiPreset = event.target.closest("[data-api-preset]");
    if (apiPreset) {
      chooseApiProviderPreset(apiPreset.dataset.apiPreset);
      return;
    }
    const apiDisconnect = event.target.closest("[data-api-disconnect]");
    if (apiDisconnect) {
      disconnectConfiguredApiProvider();
      return;
    }
    const apiModelRefresh = event.target.closest("[data-api-model-refresh]");
    if (apiModelRefresh) {
      refreshApiProviderModels();
      return;
    }
    const ollamaRefresh = event.target.closest("[data-ollama-refresh]");
    if (ollamaRefresh) {
      refreshOllama();
      return;
    }
    const copyOllamaCommand = event.target.closest("[data-copy-ollama-command]");
    if (copyOllamaCommand) {
      const command = copyOllamaCommand.dataset.copyOllamaCommand;
      navigator.clipboard.writeText(command);
      showToast("Command copied", `${command} · paste it into Terminal or PowerShell.`);
      return;
    }
    const ollamaAddModel = event.target.closest("[data-ollama-add-model]");
    if (ollamaAddModel) {
      studio.ollamaAddModelOpen = !studio.ollamaAddModelOpen;
      renderInferenceSettings();
      return;
    }
    const copyDirectRuntimeCommand = event.target.closest("[data-copy-direct-runtime-command]");
    if (copyDirectRuntimeCommand) {
      const command = copyDirectRuntimeCommand.dataset.copyDirectRuntimeCommand;
      navigator.clipboard.writeText(command);
      showToast("Command copied", "Paste it into PowerShell or CMD from the ComfyUI portable folder.");
      return;
    }
    const externalDisconnect = event.target.closest("[data-external-server-disconnect]");
    if (externalDisconnect) {
      disconnectExternalServer();
      return;
    }
    const otherModelsToggle = event.target.closest("[data-other-models-toggle]");
    if (otherModelsToggle) {
      const popover = root.querySelector("[data-other-models-popover]");
      setOtherModelsPopover(popover.hidden);
      return;
    }
    const filesToggle = event.target.closest("[data-model-files-toggle]");
    if (filesToggle) {
      const menu = filesToggle.closest(".ps-model-files").querySelector("[data-model-files-menu]");
      root.querySelectorAll("[data-model-files-menu]").forEach((item) => { if (item !== menu) item.hidden = true; });
      menu.hidden = !menu.hidden;
      return;
    }
    const copyPath = event.target.closest("[data-copy-model-path]");
    if (copyPath) {
      navigator.clipboard.writeText(studio.modelDirectory || "ComfyUI/models/LLM/");
      showToast("Model path copied", studio.modelDirectory || "ComfyUI/models/LLM/");
      return;
    }
  });
  root.querySelector("[data-provider-detail]").addEventListener("change", (event) => {
    const apiModel = event.target.closest("[data-api-model]");
    if (apiModel) {
      const model = studio.apiProviderModels.find((item) => item.remote_model === apiModel.value);
      if (model) selectModel(model);
      return;
    }
    const select = event.target.closest("[data-ollama-model]");
    if (select) {
      const model = ollamaModels().find((item) => item.remote_model === select.value);
      if (model) selectModel(model);
    }
  });
  root.querySelector("[data-provider-detail]").addEventListener("submit", (event) => {
    const ollamaHostForm = event.target.closest("[data-ollama-host-form]");
    if (ollamaHostForm) {
      event.preventDefault();
      configureOllamaHost(ollamaHostForm);
      return;
    }
    const apiForm = event.target.closest("[data-api-provider-form]");
    if (apiForm) {
      event.preventDefault();
      connectConfiguredApiProvider(apiForm);
      return;
    }
    const form = event.target.closest("[data-external-server-form]");
    if (!form) return;
    event.preventDefault();
    connectExternalServer(form);
  });
  root.querySelector("[data-other-models-close]").addEventListener("click", () => setOtherModelsPopover(false));
  root.querySelector("[data-other-models-popover]").addEventListener("click", (event) => {
    const filesToggle = event.target.closest("[data-model-files-toggle]");
    if (!filesToggle) return;
    const menu = filesToggle.closest(".ps-model-files").querySelector("[data-model-files-menu]");
    root.querySelectorAll("[data-model-files-menu]").forEach((item) => { if (item !== menu) item.hidden = true; });
    menu.hidden = !menu.hidden;
  });
  root.querySelector(".ps-input-panel").addEventListener("scroll", () => setOtherModelsPopover(false));
  root.querySelector("[data-settings-view]").addEventListener("scroll", () => setOtherModelsPopover(false));
  window.addEventListener("resize", () => {
    updateBriefCount();
  });
  root.querySelector("[data-refine-toggle]").addEventListener("click", () => toggleRefine(root.querySelector("[data-refine-panel]").hidden));
  root.querySelector("[data-refine-cancel]").addEventListener("click", () => toggleRefine(false));
  root.querySelector("[data-refine-submit]").addEventListener("click", submitRefinement);
  root.querySelector("[data-lyrics-refine-toggle]").addEventListener("click", () => {
    toggleLyricsRefine(root.querySelector("[data-lyrics-refine-panel]").hidden);
  });
  root.querySelector("[data-lyrics-refine-cancel]").addEventListener("click", cancelLyricsRefinement);
  root.querySelector("[data-lyrics-refine-submit]").addEventListener("click", submitLyricsRefinement);
  root.querySelector("[data-lyrics-refine-restore]").addEventListener("click", () => {
    if (studio.lyricsRestore == null) return;
    const lyrics = root.querySelector("[data-music-lyrics]");
    const previousLyrics = studio.lyricsRestore.lyrics;
    lyrics.value = previousLyrics;
    studio.lyricsRestore = null;
    root.querySelector("[data-lyrics-refine-restore]").hidden = true;
    updateMusicLyricsCount();
    saveCurrentModeDraft();
    showToast(
      previousLyrics.trim() ? "Previous Lyrics restored" : "Generated Lyrics removed",
      "The AI Lyrics change was discarded.",
    );
  });
  root.querySelector("[data-refine-restore]").addEventListener("click", () => {
    if (studio.refineRestore == null) return;
    const output = root.querySelector("[data-output]");
    output.value = studio.refineRestore.prompt;
    studio.lastModelPrompt = studio.refineRestore.lastModelPrompt;
    studio.lastModelMeta = studio.refineRestore.lastModelMeta;
    renderPromptHighlights();
    root.querySelector(".ps-editor-meta span:last-child").textContent = studio.refineRestore.meta;
    studio.refineRestore = null;
    root.querySelector("[data-refine-restore]").hidden = true;
    syncModifiedState();
    saveCurrentModeDraft();
    showToast("Previous prompt restored", "The AI rewrite was discarded.");
  });
  root.querySelector("[data-undo-edits]").addEventListener("click", () => {
    if (typeof studio.lastModelPrompt !== "string") return;
    const output = root.querySelector("[data-output]");
    output.value = studio.lastModelPrompt;
    root.querySelector(".ps-editor-meta span:last-child").textContent = studio.lastModelMeta;
    renderPromptHighlights();
    syncModifiedState();
    saveCurrentModeDraft();
    showToast("Edits undone", "Restored the latest AI-generated prompt.");
  });
  root.querySelector("[data-copy]").addEventListener("click", () => copyPromptText(root.querySelector("[data-output]").value, isAudioMode(studio.mode)));
  root.querySelector("[data-output]").addEventListener("input", () => {
    syncModifiedState();
    renderPromptHighlights();
    syncOutputLengthMeta();
    saveCurrentModeDraft();

  });
  root.querySelector("[data-output]").addEventListener("scroll", renderPromptHighlights);
  const editor = root.querySelector("[data-output]");
  const supportedReferenceEditors = root.querySelectorAll("[data-video-brief], [data-image-brief], [data-edit-instruction], [data-output], [data-refine-instruction]");
  supportedReferenceEditors.forEach((field) => {
    ["focus", "click", "keyup", "select", "input"].forEach((type) => field.addEventListener(type, () => rememberReferenceInsertTarget(field)));
  });
  const editorWrap = root.querySelector(".ps-editor-wrap");
  const peek = root.querySelector("[data-reference-peek]");
  editor.addEventListener("focus", () => {
    editorWrap.classList.add("is-editing");
    peek.hidden = true;
  });
  editor.addEventListener("blur", () => setTimeout(() => editorWrap.classList.remove("is-editing"), 80));
  root.querySelector("[data-prompt-highlights]").addEventListener("pointerover", (event) => {
    const mark = event.target.closest("[data-prompt-reference]");
    if (!mark || editorWrap.classList.contains("is-editing")) return;
    const reference = mark.dataset.promptReference;
    const asset = studio.assets.find((item) => item.reference === reference);
    if (!asset) return;
    const visual = asset.type === "audio"
      ? `<span class="ps-peek-audio">${icon("audio", 18)}</span>`
      : `<img src="${asset.preview_url}" alt="">`;
    peek.innerHTML = `${visual}<span><strong>${escapeHtml(reference)}</strong><small>${escapeHtml(asset.filename)}</small></span>`;
    const markRect = mark.getBoundingClientRect();
    const wrapRect = editorWrap.getBoundingClientRect();
    peek.style.left = `${Math.max(8, Math.min(markRect.left - wrapRect.left, wrapRect.width - 190))}px`;
    peek.style.top = `${Math.max(8, markRect.top - wrapRect.top - 62)}px`;
    peek.hidden = false;
  });
  root.querySelector("[data-prompt-highlights]").addEventListener("pointerout", (event) => {
    if (event.target.closest("[data-prompt-reference]")) peek.hidden = true;
  });
  root.querySelector("[data-prompt-highlights]").addEventListener("click", () => editor.focus());
  studio.sequence = createSequenceWorkspace({
    root, icon, storage: localStorage, assets: () => studio.assets,
    isBusy: () => studio.requestBusy,
    snapshot: () => {
      if (!studio.selectedModel?.runtime_ready) throw new Error("Select a ready prompt model in Settings.");
      studio.modelSelectionRevision = (studio.modelSelectionRevision || 0) + 1;
      return buildGeneratePayload(studio, { creativeBrief: "", seed: newGenerationSeed() });
    },
    prepare: prepareWriterRequest,
    run: (payload, onEvent) => vramHandoffCoordinator.trackWriterRequest(generateSequence(payload, onEvent)),
    cancel: (operationId) => cancelSequence(operationId, studio.sessionId),
    busy: (busy) => {
      if (busy) markActiveWriterRequest(); else clearActiveWriterRequest();
      setGenerationState(busy ? "busy" : "idle", "Generating sequence", "Completed prompts are kept as each chunk finishes");
      root.querySelector(".ps-generation-options").inert = busy;
      root.querySelector("[data-settings-view]").inert = busy;
    },
    refresh: () => { syncWorkspace(); renderMedia(studio.mode); },
    clearMedia: () => clearCurrentMedia(),
    settled: (status) => studio.desktopNotifications.notify(status === "complete" ? "Sequence generation finished." : "Sequence needs attention. Open Prompt Studio for details."),
    error: (error) => showToast("Sequence", error.message, error.details || null, null, sequenceNotificationOptions(error)),
    copy: (text) => copyPromptText(text),
    insert: (editor, reference) => insertReferenceAtCaret(editor, reference, editor.selectionStart),
  });
  syncWorkspace();
  restoreModeDraft(studio.mode);
  renderMedia(studio.mode);
  renderPromptHighlights();
  // The generation target is chosen on every launch, covering the whole studio,
  // so the user always starts from a deliberate choice of which model the prompt
  // is being written for.
  setTargetSelectionOpen(true);
  // The prompt model (the LLM that writes prompts) is remembered from the last
  // session; it is changed from the header pill or Settings, not asked at launch.
  refreshModels();
  return studio;
}

function supportsWorkflowMedia() {
  return HOST_CAPABILITIES.workflowMedia && !!(app.canvas?.graph && window.LiteGraph?.createNode && app.clientPosToCanvasPos);
}

async function openFloatingMedia() {
  const current = createStudio();
  const hasMedia = () => current.assets.some(asset => ["image", "video", "audio"].includes(asset.type) && asset.content_url);
  if (!hasMedia()) { openStudio(); showToast("Add media first", ""); return; }
  if (!supportsWorkflowMedia()) { openStudio(); showToast("Workflow canvas unavailable", ""); return; }
  const request = ++mediaPanelRequest;
  try {
    if (!current.floatingMedia) {
      current.floatingMediaPending ||= Promise.all([
        import("./floating_media.js"), import("./workflow_media.js"), import("/scripts/api.js"),
      ]).then(([{ createFloatingMediaPanel }, { createWorkflowMediaTransfer, createMediaMaterializer }, { api }]) => {
        current.floatingMedia = createFloatingMediaPanel({
          app, getState: () => current, icon, openWriter: openStudio,
          transfer: createWorkflowMediaTransfer({ app, liteGraph: window.LiteGraph,
            getWorkflowRevision: () => workflowRevision,
            materialize: createMediaMaterializer((...args) => api.fetchApi(...args)) }),
        });
      }).finally(() => { current.floatingMediaPending = null; });
      await current.floatingMediaPending;
    }
    if (request !== mediaPanelRequest) return;
    if (!hasMedia()) { openStudio(); showToast("Add media first", ""); return; }
    if (closeStudio() === false) return;
    current.floatingMedia.open();
  } catch (error) { showToast("Media panel unavailable", error.message); }
}

function openStudio() {
  mediaPanelRequest++;
  const current = createStudio();
  current.floatingMedia?.suspend(true);
  const modal = current.root.querySelector(".ps-modal");
  studioReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal.hidden = false;
  modal.setAttribute("aria-modal", "true");
  current.root.classList.add("is-open");
  current.root.setAttribute("aria-hidden", "false");
  document.body.classList.add("ps-modal-open");
  requestAnimationFrame(() => {
    updateBriefLayout();
    modal.tabIndex = -1;
    (modal.querySelector("[data-close-studio]:not([hidden])") || modal).focus({ preventScroll: true });
  });
}

function closeStudio() {
  if (!HOST_CAPABILITIES.windowed) return false;
  mediaPanelRequest++;
  if (!studio) return;
  studio.sequence?.leave();
  const modal = studio.root.querySelector(".ps-modal");
  studio.mediaComposer?.close();
  if (studio.mediaEditor?.close() === false) return false;
  setSettingsOpen(false);
  setOtherModelsPopover(false);


  modal.removeAttribute("aria-modal");
  modal.hidden = true;
  studio.root.classList.remove("is-open");
  studio.root.setAttribute("aria-hidden", "true");
  document.body.classList.remove("ps-modal-open");
  studio.floatingMedia?.suspend(false);
  studioReturnFocus?.focus?.({ preventScroll: true });
  studioReturnFocus = null;
}

function installLauncher() {
  if (!HOST_CAPABILITIES.windowed) return;
  const existingLauncher = document.querySelector("[data-ps-launcher]");
  if (existingLauncher?.dataset.psLauncherVersion === LAUNCHER_SCHEMA_VERSION) return;
  existingLauncher?.remove();
  document.querySelector("[data-ps-launcher-group]")?.remove();
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "ps-floating-launcher";
  launcher.dataset.psLauncher = "true";
  launcher.dataset.psLauncherVersion = LAUNCHER_SCHEMA_VERSION;
  launcher.setAttribute("aria-label", "Open Prompt Studio");
  launcher.title = "Open Prompt Studio · drag to move";
  const launcherIcon = brandedAssetUrl("./assets/prompt-studio-launcher.svg");
  launcher.innerHTML = `<img src="${launcherIcon}" alt="Prompt Studio">`;
  document.body.appendChild(launcher);

  const positionKey = "ps-launcher-position";
  const edgeGap = 10;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(value, maximum));
  const savePosition = (position) => localStorage.setItem(positionKey, JSON.stringify(position));
  const applyPosition = (position) => {
    const maxX = Math.max(edgeGap, window.innerWidth - launcher.offsetWidth - edgeGap);
    const maxY = Math.max(edgeGap, window.innerHeight - launcher.offsetHeight - edgeGap);
    const horizontalOffset = clamp(Number(position.horizontalOffset) || edgeGap, edgeGap, maxX);
    const verticalOffset = clamp(Number(position.verticalOffset) || edgeGap, edgeGap, maxY);
    launcher.style.left = position.horizontalAnchor === "left" ? `${horizontalOffset}px` : "auto";
    launcher.style.right = position.horizontalAnchor === "right" ? `${horizontalOffset}px` : "auto";
    launcher.style.top = position.verticalAnchor === "top" ? `${verticalOffset}px` : "auto";
    launcher.style.bottom = position.verticalAnchor === "bottom" ? `${verticalOffset}px` : "auto";
  };
  const positionFromRect = (rect) => {
    const horizontalAnchor = rect.left + rect.width / 2 <= window.innerWidth / 2 ? "left" : "right";
    const verticalAnchor = rect.top + rect.height / 2 <= window.innerHeight / 2 ? "top" : "bottom";
    return {
      version: 3,
      horizontalAnchor,
      verticalAnchor,
      horizontalOffset: Math.round(horizontalAnchor === "left" ? rect.left : window.innerWidth - rect.right),
      verticalOffset: Math.round(verticalAnchor === "top" ? rect.top : window.innerHeight - rect.bottom),
    };
  };

  let saved = JSON.parse(localStorage.getItem(positionKey) || "null");
  if (saved?.version === 3) {
    applyPosition(saved);
  } else if (saved) {
    // Reset absolute and early edge-relative positions to the intended first-run corner.
    saved = {
      version: 3,
      horizontalAnchor: "right",
      verticalAnchor: "bottom",
      horizontalOffset: 24,
      verticalOffset: 104,
    };
    applyPosition(saved);
    savePosition(saved);
  }
  let drag = null;
  // Movement is measured as total displacement from the press point. Relying on
  // event.movementX/Y made the first click ambiguous and it started a drag
  // instead of opening the studio.
  const DRAG_THRESHOLD_PX = 4;
  launcher.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    drag = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      pointerId: event.pointerId,
    };
    launcher.setPointerCapture(event.pointerId);
  });
  launcher.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      const travelled = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (travelled <= DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }
    const x = Math.max(10, Math.min(event.clientX - drag.dx, window.innerWidth - launcher.offsetWidth - 10));
    const y = Math.max(10, Math.min(event.clientY - drag.dy, window.innerHeight - launcher.offsetHeight - 10));
    launcher.style.left = `${x}px`;
    launcher.style.top = `${y}px`;
    launcher.style.right = "auto";
    launcher.style.bottom = "auto";
  });
  launcher.addEventListener("pointerup", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (launcher.hasPointerCapture?.(event.pointerId)) launcher.releasePointerCapture(event.pointerId);
    const moved = drag.moved;
    drag = null;
    if (moved) {
      saved = positionFromRect(launcher.getBoundingClientRect());
      applyPosition(saved);
      savePosition(saved);
    } else {
      openStudio();
    }
  });
  launcher.addEventListener("pointercancel", () => { drag = null; });
  window.addEventListener("resize", () => {
    if (!saved || drag) return;
    applyPosition(saved);
  });
}

document.addEventListener("keydown", (event) => {
  if (!studio?.root.classList.contains("is-open")) return;
  const openComposer = studio.root.querySelector(".ps-composer.is-open");
  const openEditor = studio.root.querySelector(".ps-media-editor.is-open");
  if (event.key === "Tab") {
    const openPopover = studio.root.querySelector("[data-other-models-popover]:not([hidden])");
    const focusScope = openEditor?.querySelector(".ps-ed-dialog") || openComposer?.querySelector(".ps-cmp-dialog") || openPopover || studio.root.querySelector(".ps-modal");
    const focusable = Array.from(focusScope.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((element) => element.getClientRects().length && !element.closest("[hidden]"));
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  if (openComposer || openEditor) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (!studio.root.querySelector("[data-clear-menu]").hidden) {
      setClearMenuOpen(false);
      return;
    }
    const interfaceSizeMenu = studio.root.querySelector("[data-interface-size-menu]");
    const choiceMenu = Array.from(studio.root.querySelectorAll("[data-choice-menu]")).find((menu) => !menu.hidden);
    const runtimeMenu = Array.from(studio.root.querySelectorAll("[data-runtime-menu]")).find((menu) => !menu.hidden);
    if (!interfaceSizeMenu.hidden) {
      setInterfaceSizeMenuOpen(false, true);
    } else if (choiceMenu) {
      choiceMenu.hidden = true;
      const toggle = studio.root.querySelector(`[data-choice-toggle="${choiceMenu.dataset.choiceMenu}"]`);
      toggle?.setAttribute("aria-expanded", "false");
      toggle?.focus();
    } else if (runtimeMenu) setRuntimeMenuOpen(runtimeMenu.dataset.runtimeMenu, false, true);
    else if (!studio.root.querySelector("[data-other-models-popover]").hidden) setOtherModelsPopover(false);
    else if (studio.fullscreen) setFullscreen(false);
    else closeStudio();
  }
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (event.target.closest("[data-lyrics-refine-panel]")) submitLyricsRefinement();
    else if (event.target.closest("[data-refine-panel]")) submitRefinement();
    else startGenerationPreview();
  }
});

app.registerExtension({
  name: EXTENSION_NAME,
  beforeConfigureGraph() { workflowRevision++; },
  commands: [{ id: "prompt-studio.open", label: "Open Prompt Studio", function: openStudio },
    { id: "prompt-studio.media", label: "Prompt Studio media over workflow", function: openFloatingMedia }],
  menuCommands: [{ path: ["Extensions", "Prompt Studio"], commands: ["prompt-studio.open", "prompt-studio.media"] }],
  async setup() {
    injectStyles();
    // A host that cached the previous bundle would otherwise keep running old code
    // until a manual hard refresh. Check once, before the studio is built, so a
    // stale bundle never renders a stale interface first.
    await guardAgainstStaleBundle({
      builtVersion: EXTENSION_VERSION,
      fetchVersion: async () => (await getStatus()).version,
      reload: () => location.reload(),
    });
    installVramHandoff(app, {
      isEnabled: vramHandoffIsEnabled,
      onQueueRequested: () => vramHandoffCoordinator.invalidateWriterAttempts(),
      beforeQueue: unloadWriterModelsBeforeQueue,
      onError: showVramHandoffQueueError,
      onQueueHandoffEnd: () => vramHandoffCoordinator.finishQueueHandoff(),
    });
    installLauncher();
  },
});

/**
 * Test-only surface.
 *
 * `tests/main_smoke.mjs` loads this module for real and needs to CALL functions,
 * because a free variable inside a function body only throws when the line runs.
 * Exposed unconditionally so the test never has to mutate production code, and
 * because a plain object reference is inert at runtime.
 */
globalThis.__promptStudioInternals = {
  createStudio,
  selectModel,
  syncWorkspace,
  renderMedia,
  currentBriefTextarea,
  bindMediaActions,
  setTargetSelectionOpen,
  confirmTargetSelection,
  getStudio: () => studio,
  setStudio: (value) => { studio = value; },
};

