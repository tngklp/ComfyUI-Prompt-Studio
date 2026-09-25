# Prompt Studio for ComfyUI v1.1.1

ComfyUI extension release. Install through ComfyUI Manager or extract the ZIP into
`custom_nodes`.

## Download

Download **Prompt-Studio-ComfyUI-v1.1.1.zip** from the release assets below.

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

- **Fixed Anima adding a `safe` tag when the content rating was None.** The guide and
  system prompt both hard-coded a `safe` default; the safety tag is now only emitted
  when a rating is actually selected.
- **Fixed a selected character losing its series.** The output could contain
  `hatsune miku` without `vocaloid`. Character and series are now specified as one
  inseparable pair in the guide, the system prompt and the closing contract, and the
  audit reports - and repairs - a dropped series.
- **Fixed the tag group order** so character and series read as one group sitting before
  the artist tags, rather than as two separate groups.
- **More detailed prompts.** The system prompt now asks for the brief to be covered
  thoroughly instead of saying not to pad, and the audit forces a repair when the output
  contradicts the chosen rating or style.
- **Character search is much faster** (~7x) and the character index is built at startup,
  so the first search is instant.
- **Anima** text-to-image target, with content rating and prompt style options,
  character references shown as bubbles, and per-region tag highlighting.
- **Declared references** and **media-blind mode**.
- **Settings tabs**, separating prompts and media handling.

## Requirements

- ComfyUI
- Python 3.10 or newer
- At least one configured provider

Models, API keys, and `llama.cpp` binaries are not bundled.

Looking for the version that runs without ComfyUI? See the
[Standalone guide](standalone/README.md).
