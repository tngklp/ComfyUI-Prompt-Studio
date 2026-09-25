# Standalone changelog

## 1.2.0 - 2026-09-25

- Added the **Anima** text-to-image target, with content rating and prompt style options, character references, and per-region tag highlighting.
- Added **declared references**, so a prompt can reference a picture that is not attached, and **media-blind mode**, which keeps attached media out of the prompt model.
- Settings is now tabbed: prompts and media handling.
- The Anima character catalogue is downloaded once by `start.bat` on the first launch and cached locally, instead of shipping a sample inside the package.
- Fixed needing a hard refresh before new features appeared after an update: assets now revalidate and the interface reloads itself once when it is older than the backend.
- Open Prompt Studio as an installed browser app with its own window and taskbar icon. Run `start.bat` first; the installed app needs the local server running at the same address.
- Save and load text drafts for Single and Sequence from **Actions**.
- Extract and download audio from a selected video interval.
- Set a manual generation budget for Ollama; Direct keeps its own separate budget.
- Keep Single Reference labels in sync after deleting or reordering media.
- Write longer Creative Briefs without a character limit or scroll jumps.
- Choose a vision projector manually when several compatible ones share a model folder.
- Requires Prompt Studio core `1.1.0`.

## 1.1.0 - 2026-09-24

- Rebranded to **Prompt Studio**. The package, launch scripts, environment variables, and interface now use the Prompt Studio name.
- Added generation-target support: video, music, and image prompts from one workspace, driven by `targets.json`.
- Environment variables renamed from `H3_*` to `PS_*`. Existing launchers and scripts must be updated.
- The upstream checkout is now expected in a folder named `prompt-studio`.
- Requires Prompt Studio core `1.0.0`.
- Fixed the Windows ZIP shipping without generation targets: the build kept a private copy list that drifted from the project, so the packaged app refused to start with `REGISTRY_MISSING`. The list now comes from `standalone/package.manifest.json`, and the build fails loudly if a required file is missing instead of producing a ZIP that cannot run.

## 0.1.7 - 2026-09-11

- Fixed video trimming and cropping failing because NumPy was missing.
- Existing Windows environments now install missing dependencies on launch.

## 0.1.6 - 2026-09-10

- Fixed a Local GGUF crash when processing large images with vision models.
- Added server log details when a Local GGUF connection is interrupted.

## 0.1.5 - 2026-09-09

- Added **Sequence mode**: write a series of timed clips from one brief, keep action and references consistent, and edit each prompt separately.
- Added **Compact mode** for Sequence.
- Improved draft saving, model switching, generation reliability and video playback. Added text-only Music 3 and a Linux launcher for source installs.
- Updated the shared Prompt Studio core to `0.4.6`.

## 0.1.4 - 2026-09-06

- Updated to the shared Prompt Studio `0.4.5` interface and core.
- Added Media Composer for collages and Media Editor for crop and trim.
- Added Light theme and adjustable Interface Size.
- Added model selection and unload controls for compatible external llama.cpp routers.
- Kept ComfyUI-only workflow and memory controls out of Standalone.

## 0.1.3 - 2026-09-02

- Updated the shared Prompt Studio interface and core to Prompt Studio extension `0.4.4`.
- Added a compact Clear menu for clearing prompts while keeping media, or clearing the entire workspace.
- Added custom 2–16 frame contact sheets with more readable frame labels.
- Improved safe remote Ollama host editing and private-network hostname handling.

## 0.1.2 - 2026-08-30

- Fixed Local GGUF generation failing before the model could respond.
- Restored Thinking controls for Local GGUF models whose templates support them.

## 0.1.1 - 2026-08-29

- Updated the shared Prompt Studio interface and core to Prompt Studio extension `0.4.3`.
- Added Local GGUF Custom Context, KV cache, Generation budget, and supported reasoning effort controls.
- Improved metadata-based model and projector detection for renamed GGUF files.
- Increased the video Creative Brief limit to 8,000 characters.
- Kept External llama.cpp reasoning settings under server control.
- Fixed Local GGUF generation-budget handling.

## 0.1.0 - 2026-08-27

- First Windows Standalone release candidate.
- Reuses the shared Prompt Studio core without requiring ComfyUI.
- Supports Ollama, API providers, External llama.cpp, and existing local GGUF models.
- Manages a user-selected `llama-server.exe` outside the Python process.
- Supports GGUF vision projectors, combined model locations, and metadata-based pairing.
- Based on Prompt Studio extension `0.4.2`.
