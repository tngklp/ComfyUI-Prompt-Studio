/** Minimal extension registry compatible with the upstream frontend. */
const extensions = [];

export const app = {
  psHost: { windowed: false, comfyMemory: false, workflowMedia: false },
  registerExtension(extension) {
    extensions.push(extension);
  },
};

export async function boot() {
  for (const extension of extensions) {
    await extension.setup?.();
  }

  const openCommand = extensions
    .flatMap((extension) => extension.commands || [])
    .find((command) => command.id === "prompt-studio.open");
  if (typeof openCommand?.function !== "function") {
    throw new Error("The upstream Prompt Studio open command was not registered.");
  }

  await openCommand.function();
  document.documentElement.dataset.psStandaloneReady = "true";
}
