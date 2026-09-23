"""Guide loading for generation targets.

Guide metadata (ids, titles, filenames, integrity pins, source URLs) is declared
per target in ``targets.json`` and read through :mod:`backend.targets`. This
module owns only the file handling: normalisation, the SHA-256 integrity check,
and extraction of the shared base-guide rules used by reference mode.

A guide whose ``source_sha256`` is ``null`` is Prompt Studio-authored rather
than vendored from an upstream document, so no integrity pin is enforced.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

from .targets import GuideRef, target, target_for_mode

GUIDES_DIR = Path(__file__).resolve().parent.parent / "guides"

# Sections of the H3 base guide that full-reference mode reuses verbatim, with the
# number of prose paragraphs to take from each. This is H3 guide structure, not
# prompt behaviour, so it stays here rather than in the H3 strategy module.
REFERENCE_EXCERPT_PARAGRAPHS = {
    "4.2 Shots and Cuts": 1,
    "4.3 Camera Motion: Motion Type + Amplitude + Speed": 1,
    "4.4 Speakers, Dialogue, and Singing": 2,
    "4.5 On-Screen Text": 1,
    "4.6 overall_soundscape": 1,
    "4.7 non_diegetic_music": 1,
}
REFERENCE_EXCERPT_SOURCE = ("minimax_h3", "base")


def _normalized(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").rstrip() + "\n"


def _spec(target_id: str, guide_id: str) -> GuideRef:
    return target(target_id).guide(guide_id)


@lru_cache(maxsize=8)
def _load(target_id: str, guide_id: str) -> dict[str, str | None]:
    spec = _spec(target_id, guide_id)
    content = _normalized((GUIDES_DIR / spec.filename).read_text(encoding="utf-8-sig"))
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    if spec.source_sha256 is not None and digest != spec.source_sha256:
        raise RuntimeError(f"Official guide integrity check failed for {spec.filename}.")
    owner = target(target_id)
    return {
        "id": spec.id,
        "title": spec.title,
        "filename": spec.filename,
        "source_sha256": spec.source_sha256,
        "source_url": spec.source_url,
        "source_revision": owner.guide_revision,
        "content_sha256": digest,
        "content": content,
    }


def _owner_of_guide(guide_id: str) -> str:
    from .targets import targets as all_targets

    owners = [
        candidate.id
        for candidate in all_targets()
        if guide_id in {guide.id for guide in candidate.guides}
    ]
    if not owners:
        raise KeyError(f"No generation target declares a guide named {guide_id!r}.")
    if len(owners) > 1:
        raise KeyError(
            f"Guide {guide_id!r} is declared by several targets ({', '.join(owners)}); "
            "pass target_id explicitly."
        )
    return owners[0]


def load_guide(guide_id: str, target_id: str | None = None) -> dict[str, str | None]:
    """Load one guide.

    ``target_id`` may be omitted when the guide id is unique across targets, which
    is the common case for the H3 ``base``/``reference`` pair.
    """
    if target_id is None:
        target_id = _owner_of_guide(guide_id)
    return dict(_load(target_id, guide_id))


def guide_for_mode(mode_id: str) -> dict[str, str | None]:
    """Resolve the guide a mode uses, or raise when the mode has no guide."""
    owner = target_for_mode(mode_id)
    mode = owner.mode(mode_id)
    if mode.guide is None:
        raise KeyError(f"Mode {mode_id!r} does not use a guide.")
    return load_guide(mode.guide, owner.id)


def guide_id_for_mode(mode_id: str) -> str | None:
    return target_for_mode(mode_id).mode(mode_id).guide


@lru_cache(maxsize=1)
def reference_base_excerpt() -> str:
    """Return only the shared base-guide rules referenced by full-reference mode."""
    target_id, guide_id = REFERENCE_EXCERPT_SOURCE
    content = str(_load(target_id, guide_id)["content"])
    sections = content.split("\n### ")
    selected: list[str] = []
    for section in sections:
        title, _, body = section.partition("\n")
        limit = REFERENCE_EXCERPT_PARAGRAPHS.get(title.strip())
        if limit is None:
            continue
        paragraphs = [part.strip() for part in body.split("\n\n") if part.strip()]
        prose = [part for part in paragraphs if not part.startswith(("```", "|", "## "))]
        selected.append(f"### {title.strip()}\n\n" + "\n\n".join(prose[:limit]))
    if len(selected) != len(REFERENCE_EXCERPT_PARAGRAPHS):
        raise RuntimeError("Could not extract the required shared rules from the official base guide.")
    return (
        "# Shared official base-guide rules used by full-reference mode\n\n"
        + "\n\n".join(selected)
        + "\n"
    )


def guide_catalog() -> list[dict[str, object]]:
    """Guide metadata for every target, with the modes each guide serves."""
    from .targets import targets as all_targets

    result: list[dict[str, object]] = []
    for owner in all_targets():
        result.extend(guide_catalog_for_target(owner.id))
    return result


def guide_catalog_for_target(target_id: str) -> list[dict[str, object]]:
    owner = target(target_id)
    result: list[dict[str, object]] = []
    for spec in owner.guides:
        guide = load_guide(spec.id, owner.id)
        modes = [mode.id for mode in owner.modes if mode.guide == spec.id]
        result.append({
            "target_id": owner.id,
            "target_label": owner.label,
            "modes": modes,
            **{key: value for key, value in guide.items() if key != "content"},
        })
    return result


def reset_cache() -> None:
    """Drop memoised guide content (tests and local development only)."""
    _load.cache_clear()
    reference_base_excerpt.cache_clear()
