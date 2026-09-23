export const SEQUENCE_STORAGE_KEY = "ps-sequence-v1";
export const DEFAULT_SEQUENCE_INSTRUCTIONS = `Write only this target clip as a complete standalone MiniMax H3 prompt using the supplied official guide. Keep its required sections, local 0-to-duration timing, and request-local shot numbering starting at [Shot 1] without an opening cut timestamp. Sequence intervals are context, never output labels.
The brief and explicit instructions govern intent. Use current effective media for visual evidence and reference roles, and actual accepted neighbors for continuity. Continue the preceding ending without replaying completed events; approach a following accepted opening. Re-establish the scene and subjects so this prompt works independently. Only current media labels exist in this request. First and Last constrain only their assigned boundary; an appearance reference supplies the requested traits, not a new setting.
Use the temporal plan to allocate the requested development, including speech, atmosphere, sustained activity or physical change. Preserve explicit event timing. A boundary does not require a pause, cut, new action or conclusion. Reach a requested endpoint at its assigned time; without one, leave a natural continuing state. Keep short actions naturally paced instead of stretching them over intervals.
Add modest, concrete natural behavior and transitions within the brief, not new story, people, consequential props, locations or motivations. Honor requested cuts, camera behavior and style; otherwise preserve the viewpoint and style without inventing camera moves. Avoid repetitive filler.
Chunk Direction governs this interval. For refinement, apply the requested change to the current prompt while considering the accepted neighbors. Return only the full final H3 prompt, without commentary, planning or JSON.`;

export const COMPACT_SEQUENCE_INSTRUCTIONS = `Write this interval as a complete standalone descriptive video prompt in natural language. Keep concrete scene context, useful request-local media labels and local timing where needed.
The brief and explicit directions govern intent. Current media and the visible neighboring prompts supply scene evidence. First and Last constrain only their assigned boundary. An appearance reference supplies requested traits, not a new setting. Continue the preceding ending without replaying completed actions and approach any following opening.
Use the temporal plan to allocate development, speech, atmosphere and sustained activity. Preserve explicit timing and dialogue. Boundaries do not require pauses, cuts or new actions. Reach a requested endpoint at its assigned time; otherwise allow a natural continuing state.
Add modest natural behavior, not new story, people, consequential props, locations or motivations. Honor requested camera and style; otherwise invent no camera moves or cuts. Chunk Direction governs this interval. For Refine, apply the requested change to the current visible prompt. End with overall_soundscape: and a short description of scene-grounded audible sounds, then non_diegetic_music: and N/A unless music is requested. Describe requested music briefly; honor explicit no-music requests. Keep sounds modest and natural. Return only the final prompt.`;
export const sequenceInstructionDefault = format => format === "compact" ? COMPACT_SEQUENCE_INSTRUCTIONS : DEFAULT_SEQUENCE_INSTRUCTIONS;
export function setSequenceFormat(state, format) {
  if (!["official", "compact"].includes(format)) return;
  const untouched = [DEFAULT_SEQUENCE_INSTRUCTIONS, COMPACT_SEQUENCE_INSTRUCTIONS].includes(state.instructions);
  state.outputFormat = format;
  if (untouched) state.instructions = sequenceInstructionDefault(format);
}

const PREVIOUS_SEQUENCE_INSTRUCTIONS = `Write only the requested target clip as a complete MiniMax H3 prompt in the supplied official guide's format. Keep all required sections. Sequence metadata is planning context, never output prose: target time starts at zero and ends at the local duration. Translate an absolute event time by subtracting this clip's global start; events outside its interval belong elsewhere. Shot numbering restarts at [Shot 1] in every target clip, with no timestamp on its first shot.
By default this is one continuous scene. A chunk boundary is not a cut or a new setup. Honor the user's requested cuts, camera behavior and style; otherwise preserve the existing viewpoint and visual style without inventing camera moves. Continue the predecessor's terminal physical state and ongoing motion; do not replay its approach or completed actions. Restate only the concrete scene and subject information needed to make the target clip usable independently. Predecessor media labels belong to its request, not this one: use only the current effective conditioning and its labels.
Read the whole brief and horizon. Advance a plausible portion of the main action for this interval, leaving meaningful action for the remaining clips. Reserve the brief's terminal action and final pose for the final clip unless the user explicitly places them earlier; middle clips must develop the action rather than finish it and idle. A first frame constrains only the start where supplied; a last frame constrains only the end where supplied. Appearance references provide the requested traits, not a new setting or costume.
Expand behavior, not story: make the requested action physically specific with modest natural spontaneity and believable transitions. Do not invent people, consequential props, locations, motivations, major emotional events or a new camera/style concept. Avoid repetitive filler and decorative restatement; use the shortest clear prompt that still preserves the official structure, motion, scene, reference relationships and timing.
The current Chunk Direction governs this interval. For refinement apply the requested change to the current prompt, considering the supplied neighbors. Return only the complete final H3 prompt, without commentary, planning, JSON or instructions to another writer.`;

// Migrate only the untouched prototype default; preserve every user-authored instruction.
export const LEGACY_SEQUENCE_INSTRUCTIONS = `Write consecutive parts of one MiniMax H3 video sequence. Chunk boundaries are technical generation boundaries, not shot cuts. Read the whole Creative Brief and outline, including absolute time ranges, but write only the requested chunk as a complete, self-contained H3 prompt using the official guide supplied with the request.
Continue naturally from the previous prompt: preserve subjects, environment, lighting, camera trajectory and ongoing motion unless the user requests a change. Reintroduce the necessary context so each prompt can be used independently. Respect events at absolute sequence times and leave room for events belonging to later chunks instead of completing the entire brief in the opening chunk.
The current chunk's instruction takes priority for that interval. Explicit user requests for cuts or other changes are ordinary creative instructions. For refinement, apply the requested change to the current prompt while considering the supplied neighbors; output only the complete revised prompt. Return plain prompt text, without commentary, JSON, or an intermediate plan.`;

export const MAX_CHUNK_DURATION = 15;
export const duration = (value) => Math.max(1, Math.min(MAX_CHUNK_DURATION, Math.round(Number(value) || 10)));
export function newChunk(seconds = 10) {
  return { id: globalThis.crypto.randomUUID(), duration: duration(seconds), instruction: "", prompt: "", additions: [], exclusions: [], undo: [], redo: [] };
}
export const INITIAL_SEQUENCE_BRIEF = `An animated character sings while moving naturally through a simple scene.
Around 6 seconds, the character starts a small dance and keeps singing through the end.`;
export function newSequence() {
  return { version: 1, outputFormat: "official", brief: INITIAL_SEQUENCE_BRIEF, instructions: DEFAULT_SEQUENCE_INSTRUCTIONS, defaultDuration: 10, aspectRatio: "16:9", first: null, last: null, references: [], chunks: [newChunk()], copyFormat: { format: "prompts", template: "{prompt}", separator: "\n\n" } };
}
export function timeline(state) {
  let start = 0;
  return state.chunks.map((chunk, index) => {
    const end = start + chunk.duration;
    const item = { ...chunk, index: index + 1, start, end };
    start = end;
    return item;
  });
}
export function addChunk(state) { state.chunks.push(newChunk(state.defaultDuration)); }
export function deleteChunk(state, id) {
  if (state.chunks.length > 1) state.chunks = state.chunks.filter(c => c.id !== id);
}
export function effectiveMedia(state, id, assets) {
  const index = state.chunks.findIndex(c => c.id === id);
  const chunk = state.chunks[index];
  if (!chunk) return [];
  const selected = [...new Set([...state.references.filter(a => !chunk.exclusions.includes(a)), ...chunk.additions])];
  const items = selected.map(assetId => ({ assetId, role: "Reference" }));
  if (index === 0 && state.first) items.unshift({ assetId: state.first, role: "First frame" });
  if (index === state.chunks.length - 1 && state.last) items.push({ assetId: state.last, role: "Last frame" });
  const counters = { image: 0, video: 0, audio: 0 };
  return items.map(item => {
    const asset = assets.find(a => a.id === item.assetId);
    const type = asset?.type || "image";
    const tag = `<${{image:"Picture",video:"Video",audio:"Audio"}[type]} ${++counters[type]}>`;
    return { ...item, asset, tag };
  });
}
// Export metadata belongs here, never in stored prompts or inference inputs.
export function aggregate(state, { format = "prompts", template = "{prompt}", separator = "\n\n" } = state.copyFormat || {}) {
  return timeline(state).filter(c => c.prompt.trim()).map(c => {
    if (format === "custom") return template.replace(/\{(prompt|index|start|end|duration)\}/g, (_, key) => String(c[key]));
    if (format === "headings") return `Chunk ${c.index} · ${c.start}–${c.end}s\n${c.prompt}`;
    return c.prompt;
  }).join(format === "custom" ? separator : "\n\n");
}
export function replacePrompt(chunk, prompt) {
  (chunk.undo ||= []).push(chunk.prompt);
  chunk.redo = [];
  chunk.prompt = prompt;
  delete chunk.attention;
}
export function revisePrompt(chunk, direction) {
  const source = chunk[direction];
  if (!source?.length) return;
  (chunk[direction === "undo" ? "redo" : "undo"] ||= []).push(chunk.prompt);
  chunk.prompt = source.pop();
  delete chunk.attention;
}
export function removeReference(state, chunk, id) {
  chunk.additions = chunk.additions.filter(x => x !== id);
  if (state.references.includes(id)) chunk.exclusions = [...new Set([...chunk.exclusions, id])];
}
export function assignReference(state, chunk, id, previous = null) {
  if (previous && previous !== id) removeReference(state, chunk, previous);
  chunk.exclusions = chunk.exclusions.filter(x => x !== id);
  if (!state.references.includes(id)) chunk.additions = [...new Set([...chunk.additions, id])];
}
export function reconcileMedia(state, assets) {
  const available = new Set(assets.map(a => a.id));
  const before = JSON.stringify([state.first, state.last, state.references, state.chunks.map(c => [c.additions,c.exclusions])]);
  for (const key of ["first", "last"]) if (!available.has(state[key])) state[key] = null;
  state.references = state.references.filter(id => available.has(id));
  for (const c of state.chunks) for (const key of ["additions", "exclusions"]) c[key] = c[key].filter(id => available.has(id));
  return before !== JSON.stringify([state.first, state.last, state.references, state.chunks.map(c => [c.additions,c.exclusions])]);
}
export function sequenceInputs(state) {
  const {version, brief, instructions, defaultDuration, aspectRatio, first, last, references, outputFormat} = state;
  return {version, brief, instructions, defaultDuration, aspectRatio, first, last, references, outputFormat:outputFormat || "official",
    chunks: state.chunks.map(({id,duration,instruction,prompt,additions,exclusions,attention}) => ({id,duration,instruction,prompt,additions,exclusions,...(attention ? {attention} : {})}))};
}
export function saveSequence(storage, state) { storage?.setItem(SEQUENCE_STORAGE_KEY, JSON.stringify(state)); }
export function loadSequence(storage) {
  const fallback = newSequence();
  try {
    const value = JSON.parse(storage?.getItem(SEQUENCE_STORAGE_KEY) || "null");
    if (value?.version !== 1 || !Array.isArray(value.chunks) || !value.chunks.length) return fallback;
    const ids = new Set();
    const strings = a => Array.isArray(a) ? [...new Set(a.filter(x => typeof x === "string"))] : [];
    return { ...fallback, outputFormat:value.outputFormat === "compact" ? "compact" : "official", brief: typeof value.brief === "string" ? value.brief.slice(0,8000) : "",
      instructions: typeof value.instructions === "string" && ![LEGACY_SEQUENCE_INSTRUCTIONS, PREVIOUS_SEQUENCE_INSTRUCTIONS].includes(value.instructions) ? value.instructions : sequenceInstructionDefault(value.outputFormat),
      defaultDuration: duration(value.defaultDuration),
      aspectRatio: ["1:1","2:3","3:2","3:4","4:3","9:16","16:9","21:9"].includes(value.aspectRatio) ? value.aspectRatio : fallback.aspectRatio,
      first: typeof value.first === "string" ? value.first : null, last: typeof value.last === "string" ? value.last : null,
      references: strings(value.references),
      copyFormat: { format: value.copyFormat?.format === "custom" ? "custom" : "prompts",
        template: typeof value.copyFormat?.template === "string" ? value.copyFormat.template.slice(0,8000) : "{prompt}",
        separator: typeof value.copyFormat?.separator === "string" ? value.copyFormat.separator.slice(0,2000) : "\n\n" },
      chunks: value.chunks.map(c => {
        const id = typeof c.id === "string" && !ids.has(c.id) ? c.id : newChunk().id; ids.add(id);
        return { ...newChunk(), ...(typeof c.attention === "string" && c.attention ? {attention:c.attention.slice(0,8000)} : {}), id, duration: duration(c.duration), instruction: typeof c.instruction === "string" ? c.instruction : "", prompt: typeof c.prompt === "string" ? c.prompt : "", additions: strings(c.additions), exclusions: strings(c.exclusions), undo: Array.isArray(c.undo) ? c.undo.filter(x => typeof x === "string") : [], redo: Array.isArray(c.redo) ? c.redo.filter(x => typeof x === "string") : [] };
      }) };
  } catch { return fallback; }
}
