# Prompt Studio Standalone for Windows

Use Prompt Studio without ComfyUI.

Current Standalone version: **1.2.1**

[Download Prompt Studio Standalone v1.2.1](../../../releases/download/standalone-v1.2.1/Prompt-Studio-Standalone-Windows-v1.2.1.zip)

## This is the Standalone version

[Sequence mode](../docs/USAGE.md#sequence) writes several standalone Official or Compact descriptive prompts from one brief. Set chunk durations, assign First, Last, or Reference media, then generate and refine each part.

You do not need ComfyUI. Do not install this ZIP into ComfyUI `custom_nodes`.

Looking for the ComfyUI extension? See
[Prompt Studio for ComfyUI](../README.md).

- ✓ Ollama
- ✓ API providers
- ✓ External llama.cpp
- ✓ Existing local GGUF models
- ✓ Vision GGUF projectors

No ComfyUI installation is required. Models, API keys, and `llama.cpp` binaries are
not bundled.

## Start

1. Extract the ZIP to a writable folder.
2. Double-click `start.bat`.
3. Open **Settings**, choose a provider, and select a model.

On first launch, Standalone creates a private `.venv` beside the application and
installs three small Python packages. Nothing is installed globally. Windows needs
Python 3.10 or newer, or `uv`, unless a future release includes portable Python.

The ZIP contains `data/settings.example.json`, not a live `settings.json`. Existing
runtime and model locations are therefore not replaced when a newer ZIP is extracted
over the same folder.

The Prompt Studio opens directly in a full-window browser view. Close the browser tab or
window normally.

### Optional: install as a browser app

This is optional. The normal way to use Prompt Studio is to run `start.bat` and work in
the browser tab it opens; no browser app installation is required.

In a Chromium-based browser that supports installing web apps, use the browser's
install option to open Prompt Studio in its own window and pin it to the taskbar.
This does not start the Python server: run `start.bat` first and keep its console
open while using Prompt Studio.

The installed app remembers the server address and port (normally
`http://127.0.0.1:8766/`). If that port is occupied, Standalone opens on another port;
the installed shortcut still points to the old address. Free the usual port and
restart Standalone, or use the new browser URL printed in the console.

### Linux

Standalone also runs on Linux using the same Python backend and browser-based interface.

**The Windows ZIP is a Windows package.** `start-linux.sh` is not inside it, so use a
repository checkout to run Standalone on Linux:

```bash
chmod +x start-linux.sh
./start-linux.sh
```

The launcher creates `.venv`, installs `requirements.txt`, and runs the same
`prompt_studio` entry point as `start.bat`. It reuses an existing `.venv` if present, so
repeat launches are fast. "Repository checkout" means a full clone, not the `.zip` build
artifact under `dist/`, which also omits this launcher.

For Local GGUF, point it to your Linux `llama-server` executable:

```bash
PS_LLAMA_SERVER="/path/to/llama-server" ./start-linux.sh
```

You can also provide model paths on first launch:

```bash
PS_MODEL_ROOT="/path/to/models" \
PS_MODEL="/path/to/model.gguf" \
PS_PROJECTOR="/path/to/mmproj.gguf" \
./start-linux.sh
```

Python 3.10 or newer is required. The Linux launcher has been tested on WSL2. Managed
Local GGUF is Windows-only, so on Linux use External llama.cpp or Ollama instead.

## What's new in v1.2.1

- Added the **Anima** text-to-image target, with content rating and prompt style options, character references, and per-region tag highlighting.
- Added **declared references** and **media-blind mode**, so a prompt can reference a picture that is not attached or keep attached media away from the prompt model.
- Settings is now tabbed, separating prompts and media handling.
- The Anima character catalogue is downloaded once by `start.bat` on the first launch.
- Fixed needing a hard refresh before new features appeared after an update.

See [Sequence usage](../docs/USAGE.md#sequence) for media scope, refinement, and limitations. Media Composer, Media Editor, themes, and provider settings remain available.

Open a media card to edit it. In Reference mode, use **Actions → Compose** to create
a collage from existing Pictures and video sheets. Editing does not overwrite your
original files.

The floating Media panel, Add to workflow, and Auto VRAM management are ComfyUI
features and are not included in Standalone. Model unload controls remain available
for supported providers.

## Providers

### Ollama

Choose an installed Ollama model. Existing local and remote-host behavior is provided
by Prompt Studio.

### API providers

Connect a supported provider in Settings. API keys stay in backend memory for the
current Prompt Studio session and are not saved by Standalone.

### External llama.cpp

Connect to a `llama-server` that you already started. Compatible routers let you
select and unload models from Prompt Studio. Context and KV cache remain server-managed.

### Local GGUF

Standalone can start and stop a user-supplied `llama-server` executable for existing GGUF
models:

1. Download the appropriate Windows archive from the official
   [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases).
2. Open **Settings → Local GGUF** and choose `llama-server.exe`.
3. Use **Add models…** to choose one model GGUF or scan a folder.
4. Select a model from the combined model list.
5. Review the matched vision projector, or choose one manually.

Use **Locations · N** to see remembered model folders, forget one, or forget all.
Forgetting a location never deletes files. Use the runtime card's **Manage** menu to
change or forget the `llama-server` executable.

Model and projector roles are read from GGUF metadata, not filenames. Unknown files
remain selectable as **Unverified**. If several projectors match, Standalone asks you
to choose; the actual `llama-server` load is the final compatibility check.

Standalone does not guess or download CUDA, CPU, or Vulkan builds. It starts at most
one managed server on `127.0.0.1`, reuses it while the configuration is unchanged,
and keeps native runtime failures outside the Prompt Studio process. `llama-cpp-python` is
not used for Local GGUF.

If a Local GGUF connection is interrupted, Technical details includes the server log
path and an exit code when available. Try generating again; a stopped server is
started automatically. You do not normally need to restart Windows.

## Notes

- The local Prompt Studio host binds only to `127.0.0.1`.
- Browser requests use the local host; provider calls are made by the Python backend.
- Local runtime paths and model locations are stored only in the extracted copy's
  `data/` folder.
- Qwen3.8 receives `reasoning_effort=low` and a 24K automatic context only when its
  embedded chat template explicitly supports that control.
- Local GGUF provides managed Context, KV cache, Generation budget, and supported
  reasoning effort controls. External llama.cpp remains server-managed.

## Development

The standalone layer is intentionally small. In this repository it imports the shared
`backend/`, `web/`, guides, and model metadata directly. A portable build vendors a
clean snapshot of those shared files. Standalone-specific behavior stays in adapter
files so normal core commits are immediately available to both hosts.

Host capabilities are declared in `prompt_studio/static/app.js`. Keep ComfyUI-only
actions behind these shared guards, and use Prompt Studio's theme and size tokens for
Standalone controls. CI tests both hosts. The build copies tracked source files only.

Optional development settings live in `data/settings.json`:

```json
{
  "upstream_repo": "C:\\path\\to\\prompt-studio",
  "model_roots": ["D:\\Models"],
  "port": 8766,
  "open_browser": true
}
```

Command-line overrides are also available:

```text
start.bat --upstream C:\path\to\prompt-studio --model-root D:\Models --port 9000 --no-browser
```

From the repository root, build the portable package with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build_standalone.ps1
```

The result is `dist\Prompt-Studio-Standalone-Windows-v1.2.1.zip`. It records the
repository commit in `upstream\UPSTREAM_SNAPSHOT.txt` and excludes local settings,
logs, models, `llama-server`, CUDA libraries, and test artifacts.

The package is Windows-named and Windows-first, but the Python backend is not
Windows-specific. The build copies tracked source files only, so a Linux user can run
Standalone from a checkout with `start-linux.sh`.
