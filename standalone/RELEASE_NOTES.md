# Prompt Studio Standalone v1.1.0

Standalone Windows version. ComfyUI is not required.

## Download

Download **Prompt-Studio-Standalone-Windows-v1.1.0.zip** from the release assets below.

Do not download **Source code (zip)** or **Source code (tar.gz)** for normal use.
Do not install this package into ComfyUI `custom_nodes`.

## What's new

- Fixed video trimming and cropping failing because NumPy was missing.
- Existing Windows environments now install missing dependencies on launch.

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
