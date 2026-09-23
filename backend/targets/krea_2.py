"""Krea 2 generation-target strategy.

Krea 2 is a native text-to-image model with a single mode: text to image. It has
no editing mode and takes no input media, so this strategy is the narrower of
the two image targets.

Its prompt philosophy differs from Qwen Image 2.1 in one way that matters to the
audit: Krea's own guidance is that prompt *length* buys control, not quality, and
that legacy Stable Diffusion quality tags ("8k", "masterpiece", "best quality")
do nothing. A short prompt is therefore not a defect here, so the audit does not
flag one on length alone.
"""

from __future__ import annotations

import re
from typing import Any

# Angles Krea 2 responds to reliably; used only as an audit signal.
SUBJECT_COVERAGE = re.compile(
    r"(?i)\b(?:subject|scene|figure|character|object|landscape|portrait|still life|"
    r"background|foreground|midground)\b"
)
APPEARANCE_COVERAGE = re.compile(
    r"(?i)\b(?:wearing|dressed|clothed|hair|eyes|skin|texture|material|colour|color|"
    r"shape|size|proportion|expression|pose|posture)\b"
)
LIGHTING_COVERAGE = re.compile(
    r"(?i)\b(?:light|lighting|lit|illuminat|shadow|highlight|backlit|sunlit|"
    r"golden hour|blue hour|neon|overcast|dusk|dawn|contrast|studio)\b"
)
COMPOSITION_COVERAGE = re.compile(
    r"(?i)\b(?:composition|framing|frame|camera|angle|close-?up|wide shot|full shot|"
    r"medium shot|low[- ]angle|high[- ]angle|birds?-eye|overhead|centred|centered|"
    r"off-?centre|off-?center|rule of thirds|perspective|depth of field|bokeh|"
    r"negative space|symmetrical)\b"
)
STYLE_COVERAGE = re.compile(
    r"(?i)\b(?:style|aesthetic|photograph|photo|painting|illustration|render|3d|"
    r"cinematic|anime|realistic|pencil|watercolour|watercolor|oil paint|vector|"
    r"poster|concept art|art direction|collage|print|linocut|risograph|"
    r"cel[- ]shaded|claymation|gouache|charcoal|ink)\b"
)

# Legacy Stable Diffusion quality tags. Krea 2 does not use them, and Krea's own
# guidance says including them only spends prompt budget. Kept separate from
# resolution noise because they are a distinct habit worth naming in the report.
QUALITY_TAG_NOISE = re.compile(
    r"(?i)\b(?:masterpiece|best quality|high quality|ultra detailed|highly detailed|"
    r"trending on artstation|trending on deviantart|award[- ]winning|"
    r"professional|photorealistic, ultra|hyperrealistic|ultra realistic|"
    r"sharp focus, 8k|extremely detailed)\b"
)
RESOLUTION_NOISE = re.compile(
    r"(?i)\b(?:\d{3,4}\s*[x\u00d7]\s*\d{3,4}|(?:8k|4k|2k|hd|uhd|1080p|720p))\b"
)

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
    r")"
)

# Contradictory media in one prompt. Krea 2 honours an explicit medium rather
# than drifting, so a prompt naming two incompatible ones usually resolves to a
# hybrid the user did not ask for.
CONTRADICTORY_MEDIA = re.compile(
    r"(?i)(?:photorealistic|photograph|photo)\b[\s\S]{0,60}?"
    r"\b(?:anime|cel[- ]shaded|watercolour|watercolor|flat[- ]color illustration|"
    r"linocut|risograph|pencil sketch|charcoal sketch)"
)
QUOTED_TEXT = re.compile(r"\"[^\"\n]{1,80}\"")

_MEDIA_CONTRACT = """\
Krea 2 requests are text-to-image only and take no input media.
Describe a single still image from the brief alone.
Never reference source images, video, audio, cameras-in-time, or a timeline.
Never introduce [Shot N] markers or MM:SS.mmm timestamps.\
"""


def final_contract(mode: str, task_text: str) -> str:
    if mode == "Krea2TextToImage":
        return (
            "Final grounding check: describe a single still image. State the medium and style "
            "explicitly and early, then the subject, setting, lighting, composition and material "
            "detail, and add nothing the brief does not support. Prefer concrete visual description "
            "over mood adjectives and legacy quality tags. Return only the complete final image "
            "prompt, as natural language."
        )
    raise ValueError(f"{mode!r} is not a Krea 2 mode.")


def audit_prompt(
    prompt: str,
    mode: str = "Krea2TextToImage",
    **_ignored: Any,
) -> dict[str, Any]:
    """Audit a Krea 2 prompt for coverage and for contract leakage."""
    leakage = list(dict.fromkeys(match.group(0) for match in VIDEO_LEAKAGE.finditer(prompt)))
    words = len(re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", prompt))
    quality_noise = list(dict.fromkeys(
        match.group(0) for match in QUALITY_TAG_NOISE.finditer(prompt)
    ))
    resolution_noise = list(dict.fromkeys(
        match.group(0) for match in RESOLUTION_NOISE.finditer(prompt)
    ))
    contradictory_media = list(dict.fromkeys(
        match.group(0) for match in CONTRADICTORY_MEDIA.finditer(prompt)
    ))

    signals = {
        "subject": bool(SUBJECT_COVERAGE.search(prompt)),
        "appearance": bool(APPEARANCE_COVERAGE.search(prompt)),
        "lighting": bool(LIGHTING_COVERAGE.search(prompt)),
        "composition": bool(COMPOSITION_COVERAGE.search(prompt)),
        "style": bool(STYLE_COVERAGE.search(prompt)),
    }
    missing_signals = [name for name, present in signals.items() if not present]

    # Deliberately no length warning: Krea 2 is explicitly designed to work from
    # minimal prompts, so a short prompt is a legitimate choice, not a defect.
    quality_warnings = []
    if not signals["subject"]:
        quality_warnings.append("no clear subject")
    if not signals["style"]:
        quality_warnings.append("no stated visual style")
    if quality_noise:
        quality_warnings.append("legacy quality tags do not help this target")
    if resolution_noise:
        quality_warnings.append("resolution keywords add noise for this target")
    if contradictory_media:
        quality_warnings.append("conflicting medium cues")

    # Leakage of the video contract is the only condition that justifies a repair.
    repair_required = bool(leakage)

    return {
        "mode": mode,
        "required_sections": [],
        "missing_sections": [],
        "section_order_valid": True,
        "image_words": words,
        "coverage_signals": signals,
        "missing_coverage": missing_signals,
        "video_contract_leakage": leakage,
        "quality_tag_noise": quality_noise,
        "resolution_noise": resolution_noise,
        "contradictory_media": contradictory_media,
        "structure_pass": not leakage,
        "repair_required": repair_required,
        "official_format_pass": not leakage,
        "quality_target_pass": not quality_warnings,
        "quality_warnings": quality_warnings,
    }


def media_contract() -> str:
    return _MEDIA_CONTRACT


def narrow_repair_messages(**kwargs: Any) -> list[dict[str, str]]:
    """Repair a Krea 2 prompt that leaked video-contract syntax."""
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
                "You are correcting one Krea 2 image prompt. It must describe a single still image. "
                f"Remove the video-only constructs {offending} and any timeline, shot or soundscape "
                "language. Keep every other detail, word and line break exactly as written. "
                "Return only the corrected image prompt."
            ),
        },
        {"role": "user", "content": prompt},
    ]


def multimodal_repair_messages(**kwargs: Any) -> list[dict[str, str]]:
    """Krea 2 accepts no input media, so its repair carries text only."""
    return narrow_repair_messages(**kwargs)
