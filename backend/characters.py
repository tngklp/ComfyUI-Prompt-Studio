"""Anima character references from the AnimaDex dataset.

Why a character reference exists
--------------------------------
Anima is trained on Danbooru-style captions, and its guide requires a named character
to be followed by basic appearance description, with the series named after the
character. Getting that right by hand means knowing the exact Danbooru spelling of
both the character and the series - ``hatsune miku, vocaloid``, not ``Miku`` and not
``Vocaloid``. A misspelled or reordered name degrades the result silently.

This module turns a character *name* into that exact pair, from the same dataset the
community uses.

Data source
-----------
`AnimaDex <https://github.com/zetaneko/AnimaDex>`_ (MIT) publishes the catalogue as a
CSV whose ``trigger`` column already holds ``<character>, <series>`` in the spelling
the model expects::

    character,copyright,trigger,core_tags,count,url
    hatsune_miku,vocaloid,"hatsune miku, vocaloid","1girl, aqua eyes, ...",103500,...

The full export is ~36,000 rows and 9 MB, so it is **not** shipped with the studio.
``backend/character_data.py`` downloads it once from the public blob store and caches
the parsed index; this module reads whichever source is available. Nothing
downstream needs to know which one that was - both the downloaded cache and the
committed offline sample produce the same record shape.
"""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Iterator

# The sample index committed to the repository. It exists only as a fallback for a
# first launch that is offline, and is deliberately tiny: the real catalogue is
# downloaded by backend/character_data.py.
DATA_PATH = Path(__file__).resolve().parent / "data" / "anima_characters.json"

# Tags Anima's guide says must never be treated as a character: they are appearance,
# count or meta tags that happen to live in the same caption.
NON_CHARACTER_TAGS = frozenset({
    "1girl", "1boy", "2girls", "2boys", "multiple girls", "multiple boys",
    "solo", "no humans", "1other",
})

MAX_TRIGGER_LENGTH = 120
# Below this the bundled index is treated as a sample rather than a real catalogue,
# and the interface says so and points at the import path.
BUNDLED_USEFUL_THRESHOLD = 200


@dataclass(frozen=True)
class CharacterRef:
    """One character, with the exact trigger Anima should receive."""

    character: str
    copyright: str
    trigger: str
    core_tags: tuple[str, ...] = ()
    count: int = 0

    @property
    def display_name(self) -> str:
        """Title-cased character name, for the picker's label."""
        return " ".join(word.capitalize() for word in self.character.replace("_", " ").split())

    @property
    def series(self) -> str:
        return self.copyright.replace("_", " ")

    def public(self) -> dict[str, Any]:
        return {
            "character": self.character,
            "copyright": self.copyright,
            "trigger": self.trigger,
            "display_name": self.display_name,
            "series": self.series,
            "count": self.count,
        }


def normalize_name(value: str) -> str:
    """Fold a name for matching: case, underscore/space, and accents.

    A user types ``Hatsune Miku`` or ``hatsune_miku`` and both must find
    ``hatsune_miku``. The Danbooru slug keeps underscores, but nobody types those, so
    the underscore and the space are treated as the same character here.
    """
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.casefold().replace("_", " ").strip()
    return re.sub(r"\s+", " ", text)


def parse_trigger(trigger: str) -> tuple[str, str, tuple[str, ...]]:
    """Split an AnimaDex ``trigger`` into ``(character, series, extra)``.

    The trigger is ``<character>, <series>`` and may carry further comma-separated
    entries in the wild, so everything after the series is preserved rather than
    dropped.
    """
    parts = [part.strip() for part in str(trigger or "").split(",") if part.strip()]
    if not parts:
        return "", "", ()
    character = parts[0]
    series = parts[1] if len(parts) > 1 else ""
    return character, series, tuple(parts[2:])


class CharacterIndexError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class CharacterIndex:
    """Searchable set of character references.

    Lookup is a normalized-name map plus a substring scan. That is deliberate rather
    than a full-text index: the curated set is small, a linear scan over a few
    thousand short strings is imperceptible, and it keeps the module dependency-free
    so it loads the same inside ComfyUI and in the standalone host.
    """

    def __init__(self, entries: Iterable[CharacterRef], *, source: str = "builtin") -> None:
        self.source = source
        self._entries: list[CharacterRef] = list(entries)
        self._by_name: dict[str, CharacterRef] = {}
        self._by_character: dict[str, CharacterRef] = {}
        for entry in self._entries:
            self._by_character.setdefault(entry.character, entry)
            self._by_name.setdefault(normalize_name(entry.character), entry)
            # The full trigger is also a key, so pasting "<character>, <series>"
            # resolves as readily as typing just the character.
            self._by_name.setdefault(normalize_name(entry.trigger), entry)

    def __len__(self) -> int:
        return len(self._entries)

    @property
    def entries(self) -> tuple[CharacterRef, ...]:
        return tuple(self._entries)

    def lookup(self, name: str) -> CharacterRef | None:
        """Resolve one name to a character, or None when it is unknown.

        Matching is deliberately forgiving, because the user's mental model of a
        character's name is often shorter than the Danbooru slug: people write
        "miku" or "Miku", not "hatsune miku". Resolution therefore tries, in order:

        1. the exact normalized name or trigger;
        2. punctuation-insensitive equality;
        3. a unique final-word match, so "miku" finds ``hatsune_miku``;
        4. a unique whole-word match anywhere in the name, so "shogun" finds
           ``raiden_shogun``.

        Steps 3 and 4 require the match to be **unique**. Guessing between two
        characters would silently put the wrong name in the prompt, which is worse
        than reporting the name as unknown and letting the picker disambiguate.
        """
        key = normalize_name(name)
        if not key:
            return None
        exact = self._by_name.get(key)
        if exact:
            return exact

        collapsed = re.sub(r"[^a-z0-9]+", "", key)
        if collapsed:
            punctuation_matches = [
                entry
                for candidate_key, entry in self._by_name.items()
                if re.sub(r"[^a-z0-9]+", "", candidate_key) == collapsed
            ]
            if len({entry.character for entry in punctuation_matches}) == 1:
                return punctuation_matches[0]

        # A single trailing word ("miku" -> "hatsune miku", "reimu" -> "hakurei reimu").
        if " " not in key:
            tail_matches = {
                entry.character: entry
                for candidate_key, entry in self._by_name.items()
                if candidate_key.split(" ")[-1] == key
            }
            if len(tail_matches) == 1:
                return next(iter(tail_matches.values()))

        # A whole word anywhere in the name, still only when it is unambiguous.
        word_matches: dict[str, CharacterRef] = {}
        for candidate_key, entry in self._by_name.items():
            if re.search(rf"\b{re.escape(key)}\b", candidate_key):
                word_matches.setdefault(entry.character, entry)
        if len(word_matches) == 1:
            return next(iter(word_matches.values()))
        return None

    def search(self, query: str, limit: int = 24) -> list[CharacterRef]:
        """Rank characters matching a free-text query.

        Ranking puts an exact name match first, then a name prefix, then a word
        boundary inside the name, then series, then the general tags. Within a tier
        the popularity count breaks ties, so the most-used character wins.
        """
        key = normalize_name(query)
        if not key:
            return []
        tiered: list[tuple[int, int, CharacterRef]] = []
        for entry in self._entries:
            name = normalize_name(entry.character)
            series = normalize_name(entry.copyright)
            rank: int | None = None
            if name == key:
                rank = 0
            elif name.startswith(key):
                rank = 1
            elif re.search(rf"\b{re.escape(key)}", name):
                rank = 2
            elif series.startswith(key):
                rank = 3
            elif key in series:
                rank = 4
            elif any(key in normalize_name(tag) for tag in entry.core_tags):
                rank = 5
            if rank is None:
                continue
            tiered.append((rank, -entry.count, entry))
        tiered.sort(key=lambda item: (item[0], item[1], item[2].character))
        return [entry for _, _, entry in tiered[:limit]]

    def resolve_many(self, names: Iterable[str]) -> tuple[list[CharacterRef], list[str]]:
        """Resolve names, returning ``(found, unknown)``.

        Order is preserved and duplicates are dropped, so a selection keeps the order
        the user made it in and cannot emit the same character twice.
        """
        found: list[CharacterRef] = []
        unknown: list[str] = []
        seen: set[str] = set()
        for name in names:
            entry = self.lookup(name)
            if entry is None:
                unknown.append(name)
                continue
            if entry.character in seen:
                continue
            seen.add(entry.character)
            found.append(entry)
        return found, unknown


def _entry_from_row(row: dict[str, str]) -> CharacterRef | None:
    character = str(row.get("character") or "").strip()
    if not character or normalize_name(character) in NON_CHARACTER_TAGS:
        return None
    trigger = str(row.get("trigger") or "").strip()
    parsed_character, parsed_series, extra = parse_trigger(trigger)
    series = str(row.get("copyright") or "").strip() or parsed_series
    if not trigger:
        trigger = f"{parsed_character or character}, {series}".rstrip(", ")
    if len(trigger) > MAX_TRIGGER_LENGTH:
        return None
    tags = tuple(
        tag.strip()
        for tag in str(row.get("core_tags") or "").split(",")
        if tag.strip() and normalize_name(tag) not in NON_CHARACTER_TAGS
    )
    try:
        count = int(str(row.get("count") or "0").strip() or 0)
    except ValueError:
        count = 0
    return CharacterRef(
        character=character,
        copyright=series,
        trigger=trigger,
        core_tags=tags + extra,
        count=count,
    )


def parse_csv(text: str) -> list[CharacterRef]:
    """Parse an AnimaDex characters CSV.

    Unrecognised columns are ignored, which is what the upstream data format
    promises, so a user's own export with extra metadata still imports.
    """
    if text.startswith("\ufeff"):
        text = text[1:]
    reader = csv.DictReader(text.splitlines())
    if reader.fieldnames is None:
        raise CharacterIndexError("CHARACTER_CSV_EMPTY", "The character CSV has no header row.")
    if "character" not in reader.fieldnames:
        raise CharacterIndexError(
            "CHARACTER_CSV_INVALID",
            "The character CSV needs a 'character' column. AnimaDex exports character, copyright, trigger, core_tags, count, url.",
        )
    entries: list[CharacterRef] = []
    for row in reader:
        entry = _entry_from_row(row)
        if entry is not None:
            entries.append(entry)
    if not entries:
        raise CharacterIndexError("CHARACTER_CSV_EMPTY", "The character CSV contained no usable rows.")
    # Most-used first, which is also the order the picker shows by default.
    entries.sort(key=lambda item: (-item.count, item.character))
    return entries


def load_builtin(path: Path = DATA_PATH) -> CharacterIndex:
    """Load the bundled curated index. Missing or corrupt data degrades to empty.

    A character picker is a convenience; it must never stop the studio from loading,
    so a broken data file yields an empty index and the picker simply reports that no
    characters are available.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return CharacterIndex([], source="builtin")
    if not isinstance(raw, dict):
        return CharacterIndex([], source="builtin")
    entries: list[CharacterRef] = []
    for row in raw.get("characters") or []:
        if not isinstance(row, dict):
            continue
        entry = _entry_from_row({key: "" if value is None else str(value) for key, value in row.items()})
        if entry is not None:
            entries.append(entry)
    entries.sort(key=lambda item: (-item.count, item.character))
    return CharacterIndex(entries, source=str(raw.get("source") or "builtin"))


# The active index. The dataset is downloaded once and cached on disk by
# backend/character_data.py, so this is read on demand and then memoized; there is no
# user-facing "import" step any more, and no in-memory override to keep in sync.
_OVERRIDE: CharacterIndex | None = None


def _load_source() -> CharacterIndex:
    """The best available index: an explicit override, the cache, then the sample.

    Order matters. An override exists for tests and for an operator who points the
    studio at a hand-built index. The downloaded cache is next because it is the real
    catalogue. The committed sample is the last resort for a first launch with no
    network - small, but enough that a well-known character still resolves.
    """
    if _OVERRIDE is not None:
        return _OVERRIDE
    # Imported lazily: character_data imports this module for the shared row rules, so
    # a module-level import here would be circular.
    from . import character_data

    cached = character_data.load_cache()
    if cached is not None:
        return cached
    shipped = load_builtin()
    if len(shipped):
        return shipped
    return CharacterIndex([], source="unavailable")


@lru_cache(maxsize=1)
def index() -> CharacterIndex:
    """The process-wide character index, resolved once."""
    return _load_source()


def use_index(candidate: CharacterIndex | None) -> None:
    """Force a specific index, or pass None to fall back to the cache and sample.

    Exists for tests and for an operator who wants to point the studio at a
    hand-built index without touching the download cache.
    """
    global _OVERRIDE
    _OVERRIDE = candidate
    reset_cache()


def index_status() -> dict[str, Any]:
    """Diagnostics for the active character data.

    The interface no longer renders any of this - the catalogue is fetched
    automatically, so there is no user action to prompt for and no state worth
    surfacing. It is kept because it is the only way to tell, from the API, whether a
    deployment is running on the real catalogue or the offline fallback, which is
    exactly what you want to know when a character does not appear in search.
    """
    from . import character_data

    active = index()
    cached = character_data.load_cache() is not None
    count = len(active)
    return {
        "count": count,
        "source": active.source,
        # True when the real catalogue is on disk, as opposed to the offline sample.
        "downloaded": cached,
        "usable_threshold": BUNDLED_USEFUL_THRESHOLD,
        # With no cache the committed sample is all there is, and it holds only a
        # handful of characters - worth distinguishing a small index from a bad one.
        "bundled_is_sample": not cached and count < BUNDLED_USEFUL_THRESHOLD,
        "dataset_url": character_data.DATASET_URL,
    }


def reset_cache() -> None:
    """Drop the memoized index, e.g. after the dataset is downloaded. Tests too."""
    index.cache_clear()


def dataset_ready() -> bool:
    """True when the full catalogue is available on disk."""
    from . import character_data

    return character_data.load_cache() is not None


def search(query: str, limit: int = 24) -> list[dict[str, Any]]:
    return [entry.public() for entry in index().search(query, limit)]


def resolve(names: Iterable[str]) -> dict[str, Any]:
    """Resolve names for the prompt, reporting anything unknown."""
    found, unknown = index().resolve_many(names)
    return {
        "characters": [entry.public() for entry in found],
        "unknown": unknown,
        # The exact comma-separated pair the model should receive, in selection order.
        "trigger": ", ".join(entry.trigger for entry in found),
    }
