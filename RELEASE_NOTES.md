# Prompt Studio for ComfyUI v1.1.4

ComfyUI extension release. Install through ComfyUI Manager or extract the ZIP into
`custom_nodes`.

## Download

Download **Prompt-Studio-ComfyUI-v1.1.4.zip** from the release assets below.

Do not download **Source code (zip)** or **Source code (tar.gz)** for normal use.

## Install

1. Extract the ZIP so that the folder `ComfyUI-Prompt-Studio` sits inside
   `ComfyUI/custom_nodes`.
2. Restart ComfyUI.
3. Open the floating **Prompt Studio** button, or use **Extensions > Prompt Studio**.
4. Open **Settings** and choose a provider.

ComfyUI Manager is the simpler path and handles updates. Use the ZIP only for a manual
install.

## What's new

- **Fixed generating a prompt for an image target.** The previous release fixed Refine for
  Anima, Qwen Image 2.1 and Krea 2 but left the matching check on the generate endpoint, so
  Generate failed with `INVALID_REQUEST: Required fields are missing (duration_seconds)`.
  Duration is now a target capability everywhere it is checked: required only for the
  targets that declare one, and never read as if it always exists.
- Image prompts no longer carry a `Duration:` line at all, instead of the literal
  `None seconds` that could be read as a constraint.

## Requirements

- ComfyUI
- Python 3.10 or newer
- At least one configured provider

Models, API keys, and `llama.cpp` binaries are not bundled.

Looking for the version that runs without ComfyUI? See the
[Standalone guide](standalone/README.md).
