# API providers

API providers use one OpenAI-compatible Chat Completions backend with presets for Gemini, OpenAI, OpenRouter, and Custom endpoints.

## Choose a preset

- **Gemini** uses Google's OpenAI-compatible endpoint and exposes Gemini Thinking levels.
- **OpenAI** uses the OpenAI API preset.
- **OpenRouter** sends requests through OpenRouter to an upstream model provider.
- **Custom** accepts a generic OpenAI-compatible URL, including local LM Studio.

Gemini was validated live. The shared Custom transport was validated live with LM Studio. OpenAI and OpenRouter contract tests cover request serialization, model listing, streaming, cancellation, errors, and secret handling, but no credentialed live smoke was run for those two services.

The API provider path is not tied to Gemma 4. You can choose another multimodal model when the provider accepts image inputs in a format Prompt Studio supports. A successful connection shows that Prompt Studio can reach the model, but it does not guarantee a good prompt for every target.

## Connect

1. Open **Prompt Studio > Settings > API providers**.
2. Choose a preset.
3. Paste the API key for the current Prompt Studio session. Custom endpoints may be used without a key.
4. Optionally enter an exact Model ID before connecting.
5. Select **Connect & test**, then choose a vision-capable model from the provider list or enter its exact ID.

Model availability, pricing, quotas, rate limits, and input support belong to the provider and selected model. Check the policy and pricing links shown in Settings.

## Gemini Thinking

Gemini supports these Prompt Studio levels:

- Minimal
- Low
- Medium
- High

Gemini manages its reasoning and output budget. Higher levels can consume more tokens and take longer. The general Thinking switch on Generate is hidden for API providers so it does not conflict with the provider-specific setting.

## Custom and LM Studio

For LM Studio, use a base URL such as:

```text
http://localhost:1234/v1
```

Load a vision model in LM Studio, connect the Custom preset, and choose the model. Prompt Studio can read LM Studio's local capability metadata when the standard `/v1/models` response does not identify vision support.

For Ollama through the Custom OpenAI-compatible preset, use a base URL such as `http://192.168.1.25:11434/v1`. The `/v1` prefix is required for Ollama's OpenAI-compatible routes.

For another Custom endpoint, enable **Endpoint accepts image_url inputs** only when the server and model really accept OpenAI-style image content. You can also provide a known context size. Loopback and private LAN IP addresses may use HTTP; public remote endpoints must use HTTPS.

Custom is a transport contract, not a claim that every OpenAI-compatible server or model is supported.

## Keys and saved settings

The key is sent once to the local Prompt Studio backend and held only in the current Prompt Studio backend process's memory. It is not read from environment variables and is not written to browser storage, model settings, developer notes, or request content. The backend uses it only to authenticate provider requests. Disconnecting removes the in-memory connection. The browser may save the preset, base URL, model ID, Gemini Thinking level, and Custom capability settings.

## What leaves this computer

For a remote provider, Prompt Studio sends:

- your Creative Brief;
- the current target's writing and system instructions;
- prepared images in the current mode's manifest;
- one derived contact sheet for each video in that manifest.

Prompt Studio does not upload original video bytes or audio bytes. Audio references remain textual entries in the request manifest, so describe their intended role in the brief.

The provider can retain or process requests according to its own policy. OpenRouter can forward the request to an upstream model provider with a separate policy. Review the provider's data policy before sending private media.

## Lifecycle and errors

API providers show **Cancel** for the current Prompt Studio request. Prompt Studio cannot unload or stop a remote service.

Authentication, billing, rate-limit, safety, and quota errors are returned by the provider. A response that reaches its length limit is rejected rather than displayed as a successful but truncated prompt.

Comfy Cloud has not been validated for v0.3. The existence of an API provider does not establish that the extension, outbound networking, or session-key handling works there.
