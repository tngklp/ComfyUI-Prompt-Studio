/**
 * Regression tests for the stale-asset caching fix.
 *
 * The bug: after updating Prompt Studio, a new stylesheet or module did not take
 * effect until the user pressed Ctrl+Shift+R. The cause is that both hosts served
 * web assets without a `Cache-Control` header, leaving the browser free to apply
 * heuristic freshness to files that change whenever the project does.
 *
 * Two independent fixes are pinned here.
 *
 * 1. **Standalone** sets an explicit revalidation policy, so a changed file is
 *    picked up on an ordinary reload (`standalone/prompt_studio/static_serving.py`).
 * 2. **The extension** cannot change ComfyUI's server, so it (a) appends a version
 *    token to every asset URL it injects itself, and (b) compares the version it was
 *    built as against the version the backend reports, reloading once if it is
 *    behind. That covers `main.js` itself, which the host imports and we therefore
 *    cannot bust from inside.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const mainSource = await read("../web/main.js");
const guardSource = await read("../web/bundle_guard.js");
const servingSource = await read("../standalone/prompt_studio/static_serving.py");
const appSource = await read("../standalone/prompt_studio/app.py");
const versionSource = await read("../backend/version.py");

const { compareVersions, bundleIsStale, guardAgainstStaleBundle } = await import("../web/bundle_guard.js");

/** Minimal sessionStorage stand-in so a test can inspect what the guard recorded. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    get size() { return data.size; },
  };
}

test("the standalone host states its cache policy instead of leaving it to the browser", () => {
  // aiohttp's add_static sends Last-Modified and ETag but no Cache-Control, which is
  // what let a browser treat a changed file as still fresh.
  assert.match(servingSource, /REVALIDATE_HEADERS = \{\s*"Cache-Control": "no-cache, must-revalidate",\s*\}/);
  // `no-cache` means "revalidate before use", not "do not store".
  assert.match(servingSource, /no-cache, must-revalidate/);
  assert.match(servingSource, /headers\["ETag"\]/);
  // A conditional request must be answerable with a 304 rather than a body.
  assert.match(servingSource, /request\.headers\.get\("If-None-Match"\) == etag/);
  assert.match(servingSource, /raise web\.HTTPNotModified\(headers=headers\)/);
});

test("the standalone host serves every asset tree through the revalidating handler", () => {
  assert.match(appSource, /from \.static_serving import register_static/);
  for (const prefix of ["/app-icons/", "/scripts/", "/"]) {
    assert.match(
      appSource,
      new RegExp(`register_static\\(app, "${prefix.replace(/\//g, "\\/")}", `),
      `${prefix} must be served with the revalidation policy`,
    );
  }
  // The bare add_static calls are what caused the stale cache; none may remain.
  assert.doesNotMatch(appSource, /add_static\(/);
});

test("the standalone static handler refuses path traversal", () => {
  // A traversal attempt must be indistinguishable from a missing file rather than
  // escaping the served directory.
  assert.match(servingSource, /candidate\.relative_to\(self\._directory\.resolve\(\)\)/);
  assert.match(servingSource, /except ValueError:\s*\n\s*return None/);
  assert.match(servingSource, /raise web\.HTTPNotFound\(\)/);
});

test("the ETag changes when a file changes and is stable when it does not", () => {
  // Derived from size and mtime so it costs one stat call rather than hashing.
  assert.match(servingSource, /f"\{path\}:\{stat\.st_size\}:\{stat\.st_mtime_ns\}"/);
});

test("the standalone handler serves the extensions a stale cache actually breaks", () => {
  for (const extension of [".js", ".mjs", ".css", ".json", ".svg"]) {
    assert.match(servingSource, new RegExp(`"${extension.replace(".", "\\.")}"`), extension);
  }
});

test("the extension appends a version token to the assets it injects itself", () => {
  assert.match(mainSource, /function brandedAssetUrl\(relative\)/);
  assert.match(mainSource, /url\.searchParams\.set\("v", assetToken\)/);
  // The stylesheet links are the highest-value case: a stale one silently keeps old
  // layout and colours with no error anywhere.
  assert.match(mainSource, /const href = brandedAssetUrl\(`\.\/styles\/\$\{name\}\.css`\)/);
  assert.match(mainSource, /link\.href = href;/);
  // And the brand mark, which is also fetched by URL.
  assert.match(mainSource, /const studioBrandIcon = brandedAssetUrl\("\.\/assets\/prompt-studio-launcher\.svg"\)/);
  assert.match(mainSource, /const launcherIcon = brandedAssetUrl\("\.\/assets\/prompt-studio-launcher\.svg"\)/);
});

test("a stylesheet link whose token changed is replaced, not left in place", () => {
  // Skipping an existing link would pin the first render's stylesheet for the whole
  // session, so the token would never take effect.
  assert.match(mainSource, /const existing = document\.querySelector\(`link\[data-ps-style="\$\{name\}"\]`\)/);
  assert.match(mainSource, /if \(existing\.dataset\.psStyleHref === href\) continue;/);
  assert.match(mainSource, /existing\.remove\(\)/);
  assert.match(mainSource, /link\.dataset\.psStyleHref = href/);
});

test("the bundle version constant matches the backend version", async () => {
  // The guard is only correct while these agree: if they drift, every load either
  // never reloads or always thinks it is stale.
  const declared = versionSource.match(/VERSION\s*=\s*"([^"]+)"/)?.[1];
  const bundled = mainSource.match(/const EXTENSION_VERSION = "([^"]+)"/)?.[1];
  assert.ok(declared, "backend/version.py must declare a version");
  assert.ok(bundled, "main.js must declare EXTENSION_VERSION");
  assert.equal(bundled, declared, "EXTENSION_VERSION must match backend/version.py");
});

test("version comparison handles the dotted forms a version can take", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0", "1.0.1"), -1);
  assert.equal(compareVersions("1.0.1", "1.0.0"), 1);
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1, "numeric segments must compare as numbers");
  assert.equal(compareVersions("1.0", "1.0.0"), 0, "a missing segment counts as zero");
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
  // A suffix such as "-beta" is ignored for ordering: Prompt Studio has never
  // shipped a prerelease, and treating it as a suffix keeps an unexpected value
  // from being read as a downgrade.
  assert.equal(compareVersions("1.0.0-beta", "1.0.0"), 0);
});

test("staleness only fires when the served version is genuinely newer", () => {
  assert.equal(bundleIsStale("1.0.0", "1.0.1"), true);
  assert.equal(bundleIsStale("1.0.0", "1.0.0"), false);
  // A newer client than server is not stale - that is a downgrade, and reloading
  // would not help.
  assert.equal(bundleIsStale("1.0.1", "1.0.0"), false);
  // A missing version on either side must never trigger a reload.
  assert.equal(bundleIsStale("1.0.0", null), false);
  assert.equal(bundleIsStale(null, "1.0.0"), false);
  assert.equal(bundleIsStale("", "1.0.0"), false);
});

test("a stale bundle reloads once", async () => {
  const storage = memoryStorage();
  let reloads = 0;
  const report = await guardAgainstStaleBundle({
    builtVersion: "1.0.0",
    fetchVersion: async () => "1.0.1",
    storage,
    reload: () => { reloads += 1; },
  });
  assert.equal(report.reloaded, true);
  assert.equal(reloads, 1);
  // The attempt is recorded, which is what makes the guard one-shot.
  assert.equal(JSON.parse(storage.getItem("ps-bundle-guard-v1")).version, "1.0.1");
});

test("a persistent mismatch does not reload in a loop", async () => {
  // The failure this guards against: a proxy serving an old version forever would
  // otherwise spin the tab.
  const storage = memoryStorage();
  let reloads = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const report = await guardAgainstStaleBundle({
      builtVersion: "1.0.0",
      fetchVersion: async () => "1.0.1",
      storage,
      reload: () => { reloads += 1; },
    });
    if (attempt > 0) assert.equal(report.exhausted, true, "later attempts must report exhaustion");
  }
  assert.equal(reloads, 1, "only the first attempt may reload");
});

test("a newer backend version is allowed its own reload", async () => {
  // After the guard reloaded for 1.0.1, a later update to 1.0.2 must still reload.
  const storage = memoryStorage({ "ps-bundle-guard-v1": JSON.stringify({ version: "1.0.1" }) });
  let reloads = 0;
  const report = await guardAgainstStaleBundle({
    builtVersion: "1.0.0",
    fetchVersion: async () => "1.0.2",
    storage,
    reload: () => { reloads += 1; },
  });
  assert.equal(report.reloaded, true);
  assert.equal(reloads, 1);
});

test("an in-sync client never reloads and clears the one-shot flag", async () => {
  const storage = memoryStorage({ "ps-bundle-guard-v1": JSON.stringify({ version: "1.0.1" }) });
  let reloads = 0;
  const report = await guardAgainstStaleBundle({
    builtVersion: "1.0.1",
    fetchVersion: async () => "1.0.1",
    storage,
    reload: () => { reloads += 1; },
  });
  assert.equal(report.reloaded, false);
  assert.equal(reloads, 0);
  // Clearing the flag lets a subsequent update reload rather than appearing exhausted.
  assert.equal(JSON.parse(storage.getItem("ps-bundle-guard-v1")).version, undefined);
});

test("an unreachable backend never reloads", async () => {
  // Offline, mid-restart, or a moved endpoint must not reload the page.
  let reloads = 0;
  const report = await guardAgainstStaleBundle({
    builtVersion: "1.0.0",
    fetchVersion: async () => { throw new Error("offline"); },
    storage: memoryStorage(),
    reload: () => { reloads += 1; },
  });
  assert.equal(report.checked, false);
  assert.equal(report.reloaded, false);
  assert.equal(reloads, 0);
});

test("without somewhere to record the attempt the guard declines to reload", async () => {
  // Reloading with no way to remember it would risk an infinite loop in a context
  // such as a private window.
  let reloads = 0;
  const report = await guardAgainstStaleBundle({
    builtVersion: "1.0.0",
    fetchVersion: async () => "1.0.1",
    storage: null,
    reload: () => { reloads += 1; },
  });
  assert.equal(report.reloaded, false);
  assert.equal(report.exhausted, true);
  assert.equal(reloads, 0);
});

test("the guard runs at startup, before the studio is built", () => {
  assert.match(mainSource, /import \{ guardAgainstStaleBundle \} from "\.\/bundle_guard\.js"/);
  assert.match(mainSource, /await guardAgainstStaleBundle\(\{/);
  assert.match(mainSource, /builtVersion: EXTENSION_VERSION/);
  assert.match(mainSource, /fetchVersion: async \(\) => \(await getStatus\(\)\)\.version/);
  // Ordering matters: a stale bundle must not render its interface first.
  const setup = mainSource.slice(mainSource.indexOf("async setup()"));
  assert.ok(
    setup.indexOf("guardAgainstStaleBundle") < setup.indexOf("installLauncher"),
    "the guard must run before the launcher renders",
  );
  assert.match(guardSource, /sessionStorage/, "the flag is session-scoped, so a new tab starts clean");
});
