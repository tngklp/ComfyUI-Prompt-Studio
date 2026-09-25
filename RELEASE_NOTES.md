# Prompt Studio for ComfyUI v1.1.0

ComfyUI extension release. Install through ComfyUI Manager or extract the ZIP into
`custom_nodes`.

## Download

Download **Prompt-Studio-ComfyUI-v1.1.0.zip** from the release assets below.

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

- **Anima** text-to-image target, written from the official prompting guide. Prompts are
  tag lists and the workspace exposes the guide's own options:
  - **Content rating** - Safe, Sensitive, NSFW, Explicit or None, emitted as the safety
    tag the model was trained on.
  - **Prompt style** - Tags, Natural language or Hybrid.
- **Character references.** Type `miku` and it becomes `hatsune miku, vocaloid` in the
  right position of the tag list. Multi-select, backed by the AnimaDex catalogue.
- **Tag highlighting.** The guide's five tag regions are colour-coded, so a
  mis-ordered tag list is visible at a glance.
- **Declared references.** **Plan a picture** adds a reference slot with no file
  attached, so you can write a prompt for a picture that does not exist yet or cannot be
  shared. Describe what it contributes and the placeholder is filled from your brief.
- **Media-blind mode.** Keep attached media in the workspace without sending the images
  to the prompt model. Useful with a text-only model, or to keep image bytes local.
- **Settings tabs**, separating prompts, media handling and Anima characters.
- **Text drafts**, a manual Ollama generation budget, an explicit vision projector, and
  no Creative Brief character limit.
- **Fixed a stale interface after updates.** A hard refresh was previously needed before
  new features appeared.
- **Fixed Character and series highlighting bleeding** into the next tag when a series
  name is also a character name (such as `vocaloid`).
- **Fixed character instructions reaching other targets.** The Anima character directive
  is now only added to Anima requests.

## Requirements

- ComfyUI
- Python 3.10 or newer
- At least one configured provider

Models, API keys, and `llama.cpp` binaries are not bundled.

Looking for the version that runs without ComfyUI? See the
[Standalone guide](standalone/README.md).
