/**
 * Static integrity checks for the registry-driven frontend.
 *
 * These exist because the unit suites evaluate *functions* in isolated contexts
 * and never import `web/main.js` as a module. That let a missing named import
 * (`targetForMode`) ship and break the extension at runtime with
 * "targetForMode is not defined". This file closes that gap by parsing the real
 * import graph.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const webRoot = fileURLToPath(new URL("../web/", import.meta.url));
const standaloneRoot = fileURLToPath(new URL("../standalone/", import.meta.url));

async function jsFiles(root, skip = new Set([".venv", "node_modules"])) {
  const found = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        await walk(full);
      } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
        found.push(full);
      }
    }
  };
  await walk(root);
  return found;
}

const readWeb = (file) => readFile(path.join(webRoot, file), "utf8");

/**
 * Identifiers a module binds: declarations, imports, params, catch bindings.
 *
 * Deliberately permissive — it over-collects rather than risk a false positive,
 * because a missed binding shows up as a spurious failure. The guard's job is to
 * catch a name that is read but bound NOWHERE, which is always a real bug.
 */
function boundNames(source) {
  const names = new Set([
    // Globals and host objects that are legitimately available.
    "globalThis", "window", "document", "console", "Math", "JSON", "Object", "Array",
    "String", "Number", "Boolean", "Promise", "Map", "Set", "Date", "RegExp", "Error",
    "TypeError", "RangeError", "Symbol", "WeakMap", "WeakSet", "Proxy", "Reflect",
    "Intl", "BigInt", "Infinity", "NaN", "undefined", "arguments", "this", "super",
    "eval", "Function", "parseInt", "parseFloat", "isNaN", "isFinite", "decodeURI",
    "encodeURI", "decodeURIComponent", "encodeURIComponent", "structuredClone",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
    "requestAnimationFrame", "cancelAnimationFrame", "fetch", "Response", "Request",
    "Headers", "FormData", "Blob", "File", "FileReader", "URL", "URLSearchParams",
    "AbortController", "AbortSignal", "TextEncoder", "TextDecoder", "localStorage",
    "sessionStorage", "navigator", "location", "history", "performance", "crypto",
    "Uint8Array", "Uint16Array", "Uint32Array", "Int8Array", "Int16Array", "Int32Array",
    "Float32Array", "Float64Array", "ArrayBuffer", "DataView", "Image", "Audio",
    "Event", "CustomEvent", "HTMLElement", "Node", "MutationObserver", "IntersectionObserver",
    "ResizeObserver", "DOMParser", "XMLHttpRequest", "WebSocket", "Notification",
    "matchMedia", "getComputedStyle", "alert", "confirm", "prompt", "app", "LiteGraph",
    "comfyAPI", "api", "CSS", "Element", "HTMLCanvasElement", "CanvasRenderingContext2D",
    "OffscreenCanvas", "createImageBitmap", "MediaStream", "navigator", "process",
  ]);

  // function/class declarations, var/let/const, imports, params, catch, labels.
  for (const m of source.matchAll(/\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of source.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of source.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(",")) {
      const name = piece.split(":").pop().split("=")[0].trim().replace(/^\.\.\./, "");
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of source.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) {
    for (const piece of m[1].split(",")) {
      const name = piece.split("=")[0].trim().replace(/^\.\.\./, "");
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  // Imports: named, default, namespace.
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const piece of m[1].split(",")) {
      const name = piece.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  for (const m of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) names.add(m[1]);
  for (const m of source.matchAll(/import\s*\*\s*as\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // Function/method parameters and arrow params, including destructured ones.
  for (const m of source.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const piece of m[1].split(",")) {
      const name = piece.split("=")[0].split(":").pop().trim().replace(/^[.{[]+|[\])}]+$/g, "");
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of source.matchAll(/(?:^|[,{(\s])([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of source.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // for..of / for..in bindings.
  for (const m of source.matchAll(/\bfor\s*\(\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s+of\b/g)) names.add(m[1]);
  for (const m of source.matchAll(/\bfor\s*\(\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s+in\b/g)) names.add(m[1]);
  return names;
}

/** Object-literal property names, so `{ foo }` keys are not read as identifiers. */
function propertyKeys(source) {
  const keys = new Set();
  for (const m of source.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) keys.add(m[1]);
  return keys;
}

/**
 * Identifiers that are READ somewhere but bound nowhere in the module.
 *
 * These are runtime ReferenceErrors waiting to happen — exactly the class of bug
 * that shipped as "targetForMode is not defined" and "switchedToT2VA is not
 * defined", neither of which any other test could see.
 */
export function undeclaredReads(source) {
  const bound = boundNames(source);
  const keys = propertyKeys(source);
  const stripped = source
    // Remove comments and string/template literals so their contents are ignored.
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

  const offenders = new Map();
  for (const m of stripped.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?=[({[,:.?<>=!&|+\-*/%^~]|\b(?:of|in|instanceof)\b)/g)) {
    const name = m[1];
    if (bound.has(name) || keys.has(name)) continue;
    // Skip anything that is clearly a property access, keyword, or type.
    if (/^(?:true|false|null|undefined|void|typeof|new|delete|await|yield|return|if|else|for|while|do|switch|case|break|continue|throw|try|catch|finally|function|class|const|let|var|import|export|from|as|default|extends|static|get|set|async|of|in|instanceof|this|super)$/.test(name)) continue;
    if (!offenders.has(name)) offenders.set(name, stripped.slice(0, m.index).split("\n").length);
  }
  return [...offenders.entries()].map(([name, line]) => `${name} (line ${line})`);
}


/** Named exports of a module, from its export statements. */
function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
  return names;
}

/** Names imported from a given module specifier pattern. */
function importedFrom(source, modulePattern) {
  const names = new Set();
  const pattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"[^"]*${modulePattern}"`, "g");
  for (const match of source.matchAll(pattern)) {
    for (const piece of match[1].split(",")) {
      const name = piece.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Every named specifier used in a relative import, with its specifier.
 *
 * The specifier list is matched without allowing `}` or `from` inside it, so a
 * preceding `import ... from "node:..."` statement cannot be swallowed.
 */
function localImports(source) {
  const results = [];
  const pattern = /import\s*\{([^}]*)\}\s*from\s*"(\.[^"]*)"/g;
  for (const match of source.matchAll(pattern)) {
    for (const piece of match[1].split(",")) {
      const name = piece.trim().split(/\s+as\s+/)[0].trim();
      if (name) results.push({ name, specifier: match[2] });
    }
  }
  return results;
}

test("main.js imports every target-registry symbol it uses", async () => {
  const source = await readWeb("main.js");
  const available = exportedNames(await readWeb("target_registry.js"));
  const imported = importedFrom(source, "target_registry\\.js");
  const missing = [...available].filter(
    (name) => new RegExp(`(?<![\\w.$])${name}\\s*\\(`).test(source) && !imported.has(name),
  );
  assert.deepEqual(missing, [], `main.js uses but does not import: ${missing.join(", ")}`);
});

test("every registry symbol used in the web bundle is imported", async () => {
  const available = exportedNames(await readWeb("target_registry.js"));
  const offenders = [];
  for (const file of await jsFiles(webRoot)) {
    if (path.basename(file) === "target_registry.js") continue;
    const source = await readFile(file, "utf8");
    const imported = importedFrom(source, "target_registry\\.js");
    for (const name of available) {
      // Match a call or member access, but not the name inside an import list.
      const callPattern = new RegExp(`(?<![\\w.$])${name}\\s*\\(`);
      const importedNames = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"[^"]*target_registry`);
      if (callPattern.test(source) && !imported.has(name) && !importedNames.test(source)) {
        offenders.push(`${path.relative(webRoot, file)} -> ${name}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `registry symbols used without import:\n${offenders.join("\n")}`);
});

test("every local import in the web bundle resolves and exports its names", async () => {
  const missing = [];
  for (const file of await jsFiles(webRoot)) {
    const source = await readFile(file, "utf8");
    for (const { name, specifier } of localImports(source)) {
      const resolved = path.resolve(path.dirname(file), specifier);
      let target;
      try {
        target = await readFile(resolved, "utf8");
      } catch {
        missing.push(`${path.relative(webRoot, file)} -> ${specifier} (module not found)`);
        continue;
      }
      if (!exportedNames(target).has(name)) {
        missing.push(`${path.relative(webRoot, file)} -> ${specifier} -> ${name}`);
      }
    }
  }
  assert.deepEqual(missing, [], missing.join("\n"));
});

test("every name main.js imports from a local module exists there", async () => {
  const missing = [];
  for (const { name, specifier } of localImports(await readWeb("main.js"))) {
    let target;
    try {
      target = await readFile(path.resolve(webRoot, specifier), "utf8");
    } catch {
      missing.push(`${specifier} (module not found)`);
      continue;
    }
    if (!exportedNames(target).has(name)) missing.push(`${specifier} -> ${name}`);
  }
  assert.deepEqual(missing, [], `main.js imports nonexistent names: ${missing.join(", ")}`);
});

test("the standalone host resolves its relative imports", async () => {
  const missing = [];
  for (const file of await jsFiles(standaloneRoot)) {
    const source = await readFile(file, "utf8");
    for (const { name, specifier } of localImports(source)) {
      const resolved = path.resolve(path.dirname(file), specifier);
      let target;
      try {
        target = await readFile(resolved, "utf8");
      } catch {
        // Assets served over HTTP resolve at runtime, not on disk.
        continue;
      }
      if (!exportedNames(target).has(name)) {
        missing.push(`${path.relative(standaloneRoot, file)} -> ${specifier} -> ${name}`);
      }
    }
  }
  assert.deepEqual(missing, [], missing.join("\n"));
});

/** Every name introduced by an import statement (named, default, or aliased). */
function importedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"[^"]*"/g)) {
    for (const piece of match[1].split(",")) {
      const name = piece.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  for (const match of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) names.add(match[1]);
  return names;
}

/** Top-level declaration names mapped to the line numbers declaring them. */
function declaredNames(source) {
  const found = new Map();
  const pattern = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of source.matchAll(pattern)) {
    const line = source.slice(0, match.index).split("\n").length;
    found.set(match[1], [...(found.get(match[1]) || []), line]);
  }
  return found;
}

test("no module declares the same name twice", async () => {
  const offenders = [];
  for (const file of await jsFiles(webRoot)) {
    const source = await readFile(file, "utf8");
    for (const [name, lines] of declaredNames(source)) {
      if (lines.length > 1) offenders.push(`${path.relative(webRoot, file)}: ${name} at ${lines.join(", ")}`);
    }
  }
  assert.deepEqual(offenders, [], `duplicate declarations:\n${offenders.join("\n")}`);
});

test("no top-level declaration shadows an import", async () => {
  // A local copy of an imported name is a redeclaration SyntaxError in an ES
  // module, so the browser refuses to load the file at all.
  const offenders = [];
  for (const file of await jsFiles(webRoot)) {
    const source = await readFile(file, "utf8");
    const imported = importedNames(source);
    for (const [name, lines] of declaredNames(source)) {
      if (imported.has(name)) offenders.push(`${path.relative(webRoot, file)}: ${name} (line ${lines[0]})`);
    }
  }
  assert.deepEqual(offenders, [], `declarations shadowing imports:\n${offenders.join("\n")}`);
});

test("every web module parses as an ES module", async () => {
  // A syntax error stops the extension from loading with no test-time signal,
  // so parse each file the way the browser will.
  const { spawnSync } = await import("node:child_process");
  const offenders = [];
  for (const file of await jsFiles(webRoot)) {
    const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (check.status !== 0) {
      offenders.push(`${path.relative(webRoot, file)}: ${(check.stderr || "").split("\n")[0]}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("the deleted prompt-model screen leaves no dangling imports or hooks", async () => {
  const source = await readWeb("main.js");
  // These were removed deliberately: the launch screen selects the generation
  // target, not the prompt model (LLM).
  assert.doesNotMatch(source, /model_selection\.js/);
  assert.doesNotMatch(source, /modelSelectionMarkup|setModelSelectionOpen|confirmModelSelection/);
  assert.doesNotMatch(source, /data-model-select|data-change-model/);
  assert.doesNotMatch(source, /"model_select",/);
  // The original top-bar prompt-model pill still opens Settings.
  assert.match(source, /querySelector\("\[data-open-settings\]"\)\.addEventListener\("click", \(\) => setSettingsOpen\(true\)\)/);
});

test("the target selection screen is wired into the studio shell", async () => {
  const source = await readWeb("main.js");
  assert.match(source, /import \{ targetSelectionMarkup \} from "\.\/target_selection\.js"/);
  assert.match(source, /targetSelectionMarkup\(\)/);
  assert.match(source, /setTargetSelectionOpen\(true\)/);
  // Its stylesheet must be registered, or the screen renders unstyled.
  assert.match(source, /"target_select",/);
  // Every event hook it declares in markup must be bound somewhere.
  for (const hook of ["data-open-target-select", "data-target-select-confirm"]) {
    const bound = source.includes(`querySelector("[${hook}]").addEventListener`);
    assert.ok(bound, `${hook} is in the markup but never bound`);
  }
  // And the markup module must actually declare those hooks.
  const markup = await readWeb("target_selection.js");
  for (const hook of ["data-target-select-view", "data-target-select-list", "data-target-select-status", "data-target-select-confirm"]) {
    assert.match(markup, new RegExp(hook), `${hook} missing from target_selection.js`);
  }
});


test("the launcher opens on a plain press and only drags past a threshold", async () => {
  const source = await readWeb("main.js");
  // Movement is measured from the press point, not from event.movementX/Y, which
  // made the first click start a drag instead of opening the studio.
  assert.match(source, /const DRAG_THRESHOLD_PX = \d+/);
  assert.match(source, /Math\.abs\(event\.clientX - drag\.startX\) \+ Math\.abs\(event\.clientY - drag\.startY\)/);
  assert.doesNotMatch(source, /drag\.moved \|\|= Math\.abs\(event\.movementX\)/);
  // A press with no movement must open the studio.
  assert.match(source, /if \(moved\) \{[\s\S]{0,220}\} else \{\s*openStudio\(\);/);
  // Presses that do not travel far enough must not move the launcher.
  assert.match(source, /if \(travelled <= DRAG_THRESHOLD_PX\) return;/);
});
