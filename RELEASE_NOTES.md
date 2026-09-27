# Prompt Studio for ComfyUI v1.1.6

ComfyUI extension release. Install through ComfyUI Manager or extract the ZIP into
`custom_nodes`.

## Download

Download **Prompt-Studio-ComfyUI-v1.1.6.zip** from the release assets below.

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

- **Direct GGUF no longer rejects a working runtime.** `llama-cpp-python` 0.4.x was
  reported as "installed, but the runtime is not usable", which blocked Direct GGUF
  entirely. The supported range now runs from `0.3.34` up to, but not including, `0.5.0`,
  so a CUDA `cu130` build such as `0.4.0+cu130` is accepted. The 0.5.x series stays
  rejected because it has not been validated. Native compatibility and GPU execution are
  still exercised only when a Direct model actually loads.
- **Anima no longer assumes every character is a girl.** Selecting one female and one
  male character wrote `2girls`. The subject count tag is now stated explicitly and
  derived from each character's own gender, so a mixed pair is `1girl, 1boy`.
- **Anima's quality tags are now `masterpiece, best quality, highres, score_9`.**
  Previously `masterpiece, best quality, score_7`.

## Requirements

- ComfyUI
- Python 3.10 or newer
- At least one configured provider

Models, API keys, and `llama.cpp` binaries are not bundled.

Looking for the version that runs without ComfyUI? See the
[Standalone guide](standalone/README.md).
