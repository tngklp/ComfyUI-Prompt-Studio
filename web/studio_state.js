import {
  acceptsMedia,
  allModeIds,
  describesAudio,
  modeBriefLimit,
  modeHasLyrics,
  modeLyricsLimit,
  outputOnlyModeFor,
  persistedModeIds,
  systemPromptProfileFor,
  targetForMode,
  targetList,
} from "./target_registry.js";

export const SYSTEM_PROMPT_STORAGE_KEY = "ps-system-prompts-v1";
export const EXTERNAL_SERVER_STORAGE_KEY = "ps-external-llama-server-v1";
export const OLLAMA_MODEL_STORAGE_KEY = "ps-ollama-model-v1";
export const OLLAMA_HOST_STORAGE_KEY = "ps-ollama-host-v1";
export const OLLAMA_ENDPOINT_MODELS_STORAGE_KEY = "ps-ollama-endpoint-models-v1";
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
export const API_PROVIDER_STORAGE_KEY = "ps-api-provider-v1";
export const USER_PREFERENCES_STORAGE_KEY = "ps-preferences-v1";
export const MODE_DRAFTS_STORAGE_KEY = "ps-mode-drafts-v1";
export const INTERFACE_SIZES = ["100", "110", "120", "125"];

const PROVIDERS = ["direct", "external", "ollama", "api"];
const CONTEXT_PROFILES = ["auto", "low", "standard", "extended", "large", "maximum", "custom"];
const KV_CACHES = ["auto", "f16", "q8"];
const GENERATION_BUDGETS = ["auto", "2048", "4096", "8192", "custom"];

// Mode ids, brief limits and prompt profiles come from the generation-target
// registry (web/target_registry.js), which the server catalog refreshes.
const KNOWN_MODES = allModeIds();
const DRAFT_MODES = persistedModeIds();

/** Fallback for a mode/ratio that is no longer in the registry. */
export function defaultMode() {
  return targetList().find((target) => target.workspace === "video")?.default_mode
    || targetList()[0]?.default_mode
    || "Reference";
}

function defaultAspectRatio() {
  return targetForMode(defaultMode())?.default_aspect_ratio || "16:9";
}

const DEFAULT_MODE = defaultMode();
const DEFAULT_ASPECT_RATIO = defaultAspectRatio();

/** The first selectable mode that is not an audio target. */
function nonAudioMode(mode) {
  if (mode && KNOWN_MODES.includes(mode) && !describesAudio(mode)) return mode;
  return targetList().find((target) => target.category !== "audio")?.default_mode || DEFAULT_MODE;
}

/** System prompt profile of the output-only companion of a mode's target. */
function lyricsProfile(mode) {
  const companion = outputOnlyModeFor(targetForMode(mode));
  return companion ? systemPromptProfileFor(companion.id) : "music3_lyrics";
}

export function isPersistedDraftMode(mode) {
  return DRAFT_MODES.includes(mode);
}

export function audioWasAdded(previousAssets, nextAssets) {
  return previousAssets.every((asset) => asset.type !== "audio")
    && nextAssets.some((asset) => asset.type === "audio");
}

export function isTextOnlyDirectModel(model) {
  return model?.family === "gguf" && model?.capabilities?.images === false;
}

// Modes that need no vision projector. Derived from the registry: a mode is
// text-only-safe when it does not require media.
export function isGenerationModeAvailable(model, mode) {
  if (!isTextOnlyDirectModel(model)) return true;
  return !acceptsMedia(mode);
}

export function isModeDraftDirty(mode, draft, defaults) {
  return isPersistedDraftMode(mode)
    && Boolean(draft)
    && (draft.brief !== defaults.brief
      || draft.prompt !== defaults.prompt
      || (modeHasLyrics(mode) && draft.lyrics !== defaults.lyrics));
}

export function resetModeDraft(drafts, mode) {
  if (!isPersistedDraftMode(mode)) return drafts;
  const next = { ...drafts };
  delete next[mode];
  return next;
}

export function clearPromptDraft(draft = {}) {
  return { ...draft, brief: "", prompt: "" };
}

export function normalizeCustomFrameCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 2 && count <= 24 ? String(count) : null;
}

/** A stored mode is kept only when the registry still declares it. */
function resolvedMode(mode) {
  return KNOWN_MODES.includes(mode) ? mode : DEFAULT_MODE;
}

/** Aspect ratio must belong to the selected mode's target, else the target default. */
function resolveAspectRatio(value, mode) {
  const target = targetForMode(mode);
  if (typeof value === "string" && target?.aspect_ratios?.includes(value)) return value;
  return target?.default_aspect_ratio ?? DEFAULT_ASPECT_RATIO;
}

/** Duration is clamped to the selected mode's target range; modes without a
 *  duration (audio, image) keep falls back to the stored integer or 10. */
function resolveDurationSeconds(value, mode) {
  const durations = targetForMode(mode)?.durations;
  const fallback = durations?.default ?? 10;
  if (!Number.isInteger(value)) return fallback;
  if (!durations) return value >= 1 ? value : fallback;
  return value >= durations.min && value <= durations.max ? value : fallback;
}

function normalizeModeDraft(mode, draft) {
  if (!draft || typeof draft.brief !== "string" || typeof draft.prompt !== "string") return null;
  const briefLimit = modeBriefLimit(mode);
  const normalized = { brief: draft.brief.slice(0, briefLimit), prompt: draft.prompt };
  if (modeHasLyrics(mode)) {
    normalized.lyrics = typeof draft.lyrics === "string" ? draft.lyrics.slice(0, modeLyricsLimit(mode)) : "";
  }
  return normalized;
}

export function loadModeDrafts(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(MODE_DRAFTS_STORAGE_KEY) || "null");
    if (!value || value.version !== 1 || !value.drafts || typeof value.drafts !== "object") return {};
    return Object.fromEntries(DRAFT_MODES.flatMap((mode) => {
      const draft = normalizeModeDraft(mode, value.drafts[mode]);
      return draft ? [[mode, draft]] : [];
    }));
  } catch {
    return {};
  }
}

export function saveModeDrafts(storage, drafts) {
  const safeDrafts = Object.fromEntries(DRAFT_MODES.flatMap((mode) => {
    const draft = normalizeModeDraft(mode, drafts?.[mode]);
    return draft ? [[mode, draft]] : [];
  }));
  storage?.setItem(MODE_DRAFTS_STORAGE_KEY, JSON.stringify({ version: 1, drafts: safeDrafts }));
}

export function loadUserPreferences(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(USER_PREFERENCES_STORAGE_KEY) || "null");
    if (!value || value.version !== 1) return null;
    return {
      version: 1,
      mode: resolvedMode(value.mode),
      duration_seconds: resolveDurationSeconds(value.duration_seconds, resolvedMode(value.mode)),
      aspect_ratio: resolveAspectRatio(value.aspect_ratio, resolvedMode(value.mode)),
      active_provider: PROVIDERS.includes(value.active_provider) ? value.active_provider : "direct",
      direct_model_id: typeof value.direct_model_id === "string" && value.direct_model_id ? value.direct_model_id : null,
      direct_context_profile: CONTEXT_PROFILES.includes(value.direct_context_profile) ? value.direct_context_profile : "auto",
      direct_context_tokens: Number.isInteger(value.direct_context_tokens) && value.direct_context_tokens > 0 ? value.direct_context_tokens : null,
      direct_kv_cache: KV_CACHES.includes(value.direct_kv_cache) ? value.direct_kv_cache : "auto",
      direct_generation_budget: GENERATION_BUDGETS.includes(value.direct_generation_budget) ? value.direct_generation_budget : "auto",
      direct_generation_budget_tokens: Number.isInteger(value.direct_generation_budget_tokens) && value.direct_generation_budget_tokens > 0 ? value.direct_generation_budget_tokens : null,
      ollama_generation_budget: GENERATION_BUDGETS.includes(value.ollama_generation_budget) ? value.ollama_generation_budget : "auto",
      ollama_generation_budget_tokens: Number.isInteger(value.ollama_generation_budget_tokens) && value.ollama_generation_budget_tokens > 0 ? value.ollama_generation_budget_tokens : null,
      direct_reasoning_effort: typeof value.direct_reasoning_effort === "string" && value.direct_reasoning_effort ? value.direct_reasoning_effort : "auto",
      music_lyrics_use_brief: value.music_lyrics_use_brief !== false,
      fullscreen: value.fullscreen === true,
      vram_handoff: value.vram_handoff === true,
      theme: value.theme === "light" ? "light" : "dark",
      interface_size: INTERFACE_SIZES.includes(value.interface_size) ? value.interface_size : "100",
    };
  } catch {
    return null;
  }
}

export function saveUserPreferences(storage, state) {
  const safe = {
    version: 1,
    mode: resolvedMode(state.mode),
    duration_seconds: resolveDurationSeconds(state.durationSeconds, resolvedMode(state.mode)),
    aspect_ratio: resolveAspectRatio(state.aspectRatio, resolvedMode(state.mode)),
    active_provider: PROVIDERS.includes(state.settingsProvider) ? state.settingsProvider : "direct",
    direct_model_id: typeof state.preferredDirectModelId === "string" && state.preferredDirectModelId ? state.preferredDirectModelId : null,
    direct_context_profile: CONTEXT_PROFILES.includes(state.directContextProfile) ? state.directContextProfile : "auto",
    direct_context_tokens: Number.isInteger(state.directContextTokens) && state.directContextTokens > 0 ? state.directContextTokens : null,
    direct_kv_cache: KV_CACHES.includes(state.directKvCache) ? state.directKvCache : "auto",
    direct_generation_budget: GENERATION_BUDGETS.includes(state.directGenerationBudget) ? state.directGenerationBudget : "auto",
    direct_generation_budget_tokens: Number.isInteger(state.directGenerationBudgetTokens) && state.directGenerationBudgetTokens > 0 ? state.directGenerationBudgetTokens : null,
    ollama_generation_budget: GENERATION_BUDGETS.includes(state.ollamaGenerationBudget) ? state.ollamaGenerationBudget : "auto",
    ollama_generation_budget_tokens: Number.isInteger(state.ollamaGenerationBudgetTokens) && state.ollamaGenerationBudgetTokens > 0 ? state.ollamaGenerationBudgetTokens : null,
    direct_reasoning_effort: typeof state.directReasoningEffort === "string" && state.directReasoningEffort ? state.directReasoningEffort : "auto",
    music_lyrics_use_brief: state.musicLyricsUseBrief !== false,
    fullscreen: state.fullscreen === true,
    vram_handoff: state.vramHandoff === true,
    theme: state.theme === "light" ? "light" : "dark",
    interface_size: INTERFACE_SIZES.includes(state.interfaceSize) ? state.interfaceSize : "100",
  };
  storage?.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(safe));
}

export function loadApiProviderConfig(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(API_PROVIDER_STORAGE_KEY) || "null");
    if (!value || !["openai", "gemini", "openrouter", "custom"].includes(value.preset)) return null;
    return {
      preset: value.preset,
      base_url: typeof value.base_url === "string" ? value.base_url : "",
      model_id: typeof value.model_id === "string" ? value.model_id : "",
      gemini_reasoning_effort: ["minimal", "low", "medium", "high"].includes(value.gemini_reasoning_effort) ? value.gemini_reasoning_effort : "minimal",
      custom_images: value.custom_images === true,
      custom_context_tokens: Number.isInteger(value.custom_context_tokens) ? value.custom_context_tokens : null,
    };
  } catch {
    return null;
  }
}

export function saveApiProviderConfig(storage, config) {
  if (!config) {
    storage?.removeItem(API_PROVIDER_STORAGE_KEY);
    return;
  }
  const safe = {
    preset: config.preset,
    base_url: String(config.base_url || ""),
    model_id: String(config.model_id || ""),
    gemini_reasoning_effort: ["minimal", "low", "medium", "high"].includes(config.gemini_reasoning_effort) ? config.gemini_reasoning_effort : "minimal",
    custom_images: config.custom_images === true,
    custom_context_tokens: Number.isInteger(config.custom_context_tokens) ? config.custom_context_tokens : null,
  };
  storage?.setItem(API_PROVIDER_STORAGE_KEY, JSON.stringify(safe));
}

export function normalizeOllamaHost(value) {
  const host = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (/^http:\/\/(localhost|\[::1\])(?::11434)?$/i.test(host)) return DEFAULT_OLLAMA_HOST;
  return host || DEFAULT_OLLAMA_HOST;
}

export function loadOllamaHost(storage = globalThis.localStorage) {
  return normalizeOllamaHost(storage?.getItem(OLLAMA_HOST_STORAGE_KEY));
}

export function saveOllamaHost(storage, host) {
  const normalized = normalizeOllamaHost(host);
  if (normalized === DEFAULT_OLLAMA_HOST) storage?.removeItem(OLLAMA_HOST_STORAGE_KEY);
  else storage?.setItem(OLLAMA_HOST_STORAGE_KEY, normalized);
}

function loadEndpointModels(storage) {
  try {
    const value = JSON.parse(storage?.getItem(OLLAMA_ENDPOINT_MODELS_STORAGE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function loadOllamaModel(storage = globalThis.localStorage, host = DEFAULT_OLLAMA_HOST) {
  const endpoint = normalizeOllamaHost(host);
  if (endpoint === DEFAULT_OLLAMA_HOST) {
    const value = storage?.getItem(OLLAMA_MODEL_STORAGE_KEY);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  const value = loadEndpointModels(storage)[endpoint];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function saveOllamaModel(storage, modelName, host = DEFAULT_OLLAMA_HOST) {
  const endpoint = normalizeOllamaHost(host);
  if (endpoint === DEFAULT_OLLAMA_HOST) {
    if (modelName) storage?.setItem(OLLAMA_MODEL_STORAGE_KEY, modelName);
    else storage?.removeItem(OLLAMA_MODEL_STORAGE_KEY);
    return;
  }
  const models = loadEndpointModels(storage);
  if (modelName) models[endpoint] = modelName;
  else delete models[endpoint];
  if (Object.keys(models).length) storage?.setItem(OLLAMA_ENDPOINT_MODELS_STORAGE_KEY, JSON.stringify(models));
  else storage?.removeItem(OLLAMA_ENDPOINT_MODELS_STORAGE_KEY);
}

export function loadExternalServerConfig(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(EXTERNAL_SERVER_STORAGE_KEY) || "null");
    if (value && typeof value.url === "string") {
      return { url: value.url, model: String(value.model || "") };
    }
  } catch {}
  return null;
}

export function saveExternalServerConfig(storage, config) {
  if (config) storage?.setItem(EXTERNAL_SERVER_STORAGE_KEY, JSON.stringify(config));
  else storage?.removeItem(EXTERNAL_SERVER_STORAGE_KEY);
}

export function loadCustomSystemPrompts(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(SYSTEM_PROMPT_STORAGE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function saveCustomSystemPrompts(storage, prompts) {
  storage?.setItem(SYSTEM_PROMPT_STORAGE_KEY, JSON.stringify(prompts));
}

export function systemPromptProfile(mode) {
  return systemPromptProfileFor(mode);
}

export function currentSystemPromptOverride(state, mode = state.mode) {
  const profile = systemPromptProfile(mode);
  return systemPromptOverride(state, profile);
}

export function systemPromptOverride(state, profile) {
  return Object.hasOwn(state.customSystemPrompts, profile)
    ? state.customSystemPrompts[profile]
    : null;
}

export function selectedExternalServer(state) {
  return state.selectedModel?.family === "external" ? state.externalServerConfig : null;
}

export function selectedOllamaModel(state) {
  return state.selectedModel?.family === "ollama" ? state.selectedModel.remote_model : null;
}

export function selectedOllamaHost(state) {
  return state.selectedModel?.family === "ollama" ? state.ollamaHost : null;
}

export function selectedApiProvider(state) {
  if (state.selectedModel?.family !== "api") return null;
  return {
    connection_id: state.selectedModel.api_connection_id,
    model_id: state.selectedModel.remote_model,
  };
}

export function selectModelState(state, model, { preserveSettingsProvider = false } = {}) {
  const settingsProvider = state.settingsProvider;
  state.selectedModel = model || null;
  state.audioSupported = model?.capabilities?.audio === true;
  if (!preserveSettingsProvider) {
    if (model?.family === "external") state.settingsProvider = "external";
    else if (model?.family === "ollama") state.settingsProvider = "ollama";
    else if (model?.family === "api") state.settingsProvider = "api";
    else if (model?.family === "gguf") state.settingsProvider = "direct";
  } else {
    state.settingsProvider = settingsProvider;
  }
  if (["external", "api"].includes(model?.family)) {
    state.keepModelLoaded = false;
  }
  return state;
}

export function restoredModelAfterDiscovery(state) {
  const preferredDirect = state.models.find((model) => model.family === "gguf" && model.id === state.preferredDirectModelId && model.runtime_ready);
  const preferredProviderModel = state.preferredProvider === "direct"
    ? preferredDirect
    : state.preferredProvider === "external"
      ? state.externalModel
      : state.preferredProvider === "ollama"
        ? state.models.find((model) => model.family === "ollama" && model.remote_model === state.ollamaModelName && model.runtime_ready)
          || state.models.find((model) => model.family === "ollama" && model.runtime_ready)
        : null;
  return preferredProviderModel
    || preferredDirect
    || state.models.find((model) => model.runtime_ready)
    || state.models[0]
    || null;
}

function sharedInferencePayload(state) {
  const directRuntime = state.selectedModel?.family === "gguf";
  const thinking = state.selectedModel?.family === "external" ? false : state.thinking;
  const budgetMode = directRuntime ? (state.directGenerationBudget || "auto") : (state.ollamaGenerationBudget || "auto");
  const budgetTokens = directRuntime ? state.directGenerationBudgetTokens : state.ollamaGenerationBudgetTokens;
  const generationBudget = budgetMode === "custom"
    ? (budgetTokens ?? 0)
    : budgetMode === "auto" ? null : Number(budgetMode);
  return {
    session_id: state.sessionId,
    mode: state.mode,
    model_id: state.selectedModel?.id,
    ...(directRuntime && state.selectedModel.selected_projector ? { gguf_projector: state.selectedModel.selected_projector } : {}),
    external_server: selectedExternalServer(state),
    ollama_model: selectedOllamaModel(state),
    ollama_host: selectedOllamaHost(state),
    api_provider: selectedApiProvider(state),
    thinking,
    context_profile: directRuntime ? state.contextProfile : "auto",
    kv_cache: directRuntime ? state.kvCache : "auto",
    ...(directRuntime ? {
      context_tokens: state.contextProfile === "custom" ? state.contextTokens : null,
    } : {}),
    ...(["gguf", "ollama"].includes(state.selectedModel?.family) ? { generation_budget: generationBudget } : {}),
    ...(directRuntime && thinking ? { reasoning_effort: state.reasoningEffort || "auto" } : {}),
    system_prompt_override: currentSystemPromptOverride(state),
    unload_after: !state.keepModelLoaded,
  };
}

export function buildGeneratePayload(state, { creativeBrief, lyrics = "", seed }) {
  const payload = {
    ...sharedInferencePayload(state),
    duration_seconds: state.durationSeconds,
    aspect_ratio: state.aspectRatio,
    creative_brief: creativeBrief,
    seed,
  };
  if (modeHasLyrics(state.mode)) payload.lyrics = lyrics;
  return payload;
}

export function buildRefinePayload(state, { currentPrompt, instruction, creativeBrief, lyrics = "", seed }) {
  const payload = {
    ...sharedInferencePayload(state),
    current_prompt: currentPrompt,
    instruction,
    duration_seconds: state.durationSeconds,
    aspect_ratio: state.aspectRatio,
    creative_brief: creativeBrief,
    seed,
  };
  if (modeHasLyrics(state.mode)) payload.lyrics = lyrics;
  return payload;
}

export function buildLyricsRefinePayload(state, {
  currentLyrics,
  instruction,
  useMusicBrief,
  creativeBrief,
  seed,
}) {
  return {
    ...sharedInferencePayload(state),
    target: "lyrics",
    current_lyrics: currentLyrics,
    instruction,
    use_music_brief: useMusicBrief,
    creative_brief: useMusicBrief ? creativeBrief : "",
    system_prompt_override: systemPromptOverride(state, lyricsProfile(state.mode)),
    seed,
  };
}

export function createStudioState({ sessionId, storage = globalThis.localStorage }) {
  const preferences = loadUserPreferences(storage);
  const ollamaHost = loadOllamaHost(storage);
  return {
    mode: preferences?.mode || "Reference",
    lastVideoMode: nonAudioMode(preferences?.mode),
    mediaFilter: "all",
    durationSeconds: preferences?.duration_seconds || 10,
    aspectRatio: preferences?.aspect_ratio || "16:9",
    contextProfile: "auto",
    contextTokens: null,
    kvCache: "auto",
    generationBudget: "auto",
    generationBudgetTokens: null,
    reasoningEffort: "auto",
    thinking: false,
    keepModelLoaded: false,
    vramHandoff: preferences?.vram_handoff === true,
    settingsProvider: preferences?.active_provider || "ollama",
    preferencesRestoring: true,
    preferredProvider: preferences?.active_provider || "ollama",
    preferredDirectModelId: preferences?.direct_model_id || null,
    directContextProfile: preferences?.direct_context_profile || "auto",
    directContextTokens: preferences?.direct_context_tokens || null,
    directKvCache: preferences?.direct_kv_cache || "auto",
    ollamaGenerationBudget: preferences?.ollama_generation_budget || "auto",
    ollamaGenerationBudgetTokens: preferences?.ollama_generation_budget_tokens || null,
    directGenerationBudget: preferences?.direct_generation_budget || "auto",
    directGenerationBudgetTokens: preferences?.direct_generation_budget_tokens || null,
    directReasoningEffort: preferences?.direct_reasoning_effort || "auto",
    musicLyricsUseBrief: preferences?.music_lyrics_use_brief !== false,
    fullscreen: preferences?.fullscreen === true,
    theme: preferences?.theme === "light" ? "light" : "dark",
    interfaceSize: INTERFACE_SIZES.includes(preferences?.interface_size) ? preferences.interface_size : "100",
    ollamaAddModelOpen: false,
    promptResidency: { direct: null, ollama: [] },
    activeRequestFamily: null,
    activeRequestModelId: null,
    activeRequestOllamaHost: null,
    requestBusy: false,
    comfyVramReleaseInFlight: false,
    vramHandoffInFlight: false,
    lyricsRequestBusy: false,
    toastTimer: null,
    statusTimer: null,
    lifecycleDotCount: 0,
    generationDotCount: 0,
    sessionId,
    assets: [],
    audioSupported: false,
    models: [],
    modelSetup: [],
    modelDirectory: "ComfyUI/models/LLM/",
    modelDiscovery: null,
    gpuMemory: null,
    selectedModel: null,
    externalServerConfig: loadExternalServerConfig(storage),
    externalModel: null,
    externalServerError: null,
    ollamaStatus: null,
    ollamaHost,
    ollamaModelName: loadOllamaModel(storage, ollamaHost),
    ollamaError: null,
    ollamaPollTimer: null,
    ollamaRefreshBusy: false,
    ollamaHostSettingsOpen: false,
    ollamaStorageHelpOpen: false,
    apiProviderConfig: loadApiProviderConfig(storage) || {
      preset: "gemini",
      base_url: "",
      model_id: "",
      gemini_reasoning_effort: "minimal",
      custom_images: false,
      custom_context_tokens: null,
    },
    apiProviderConnection: null,
    apiProviderModels: [],
    apiProviderPresets: [],
    apiProviderError: null,
    ggufRuntimeDiagnostics: null,
    ggufRuntimeDiagnosticsLoading: false,
    runtimeWarningShown: false,
    refineRestore: null,
    lyricsRestore: null,
    lastModelPrompt: null,
    lastModelMeta: null,
    guides: [],
    draggedAssetId: null,
    dragGhost: null,
    // Stored overrides are still honoured; they are simply no longer editable in
    // the interface, so nothing else reads or writes them.
    customSystemPrompts: loadCustomSystemPrompts(storage),
    modeDrafts: loadModeDrafts(storage),
  };
}
