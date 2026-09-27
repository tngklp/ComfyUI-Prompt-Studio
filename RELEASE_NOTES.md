# Prompt Studio for ComfyUI v1.1.3

ComfyUI extension release. Install through ComfyUI Manager or extract the ZIP into
`custom_nodes`.

## Download

Download **Prompt-Studio-ComfyUI-v1.1.3.zip** from the release assets below.

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

- **Fixed refining a prompt for an image target.** Refine failed for Anima, Qwen Image 2.1
  and Krea 2 with `INVALID_DURATION: The selected mode does not accept a duration.`
  Generation and refinement both validated a video-only duration for every target, so the
  three image targets - which have no duration at all - were rejected before the request
  reached their guide. Duration is now validated only for the targets that declare one.
- The duration line is omitted from an image request instead of being written as
  `None seconds`, so the prompt model no longer reads an absent field as a constraint.
- An image target that is sent a duration anyway is still rejected with a clear error,
  rather than silently ignoring a field that does not apply to it.

## Requirements

- ComfyUI
- Python 3.10 or newer
- At least one configured provider

Models, API keys, and `llama.cpp` binaries are not bundled.

Looking for the version that runs without ComfyUI? See the
[Standalone guide](standalone/README.md).
