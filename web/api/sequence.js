import { api } from "/scripts/api.js";
import { readApiResponse } from "./response.js";

export async function readSequenceStream(response, onEvent) {
  if (!response.ok) return readApiResponse(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", done = false;
  try {
    while (true) {
      const part = await reader.read();
      buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "error") throw Object.assign(new Error(event.message), { code: event.code, details: event.details });
        if (event.type === "done") done = true;
        onEvent(event);
      }
      if (part.done) break;
    }
    if (!done || buffer.trim()) throw new Error("Sequence connection ended before completion. Completed prompts were kept.");
  } finally { reader.releaseLock(); }
}

export async function generateSequence(payload, onEvent) {
  const response = await api.fetchApi("/promptstudio/sequence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return readSequenceStream(response, onEvent);
}

export async function cancelSequence(operationId, sessionId) {
  return readApiResponse(await api.fetchApi("/promptstudio/sequence/cancel", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({operation_id:operationId,session_id:sessionId}),
  }));
}
