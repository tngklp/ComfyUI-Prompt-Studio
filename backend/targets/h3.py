"""MiniMax H3 generation-target strategy.

Holds the behaviour that is specific to prompting MiniMax H3: the six-section
reference schema, the per-mode output contract, timestamp and camera rules, and
the reference media-task vocabulary.

Prompt text lives in :mod:`backend.system_prompts`; guide text lives in the
``guides/`` bundle and is referenced from ``targets.json``.
"""

from __future__ import annotations

import re
from typing import Any

# Six required sections of the official full-reference output contract.
REFERENCE_SECTIONS = (
    "subject_definitions",
    "summary",
    "retention_analysis",
    "detailed_description",
    "overall_soundscape",
    "non_diegetic_music",
)

TIMESTAMP_CANDIDATE = re.compile(r"(?<!\d)\d{2}:\d{2,3}(?:\.\d{1,3})?(?!\d)")
VALID_TIMESTAMP = re.compile(r"^(\d{2}):(\d{2})\.(\d{3})$")
CAMERA_DIRECTION = re.compile(
    r"(?i)\b(?:cut(?:s)?\s+to|zoom(?:s|ed|ing)?(?:-in|-out|\s+in|\s+out)?|"
    r"pan(?:s|ned|ning)?(?:\s+(?:up|down|left|right|across))?|doll(?:y|ies|ied|ying)|"
    r"tracking shot|camera\s+(?:moves?|pulls?|pushes?|pans?|zooms?|tracks?|dollies?))\b"
)
INTERNAL_VIDEO_REPRESENTATION = re.compile(
    r"(?i)\b(?:contact sheet|sheet cell(?:s)?|sampled frame(?:s)?|sample frame(?:s)?|"
    r"\d+(?:\.\d+)?s\s+mark)\b"
)
DIALOGUE_SOURCE = re.compile(
    r"\(S\d+(?:\s*,\s*S\d+)*\)|<Audio\s+\d+>",
    re.IGNORECASE,
)

# Per-mode closing rules. Keys are the video modes of the H3 target.
_MODE_RULES = {
    "T2VA": "Preserve any explicit continuous-camera or no-cut instruction instead of introducing an unsupported cut.",
    "I2VA": "Separate facts visible in the first frame from newly requested space or action revealed after it.",
    "FL2VA": "Prioritize exact endpoint geometry and a continuous state/camera path between the first and last frames.",
    "L2VA": "Invent only the minimum compatible preceding state needed to reach the final frame; do not infer a named location or period without evidence.",
}

_EXPLICIT_VIDEO_EDIT = re.compile(
    r"\b(?:edit(?:ing)?|continue|continuation|extend|remix|re-cut)\b.{0,40}\bvideo\b|\bvideo\s+editing\b",
    re.IGNORECASE | re.DOTALL,
)

_MEDIA_CONTRACT = """\
Media task types allowed for full-reference requests:
- video editing: change footage that already exists in a source video.
- video continuation: extend a source video forward or backward in time.
- audio reuse: reuse existing audio from a source audio or video asset.
- audio reference: describe audio that should be matched in character but not copied.
- keyframe completion: complete motion between supplied first and last frames.
- reference generation: generate new content guided by assigned appearance references.

Never label a task video editing or continuation without a source video.
Never label a task audio reuse without a source audio or video asset.
Never describe a contact sheet or sampled frame as a target shot or keyframe.\
"""


def final_contract(mode: str, task_text: str) -> str:
    """Closing grounding check appended to the assembled request."""
    if mode in _MODE_RULES:
        return (
            f"Final grounding check: {_MODE_RULES[mode]} "
            "If the brief does not explicitly request non-diegetic music, return N/A for non_diegetic_music. "
            "Return only the complete final MiniMax H3 prompt."
        )
    if mode == "Reference":
        explicit_edit = bool(_EXPLICIT_VIDEO_EDIT.search(task_text or ""))
        task_classification = (
            "source-video editing or continuation; scale detailed_description with source complexity"
            if explicit_edit
            else "reference generation, not keyframe completion or source-video editing"
        )
        return (
            f"Final request classification: {task_classification}. "
            "Treat every explicitly assigned reference role as exclusive unless the user asks that reference to contribute "
            "additional traits; 'only' and 'solely' emphasize this rule but are not required. Unspecified target environment, lighting, "
            "composition, camera treatment, and atmosphere may be designed as new target content, but never described as "
            "facts derived from a reference. Do not add unsupported subject actions, dialogue, props, visible text, or an "
            "invented ending. Music requested without an uploaded audio asset belongs only in non_diegetic_music and must "
            "not create audio-reference or audio-reuse semantics. Prefer one continuous shot unless cuts are requested; "
            "purposeful camera movement within that shot is allowed. Because H3 receives each source video itself, bind the "
            "complete choreography, temporal order, pacing, and rhythmic character of a motion-only video without "
            "reconstructing individual sampled gestures, named steps, poses, expressions, transitions, or a concluding move. "
            "When a concrete visible object, character, scene, or effect from <Video N> is reused in the target, describe that "
            "reused visual element through an appropriate <Subject N> while keeping <Video N> as its source provenance; do not "
            "automatically create a separate subject for ordinary motion transfer. "
            "If the brief does not explicitly request music, non_diegetic_music must be N/A. "
            "Use the official detail budget for grounded target composition, placement, lighting, atmosphere, camera treatment, "
            "supported action progression, and reference application; never pad solely to reach a word count. Return only the complete "
            "prompt with all six required sections in the official order and no commentary outside the prompt."
        )
    raise ValueError(f"{mode!r} is not a MiniMax H3 mode.")


def reference_sections() -> tuple[str, ...]:
    """The six required sections of the official full-reference output contract."""
    return REFERENCE_SECTIONS


def invalid_timestamps(prompt: str, duration_seconds: float | None = None) -> list[str]:
    invalid: list[str] = []
    for value in TIMESTAMP_CANDIDATE.findall(prompt):
        match = VALID_TIMESTAMP.fullmatch(value)
        if not match:
            invalid.append(value)
            continue
        minutes, seconds, milliseconds = (int(part) for part in match.groups())
        total = minutes * 60 + seconds + milliseconds / 1000
        if seconds >= 60 or (duration_seconds is not None and total > duration_seconds + 0.001):
            invalid.append(value)
    return list(dict.fromkeys(invalid))


def camera_structure_requested(intent_text: str) -> bool:
    return bool(re.search(
        r"(?i)\b(?:camera|framing|shot|cut|zoom|pan|dolly|tracking|handheld|pov|"
        r"temporal structure|whole video|entire video)\b",
        intent_text,
    ))


def unsupported_camera_directions(prompt: str, allowed: bool) -> list[str]:
    if allowed:
        return []
    return list(dict.fromkeys(match.group(0) for match in CAMERA_DIRECTION.finditer(prompt)))


def internal_video_representation_terms(prompt: str) -> list[str]:
    return list(dict.fromkeys(
        match.group(0) for match in INTERNAL_VIDEO_REPRESENTATION.finditer(prompt)
    ))


def audit_prompt(
    prompt: str,
    mode: str = "Reference",
    duration_seconds: float | None = None,
    camera_structure_allowed: bool = True,
    **_ignored: Any,
) -> dict[str, Any]:
    """Audit an H3 prompt. Only Reference mode carries a checkable section schema."""
    if mode != "Reference":
        # The strategy contract promises `repair_required` for every mode, so
        # callers can read it without branching on the target.
        return {
            "mode": mode,
            "official_format_pass": None,
            "reference_understanding": "not_applicable",
            "required_sections": [],
            "missing_sections": [],
            "structure_pass": None,
            "repair_required": False,
            "quality_target_pass": True,
        }

    positions: dict[str, re.Match[str]] = {}
    for section in REFERENCE_SECTIONS:
        match = re.search(rf"(?im)^\s*{re.escape(section)}\s*:\s*", prompt)
        if match:
            positions[section] = match

    missing = [section for section in REFERENCE_SECTIONS if section not in positions]
    ordered = sorted(positions.items(), key=lambda item: item[1].start())
    section_order = [name for name, _ in ordered]
    order_valid = section_order == [section for section in REFERENCE_SECTIONS if section in positions]

    detailed = ""
    detailed_match = positions.get("detailed_description")
    if detailed_match:
        following = [match.start() for _, match in ordered if match.start() > detailed_match.start()]
        end = min(following) if following else len(prompt)
        detailed = prompt[detailed_match.end():end]
    detailed_for_count = re.sub(r"\[Shot\s+\d+\]", "", detailed, flags=re.IGNORECASE)
    detailed_words = len(re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", detailed_for_count))
    has_shot_marker = bool(re.search(r"(?im)^\s*\[Shot\s+1\]", detailed))

    summary_match = positions.get("summary")
    task_label = None
    if summary_match:
        label_match = re.match(r"\s*\[([^\]]+)\]", prompt[summary_match.end():], re.IGNORECASE)
        if label_match:
            task_label = label_match.group(1).strip()
    missing_task_label = summary_match is not None and task_label is None
    missing_shot_marker = detailed_match is not None and not has_shot_marker

    generation_word_target = bool(task_label and "generation" in task_label.lower())
    word_target_met = 350 <= detailed_words <= 500 if generation_word_target else None
    if not generation_word_target:
        length_status = "not_applicable"
    elif detailed_words < 250:
        length_status = "severely_short_internal_warning"
    elif detailed_words < 300:
        length_status = "short_internal_warning"
    elif detailed_words < 350:
        length_status = "acceptable_below_target"
    elif detailed_words <= 500:
        length_status = "official_target"
    else:
        length_status = "above_target"

    structure_pass = not missing and order_valid
    invalid_timestamp_values = invalid_timestamps(prompt, duration_seconds)
    unsupported_camera_values = unsupported_camera_directions(prompt, camera_structure_allowed)
    internal_video_terms = internal_video_representation_terms(prompt)
    has_dialogue = bool(re.search(r"(?is)<d>.*?</d>", prompt))
    dialogue_source_valid = bool(DIALOGUE_SOURCE.search(prompt))
    missing_dialogue_source = has_dialogue and not dialogue_source_valid

    quality_warnings = []
    if length_status == "severely_short_internal_warning":
        quality_warnings.append("severely short detailed_description")
    elif length_status == "short_internal_warning":
        quality_warnings.append("short detailed_description")

    repair_required = (
        not structure_pass
        or bool(invalid_timestamp_values)
        or bool(internal_video_terms)
        or missing_dialogue_source
        or missing_task_label
        or missing_shot_marker
    )

    return {
        "mode": mode,
        "required_sections": list(REFERENCE_SECTIONS),
        "missing_sections": missing,
        "section_order_valid": order_valid,
        "task_label": task_label,
        "missing_task_label": missing_task_label,
        "missing_shot_marker": missing_shot_marker,
        "detailed_description_words": detailed_words,
        "generation_word_target_applies": generation_word_target,
        "generation_word_target_met": word_target_met,
        "detailed_description_length_status": length_status,
        "structure_pass": structure_pass,
        "invalid_timestamps": invalid_timestamp_values,
        "unsupported_camera_directions": unsupported_camera_values,
        "quality_warnings": quality_warnings,
        "internal_video_representation_terms": internal_video_terms,
        "missing_dialogue_source": missing_dialogue_source,
        "repair_required": repair_required,
        "official_format_pass": (
            structure_pass
            and not invalid_timestamp_values
            and not internal_video_terms
            and not missing_dialogue_source
            and not missing_task_label
            and not missing_shot_marker
        ),
        "quality_target_pass": not quality_warnings,
        "reference_understanding": "manual_review_required",
    }


def media_contract() -> str:
    return _MEDIA_CONTRACT


def narrow_repair_messages(**kwargs: Any) -> list[dict[str, str]]:
    """Delegates to the shared repair builder; H3 supplies the vocabulary only."""
    from ..prompt_repair import narrow_repair_messages as shared

    return shared(**kwargs)


def multimodal_repair_messages(**kwargs: Any) -> list[dict[str, str]]:
    from ..prompt_repair import multimodal_repair_messages as shared

    return shared(**kwargs)
