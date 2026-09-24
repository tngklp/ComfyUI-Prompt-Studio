import { newSequence, newChunk } from "./sequence_state.js";
import { selectableModes } from "./target_registry.js";

const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"];
function text(value, max = 8000) {
  if (typeof value !== "string" || value.length > max) throw Error("Invalid or oversized draft text.");
  return value;
}
function seconds(value, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw Error("Invalid draft duration.");
  return value;
}

// Portable text only. Never restore session IDs, paths, credentials or asset bindings.
export function normalizeDraft(value) {
  if (value?.format === undefined || value.format !== "prompt-studio-draft" || value.version !== 1) throw Error("Choose a supported Prompt Studio draft JSON file.");
  const modes = selectableModes().map(mode => mode.id);
  const d = value.content;
  if (!d || !RATIOS.includes(d.aspectRatio)) throw Error("Invalid draft settings.");
  let content;
  if (value.kind === "sequence") {
    if (!Array.isArray(d.chunks) || !d.chunks.length || d.chunks.length > 100) throw Error("A draft must contain 1-100 chunks.");
    if (!["official", "compact"].includes(d.outputFormat)) throw Error("Invalid Sequence output format.");
    content = { ...newSequence(), brief: text(d.brief, Infinity), instructions: text(d.instructions, 32000),
      aspectRatio: d.aspectRatio, defaultDuration: seconds(d.defaultDuration, 15), outputFormat: d.outputFormat,
      chunks: d.chunks.map(c => ({ ...newChunk(seconds(c.duration, 15)), instruction: text(c.instruction), prompt: text(c.prompt, 100000),
        ...(c.attention ? {attention:text(c.attention)} : {}) })),
      copyFormat: { format: d.copyFormat?.format === "custom" ? "custom" : "prompts",
        template: text(d.copyFormat?.template ?? "{prompt}"), separator: text(d.copyFormat?.separator ?? "\n\n", 2000) } };
  } else if (value.kind === "single" && modes.includes(d.mode)) {
    content = { mode:d.mode, aspectRatio:d.aspectRatio, duration:seconds(d.duration,20),
      brief:text(d.brief, Infinity), prompt:text(d.prompt,100000), instructions:d.instructions === null ? null : text(d.instructions, 32000) };
  } else throw Error("Unsupported draft type.");
  const media = Array.isArray(value.media) ? value.media.slice(0,100).map(n => text(n,2000)) : [];
  return { format:"prompt-studio-draft", version:1, kind:value.kind, content, media };
}

export function parseDraft(source) {
  if (source.length > 2_000_000) throw Error("Draft file is too large (maximum 2 MB).");
  let value;
  try { value = JSON.parse(source); } catch { throw Error("The draft is not valid JSON."); }
  return normalizeDraft(value);
}

export function draftFile(kind, content, media = []) {
  const value = normalizeDraft({format:"prompt-studio-draft", version:1, kind, content, media});
  if (new Blob([JSON.stringify(value,null,2)]).size > 2_000_000) throw Error("Draft file is too large (maximum 2 MB).");
  return value;
}

export function draftFilename(kind, now = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map(pad).join("-");
  return `prompt-studio-${kind === "sequence" ? "sequence" : "single"}-${date}_${time}.json`;
}
