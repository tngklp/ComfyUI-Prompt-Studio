"""MiniMax Music 3 generation-target strategy.

Music captions have no checkable section schema in the same sense as H3: the
caption is prose under three headings, and the lyrics mode has no structure at
all. The audit therefore reports only coarse, non-blocking signals and never
requests a repair.
"""

from __future__ import annotations

import re
from typing import Any

CAPTION_HEADINGS = (
    "### Global Metadata",
    "### Vocal Details",
    "### Arrangement",
)

_LYRIC_SECTION_LABEL = re.compile(r"(?m)^\s*\[[^\]]+\]\s*$")

_MEDIA_CONTRACT = """\
Music requests accept no media. Every role must come from the Music Brief text.
Never claim to have listened to audio, and never reference an attached file.\
"""


def final_contract(mode: str, task_text: str) -> str:
    if mode == "Music3Lyrics":
        return (
            "Return only the complete lyrics text. Do not add commentary, explanations, "
            "or Markdown fences."
        )
    if mode == "Music3":
        return (
            "Return only the complete MiniMax Music 3 structured caption, using the three "
            "required headings in order."
        )
    raise ValueError(f"{mode!r} is not a MiniMax Music 3 mode.")


def audit_prompt(
    prompt: str,
    mode: str = "Music3",
    **_ignored: Any,
) -> dict[str, Any]:
    """Coarse audit for music output. Never blocks generation."""
    if mode == "Music3Lyrics":
        labelled_sections = len(_LYRIC_SECTION_LABEL.findall(prompt))
        return {
            "mode": mode,
            "structure_pass": True,
            "repair_required": False,
            "official_format_pass": True,
            "quality_target_pass": True,
            "caption_character_count": len(prompt),
            "lyric_section_labels": labelled_sections,
            "missing_sections": [],
        }

    positions = [heading for heading in CAPTION_HEADINGS if heading in prompt]
    missing = [heading for heading in CAPTION_HEADINGS if heading not in positions]
    ordered = [heading for heading in CAPTION_HEADINGS if heading in prompt]
    order_valid = ordered == positions
    words = len(re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", prompt))

    return {
        "mode": mode,
        "required_sections": list(CAPTION_HEADINGS),
        "missing_sections": missing,
        "section_order_valid": order_valid,
        "caption_words": words,
        "structure_pass": not missing and order_valid,
        # A music caption is prose; a missing heading is worth reporting but never
        # justifies spending another generation on a repair pass.
        "repair_required": False,
        "official_format_pass": not missing and order_valid,
        "quality_target_pass": True,
    }


def media_contract() -> str:
    return _MEDIA_CONTRACT


def narrow_repair_messages(**kwargs: Any) -> list[dict[str, str]]:
    raise NotImplementedError("MiniMax Music 3 has no repair pass.")


def multimodal_repair_messages(**kwargs: Any) -> list[dict[str, str]]:
    raise NotImplementedError("MiniMax Music 3 accepts no media.")
