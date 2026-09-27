# Prompt Studio for ComfyUI v1.1.5

ComfyUI extension release. Install through ComfyUI Manager or extract the ZIP into
`custom_nodes`.

## Download

Download **Prompt-Studio-ComfyUI-v1.1.5.zip** from the release assets below.

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

- **Fixed "Generate prompt" for every image target.** Qwen Image 2.1 (T2I and Edit),
  Krea 2 and Anima returned `INVALID_DURATION: The selected mode does not accept a
  duration.` Generating and refining a video prompt were never affected.
- Image targets now ignore the duration value the studio sends with every request, since
  they have no duration of their own. Previously the request was rejected for carrying a
  field it could not use.
- Only 1.1.5 changed how this works. 1.1.3 broke Refine and 1.1.4 broke Generate; if you
  are on either, update to 1.1.5.

## Requirements

- ComfyUI
- Python 3.10 or newer
- At least one configured provider

Models, API keys, and `llama.cpp` binaries are not bundled.

Looking for the version that runs without ComfyUI? See the
[Standalone guide](standalone/README.md).
