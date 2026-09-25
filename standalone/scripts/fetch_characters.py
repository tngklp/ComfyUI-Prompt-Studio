"""Fetch the Anima character catalogue, if it is not already cached.

Run by ``start.bat`` before the application starts, so the first launch pays the
download cost once, up front, with visible progress instead of in the background
behind a picker that looks empty.

Idempotent by design: it exits silently and immediately (status 0) when a current
cache is present, so every later launch is unaffected. A failure exits non-zero so
the launcher can print a warning, but the studio deliberately still starts - the
character picker is a convenience and must never block the app.

Not part of the web application's request path, and not imported by it.
"""

from __future__ import annotations

import sys
from pathlib import Path

# The core checkout sits beside the app in a source tree and under "upstream/" in a
# packaged ZIP, so both are tried rather than assuming one layout.
APP_ROOT = Path(__file__).resolve().parents[1]
for candidate in (APP_ROOT, APP_ROOT / "upstream", APP_ROOT.parent):
    if (candidate / "backend" / "characters.py").is_file():
        sys.path.insert(0, str(candidate))
        break
else:
    print("Could not locate the Prompt Studio checkout.", file=sys.stderr)
    raise SystemExit(1)

from backend import character_data  # noqa: E402


def main() -> int:
    target = character_data.cache_path()
    if not character_data.cache_is_stale(target):
        # Already fetched recently. Say nothing: a normal launch should be quiet.
        return 0

    print("Downloading the Anima character catalogue (about 9 MB, once only)...")
    try:
        index = character_data.refresh_cache()
    except character_data.CharacterDownloadError as error:
        print(f"  {error.message}", file=sys.stderr)
        if error.detail:
            print(f"  {error.detail}", file=sys.stderr)
        print("  Characters will be unavailable until this succeeds.", file=sys.stderr)
        return 1

    size_mb = target.stat().st_size / 1024 / 1024 if target.is_file() else 0
    print(f"  Cached {len(index):,} characters ({size_mb:.1f} MB).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
