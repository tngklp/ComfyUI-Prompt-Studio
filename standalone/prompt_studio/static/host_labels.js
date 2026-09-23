function replaceStandaloneText(element) {
  if (!element || element.childElementCount) return;
  const text = element.textContent || "";
  const next = text
    .replaceAll("Models installed in ComfyUI", "Models available to Standalone")
    .replaceAll("ComfyUI Python environment", "Standalone Python environment")
    .replaceAll("ComfyUI/models/LLM/", "models/ (or a configured --model-root)")
    .replaceAll("Close ComfyUI", "Stop Prompt Studio")
    .replaceAll("your ComfyUI Portable folder containing python_embeded", "this package's local Python environment")
    .replaceAll("restart ComfyUI", "restart Prompt Studio")
    .replaceAll("llama-cpp-python", "llama.cpp");
  if (next !== text) element.textContent = next;
}

function applyHostLabels() {
  const directOption = document.querySelector('[data-provider-option="direct"] small');
  if (directOption && directOption.textContent !== "Existing files via llama-server") {
    directOption.textContent = "Existing files via llama-server";
  }

  const directPanel = document.querySelector('[data-provider-panel="direct"]');
  directPanel?.querySelectorAll("small, p, em, strong, code").forEach(replaceStandaloneText);
}

export function startHostLabels() {
  applyHostLabels();
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      applyHostLabels();
    }, 0);
  }).observe(document.body, { childList: true, subtree: true });
}
