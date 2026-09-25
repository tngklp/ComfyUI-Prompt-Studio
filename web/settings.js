export function generateModelSummaryMarkup(icon) {
  return `
    <button class="ps-active-model" type="button" title="Open model settings" data-open-settings>
      <span class="ps-active-model-icon ps-provider-icon" data-active-model-icon data-provider-icon="direct" aria-hidden="true"></span>
      <span><small data-active-model-source>Prompt model</small><strong data-active-model-name>Scanning models…</strong></span>
      <em data-active-runtime-summary>Runtime · Auto</em>
      ${icon("chevron", 14)}
    </button>`;
}

export function settingsMarkup(icon) {
  return `
    <section class="ps-settings-view" data-settings-view hidden>
      <header class="ps-settings-heading">
        <span><strong>Settings</strong><em data-settings-subtitle>Inference, runtime and prompt behavior</em></span>
        <button class="ps-secondary-button" type="button" data-close-settings>${icon("chevron", 14)} Back to Generate</button>
      </header>

      <nav class="ps-settings-tabs" role="tablist" aria-label="Settings section">
        <button type="button" role="tab" aria-selected="true" data-settings-tab="model">
          ${icon("grid", 15)}<span><strong>Prompt model</strong><small>Providers, models and runtime</small></span>
        </button>
        <button type="button" role="tab" aria-selected="false" data-settings-tab="media">
          ${icon("image", 15)}<span><strong>Media handling</strong><small>How references reach the prompt model</small></span>
        </button>
      </nav>

      <div class="ps-settings-content" data-settings-panel="model">
        <section class="ps-settings-card ps-provider-settings">
          <header><span><small>Inference</small><strong>Provider</strong></span></header>
          <div class="ps-provider-selector" role="tablist" aria-label="Inference provider">
            <button type="button" role="tab" data-provider-option="ollama" aria-selected="true">
              <span class="ps-provider-icon" data-provider-icon="ollama" aria-hidden="true"></span><span><strong>Ollama</strong><small>Simple local model service</small></span>${icon("check", 14)}
            </button>
            <button type="button" role="tab" data-provider-option="direct" aria-selected="false">
              <span class="ps-provider-icon" data-provider-icon="direct" aria-hidden="true"></span><span><strong>Direct GGUF</strong><small>Models installed in ComfyUI</small></span>${icon("check", 14)}
            </button>
            <button type="button" role="tab" data-provider-option="external" aria-selected="false">
              <span class="ps-provider-icon" data-provider-icon="external" aria-hidden="true"></span><span><strong>External llama.cpp</strong><small>Existing local llama-server</small></span>${icon("check", 14)}
            </button>
            <button type="button" role="tab" data-provider-option="api" aria-selected="false">
              <span class="ps-provider-icon" data-provider-icon="api" aria-hidden="true"></span><span><strong>API providers</strong><small>OpenAI-compatible local or remote API</small></span>${icon("check", 14)}
            </button>
          </div>
        </section>

        <section class="ps-settings-card ps-provider-detail" data-provider-detail>
          <div class="ps-provider-panel" data-provider-panel="direct" hidden>
            <div data-direct-runtime-status></div>
            <header class="ps-settings-section-heading">
              <span><small>Model</small><strong>Installed models</strong></span>
              <button class="ps-small-refresh" type="button" data-model-refresh>${icon("refresh", 13)} Refresh</button>
            </header>
            <div class="ps-installed-model-heading">Select Model</div>
            <div class="ps-installed-model-control">
              <span class="ps-model-icon ps-provider-icon" data-provider-icon="direct" aria-hidden="true"></span>
              <label><select data-installed-model aria-label="Installed model"><option>Scanning models…</option></select></label>
              <span class="ps-model-lifecycle" data-model-lifecycle hidden><em data-model-lifecycle-label>Model loaded</em></span>
            </div>
            <p class="ps-installed-model-source" data-model-source-label>Local GGUF · llama-cpp-python</p>
            <div data-direct-model-status></div>
            <div data-direct-projector></div>
            <div class="ps-model-utilities">
              <div data-model-scan-slot></div>
              <div data-verified-models-slot></div>
            </div>
          </div>

          <div class="ps-provider-panel" data-provider-panel="external" hidden>
            <header class="ps-settings-section-heading"><span><small>Connection</small><strong>External llama.cpp server</strong></span></header>
            <div data-external-provider-control></div>
          </div>

          <div class="ps-provider-panel" data-provider-panel="ollama">
            <div data-ollama-provider-control></div>
          </div>

          <div class="ps-provider-panel" data-provider-panel="api" hidden>
            <div data-api-provider-control></div>
          </div>

        </section>

        <section class="ps-settings-card ps-runtime-settings">
          <header><span><small>Runtime</small></span></header>
          <div class="ps-runtime-settings-grid">
            <div class="ps-runtime-control"><span>Context</span><span class="ps-runtime-picker"><button type="button" aria-haspopup="true" aria-expanded="false" data-runtime-toggle="context"><b data-runtime-label="context">Auto</b>${icon("chevron", 12)}</button><span class="ps-runtime-menu" data-runtime-menu="context" hidden><button type="button" data-runtime-option="context" data-value="auto">Auto</button><button type="button" data-runtime-option="context" data-value="low">8K</button><button type="button" data-runtime-option="context" data-value="standard">16K</button><button type="button" data-runtime-option="context" data-value="extended">24K</button><button type="button" data-runtime-option="context" data-value="large">32K</button><button type="button" data-runtime-option="context" data-value="maximum">48K</button><button type="button" data-runtime-option="context" data-value="custom">Custom</button></span></span><label class="ps-runtime-custom" data-custom-context hidden><input type="number" min="1024" step="1" inputmode="numeric" placeholder="Enter tokens" data-custom-context-input><span>tokens</span></label></div>
          </div>
          <details class="ps-direct-advanced" data-direct-runtime-advanced>
            <summary><strong>Advanced settings</strong><em data-direct-advanced-summary>Auto</em>${icon("chevron", 12)}</summary>
            <div class="ps-direct-advanced-body">
              <div class="ps-runtime-control"><span>KV cache</span><span class="ps-runtime-picker"><button type="button" aria-haspopup="true" aria-expanded="false" data-runtime-toggle="kv"><b data-runtime-label="kv">Auto</b>${icon("chevron", 12)}</button><span class="ps-runtime-menu" data-runtime-menu="kv" hidden><button type="button" data-runtime-option="kv" data-value="auto">Auto</button><button type="button" data-runtime-option="kv" data-value="q8">Q8</button><button type="button" data-runtime-option="kv" data-value="f16">F16</button></span></span></div>
              <div class="ps-runtime-control"><span>Generation budget</span><span class="ps-runtime-picker"><button type="button" aria-haspopup="true" aria-expanded="false" data-runtime-toggle="budget"><b data-runtime-label="budget">Auto</b>${icon("chevron", 12)}</button><span class="ps-runtime-menu" data-runtime-menu="budget" hidden><button type="button" data-runtime-option="budget" data-value="auto">Auto</button><button type="button" data-runtime-option="budget" data-value="2048">2K</button><button type="button" data-runtime-option="budget" data-value="4096">4K</button><button type="button" data-runtime-option="budget" data-value="8192">8K</button><button type="button" data-runtime-option="budget" data-value="custom">Custom</button></span></span><label class="ps-runtime-custom" data-custom-generation-budget hidden><input type="number" min="1" step="1" inputmode="numeric" placeholder="Enter tokens" data-custom-generation-budget-input><span>tokens</span></label></div>
              <div class="ps-runtime-control" data-reasoning-effort-control hidden><span>Reasoning effort</span><span class="ps-runtime-picker"><button type="button" aria-haspopup="true" aria-expanded="false" data-runtime-toggle="reasoning"><b data-runtime-label="reasoning">Auto</b>${icon("chevron", 12)}</button><span class="ps-runtime-menu" data-runtime-menu="reasoning" hidden></span></span></div>
            </div>
          </details>
          <p data-runtime-management>Direct GGUF runtime settings are applied to the next request.</p>
        </section>

        <section class="ps-settings-card ps-notifications-settings">
          <header><span><small>Notifications</small></span></header>
          <label class="ps-toggle-control"><input type="checkbox" data-desktop-notifications><span></span>Desktop notifications</label>
          <p class="ps-field-help" data-desktop-notifications-hint></p>
        </section>
      </div>

      <div class="ps-settings-content" data-settings-panel="media" hidden>
        <section class="ps-settings-card ps-media-handling-settings">
          <header><span><small>References</small><strong>Attach media without a vision model</strong></span></header>
          <label class="ps-toggle-control"><input type="checkbox" data-blind-media><span></span>Media-blind mode</label>
          <p class="ps-field-help" data-blind-media-hint>
            Attached pictures and videos stay in the workspace and keep their reference tags, but are
            <strong>not sent to the prompt model</strong>. The model is told each reference exists, that it has not
            seen it, and that it must not invent its contents, so it writes that reference's role from your brief
            alone. Use it to generate with a text-only prompt model, or to keep image bytes off a remote provider.
          </p>
          <ul class="ps-field-notes">
            <li>A <strong>declared reference</strong> you added with <em>Plan a picture</em> is already text-only and needs no vision model whether this is on or off.</li>
            <li>With this on, reference roles depend entirely on your brief. Describe what each tag contributes.</li>
            <li>Turning it off restores the normal requirement: every attached picture or video needs a vision-capable prompt model.</li>
          </ul>
        </section>

        <section class="ps-settings-card ps-character-settings">
          <header><span><small>Anima</small><strong>Characters</strong></span></header>
          <p class="ps-field-help" data-character-source>Checking character data…</p>
          <div class="ps-character-import">
            <button class="ps-secondary-button" type="button" data-character-refresh>Download character data</button>
          </div>
          <p class="ps-field-help">
            The Anima character catalogue is downloaded once from
            <strong>animadex.net</strong> and cached on this computer, so it is only fetched
            on the first launch or when the copy on disk is old. Characters are then resolved
            to the exact <code>&lt;character&gt;, &lt;series&gt;</code> pair Anima expects.
          </p>
        </section>
      </div>
    </section>`;
}
