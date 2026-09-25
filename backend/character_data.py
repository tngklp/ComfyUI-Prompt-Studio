"""Character dataset acquisition, caching and first-launch download.

The Anima character index is not shipped with the studio any more - the real
catalogue is 36,000 rows and 9 MB, which has no business inside a ComfyUI custom
node. Instead the dataset is downloaded once from AnimaDex's public blob store,
converted to the compact JSON index, and cached on disk. Every later launch reads
the cache and never touches the network.

Design decisions worth keeping
------------------------------
*   **The download is not on the request path.** A ComfyUI extension must not open
    a 9 MB socket during import, and the user may be offline. Acquisition therefore
    runs as a background task with a short timeout, and the studio works with an
    empty index until it finishes.
*   **The cached index, not the CSV, is what is stored.** The CSV is 9 MB and takes
    ~1.3 s to parse; the JSON index is 4 MB and loads with ``json.loads``. Caching
    the parsed form is what keeps startup fast.
*   **A failed download is not an error state.** Offline first launch leaves the
    studio fully usable, with the picker reporting that no characters are available.
    Only a *cache write* failure is worth surfacing, and even that is a warning.
*   **The cache is written atomically.** A half-written 4 MB index would be worse
    than no index, and a crash mid-download must not leave a corrupt file that the
    next launch trusts.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .characters import (
    BUNDLED_USEFUL_THRESHOLD,
    CharacterIndex,
    CharacterIndexError,
    parse_csv,
)

LOGGER = logging.getLogger("prompt_studio.character_data")

# AnimaDex publishes a token-free export at this path. It is the same file the
# AnimaDex site's "Offline dataset export" wizard produces, so the trigger column
# already carries the exact `<character>, <series>` pair Anima expects.
DATASET_URL = "https://blobs.animadex.net/export/characters.csv"

# The download is 9 MB. 60 s is generous for a slow connection while still failing
# long before a user would give up and close the window.
DOWNLOAD_TIMEOUT_SECONDS = 60

# Below this the downloaded index is not worth caching: the file was probably a
# truncated transfer or an HTML error page that happened to parse as one row.
MIN_CACHEABLE_CHARACTERS = BUNDLED_USEFUL_THRESHOLD

# The cache lives beside the shipped data so that deleting one directory resets the
# feature completely. It is deliberately NOT inside the package's tracked data
# folder - see .gitignore.
CACHE_PATH = Path(__file__).resolve().parent / "data" / "anima_characters.cache.json"

# A cache older than this is refreshed in the background. AnimaDex adds characters
# continuously but the catalogue is stable enough that 30 days is invisible to the
# user while keeping a long-lived install reasonably current.
CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60


class CharacterDownloadError(RuntimeError):
    """A dataset download or cache write failed. Carries a stable error code."""

    def __init__(self, code: str, message: str, *, detail: str = ""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


def cache_path() -> Path:
    """The on-disk index cache. Indirected so tests can redirect it."""
    return CACHE_PATH


def _atomic_write(path: Path, payload: str) -> None:
    """Write ``payload`` to ``path`` via a temp file and a rename.

    A rename within one directory is atomic on every platform we ship, so a reader
    either sees the old index or the new one - never a partial file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        # Leaving a stray temp file behind would slowly fill the data directory.
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def serialize(entries: list[Any], *, source: str) -> str:
    """Render parsed entries as the compact cache/index format.

    The same shape the committed offline sample uses, so a downloaded index and the
    shipped fallback are interchangeable.
    """
    return json.dumps(
        {
            "source": source,
            "url": DATASET_URL,
            "fetched_at": int(time.time()),
            "note": "Ordered by training-image count. Cached from the AnimaDex export.",
            "characters": [
                {
                    "character": entry.character,
                    "copyright": entry.copyright,
                    "trigger": entry.trigger,
                    "count": entry.count,
                }
                for entry in entries
            ],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ) + "\n"


def cache_is_stale(path: Path | None = None, *, max_age: int = CACHE_MAX_AGE_SECONDS) -> bool:
    """True when the cache is missing or older than ``max_age``."""
    target = path or cache_path()
    try:
        age = time.time() - target.stat().st_mtime
    except OSError:
        return True
    return age > max_age


def load_cache(path: Path | None = None) -> CharacterIndex | None:
    """Load the cached index, or None when there is no usable cache.

    A corrupt or empty cache is treated as absent rather than as an error, so a
    interrupted download self-heals on the next launch instead of bricking the
    picker.
    """
    target = path or cache_path()
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    if not isinstance(raw, dict):
        return None
    rows = raw.get("characters")
    if not isinstance(rows, list) or len(rows) < MIN_CACHEABLE_CHARACTERS:
        return None
    entries = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        character = str(row.get("character") or "").strip()
        if not character:
            continue
        entries.append(
            _entry(character, row.get("copyright"), row.get("trigger"), row.get("count"))
        )
    if len(entries) < MIN_CACHEABLE_CHARACTERS:
        return None
    source = str(raw.get("source") or "AnimaDex export")
    return CharacterIndex(entries, source=source)


def _entry(character: str, copyright_value: Any, trigger_value: Any, count_value: Any):
    """Build a CharacterRef from cache columns, mirroring the CSV reader's rules."""
    from .characters import _entry_from_row  # local import: keeps the shared rules in one place

    return _entry_from_row(
        {
            "character": character,
            "copyright": "" if copyright_value is None else str(copyright_value),
            "trigger": "" if trigger_value is None else str(trigger_value),
            "count": "" if count_value is None else str(count_value),
        }
    )


def download_dataset(
    url: str = DATASET_URL,
    *,
    timeout: int = DOWNLOAD_TIMEOUT_SECONDS,
) -> str:
    """Fetch the AnimaDex CSV export and return it as text.

    Raises ``CharacterDownloadError`` with a stable code so the caller can tell a
    network problem from a bad response.
    """
    request = urllib.request.Request(
        url,
        headers={
            # Identify the studio instead of sending urllib's default agent, so an
            # operator looking at their own logs can see who is fetching.
            "User-Agent": "PromptStudio/1.0 (+https://github.com/tngklp/ComfyUI-Prompt-Studio)",
            "Accept": "text/csv,text/plain;q=0.9,*/*;q=0.5",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                raise CharacterDownloadError(
                    "CHARACTER_DOWNLOAD_FAILED",
                    f"AnimaDex returned HTTP {status}.",
                )
            body = response.read()
    except urllib.error.HTTPError as error:
        raise CharacterDownloadError(
            "CHARACTER_DOWNLOAD_FAILED",
            f"AnimaDex returned HTTP {error.code}.",
            detail=str(error.reason or ""),
        ) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise CharacterDownloadError(
            "CHARACTER_DOWNLOAD_FAILED",
            "The AnimaDex character dataset could not be downloaded.",
            detail=str(getattr(error, "reason", error) or error),
        ) from error
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CharacterDownloadError(
            "CHARACTER_DOWNLOAD_FAILED",
            "The AnimaDex character dataset was not valid UTF-8.",
            detail=str(error),
        ) from error


def refresh_cache(
    *,
    url: str = DATASET_URL,
    path: Path | None = None,
    timeout: int = DOWNLOAD_TIMEOUT_SECONDS,
) -> CharacterIndex:
    """Download the dataset and replace the cached index.

    Both failure modes - a network problem and an unusable payload - surface as
    ``CharacterDownloadError`` so callers have one thing to handle.
    """
    target = path or cache_path()
    text = download_dataset(url, timeout=timeout)
    try:
        entries = parse_csv(text)
    except CharacterIndexError as error:
        raise CharacterDownloadError(
            "CHARACTER_DATASET_INVALID",
            "The AnimaDex character dataset could not be read.",
            detail=f"{error.code}: {error.message}",
        ) from error
    if len(entries) < MIN_CACHEABLE_CHARACTERS:
        raise CharacterDownloadError(
            "CHARACTER_DATASET_INVALID",
            "The AnimaDex character dataset was unexpectedly small and was not cached.",
            detail=f"{len(entries)} usable rows (expected at least {MIN_CACHEABLE_CHARACTERS}).",
        )
    try:
        _atomic_write(target, serialize(entries, source="AnimaDex export (characters.csv)"))
    except OSError as error:
        raise CharacterDownloadError(
            "CHARACTER_CACHE_WRITE_FAILED",
            "The character dataset downloaded but could not be stored.",
            detail=str(error),
        ) from error
    return CharacterIndex(entries, source="AnimaDex export (characters.csv)")


def ensure_dataset(*, url: str = DATASET_URL, path: Path | None = None) -> bool:
    """Populate the cache when it is missing or stale. Returns True if it downloaded.

    Never raises: this is called from a background task at startup, where a failure
    has to leave the studio running rather than surface a traceback.
    """
    target = path or cache_path()
    if not cache_is_stale(target):
        return False
    try:
        index = refresh_cache(url=url, path=target)
    except CharacterDownloadError as error:
        LOGGER.warning("Character dataset unavailable: %s (%s)", error.message, error.detail)
        return False
    except Exception:  # pragma: no cover - defensive: a background task must not escape
        LOGGER.exception("Unexpected failure while fetching the character dataset")
        return False
    LOGGER.info("Cached %d Anima characters from %s", len(index), url)
    return True


_STARTUP_LOCK = threading.Lock()
_STARTUP_STATE: dict[str, Any] = {"started": False, "thread": None}


def start_background_fetch(*, url: str = DATASET_URL, path: Path | None = None) -> threading.Thread | None:
    """Kick off a one-shot background download if the cache needs one.

    Idempotent per process: calling it from both the route layer and a startup hook
    must not start two 9 MB downloads.
    """
    with _STARTUP_LOCK:
        if _STARTUP_STATE["started"] or not cache_is_stale(path):
            return None
        _STARTUP_STATE["started"] = True

    thread = threading.Thread(
        target=ensure_dataset,
        kwargs={"url": url, "path": path},
        name="ps-character-dataset",
        daemon=True,
    )
    _STARTUP_STATE["thread"] = thread
    thread.start()
    return thread


def wait_for_background_fetch(timeout: float = 120.0) -> None:
    """Block until the startup fetch finishes. Tests only; never call from a route."""
    thread = _STARTUP_STATE.get("thread")
    if thread is not None:
        thread.join(timeout)


def reset_startup_state() -> None:
    """Allow another background fetch in this process. Tests only."""
    with _STARTUP_LOCK:
        _STARTUP_STATE["started"] = False
        _STARTUP_STATE["thread"] = None
