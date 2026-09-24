# Prompt Studio Standalone v1.1.0

Standalone Windows version. ComfyUI is not required.

## Download

Download **Prompt-Studio-Standalone-Windows-v1.1.0.zip** from the release assets below.

Do not download **Source code (zip)** or **Source code (tar.gz)** for normal use.
Do not install this package into ComfyUI `custom_nodes`.

## What's new

- Rebranded to **Prompt Studio**. The package, launch scripts, environment variables, and
  interface now use the Prompt Studio name. Environment variables renamed from `H3_*` to
  `PS_*`, and the upstream checkout is now expected in a folder named `prompt-studio`.
- Added generation-target support: video, music, and image prompts from one workspace,
  driven by `targets.json`.
- Added Qwen Image 2.1 text-to-image and image-edit prompts, plus Krea 2 and MiniMax
  Music 3 caption and lyrics writing.
- Fixed the Windows ZIP shipping without the generation-target registry. The release
  build no longer keeps a private copy list that can drift from the project, so the
  package starts correctly instead of failing with `REGISTRY_MISSING`.
- Requires Prompt Studio core `1.0.0`.

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
