/**
 * Generation-target registry (frontend).
 *
 * Mirrors `targets.json` / `backend/targets/` so the UI can render targets,
 * modes, limits and brief lengths without hardcoding them. The server remains
 * the source of truth: `adoptTargetCatalog()` replaces the built-in snapshot
 * with whatever `GET /promptstudio/targets` returns.
 *
 * Everything here is written so a missing or partial catalog degrades to the
 * built-in snapshot rather than throwing, because the UI must still render if
 * the request fails.
 */

let catalog = null;

/**
 * Built-in snapshot of the server registry for the three first-party targets.
 * Kept minimal: only the fields the UI reads.
 */
const BUILT_IN = [
  {
    id: "minimax_h3",
    label: "MiniMax H3",
    category: "video",
    workspace: "video",
    default_mode: "Reference",
    default_aspect_ratio: "16:9",
    aspect_ratios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
    durations: { min: 1, max: 20, default: 10 },
    media_capabilities: ["image", "video", "audio"],
    output_contract: {
      profile: "official_sections",
      brief_limit: 8000,
      requires_duration: true,
      requires_aspect_ratio: true,
      shot_numbering: true,
      timestamp_syntax: true,
      lyrics_limit: null,
      edit_instruction_limit: null,
    },
    modes: [
      { id: "T2VA", label: "T2VA", title: "Text to video", hint: "Describe the scene. No reference media is required.", guide: "base", system_prompt: "base", requires_media: false, limits: {}, output_only: false },
      { id: "I2VA", label: "I2VA", title: "Image to video", hint: "The opening image anchors subject, framing and visual style.", guide: "base", system_prompt: "base", requires_media: true, limits: { image: 1 }, output_only: false },
      { id: "FL2VA", label: "FL2VA", title: "First & last frame", hint: "Define the visual transition between the opening and closing frames.", guide: "base", system_prompt: "base", requires_media: true, limits: { image: 2 }, output_only: false },
      { id: "L2VA", label: "L2VA", title: "Last frame", hint: "The final image defines where the generated shot must arrive.", guide: "base", system_prompt: "base", requires_media: true, limits: { image: 1 }, output_only: false },
      { id: "Reference", label: "Reference", title: "Images, video & audio", hint: "Add up to 9 images, 3 videos and 3 audio files.", guide: "reference", system_prompt: "ref", requires_media: true, limits: { image: 9, video: 3, audio: 3, total: 12 }, output_only: false },
    ],
  },
  {
    id: "minimax_music3",
    label: "MiniMax Music 3",
    category: "audio",
    workspace: "music",
    default_mode: "Music3",
    default_aspect_ratio: null,
    aspect_ratios: [],
    durations: null,
    media_capabilities: [],
    output_contract: {
      profile: "music_caption",
      brief_limit: 2000,
      requires_duration: false,
      requires_aspect_ratio: false,
      shot_numbering: false,
      timestamp_syntax: false,
      lyrics_limit: 4000,
      edit_instruction_limit: null,
    },
    modes: [
      { id: "Music3", label: "Caption", title: "Music Caption", hint: "Structured music caption with Global Metadata, Vocal Details and Arrangement.", guide: null, system_prompt: "base", requires_media: false, limits: {}, output_only: false },
      { id: "Music3Lyrics", label: "Lyrics", title: "Lyrics", hint: "Create new lyrics or rewrite the current lyrics.", guide: null, system_prompt: "lyrics", requires_media: false, limits: {}, output_only: true },
    ],
  },
  {
    id: "qwen_image_2.1",
    label: "Qwen Image 2.1",
    category: "image",
    workspace: "image",
    default_mode: "TextToImage",
    default_aspect_ratio: "1:1",
    aspect_ratios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
    durations: null,
    media_capabilities: ["image"],
    output_contract: {
      profile: "image_description",
      brief_limit: 8000,
      requires_duration: false,
      requires_aspect_ratio: true,
      shot_numbering: false,
      timestamp_syntax: false,
      lyrics_limit: null,
      edit_instruction_limit: 4000,
    },
    modes: [
      { id: "TextToImage", label: "T2I", title: "Text to Image", hint: "Describe the image to generate from scratch.", guide: "t2i", system_prompt: "base", requires_media: false, limits: {}, output_only: false },
      { id: "ImageEdit", label: "Edit", title: "Image Edit", hint: "One or more source images plus an edit instruction.", guide: "edit", system_prompt: "edit", requires_media: true, limits: { image: 10, total: 10 }, instruction_field: "edit_instruction", instruction_limit: 4000, output_only: false },
    ],
  },
  {
    id: "krea_2",
    label: "Krea 2",
    category: "image",
    workspace: "image",
    default_mode: "Krea2TextToImage",
    default_aspect_ratio: "1:1",
    aspect_ratios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
    durations: null,
    media_capabilities: [],
    output_contract: {
      profile: "image_description",
      brief_limit: 8000,
      requires_duration: false,
      requires_aspect_ratio: true,
      shot_numbering: false,
      timestamp_syntax: false,
      lyrics_limit: null,
      edit_instruction_limit: null,
    },
    modes: [
      { id: "Krea2TextToImage", label: "T2I", title: "Text to Image", hint: "Describe the image to generate from scratch.", guide: "base", system_prompt: "base", requires_media: false, limits: {}, output_only: false },
    ],
  },
];

function indexTargets(targets) {
  const byId = new Map();
  const byMode = new Map();
  for (const target of targets) {
    if (!target || typeof target.id !== "string") continue;
    byId.set(target.id, target);
    for (const mode of target.modes || []) {
      if (mode && typeof mode.id === "string") byMode.set(mode.id, target);
    }
  }
  return { byId, byMode, list: targets.filter((target) => byId.has(target?.id)) };
}

let index = indexTargets(BUILT_IN);

/**
 * Replace the client-side snapshot with the server catalog.
 * Ignores anything that does not look like a usable catalog.
 */
export function adoptTargetCatalog(response) {
  const targets = Array.isArray(response) ? response : response?.targets;
  if (!Array.isArray(targets) || targets.length === 0) return false;
  if (!targets.every((target) => target && typeof target.id === "string" && Array.isArray(target.modes) && target.modes.length > 0)) {
    return false;
  }
  index = indexTargets(targets);
  return true;
}

/** Restore the built-in snapshot (tests and error recovery). */
export function resetTargetCatalog() {
  index = indexTargets(BUILT_IN);
}

export function targetList() {
  return index.list;
}

export function targetById(targetId) {
  return index.byId.get(targetId) || null;
}

export function targetForMode(mode) {
  return index.byMode.get(mode) || null;
}

export function modeDescriptor(mode) {
  const target = targetForMode(mode);
  return target?.modes?.find((candidate) => candidate.id === mode) || null;
}

export function allModes() {
  return index.list.flatMap((target) => target.modes || []);
}

/** Modes the UI offers as selectable input modes (excludes output-only helpers). */
export function selectableModes(target = null) {
  const modes = target ? target.modes || [] : allModes();
  return modes.filter((mode) => !mode.output_only);
}

export function allModeIds() {
  return allModes().map((mode) => mode.id);
}

/** Modes whose drafts are persisted across reloads. */
export function persistedModeIds() {
  return selectableModes()
    .filter((mode) => !mode.output_only)
    .map((mode) => mode.id);
}

export function modeBriefLimit(mode) {
  return targetForMode(mode)?.output_contract?.brief_limit ?? 8000;
}

export function modeLyricsLimit(mode) {
  return targetForMode(mode)?.output_contract?.lyrics_limit ?? 4000;
}

export function modeEditInstructionLimit(mode) {
  return modeDescriptor(mode)?.instruction_limit
    ?? targetForMode(mode)?.output_contract?.edit_instruction_limit
    ?? 4000;
}

export function modeMediaLimits(mode) {
  return { ...(modeDescriptor(mode)?.limits || {}) };
}

export function modeTotalLimit(mode) {
  const limits = modeMediaLimits(mode);
  return limits.total ?? null;
}

/**
 * The output-only companion mode for a target, if it has one (Music 3 lyrics).
 */
export function outputOnlyModeFor(target) {
  return (target?.modes || []).find((mode) => mode.output_only) || null;
}

export function targetCategories() {
  return [...new Set(index.list.map((target) => target.category))];
}

/**
 * Input panel a target category renders. Each category has its own panel so a
 * new target never inherits another one's fields.
 */
export function panelForCategory(category) {
  if (category === "audio") return "music";
  if (category === "image" || category === "image-edit") return "image";
  return "video";
}

export function describesAudio(mode) {
  return targetForMode(mode)?.category === "audio";
}

export function acceptsMedia(mode) {
  return Boolean(modeDescriptor(mode)?.requires_media);
}

export function modeHasLyrics(mode) {
  return targetForMode(mode)?.output_contract?.lyrics_limit != null;
}

export function modeRequiresDuration(mode) {
  return Boolean(targetForMode(mode)?.output_contract?.requires_duration);
}

export function modeRequiresAspectRatio(mode) {
  return Boolean(targetForMode(mode)?.output_contract?.requires_aspect_ratio);
}

/**
 * Default mode for a target, identified by id.
 *
 * Two targets can share one workspace - Qwen Image 2.1 and Krea 2 are both
 * "image" - so resolving a default mode by workspace is ambiguous and returns
 * whichever target happens to be listed first. Callers that know which target
 * the user picked must use this instead.
 */
export function defaultModeForTarget(targetId) {
  return targetById(targetId)?.default_mode ?? null;
}

/**
 * Default mode for a workspace.
 *
 * Ambiguous when several targets share the workspace; prefer
 * :func:`defaultModeForTarget` anywhere the chosen target is known.
 */
export function defaultModeForWorkspace(workspace) {
  const target = index.list.find((candidate) => candidate.workspace === workspace);
  return target?.default_mode ?? null;
}

export function workspaceForMode(mode) {
  return targetForMode(mode)?.workspace ?? null;
}

/**
 * System prompt profile for a mode, taken from the registry.
 * Falls back to the mode name so an unknown mode never crashes the editor.
 */
export function systemPromptProfileFor(mode) {
  return modeDescriptor(mode)?.system_prompt || mode;
}
