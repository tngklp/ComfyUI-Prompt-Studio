# Ollama

Ollama is the recommended local provider. It keeps the prompt-model runtime outside ComfyUI and avoids the optional Direct GGUF Python wheel.

## Quick setup

1. [Install Ollama](https://ollama.com/download) and open the Ollama app.
2. Choose a starting model for your GPU from the table below.
3. Run its `ollama pull` command in Terminal, PowerShell, or Command Prompt.
4. Open **Prompt Studio > Settings > Ollama**.
5. Select **Check now** if the app is waiting for Ollama to start.
6. After the pull completes, select **Refresh**, choose the installed model, and return to Generate.

Prompt Studio only checks the selected Ollama service and its installed models. It does not start `ollama serve`, call `/api/pull`, or download models.

## Ollama on another computer

The default host is `http://127.0.0.1:11434`. To use Ollama on another computer, open the collapsed **Use Ollama on another computer** control in Ollama Settings and enter that server's root URL, such as `http://192.168.1.25:11434`.

The Ollama server must listen on the network and allow connections from the ComfyUI computer. Pull commands must be run on the computer that hosts Ollama. Prompt Studio remembers the selected model separately for each host.

Plain HTTP is allowed only for this computer or a private LAN IP. Public remote hosts must use HTTPS. Prompt Studio rejects cloud metadata and special network addresses.

## Tested Gemma 4 tags

These are starting recommendations, not guaranteed minimum requirements:

| GPU tier | Tested tag | Command |
| --- | --- | --- |
| Less than 8 GB | `gemma4:e2b` | `ollama pull gemma4:e2b` |
| 8 GB | `gemma4:e4b` | `ollama pull gemma4:e4b` |
| 12-16 GB | `gemma4:12b` | `ollama pull gemma4:12b` |
| 24 GB | `gemma4:26b` | `ollama pull gemma4:26b` |
| 32 GB | `gemma4:31b` | `ollama pull gemma4:31b` |

All five exact tags completed multimodal validation on the video target. The measurements were taken on a 32 GB RTX 5090. Actual headroom depends on display use, ComfyUI models, other applications, context size, and Ollama's GPU/CPU placement.

The Prompt Studio marks these exact tags **Tested with Prompt Studio**. The measurement was taken against the video target, but the badge means the tag is a known-good prompt model rather than a promise about one target. Other installed vision models can still appear when Ollama reports compatible capabilities; they are shown as compatible but not yet tested.

Qwen 3.6 also completed all five video modes through Ollama without special changes to Prompt Studio. It is not part of the fixed GPU table because those starting tiers come from the measured Gemma 4 runs.

You can try other Ollama vision models when Ollama reports the required image capability. This is an option for experimentation, not a promise that every multimodal model will follow a given target's format equally well.

## Context and Thinking

Ollama has no manual Context or KV cache controls in Prompt Studio. Prompt Studio estimates the assembled request and sends the smallest sufficient 8K, 16K, or 24K `num_ctx` value, within the selected model's reported limit. Ollama decides the actual GPU and CPU placement.

The **Thinking** switch is available only when the selected Ollama model reports thinking support. When enabled, Auto reserves the larger reasoning and final-output budget before choosing context.

## Model lifecycle

With **Keep model loaded** off, Prompt Studio asks Ollama to unload the model after the request. Turn it on when generating several prompts in a row.

- **Unload Ollama** releases an idle Ollama model retained by Prompt Studio.
- **Stop & unload** cancels an active Ollama request and asks Ollama to unload that model.
- **Cancel** stops the current request without changing a previously retained model.

Ollama is a shared service. Prompt Studio only offers unload controls for models it intentionally used and retained during the current Prompt Studio session. Retained-model state is tracked separately for each configured host.

See [Troubleshooting](TROUBLESHOOTING.md#ollama-is-not-running) if the service or model is not detected.

**Generation budget** in Settings sets the output token limit, including thinking.
Auto keeps the default budget. Choose a preset or Custom when a response reaches
its limit. Context is planned automatically and must also fit the selected model.
This is separate from the Direct GGUF generation budget.
