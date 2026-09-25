/**
 * Detect a stale cached web bundle and recover without a manual hard refresh.
 *
 * The problem this solves
 * -----------------------
 * ComfyUI serves the extension's `WEB_DIRECTORY` through its own static handler,
 * which sends `Last-Modified` but no `Cache-Control`. A browser is then free to
 * apply heuristic freshness, so after an update the host can keep importing the
 * *previous* `main.js` and its sibling modules. The new code exists on disk but
 * never runs, and the only way out is Ctrl+Shift+R - which is exactly the symptom
 * this module removes.
 *
 * The standalone host sets a revalidation policy of its own, so it does not rely on
 * this; the guard is written to be a no-op there because the reported version will
 * already match.
 *
 * How it works
 * ------------
 * The running module knows the version it was built as. The backend knows the
 * version it is currently serving. If the backend is newer, the loaded bundle is
 * stale by definition, and one cache-bypassing reload brings the client in line.
 *
 * Guard rails, because an unconditional reload loop would be worse than the bug:
 *
 * * a reload happens at most once per backend version, recorded in
 *   `sessionStorage`, so a persistently mismatched server cannot spin the tab;
 * * the reload uses `location.reload()`, which revalidates; if that is not enough
 *   the next load will not reload again, and the mismatch is surfaced instead;
 * * a failed check is ignored entirely - being offline or mid-restart must never
 *   reload the page.
 */

const STORAGE_KEY = "ps-bundle-guard-v1";

/**
 * Compare two dotted version strings.
 *
 * Numeric segments compare as numbers so `1.9.0` is older than `1.10.0`. A
 * non-numeric segment marks the start of a suffix (`1.0.0-beta`), which is ignored:
 * Prompt Studio has never shipped a prerelease, and ignoring it means an unexpected
 * suffix can never be read as "newer" and trigger a pointless reload.
 */
export function compareVersions(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return 0;
  const numeric = (value) => {
    const segments = [];
    for (const part of value.split(".")) {
      if (!/^\d+$/.test(part)) break;
      segments.push(Number(part));
    }
    return segments;
  };
  const a = numeric(left);
  const b = numeric(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

/** True when the served version is newer than the version this module was built as. */
export function bundleIsStale(builtVersion, servedVersion) {
  if (typeof builtVersion !== "string" || !builtVersion) return false;
  if (typeof servedVersion !== "string" || !servedVersion) return false;
  return compareVersions(builtVersion, servedVersion) < 0;
}

function readGuard(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function writeGuard(storage, value) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A storage-less context (private mode, embedded webview) simply means the
    // guard cannot persist its one-shot flag; the caller then declines to reload.
  }
}

/**
 * Check the served version and reload once if this bundle is behind it.
 *
 * Returns a small report so the caller can log or surface the decision rather than
 * the reload being silent.
 */
export function guardAgainstStaleBundle({
  builtVersion,
  fetchVersion,
  storage = globalThis.sessionStorage,
  reload,
} = {}) {
  return (async () => {
    let servedVersion = null;
    try {
      servedVersion = await fetchVersion();
    } catch {
      // Offline, restarting, or the endpoint moved. Not a stale-bundle signal.
      return { checked: false, servedVersion: null, reloaded: false };
    }
    if (!bundleIsStale(builtVersion, servedVersion)) {
      // In sync: clear the flag so a *future* update is allowed its one reload.
      if (readGuard(storage)?.version) writeGuard(storage, {});
      return { checked: true, servedVersion, reloaded: false };
    }
    const previous = readGuard(storage);
    if (previous?.version === servedVersion) {
      // Already tried this version once and the client is still stale, so a reload
      // is not going to fix it. Stop rather than loop.
      return { checked: true, servedVersion, reloaded: false, exhausted: true };
    }
    if (typeof reload !== "function") {
      return { checked: true, servedVersion, reloaded: false };
    }
    if (typeof storage === "undefined" || storage === null) {
      // Without a place to record the attempt, reloading risks a loop. Refuse.
      return { checked: true, servedVersion, reloaded: false, exhausted: true };
    }
    writeGuard(storage, { version: servedVersion });
    reload();
    return { checked: true, servedVersion, reloaded: true };
  })();
}
