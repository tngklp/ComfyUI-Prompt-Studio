import "/main.js";
import { boot } from "/scripts/app.js";
import { startHostLabels } from "/scripts/host_labels.js";
import { startManagedGGUF } from "/scripts/managed_gguf.js";

try {
  await boot();
  startHostLabels();
  startManagedGGUF();
  document.documentElement.dataset.psStandaloneShell = "ready";
  document.title = "Prompt Studio";
  document.querySelector("[data-host-status]")?.replaceChildren("Prompt Studio is ready.");
} catch (error) {
  document.querySelector("[data-host-status]")?.replaceChildren(
    `Startup failed: ${error?.message || error}`,
  );
  throw error;
}
