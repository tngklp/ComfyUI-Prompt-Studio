# Prompt Studio Standalone v1.2.3

Standalone Windows version. ComfyUI is not required.

## Download

Download **Prompt-Studio-Standalone-Windows-v1.2.3.zip** from the release assets below.

Do not download **Source code (zip)** or **Source code (tar.gz)** for normal use.
Do not install this package into ComfyUI `custom_nodes`.

## What's new

- **Fixed refining a prompt for an image target.** Refine failed for Anima, Qwen Image 2.1
  and Krea 2 with `INVALID_DURATION: The selected mode does not accept a duration.`
  Duration was validated for every target, so the three image targets - which have no
  duration at all - were rejected before the request reached their guide.
- The duration line is omitted from an image request instead of being written as
  `None seconds`, so the prompt model no longer reads an absent field as a constraint.
- Requires Prompt Studio core `1.1.3`.

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
