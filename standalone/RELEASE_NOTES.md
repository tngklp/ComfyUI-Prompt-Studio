# Prompt Studio Standalone v1.2.5

Standalone Windows version. ComfyUI is not required.

## Download

Download **Prompt-Studio-Standalone-Windows-v1.2.5.zip** from the release assets below.

Do not download **Source code (zip)** or **Source code (tar.gz)** for normal use.
Do not install this package into ComfyUI `custom_nodes`.

## Updating

Run **`update.bat`** in the install folder:

```bat
update.bat
```

It downloads the latest release, replaces the application files, and keeps your `data\`,
`models\`, `.venv\` and any `llama-server` or CUDA files you added. Your previous version
is backed up to a temp folder, so a bad update can be undone. Run `start.bat` afterwards.

This is the first release you can update with `update.bat` alone. Updating **to** 1.2.5
from 1.2.4 still needs that one manual ZIP extract, because the copy of `update.bat`
being replaced is the one doing the replacing.

## What's new

- **Fixed "Generate prompt" for every image target.** Qwen Image 2.1 (T2I and Edit),
  Krea 2 and Anima returned `INVALID_DURATION: The selected mode does not accept a
  duration.` Video and music prompts were never affected.
- Image targets now ignore the duration value the studio sends with every request, instead
  of rejecting the request for carrying a field it cannot use.
- Requires Prompt Studio core `1.1.5`.

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
