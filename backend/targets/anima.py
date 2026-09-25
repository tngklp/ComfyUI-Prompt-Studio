"""Anima generation-target strategy.

Anima is CircleStone Labs' 2B text-to-image model, prompted with Danbooru-style
tags, natural-language captions, or a mixture of the two. It is a single-mode
text-to-image target, so this strategy is the narrowest of the image strategies.

What separates it from Qwen Image 2.1 and Krea 2 is its *vocabulary*. Anima has
its own positive quality prefix (``masterpiece, best quality, score_7, safe``) and
its own negative vocabulary, an ``@`` prefix that marks an artist tag, a tag order
that begins with the subject count, and dataset tags that change the caption
dialect entirely. The audit therefore checks Anima-specific habits rather than the
generic "is there a stated style" signal the other image targets use.
"""

from __future__ import annotations

import re
from typing import Any

# Anima is order-sensitive by tag *group*, not by position inside a group:
# quality/meta/year/safety, then the subject count, then character, then series,
# then artist, then general tags. These are the recognisable members of each
# group, used to tell whether a tag list opens the way the guide asks.
QUALITY_TAG = re.compile(
    r"(?i)\b(?:masterpiece|best quality|good quality|normal quality|low quality|"
    r"worst quality|score_[1-9])\b"
)
SCORE_TAG = re.compile(r"(?i)\bscore_[1-9]\b")
META_TAG = re.compile(
    r"(?i)\b(?:highres|absurdres|anime screenshot|jpeg artifacts|official art|"
    r"twitter username|artist name)\b"
)
YEAR_TAG = re.compile(r"(?i)\b(?:year\s+\d{4}|newest|recent|mid|early|old)\b")
SAFETY_TAG = re.compile(r"(?i)\b(?:safe|sensitive|nsfw|explicit|questionable)\b")
# The subject count tag (``1girl``, ``2boys``, ``1other``) that the guide places
# immediately after the quality/meta/year/safety group.
COUNT_TAG = re.compile(r"(?i)\b\d+\s*(?:girls?|boys?|others?)\b|\bsolo\b|\bmultiple girls\b")
# An artist tag is only an artist tag when it carries the ``@`` the guide requires.
ARTIST_TAG = re.compile(r"@[A-Za-z0-9]")
# Dataset tags switch the caption dialect to LAION-POP or DeviantArt captions and
# therefore must be deliberate.
DATASET_TAG = re.compile(r"(?im)^\s*(?:ye-pop|deviantart)\s*$")
# Underscore-joined tags are the SDXL-era habit Anima's guide rejects; only score
# tags legitimately keep their underscore. A tag is a lowercase token run joined
# by underscores, so ordinary prose ("well-known") is not matched.
UNDERSCORE_TAG = re.compile(r"(?<![\w-])[a-z][a-z0-9]*_[a-z0-9_]+(?![\w-])")

# Vocabulary that only makes sense for a video target and must never appear in an
# image prompt. Presence means the model drifted into the H3 contract.
VIDEO_LEAKAGE = re.compile(
    r"(?i)(?:"
    r"\[Shot\s+\d+\]"
    r"|\bat\s+\d{2}:\d{2}\.\d{3}\b"
    r"|\boverall_soundscape\b"
    r"|\bnon_diegetic_music\b"
    r"|\bretention_analysis\b"
    r"|<d>|</d>"
    r"|<Picture\s+\d+>"
    r"|<Video\s+\d+>"
    r"|<image\d+>"
    r")"
)

RESOLUTION_NOISE = re.compile(
    r"(?i)\b(?:\d{3,4}\s*[x\u00d7]\s*\d{3,4}|(?:8k|4k|2k|hd|uhd|1080p|720p))\b"
)

# Anima does not render realism well, and its own limitations section says so. A
# photoreal request is a brief the model cannot serve, not a stylistic choice.
REALISM_REQUEST = re.compile(
    r"(?i)\b(?:photorealistic|photo-?realistic|photograph|photography|"
    r"hyper-?realistic|ultra-?realistic|realistic photograph|"
    r"dslr|35mm film photograph)\b"
)

# Anima's own recommended negative vocabulary. Listed in the audit result so a
# caller can offer it, not enforced: the negative prompt is a workflow field this
# tool does not own.
RECOMMENDED_NEGATIVE = (
    "worst quality, low quality, score_1, score_2, score_3, artist name, "
    "blurry, jpeg artifacts, chromatic aberration"
)

_ANIMA_MEDIA_CONTRACT = """\
Anima requests are text-to-image only and take no input media.
Write the prompt as Danbooru-style tags, natural-language prose, or a mixture.
Never reference source images, video, audio, cameras-in-time, or a timeline.
Never introduce [Shot N] markers or MM:SS.mmm timestamps.\
"""


def normalize_prompt_text(text: str) -> str:
    """Strip any content-rating tag the model added.

    This target never emits a rating tag, but Anima's training captions all carried
    one and a model will sometimes add ``safe`` out of habit. The guide and the system
    prompt both forbid it, and the audit reports it, but stripping it here is the only
    way to guarantee the user never sees one.

    Only a whole comma-separated tag that *is* a rating word is removed, so a
    legitimate tag that merely contains one - ``safety glasses``, ``safe day`` - survives.
    """
    if not text:
        return text
    # A rating tag is a whole tag, never a word inside one: split on commas and drop the
    # segments that are exactly a rating.
    parts = text.split(",")
    kept = [part for part in parts if not SAFETY_TAG.fullmatch(part.strip())]
    if len(kept) == len(parts):
        return text
    # Rejoin with the separator style the prompt already used, so a tag list written
    # without spaces after its commas does not gain them.
    separator = ", " if ", " in text else ","
    cleaned = separator.join(part.strip() for part in kept if part.strip())
    # If the removed tag carried a trailing sentence period, keep the text tidy.
    if cleaned and text.rstrip().endswith(".") and not cleaned.endswith("."):
        cleaned += "."
    return cleaned


def final_contract(mode: str, task_text: str) -> str:
    """Closing instruction for Anima.

    The per-request directives that the mode options inject (content rating and
    prompt style) take precedence over the dialect advice below, so this text is
    deliberately neutral about which dialect to pick. It is worded to not *contradict*
    a style the user chose - the option directive is the authoritative instruction.
    """
    if mode == "AnimaTextToImage":
        return (
            "Final grounding check: describe a single still image for Anima, using the prompt style "
            "stated above. If you write tags, group them as quality/meta/year "
            "first, then the subject count, then character and series as one pair, then artist, then "
            "general tags, and write them in lowercase with spaces instead of underscores. Every "
            "character must be followed by the work it comes from, e.g. `hatsune miku, vocaloid`; never "
            "write a character name on its own. Never include a safety tag. "
            "Prefix every artist tag with @. Name each character and then describe their basic "
            "appearance, and use the general-tag group to describe appearance, clothing, pose, "
            "expression, props, framing, background and lighting thoroughly enough to cover the whole "
            "brief. Add nothing the brief does not support, and invent no artist, series, character or "
            "visible text. Return only the complete final image prompt, with no commentary and no JSON."
        )
    raise ValueError(f"{mode!r} is not an Anima mode.")


def _tag_like_ratio(prompt: str) -> float:
    """Share of comma-separated segments short enough to be tags rather than prose."""
    segments = [segment.strip() for segment in prompt.split(",") if segment.strip()]
    if not segments:
        return 0.0
    tag_like = [segment for segment in segments if len(segment.split()) <= 5 and not segment.endswith(".")]
    return len(tag_like) / len(segments)


def audit_prompt(
    prompt: str,
    mode: str = "AnimaTextToImage",
    mode_options: dict[str, Any] | None = None,
    selected_characters: list[dict[str, Any]] | None = None,
    **_ignored: Any,
) -> dict[str, Any]:
    """Audit an Anima prompt for tag discipline and for contract leakage.

    ``mode_options`` carries the user's own selections, so the audit judges the
    prompt against what was actually asked for: a prompt that omits the safety tag
    is correct when the rating is "none", and a prose prompt is correct when the
    style is natural language. Without this the audit would contradict the user.

    ``selected_characters`` are the picker's resolved entries, so the audit can report
    a character whose series tag the model dropped.
    """
    text = prompt or ""
    options = mode_options or {}
    style = options.get("prompt_style")
    leakage = list(dict.fromkeys(match.group(0) for match in VIDEO_LEAKAGE.finditer(text)))
    words = len(re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", text))

    score_tags = list(dict.fromkeys(match.group(0) for match in SCORE_TAG.finditer(text)))
    quality_tags = list(dict.fromkeys(match.group(0) for match in QUALITY_TAG.finditer(text)))
    meta_tags = list(dict.fromkeys(match.group(0) for match in META_TAG.finditer(text)))
    year_tags = list(dict.fromkeys(match.group(0) for match in YEAR_TAG.finditer(text)))
    safety_tags = list(dict.fromkeys(match.group(0) for match in SAFETY_TAG.finditer(text)))
    count_tags = list(dict.fromkeys(match.group(0) for match in COUNT_TAG.finditer(text)))
    dataset_tags = list(dict.fromkeys(match.group(0) for match in DATASET_TAG.finditer(text)))
    realism = list(dict.fromkeys(match.group(0) for match in REALISM_REQUEST.finditer(text)))
    resolution_noise = list(dict.fromkeys(match.group(0) for match in RESOLUTION_NOISE.finditer(text)))

    # Underscore-joined tokens are the SDXL habit, but score tags legitimately keep
    # their underscore, so they are excluded before the finding is reported.
    underscore_tags = [
        value
        for value in dict.fromkeys(match.group(0) for match in UNDERSCORE_TAG.finditer(text))
        if not SCORE_TAG.fullmatch(value)
    ]

    # Tag discipline only says anything about a prompt that is actually a tag list.
    tag_like_ratio = _tag_like_ratio(text)
    is_tag_list = tag_like_ratio >= 0.6 and len(text.split(",")) >= 3

    # A character whose series tag is absent from the prompt. The picker hands the
    # model "character, series", so seeing the character without the series means half
    # the trigger was dropped - which silently degrades the result.
    present = {segment.strip().lower() for segment in text.split(",")}
    character_missing_series: list[str] = []
    for entry in (selected_characters or []):
        parts = [part.strip().lower() for part in str(entry.get("trigger") or "").split(",")]
        character = parts[0] if parts else ""
        series = parts[1] if len(parts) > 1 else ""
        if not character or character in character_missing_series:
            continue
        if character not in present:
            continue
        # The series may legitimately be absent from a dataset row, so only report a
        # problem when there was a series to drop.
        if series and series not in present:
            character_missing_series.append(str(entry.get("character") or character))

    quality_warnings: list[str] = []
    if words < 12 and not is_tag_list:
        quality_warnings.append("very short prompt")
    if realism:
        quality_warnings.append("Anima is an anime and illustration model and does not render realism well")
    if underscore_tags:
        quality_warnings.append("tags should use spaces instead of underscores, except score tags")
    if "@" in text and not ARTIST_TAG.search(text):
        quality_warnings.append("an artist tag without the @ prefix has almost no effect")
    if dataset_tags:
        quality_warnings.append("a dataset tag switches the caption dialect and must be deliberate")
    if resolution_noise:
        quality_warnings.append("resolution keywords add noise for this target")
    if is_tag_list and not count_tags:
        quality_warnings.append("a tag list should state how many subjects to compose")
    if is_tag_list and not quality_tags:
        quality_warnings.append("a tag list usually opens with a quality group")
    # A character tag without the series right after it is the failure the picker
    # exists to prevent: the trigger is "character, series" and half of it is missing.
    if is_tag_list and character_missing_series:
        quality_warnings.append(
            "a selected character is missing its series tag next to it "
            f"({', '.join(character_missing_series)})"
        )
    if safety_tags:
        quality_warnings.append(
            "a safety tag was added; this target never emits one, so it is a dataset habit "
            f"({', '.join(safety_tags)})"
        )
    if style == "tags" and not is_tag_list:
        quality_warnings.append("the prompt style is Tags but the output is not a tag list")
    if style == "natural_language" and is_tag_list:
        quality_warnings.append("the prompt style is Natural language but the output is a tag list")

    # Leakage of the video contract is the primary condition that justifies a repair.
    repair_required = bool(leakage)

    # A contradiction of the user's own style selection also forces a repair: they picked
    # a dialect and got another. These are failures the user cannot see for themselves,
    # and leaving them as warnings shipped a prompt that disagreed with the settings.
    if style == "tags" and not is_tag_list:
        repair_required = True
    if style == "natural_language" and is_tag_list:
        repair_required = True
    # A safety tag is stripped from the output by `normalize_prompt_text` rather than
    # regenerated, so it is worth reporting but not worth a repair: a repair pass would
    # cost a full generation to fix something already handled deterministically.

    return {
        "mode": mode,
        "required_sections": [],
        "missing_sections": [],
        "section_order_valid": True,
        "image_words": words,
        "tag_like_ratio": round(tag_like_ratio, 3),
        "is_tag_list": is_tag_list,
        "content_rating": None,
        "prompt_style": style,
        "coverage_signals": {
            "count_tag": bool(count_tags),
            "quality_or_safety": bool(quality_tags or safety_tags),
            "artist": bool(ARTIST_TAG.search(text)),
        },
        "quality_tags": quality_tags,
        "score_tags": score_tags,
        "meta_tags": meta_tags,
        "year_tags": year_tags,
        "safety_tags": safety_tags,
        "count_tags": count_tags,
        "dataset_tags": dataset_tags,
        "underscore_tags": underscore_tags,
        "artist_prefix_missing": bool(
            re.search(r"(?i)\b(?:artist|by)\b", text) and not ARTIST_TAG.search(text)
        ),
        "recommended_negative": RECOMMENDED_NEGATIVE,
        "realism_request": realism,
        "video_contract_leakage": leakage,
        "resolution_noise": resolution_noise,
        "structure_pass": not leakage,
        "repair_required": repair_required,
        "official_format_pass": not leakage,
        "quality_target_pass": not quality_warnings,
        "quality_warnings": quality_warnings,
    }


def media_contract() -> str:
    return _ANIMA_MEDIA_CONTRACT


def narrow_repair_messages(**kwargs: Any) -> list[dict[str, str]]:
    """Repair an Anima prompt that leaked video-contract syntax."""
    prompt = kwargs.get("prompt", "")
    leakage = kwargs.get("leakage") or list(
        dict.fromkeys(match.group(0) for match in VIDEO_LEAKAGE.finditer(prompt))
    )
    if not leakage:
        return []
    offending = ", ".join(f"`{value}`" for value in leakage)
    return [
        {
            "role": "system",
            "content": (
                "You are correcting one Anima image prompt. It must describe a single still image "
                "using Danbooru-style tags, natural-language prose, or a mixture of the two. "
                f"Remove the video-only constructs {offending} and any timeline, shot, soundscape "
                "or dialogue language. Keep every other tag, word and line break exactly as written. "
                "Return only the corrected image prompt."
            ),
        },
        {"role": "user", "content": prompt},
    ]


def multimodal_repair_messages(**kwargs: Any) -> list[dict[str, str]]:
    """Anima accepts no input media, so its repair carries text only."""
    return narrow_repair_messages(**kwargs)
