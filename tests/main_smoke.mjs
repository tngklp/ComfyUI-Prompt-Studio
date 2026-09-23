/**
 * Runtime smoke test: actually load web/main.js and drive the paths that have
 * shipped free-variable ReferenceErrors.
 *
 * Why this exists: `targetForMode is not defined` and `switchedToT2VA is not
 * defined` both reached users despite a green test suite. Every other frontend
 * test either reads source with regex or evaluates single functions in isolation,
 * so an identifier that is read but never declared is invisible to them. Loading
 * the module for real makes the JS engine report it, exactly as a browser would.
 *
 * Requires `--experimental-vm-modules` (vm.SourceTextModule). Run with:
 *     node --experimental-vm-modules --test tests/main_smoke.mjs
 * Without the flag the tests are SKIPPED rather than failed, so the default
 * `node --test tests/*.mjs` invocation stays green and the reason stays visible.
 *
 * Only the two ComfyUI host modules are stubbed (`/scripts/app.js`, `/scripts/api.js`).
 * Everything under web/ is the real file.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Window } from "happy-dom";

const hasVmModules = typeof vm.SourceTextModule === "function";
const skipReason = hasVmModules
  ? false
  : "needs --experimental-vm-modules: node --experimental-vm-modules --test tests/main_smoke.mjs";

const webRoot = fileURLToPath(new URL("../web/", import.meta.url));
const toPosix = (value) => value.replace(/\\/g, "/");

/** The two host modules main.js and its graph import, with the names they need. */
const HOST_MODULES = {
  "comfy:app": "export const app = globalThis.__psHostApp;",
  "comfy:api": "export const api = globalThis.__psHostApi;",
};

/** Build an isolated module loader over the real web/ sources. */
function createLoader() {
  const window = new Window({ url: "http://localhost/" });
  const registered = [];
  window.app = {
    registerExtension: (extension) => registered.push(extension),
    psHost: { windowed: true, comfyMemory: false, workflowMedia: false },
    canvas: null,
  };
  window.api = { fetchApi: async () => ({}), apiURL: (route) => route };

  const context = vm.createContext({
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    crypto: {
      getRandomValues: (array) => { for (let i = 0; i < array.length; i++) array[i] = (i * 37) % 251; return array; },
      randomUUID: () => "00000000-0000-4000-8000-" + String(Math.floor(Math.random() * 1e12)).padStart(12, "0"),
    },
    URL, URLSearchParams,
    Blob: window.Blob, File: window.File, FormData: window.FormData,
    Event: window.Event, CustomEvent: window.CustomEvent,
    HTMLElement: window.HTMLElement, Node: window.Node,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }),
    __psHostApp: window.app,
    __psHostApi: window.api,
  });

  const cache = new Map();

  const load = async (identifier) => {
    if (cache.has(identifier)) return cache.get(identifier);
    if (HOST_MODULES[identifier]) {
      const stub = new vm.SourceTextModule(HOST_MODULES[identifier], { context, identifier });
      cache.set(identifier, stub);
      return stub;
    }
    const filePath = fileURLToPath(identifier);
    const raw = await readFile(filePath, "utf8");
    const dir = path.dirname(filePath);
    const source = raw
      .replace(/from\s+"(\.[^"]*)"/g, (_, spec) => `from "file:///${toPosix(path.resolve(dir, spec))}"`)
      .replace(/from\s+"\/scripts\/app\.js"/g, 'from "comfy:app"')
      .replace(/from\s+"\/scripts\/api\.js"/g, 'from "comfy:api"')
      // `import.meta.url` is undefined inside vm.SourceTextModule, so any
      // `new URL("./x", import.meta.url)` throws. Substitute a literal file URL
      // for this module so asset and stylesheet resolution works as it does in a
      // browser.
      .replace(/import\.meta\.url/g, JSON.stringify(`file:///${toPosix(filePath)}`));
    const mod = new vm.SourceTextModule(source, { context, identifier: toPosix(identifier) });
    cache.set(identifier, mod);
    await mod.link(async (specifier) => {
      if (HOST_MODULES[specifier]) return load(specifier);
      if (specifier.startsWith("file://")) return load(specifier);
      // Any other host specifier: harmless empty module.
      const stub = new vm.SourceTextModule("export default undefined;", { context, identifier: specifier });
      return stub;
    });
    return mod;
  };

  return { load, registered, window, context, entry: `file:///${toPosix(path.join(webRoot, "main.js"))}` };
}

test("main.js evaluates without unresolved identifiers", { skip: skipReason }, async () => {
  const { load, registered, entry, context } = createLoader();
  const main = await load(entry);
  // A ReferenceError from a free variable at module scope surfaces here.
  await main.evaluate();
  assert.ok(registered.length > 0, "main.js should register a ComfyUI extension");
  assert.ok(context.__promptStudioInternals, "main.js should expose its test surface");
});

test("selectModel runs without unresolved identifiers", { skip: skipReason }, async () => {
  // `switchedToT2VA is not defined` shipped because the declaration was dropped in
  // a refactor while a use of it survived. It throws only when the line EXECUTES,
  // so evaluating the module is not enough: the function has to be called.
  const { load, entry, context, registered } = createLoader();
  const main = await load(entry);
  await main.evaluate();

  const internals = context.__promptStudioInternals;
  // The studio is built lazily on first open.
  assert.doesNotThrow(() => internals.createStudio(), "createStudio must not throw");

  let studio = internals.getStudio();
  assert.ok(studio, "createStudio should produce studio state");

  // A text-only model on a media mode forces the fallback branch that held the bug.
  // The id is shaped like a real one so path handling in selectModel behaves.
  const textOnly = {
    id: "gguf/text-only-smoke.gguf",
    name: "Text Only Smoke",
    family: "gguf",
    capabilities: {},
    runtime_ready: true,
    model_ready: true,
  };
  assert.doesNotThrow(
    () => internals.selectModel(textOnly),
    "selectModel must not throw a ReferenceError",
  );
  assert.doesNotThrow(
    () => internals.selectModel({
      id: "ollama/smoke:latest",
      name: "Smoke",
      family: "ollama",
      remote_model: "smoke:latest",
      capabilities: {},
      runtime_ready: true,
      model_ready: true,
    }),
    "selecting a second model must not throw",
  );
  // Switching mode re-renders every panel; that path had the same bug class.
  studio = internals.getStudio();
  assert.doesNotThrow(() => internals.syncWorkspace(), "syncWorkspace must not throw");
  assert.doesNotThrow(() => internals.renderMedia(studio.mode), "renderMedia must not throw");
});
