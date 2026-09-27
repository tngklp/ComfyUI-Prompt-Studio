# Prompt Studio Standalone v1.2.6

Standalone Windows version. ComfyUI is not required.

## Download

Download **Prompt-Studio-Standalone-Windows-v1.2.6.zip** from the release assets below.

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

## What's new

- **Anima's quality tags are now `masterpiece, best quality, highres, score_9`.**
  Previously `masterpiece, best quality, score_7`. This applies to the system prompt and
  the starter prompt in the Anima workspace.
- **Anima no longer assumes every character is a girl.** Selecting one female and one
  male character wrote `2girls`. The subject count tag is now stated explicitly and
  derived from each character's own gender, so a mixed pair is `1girl, 1boy`.
- Requires Prompt Studio core `1.1.6`.

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
