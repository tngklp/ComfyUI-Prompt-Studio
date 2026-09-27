# Prompt Studio Standalone v1.2.4

Standalone Windows version. ComfyUI is not required.

## Download

Download **Prompt-Studio-Standalone-Windows-v1.2.4.zip** from the release assets below.

Do not download **Source code (zip)** or **Source code (tar.gz)** for normal use.
Do not install this package into ComfyUI `custom_nodes`.

## Updating

Run **`update.bat`** in the install folder. It downloads the latest release, replaces the
application files, and keeps your `data\`, `models\`, `.venv\` and any `llama-server` or
CUDA files you added. Run `start.bat` when it finishes. Your previous version is backed up
to a temp folder, so a bad update can be undone.

From 1.2.5 onward `update.bat` is included in the package. **This release is the last one
that has to be updated by extracting the ZIP by hand**, because the running copy of
`update.bat` is the one the updater replaces.

## What's new

- **Fixed generating a prompt for an image target.** Generate failed for Anima, Qwen Image
  2.1 and Krea 2 with `INVALID_REQUEST: Required fields are missing (duration_seconds)`.
  The 1.2.3 release fixed Refine for those targets but left the matching check on the
  generate path. Duration is now required only for the targets that declare one.
- Image prompts no longer carry a `Duration:` line, instead of the literal `None seconds`.
- **`update.bat` for one-step updates.** Run it in the install folder to move to the latest
  release without re-downloading or re-extracting anything by hand.
- Requires Prompt Studio core `1.1.4`.

ComfyUI-only controls, including Auto VRAM management and Add to workflow, are not
shown in Standalone.

## Features

- Ollama
- API providers
- External llama.cpp
- Existing local GGUF models through a user-selected `llama-server.exe`
- Vision GGUF projectors with metadata-based matching
- Combined and removable model locations
- Local GGUF Context, KV cache, Generation budget, and supported reasoning effort controls
- Video Creative Briefs up to 8,000 characters

External llama.cpp keeps its own reasoning and chat-template settings. Prompt Studio separates returned reasoning from the final prompt without overriding the server.

No ComfyUI installation is required. Models, API keys, llama.cpp binaries, and CUDA
libraries are not bundled.

## Requirements

- Windows 10 or 11, x64
- Python 3.10 or newer, or `uv`
- At least one configured provider

Based on Prompt Studio extension `0.4.6`.
