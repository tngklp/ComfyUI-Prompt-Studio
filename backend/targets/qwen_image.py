"""Qwen Image 2.1 generation-target strategy.

The first ``image`` target, and the first to exercise the ``image-edit`` case.
Image prompts have no duration, no shot numbering, and no timestamp syntax, so
the audit checks narrative coverage rather than a fixed section schema.
"""

from __future__ import annotations

import re
from typing import Any

# Angles Qwen Image 2.1 responds to reliably; used only as an audit signal.
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
    r"golden hour|blue hour|neon|overcast|dusk|dawn|contrast)\b"
)
COMPOSITION_COVERAGE = re.compile(
    r"(?i)\b(?:composition|framing|frame|camera|angle|close-?up|wide shot|"
    r"medium shot|low angle|high angle|birds?-eye|overhead|centred|centered|"
    r"off-?centre|off-?center|rule of thirds|perspective|depth of field|bokeh)\b"
)
STYLE_COVERAGE = re.compile(
    r"(?i)\b(?:style|aesthetic|photograph|photo|painting|illustration|render|3d|"
    r"cinematic|anime|realistic|pencil|watercolour|watercolor|oil paint|vector|"
    r"poster|concept art|art direction)\b"
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

_IMAGE_MEDIA_CONTRACT = """\
Image requests accept image inputs only.
- text-to-image takes no input media.
- image edit takes one to three source images plus an edit instruction.
Never reference video, audio, cameras-in-time, or a timeline.
Never introduce [Shot N] markers or MM:SS.mmm timestamps.\
"""

_EDIT_MEDIA_CONTRACT = """\
Image edit requests operate on the supplied source images.
Describe only the change the instruction requests and what must stay unchanged.
Reference source images as <Picture 1>, <Picture 2>, and so on.
Never introduce [Shot N] markers or MM:SS.mmm timestamps.\
"""

# Field names of the retired JSON envelope. The prompt text is the payload; the
# ratio fields were application settings that leaked into the model's output.
_ENVELOPE_TEXT_FIELDS = ("rewritten_prompt", "prompt", "rewritten_instruction", "instruction")
_JSON_BLOCK = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


def normalize_prompt_text(text: str) -> str:
    """Unwrap a JSON envelope when a model insists on emitting one.

    Qwen Image 2.1's guides ask for the bare prompt, but a model that has seen the
    older ``{"rewritten_prompt": …, "wh_ratio": …}`` contract may still answer with
    it, which put raw JSON in the editor and the wrong words in the generated image.
    Only a *recognised* envelope is unwrapped, so a prompt that legitimately contains
    braces is left untouched.
    """
    import json

    candidate = (text or "").strip()
    block = _JSON_BLOCK.fullmatch(candidate)
    if block:
        candidate = block.group(1).strip()
    if not candidate.startswith("{"):
        return text
    match = _JSON_OBJECT.match(candidate)
    if not match:
        return text
    try:
        payload = json.loads(match.group(0))
    except ValueError:
        return text
    if not isinstance(payload, dict):
        return text
    for field in _ENVELOPE_TEXT_FIELDS:
        value = payload.get(field)
        if isinstance(value, str):
            return value.strip()
    return text


def final_contract(mode: str, task_text: str) -> str:
    if mode == "TextToImage":
        return (
            "Final grounding check: describe a single still image. Include subject, appearance, "
            "setting, lighting, composition and style, and add nothing the brief does not support. "
            "Return only the complete final image prompt, as one paragraph of natural language - "
            "never a JSON object."
        )
    if mode == "ImageEdit":
        return (
            "Final grounding check: state the requested change first, then the details that must be "
            "preserved from the source images. Return only the complete final edit instruction, as one "
            "paragraph of natural language - never a JSON object."
        )
    raise ValueError(f"{mode!r} is not a Qwen Image 2.1 mode.")


def audit_prompt(
    prompt: str,
    mode: str = "TextToImage",
    **_ignored: Any,
) -> dict[str, Any]:
    """Audit an image prompt for coverage and for video-contract leakage."""
    leakage = list(dict.fromkeys(match.group(0) for match in VIDEO_LEAKAGE.finditer(prompt)))
    words = len(re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", prompt))
    resolution_noise = list(dict.fromkeys(match.group(0) for match in RESOLUTION_NOISE.finditer(prompt)))

    signals = {
        "subject": bool(SUBJECT_COVERAGE.search(prompt)),
        "appearance": bool(APPEARANCE_COVERAGE.search(prompt)),
        "lighting": bool(LIGHTING_COVERAGE.search(prompt)),
        "composition": bool(COMPOSITION_COVERAGE.search(prompt)),
        "style": bool(STYLE_COVERAGE.search(prompt)),
    }
    missing_signals = [name for name, present in signals.items() if not present]

    quality_warnings = []
    if words < 40:
        quality_warnings.append("short image prompt")
    if not signals["subject"]:
        quality_warnings.append("no clear subject")
    if not signals["style"]:
        quality_warnings.append("no stated visual style")
    if resolution_noise:
        quality_warnings.append("resolution keywords add noise for this target")

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
        "resolution_noise": resolution_noise,
        "structure_pass": not leakage,
        "repair_required": repair_required,
        "official_format_pass": not leakage,
        "quality_target_pass": not quality_warnings,
        "quality_warnings": quality_warnings,
    }


def media_contract() -> str:
    return _IMAGE_MEDIA_CONTRACT


def edit_media_contract() -> str:
    return _EDIT_MEDIA_CONTRACT


def narrow_repair_messages(**kwargs: Any) -> list[dict[str, str]]:
    """Repair an image prompt that leaked video-contract syntax."""
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
                "You are correcting one image prompt. It must describe a single still image. "
                f"Remove the video-only constructs {offending} and any timeline, shot or soundscape "
                "language. Keep every other detail, word and line break exactly as written. "
                "Return only the corrected image prompt."
            ),
        },
        {"role": "user", "content": prompt},
    ]


def multimodal_repair_messages(**kwargs: Any) -> list[dict[str, str]]:
    """Image edit repair carries the source images alongside the instruction."""
    return narrow_repair_messages(**kwargs)
