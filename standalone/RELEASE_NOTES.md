# Prompt Studio Standalone v1.2.0

Standalone Windows version. ComfyUI is not required.

## Download

Download **Prompt-Studio-Standalone-Windows-v1.2.0.zip** from the release assets below.

Do not download **Source code (zip)** or **Source code (tar.gz)** for normal use.
Do not install this package into ComfyUI `custom_nodes`.

## What's new

- Added the **Anima** text-to-image target, with the guide's own content rating and
  prompt style options.
- Added **character references**: type `miku` and it becomes `hatsune miku, vocaloid` in
  the right position of the tag list. Multi-select, and the selection shows as bubbles.
- Added **per-region tag highlighting**, so the five regions of an Anima tag list are
  colour-coded and a mis-ordered prompt is visible at a glance.
- Added **declared references** (**Plan a picture**), so you can write a prompt for a
  picture that is not attached, and **media-blind mode**, which keeps attached media out
  of the prompt model.
- Settings is now tabbed, separating prompts and media handling.
- The Anima character catalogue is downloaded once by `start.bat` on the first launch.
- Fixed needing a hard refresh before new features appeared after an update: assets now
  revalidate and the interface reloads itself once when it is older than the backend.
- Added text drafts, a manual Ollama generation budget, an explicit vision projector, and
  no Creative Brief character limit.
- Requires Prompt Studio core `1.1.0`.

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
