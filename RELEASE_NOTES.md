# Prompt Studio for ComfyUI v1.1.2

ComfyUI extension release. Install through ComfyUI Manager or extract the ZIP into
`custom_nodes`.

## Download

Download **Prompt-Studio-ComfyUI-v1.1.2.zip** from the release assets below.

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

- **Fixed "Unsupported Media" with local llama.cpp and KoboldCpp servers.** A local server
  that has a vision projector loaded was still reported as text-only, so attached images
  were refused. Its OpenAI-compatible model list does not describe image support at all;
  the projector is only visible on the server's own `/props` endpoint, which Prompt Studio
  now reads. Qwen3.8-27B with an `mmproj` file over KoboldCpp, LM Studio, or `llama-server`
  is detected automatically - no configuration needed.
- **You can now declare image support by hand for a Custom endpoint.** If a server hides
  its projector or runs behind a proxy, a new switch on the connected API panel
  (**Endpoint accepts image_url inputs**) enables vision without reconnecting. The choice is
  remembered.
- The connected API panel now explains where the image support came from - detected from the
  server, or declared by you.

## Requirements

- ComfyUI
- Python 3.10 or newer
- At least one configured provider

Models, API keys, and `llama.cpp` binaries are not bundled.

Looking for the version that runs without ComfyUI? See the
[Standalone guide](standalone/README.md).
