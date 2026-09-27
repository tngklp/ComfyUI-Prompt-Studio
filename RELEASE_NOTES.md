# Prompt Studio for ComfyUI v1.1.7

ComfyUI extension release. Install through ComfyUI Manager or extract the ZIP into
`custom_nodes`.

## Download

Download **Prompt-Studio-ComfyUI-v1.1.7.zip** from the release assets below.

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

- **Direct GGUF now works with `llama-cpp-python` 0.4.x.** 1.1.6 widened one version
  check but missed a second, so the runtime was accepted in Settings and then refused
  per model with "Model setup is incomplete - the installed llama-cpp-python 0.4.0 does
  not support the qwen35 Direct adapter". That second check also blocked Gemma, so every
  Direct model failed. Both checks now share one supported range.
- **Anima no longer assumes every character is a girl.** Selecting one female and one
  male character wrote `2girls`. The gender of each character was being discarded before
  the prompt was built. A one-girl-one-boy selection now writes `1girl, 1boy`.
- **The fix applies without deleting anything.** The character catalogue records a
  format version, so an out-of-date cache is refreshed on the next launch rather than
  waiting up to 30 days.
- Anima's quality tags remain `masterpiece, best quality, highres, score_9`.

## Requirements

- ComfyUI
- Python 3.10 or newer
- At least one configured provider

Models, API keys, and `llama.cpp` binaries are not bundled.

Looking for the version that runs without ComfyUI? See the
[Standalone guide](standalone/README.md).
