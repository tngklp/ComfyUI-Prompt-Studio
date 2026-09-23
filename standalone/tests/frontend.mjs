import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { app, boot } from "../prompt_studio/static/app.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const main = await read("../../web/main.js");

test("standalone declares host limits without emulating a ComfyUI canvas or queue", async t => {
  assert.deepEqual(app.psHost, { windowed: false, comfyMemory: false, workflowMedia: false });
  assert.equal(app.queuePrompt, undefined); assert.equal(app.canvas, undefined);
  const old = globalThis.document;
  globalThis.document = { documentElement: { dataset: {} } };
  t.after(() => { globalThis.document = old; });
  const calls = [];
  app.registerExtension({ setup() { calls.push("setup"); }, commands: [{ id: "prompt-studio.open", function() { calls.push("open"); } }] });
  await boot();
  assert.deepEqual(calls, ["setup", "open"]);
  assert.equal(document.documentElement.dataset.psStandaloneReady, "true");
});

test("shared host guards hide Comfy-only actions and preserve the standalone shell", () => {
  assert.match(main, /\[data-comfy-memory-action\].*hidden = !HOST_CAPABILITIES.comfyMemory/);
  assert.match(main, /if \(!HOST_CAPABILITIES.windowed\) fullscreen = true/);
  assert.match(main, /function closeStudio\(\) \{\s*if \(!HOST_CAPABILITIES.windowed\) return false/);
  assert.match(main, /function installLauncher\(\) \{\s*if \(!HOST_CAPABILITIES.windowed\) return/);
  assert.match(main, /return HOST_CAPABILITIES.workflowMedia &&/);
  assert.match(main, /!HOST_CAPABILITIES.comfyMemory \|\| writerAutoVramApplies/);
});

test("standalone does not intercept Editor, Composer or menu Escape handling", async () => {
  const boot = await read("../prompt_studio/static/boot.js");
  const labels = await read("../prompt_studio/static/host_labels.js");
  assert.doesNotMatch(boot, /standalone_shell|keydown|MutationObserver/);
  assert.doesNotMatch(labels, /comfy-memory-action/);
  assert.match(main, /if \(openComposer \|\| openEditor\) return/);
});

test("managed GGUF styles use the shared theme and type tokens", async () => {
  const css = await read("../prompt_studio/static/managed_gguf.css");
  assert.doesNotMatch(css, /#[a-f0-9]{3,8}\b|font-size:\s*[\d.]+px/i);
  const shared = (await Promise.all(["tokens", "foundation", "themes/dark", "themes/light"].map(name => read(`../../web/styles/${name}.css`)))).join("\n");
  for (const [, token] of css.matchAll(/var\((--ps-[\w-]+)\)/g)) assert.ok(shared.includes(token + ":"), token);
  assert.match(css, /height: calc\(29px \* var\(--ps-interface-scale\)\)/);
});
