# External llama.cpp server

External llama.cpp is the advanced local provider for users who want to control the inference runtime. It is also an alternative when a Direct `llama-cpp-python` wheel is incompatible with the system.

![External llama.cpp connection](assets/v0.3/external-llama-server.png)

## Quick setup

1. Get a current `llama-server` from the [official llama.cpp project](https://github.com/ggml-org/llama.cpp).
2. Download a model GGUF. Download its matching `mmproj` if you want Prompt Studio to read images or video.
3. Start the server from the directory containing `llama-server`:

```powershell
.\llama-server.exe -m "C:\models\model.gguf" --mmproj "C:\models\mmproj.gguf" --host 127.0.0.1 --port 8080 --ctx-size 24576 --alias h3-vision
```

On Linux or macOS, use `./llama-server` and the appropriate file paths.

For Music 3, T2VA, and Refine, you can run the same model without `--mmproj`:

```powershell
.\llama-server.exe -m "C:\models\model.gguf" --host 127.0.0.1 --port 8080 --ctx-size 24576 --alias prompt-studio
```

4. Open **Prompt Studio > Settings > External llama.cpp**.
5. Enter `http://127.0.0.1:8080` as **Server URL**.
6. Leave **Model ID** empty when the server exposes one model. If it exposes several, enter the exact `/v1/models` ID or the value passed with `--alias`.
7. Select **Connect**, return to the workspace, and run a request that matches the model's capabilities.

The command uses current official llama.cpp options. Adjust context, GPU layers, cache types, and other runtime settings for your hardware. The server's default host is loopback and its default port is 8080.

## What Prompt Studio controls

Prompt Studio prepares the brief and prompt instructions. When the server supports vision, Prompt Studio can also send images and video contact sheets. It sends a Chat Completions request and can cancel its active HTTP request.

Single-model servers remain server-managed: Prompt Studio offers generation and Cancel, not Keep loaded or Unload.

A router reporting exact model IDs and lifecycle states through `/models` enables **Keep model loaded**, **Unload**, and two-way **Auto VRAM**. Prompt Studio uses `/models/load` and `/models/unload` only for its selected ID and confirms the actual state. Keep loaded skips normal post-generation unload; Auto VRAM before ComfyUI Queue can still unload it. An automatic cleanup failure preserves the prompt and reports a warning. Manual unload requires confirmation. Ordinary ComfyUI Queue is best-effort: a failed or unconfirmed release shows a warning and Queue continues after a bounded attempt. Confirmed Prompt Studio-owned residency survives temporary unknown status until the router confirms release; an unknown model without that ownership is not a release target.

Auto VRAM can release idle ComfyUI models before generation for either server mode. Prompt Studio never stops the server process.

The external server controls:

- model and projector loading;
- GPU placement and offload;
- context size and KV cache;
- generated-token limits;
- chat-template reasoning behavior and reasoning output format;
- build flags and runtime optimizations;
- server startup, shutdown, sleep, and model unload.

Prompt Studio does not send `enable_thinking` or other reasoning controls to External llama.cpp. If the server returns reasoning through `reasoning_content` or a leading `<think>` block, Prompt Studio keeps it out of the final H3 prompt.

Changing provider, disconnecting, or closing Prompt Studio does not stop `llama-server`. Cancelling an active router generation releases the selected model; single-model lifecycle remains server-managed.

## Connection contract

Prompt Studio accepts loopback HTTP or certificate-verified HTTPS servers. Use a root URL such as:

```text
http://127.0.0.1:8080
```

Entering `http://127.0.0.1:8080/v1` is also accepted and normalized to the server root. Arbitrary additional paths are rejected.

An optional API key is sent as a Bearer token and retained only in backend memory, not browser preferences. A blank key field reuses the current session key; restarting clears it.

For same-machine Docker, publish the port on loopback (for example `-p 127.0.0.1:8080:8080`) and use the host loopback URL. Other container topologies must provide a host-loopback endpoint; External does not accept private-LAN or public hosts. Use the existing Custom API provider for remote endpoints. No redirects are followed.

During connection, Prompt Studio checks `/health`, `/props`, and `/v1/models` (router: `/models` and model-scoped `/props` without auto-loading). A text-only model can connect and handle Music 3, T2VA, and Refine.

I2VA, FL2VA, L2VA, and Reference requests with images or video need vision support from a matching model and projector. If a text-only model receives visual media, Prompt Studio stops before generation and explains how to enable vision.

## Advanced use

Use `--alias` when you want a stable API Model ID. Current llama.cpp also supports options such as `--gpu-layers`, `--cache-type-k`, `--cache-type-v`, `--flash-attn`, and `--split-mode`. Keep these on the server command line; Prompt Studio does not duplicate them.

Gemma 4 is the main tested model family for External llama.cpp. The provider is not restricted to Gemma 4. You can try another model supported by your llama.cpp build. Add its matching projector when you need vision. Compatibility does not guarantee the same prompt quality.

API providers and single-model External servers expose Cancel only. A verified External router also exposes lifecycle actions for the selected model.
