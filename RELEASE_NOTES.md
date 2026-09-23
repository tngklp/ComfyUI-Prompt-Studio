# Prompt Studio for ComfyUI v1.0.0

ComfyUI extension release. Install through ComfyUI Manager or extract the ZIP into
`custom_nodes`.

## Download

Download **Prompt-Studio-ComfyUI-v1.0.0.zip** from the release assets below.

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

- First stable release of **Prompt Studio**, rebranded from the H3-era extension.
- Multi-target support: video, image, and audio prompts from one workspace, driven by
  `targets.json`.
- MiniMax H3 video modes, Qwen Image 2.1 text-to-image and editing, Krea 2, and
  MiniMax Music 3 captions and lyrics.
- Sequence workspace with Official and Compact output, internal planning, format
  recovery, and per-chunk refinement.
- Media Composer for collages, Media Editor for crop and trim, and a Floating Media
  panel that drags media into ComfyUI workflows.
- Ollama, Direct GGUF, External llama.cpp, and API providers.

## Requirements

- ComfyUI
- Python 3.10 or newer
- At least one configured provider

Models, API keys, and `llama.cpp` binaries are not bundled.

Looking for the version that runs without ComfyUI? See the
[Standalone guide](standalone/README.md).
