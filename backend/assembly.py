from __future__ import annotations

import re
from typing import Any

from .guides import guide_for_mode, load_guide, reference_base_excerpt
from .media import STORE, MediaError, parse_session_id
from .references import canonical_reference_tags
from .system_prompts import SystemPromptError, resolve_system_prompt
from .targets import TargetError, target_for_mode, targets
from .text_normalization import normalize_unicode_text


CAPABILITY_BY_TYPE = {"image": "images", "video": "video_frames", "audio": "audio"}


def _aspect_ratios(mode: str) -> tuple[str, ...]:
    return target_for_mode(mode).aspect_ratios


def _duration_bounds(mode: str) -> tuple[float, float]:
    durations = target_for_mode(mode).durations
    if durations is None:
        raise AssemblyError("INVALID_DURATION", "The selected mode does not accept a duration.")
    return durations.min, durations.max


def _mode_or_error(mode: str) -> str:
    try:
        target_for_mode(mode)
    except TargetError as error:
        raise AssemblyError("INVALID_MODE", "The selected mode is not supported.") from error
    return mode


class AssemblyError(Exception):
    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def _required_text(body: dict[str, Any], key: str, label: str) -> str:
    value = body.get(key)
    if not isinstance(value, str) or not value.strip():
        raise AssemblyError("INVALID_REQUEST", f"{label} is required.", {"field": key})
    return normalize_unicode_text(value).strip()


def _media_line(asset: dict[str, Any]) -> str:
    detail = asset["type"]
    if asset.get("duration") is not None:
        detail += f", {asset['duration']:g}s"
    if asset["type"] == "video":
        times = ", ".join(f"{frame['timestamp']:g}s" for frame in asset.get("frames", []))
        if times:
            detail += f", sampled frames at {times}"
    elif asset["type"] == "audio":
        detail += ", not analyzed by the local model; role must come only from the user's brief"
    return f"{asset.get('reference', asset['filename'])}: {asset['filename']} ({detail})"


def _effective_system_prompt(body: dict[str, Any], mode: str) -> tuple[str, bool]:
    try:
        return resolve_system_prompt(mode, body.get("system_prompt_override"))
    except SystemPromptError as error:
        raise AssemblyError(error.code, error.message) from error


def _validate_reference_tags(text: str, manifest: dict[str, Any], mode: str, field_label: str) -> None:
    if mode != "Reference":
        return
    available = {asset["reference"] for asset in manifest["assets"]}
    canonical_tags = canonical_reference_tags(text)
    missing = sorted(canonical_tags - available)
    if missing:
        tag = missing[0]
        raise AssemblyError(
            "REFERENCE_NOT_FOUND",
            f"{tag} doesn't exist. Add the reference or remove the tag from the {field_label}.",
            {"reference": tag},
        )


def _validated_generation_context(source: dict[str, Any], mode: str) -> tuple[float, str, str]:
    minimum, maximum = _duration_bounds(mode)
    duration = source.get("duration_seconds")
    if (
        not isinstance(duration, (int, float))
        or isinstance(duration, bool)
        or duration < minimum
        or duration > maximum
    ):
        raise AssemblyError(
            "INVALID_DURATION",
            f"Duration must be between {minimum:g} and {maximum:g} seconds.",
        )
    aspect_ratio = _required_text(source, "aspect_ratio", "Aspect ratio")
    allowed = _aspect_ratios(mode)
    if aspect_ratio not in allowed:
        raise AssemblyError("INVALID_ASPECT_RATIO", "The selected aspect ratio is not supported.")
    brief_limit = target_for_mode(mode).output_contract.brief_limit
    brief = _required_text(source, "creative_brief", "Creative brief")
    if len(brief) > brief_limit:
        raise AssemblyError(
            "BRIEF_TOO_LONG",
            f"Creative brief cannot exceed {brief_limit:,} characters.",
        )
    return duration, aspect_ratio, brief


def _validated_music_caption_context(source: dict[str, Any], mode: str) -> tuple[str, str]:
    contract = target_for_mode(mode).output_contract
    brief = _required_text(source, "creative_brief", "Music brief")
    if len(brief) > contract.brief_limit:
        raise AssemblyError(
            "BRIEF_TOO_LONG",
            f"Music brief cannot exceed {contract.brief_limit:,} characters.",
        )
    lyrics = source.get("lyrics", "")
    if not isinstance(lyrics, str):
        raise AssemblyError("INVALID_REQUEST", "Lyrics must be text.", {"field": "lyrics"})
    lyrics = normalize_unicode_text(lyrics).strip()
    if contract.lyrics_limit is not None and len(lyrics) > contract.lyrics_limit:
        raise AssemblyError(
            "LYRICS_TOO_LONG",
            f"Lyrics cannot exceed {contract.lyrics_limit:,} characters.",
        )
    return brief, lyrics


def _guide_messages(mode: str, system_prompt: str) -> list[dict[str, str]]:
    """System messages for a mode: its prompt profile, guide, and shared rules.

    A mode without a guide (Music 3) contributes only its prompt profile. A
    reference mode additionally receives the shared base-guide rules its guide
    depends on, declared through the mode's ``supporting_guide_sections`` field.
    """
    target = target_for_mode(mode)
    selected = target.mode(mode)
    messages: list[dict[str, str]] = []
    if system_prompt:
        profile = selected.system_prompt or "system_prompt"
        messages.append({"role": "system", "name": f"prompt_studio_{profile}", "content": system_prompt})
    if selected.guide is None:
        return messages
    guide = guide_for_mode(mode)
    guide_spec = target.guide(selected.guide)
    messages.append({"role": "system", "name": f"official_{target.id}_guide", "content": str(guide["content"])})
    if mode == "Reference":
        messages.append({
            "role": "system",
            "name": f"official_{target.id}_shared_base_rules",
            "content": reference_base_excerpt(),
        })
    return messages


def _final_contract(mode: str, task_text: str) -> str:
    """Closing grounding check, delegated to the mode's generation-target strategy."""
    return target_for_mode(mode).strategy.final_contract(mode, task_text)


def normalize_generated_prompt(prompt: str, mode: str) -> str:
    """Let the generation target normalise its own output text.

    A strategy that once asked for a JSON envelope (Qwen Image 2.1 used to return
    ``{"rewritten_prompt": …, "wh_ratio": …}``) implements ``normalize_prompt_text``
    to unwrap a legacy reply so the editor shows the prompt and the ratio stays an
    application setting. Targets without the hook are returned unchanged.
    """
    from .targets.contract import supports

    strategy = target_for_mode(mode).strategy
    if not supports(strategy, "normalize_prompt_text"):
        return prompt
    return strategy.normalize_prompt_text(prompt)


def assemble_request(body: dict[str, Any]) -> dict[str, Any]:
    mode = _mode_or_error(_required_text(body, "mode", "Mode"))
    target = target_for_mode(mode)
    if target.category == "audio":
        system_prompt, system_prompt_custom = _effective_system_prompt(body, mode)
        brief, lyrics = _validated_music_caption_context(body, mode)
        try:
            session_id = parse_session_id(body.get("session_id"))
        except ValueError as error:
            raise AssemblyError("INVALID_SESSION", "The session ID is invalid.") from error
        user_content = (
            f"Music brief:\n{brief}\n\n"
            f"Lyrics:\n{lyrics or 'None provided.'}"
        )
        return {
            "schema_version": 1,
            "guide": {"id": "music3-caption-contract", "title": "MiniMax Music 3 Structured Caption"},
            "input": {
                "mode": mode,
                "duration_seconds": None,
                "aspect_ratio": None,
                "creative_brief": brief,
                "lyrics": lyrics,
                "media_manifest": {"session_id": session_id, "mode": mode, "assets": [], "valid": True},
            },
            "media_inputs": [],
            "supporting_guides": [],
            "system_prompt": {"custom": system_prompt_custom, "content": system_prompt},
            "messages": _guide_messages(mode, system_prompt) + [{"role": "user", "content": user_content}],
        }
    if not target.has_mode(mode):
        raise AssemblyError("INVALID_MODE", "The selected mode is not supported.")
    system_prompt, system_prompt_custom = _effective_system_prompt(body, mode)
    brief = _required_text(body, "creative_brief", "Creative brief")
    if len(brief) > 8000:
        raise AssemblyError("BRIEF_TOO_LONG", "Creative brief cannot exceed 8,000 characters.")

    aspect_ratio = _required_text(body, "aspect_ratio", "Aspect ratio")
    if aspect_ratio not in _aspect_ratios(mode):
        raise AssemblyError("INVALID_ASPECT_RATIO", "The selected aspect ratio is not supported.")
    duration = body.get("duration_seconds")
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0 or duration > 20:
        raise AssemblyError("INVALID_DURATION", "Duration must be between 1 and 20 seconds.")
    try:
        session_id = parse_session_id(body.get("session_id"))
    except ValueError as error:
        raise AssemblyError("INVALID_SESSION", "The media session ID is invalid.") from error

    manifest = STORE.manifest(session_id, mode)
    if not manifest["valid"]:
        raise AssemblyError("INVALID_MEDIA_MANIFEST", "The media manifest is not valid.", manifest["violations"])

    _validate_reference_tags(brief, manifest, mode, "Creative Brief")
    declared_references = manifest["assets"]
    eligible = [asset for asset in declared_references if asset["type"] != "audio"]
    media_inputs = [
        {
            "asset_id": asset["id"],
            "reference": asset.get("reference"),
            "type": asset["type"],
            "requires_capability": CAPABILITY_BY_TYPE[asset["type"]],
            "frames": [
                {"timestamp": frame["timestamp"], "content_url": frame["url"]}
                for frame in asset.get("frames", [])
            ],
            "content_url": asset["content_url"],
            "visual_width": (
                asset.get("prepared_width")
                if asset["type"] == "image"
                else asset.get("contact_sheet_width")
            ),
            "visual_height": (
                asset.get("prepared_height")
                if asset["type"] == "image"
                else asset.get("contact_sheet_height")
            ),
        }
        for asset in eligible
    ]
    references = "\n".join(_media_line(asset) for asset in declared_references) or "None"
    user_content = (
        f"Mode: {mode}\n"
        f"Duration: {duration:g} seconds\n"
        f"Aspect ratio: {aspect_ratio}\n\n"
        "Reference manifest (audio is not analyzed by the local model; derive its copy/reference role only from the user's words and do not invent its content):\n"
        f"{references}\n\n"
        f"Creative brief:\n{brief}\n\n"
        f"{_final_contract(mode, brief)}"
    )
    guide = guide_for_mode(mode)
    return {
        "schema_version": 1,
        "guide": {key: value for key, value in guide.items() if key != "content"},
        "input": {
            "mode": mode,
            "duration_seconds": duration,
            "aspect_ratio": aspect_ratio,
            "creative_brief": brief,
            "media_manifest": manifest,
        },
        "media_inputs": media_inputs,
        # Resolved through the target, not by bare id: several targets now declare
        # a guide called "base", so an unqualified load_guide("base") would be
        # ambiguous. Reference mode's shared rules live in its own target's base guide.
        "supporting_guides": ([{
            key: value
            for key, value in load_guide("base", target_for_mode(mode).id).items()
            if key != "content"
        }] if mode == "Reference" else []),
        "system_prompt": {"custom": system_prompt_custom, "content": system_prompt},
        "messages": _guide_messages(mode, system_prompt) + [{"role": "user", "content": user_content}],
    }


def assemble_refinement(
    body: dict[str, Any],
    cached_generation: dict[str, Any] | None,
) -> dict[str, Any]:
    mode = _mode_or_error(_required_text(body, "mode", "Mode"))
    target = target_for_mode(mode)
    if target.category == "audio":
        system_prompt, system_prompt_custom = _effective_system_prompt(body, mode)
        current_prompt = _required_text(body, "current_prompt", "Current caption")
        instruction = _required_text(body, "instruction", "Revision instruction")
        if len(current_prompt) > 20_000:
            raise AssemblyError("PROMPT_TOO_LONG", "The current caption cannot exceed 20,000 characters.")
        if len(instruction) > 2_000:
            raise AssemblyError("INSTRUCTION_TOO_LONG", "The revision instruction cannot exceed 2,000 characters.")
        try:
            session_id = parse_session_id(body.get("session_id"))
        except ValueError as error:
            raise AssemblyError("INVALID_SESSION", "The session ID is invalid.") from error
        brief, lyrics = _validated_music_caption_context(body, mode)
        user_content = (
            f"Original music brief:\n{brief}\n\n"
            f"Lyrics:\n{lyrics or 'None provided.'}\n\n"
            f"Current caption:\n{current_prompt}\n\n"
            f"Revision instruction:\n{instruction}\n\n"
            "Revise the current caption according to the revision instruction."
        )
        return {
            "schema_version": 1,
            "guide": {"id": "music3-caption-contract", "title": "MiniMax Music 3 Structured Caption"},
            "input": {
                "mode": mode,
                "duration_seconds": None,
                "aspect_ratio": None,
                "creative_brief": brief,
                "lyrics": lyrics,
                "current_prompt": current_prompt,
                "instruction": instruction,
                "media_manifest": {"session_id": session_id, "mode": mode, "assets": [], "valid": True},
            },
            "media_inputs": [],
            "supporting_guides": [],
            "system_prompt": {"custom": system_prompt_custom, "content": system_prompt},
            "messages": _guide_messages(mode, system_prompt) + [{"role": "user", "content": user_content}],
        }
    if not target.has_mode(mode):
        raise AssemblyError("INVALID_MODE", "The selected mode is not supported.")
    system_prompt, system_prompt_custom = _effective_system_prompt(body, mode)
    current_prompt = _required_text(body, "current_prompt", "Current prompt")
    instruction = _required_text(body, "instruction", "Revision instruction")
    if len(current_prompt) > 20_000:
        raise AssemblyError("PROMPT_TOO_LONG", "The current prompt cannot exceed 20,000 characters.")
    if len(instruction) > 2_000:
        raise AssemblyError("INSTRUCTION_TOO_LONG", "The revision instruction cannot exceed 2,000 characters.")
    try:
        session_id = parse_session_id(body.get("session_id"))
    except ValueError as error:
        raise AssemblyError("INVALID_SESSION", "The media session ID is invalid.") from error

    manifest = STORE.manifest(session_id, mode)
    if not manifest["valid"]:
        raise AssemblyError("INVALID_MEDIA_MANIFEST", "The media manifest is not valid.", manifest["violations"])
    context_source = cached_generation if cached_generation and cached_generation.get("mode") == mode else body
    duration, aspect_ratio, creative_brief = _validated_generation_context(context_source, mode)
    _validate_reference_tags(creative_brief, manifest, mode, "Creative Brief")
    _validate_reference_tags(instruction, manifest, mode, "Revision instruction")
    if mode == "Reference":
        _validate_reference_tags(current_prompt, manifest, mode, "Current prompt")
    references = "\n".join(_media_line(asset) for asset in manifest["assets"]) or "None"
    guide = guide_for_mode(mode)
    user_content = (
        "Rewrite the current prompt according to the revision instruction. "
        "Return only the complete revised prompt. Do not discuss the changes.\n\n"
        f"Original mode: {mode}\n"
        f"Original duration: {duration:g} seconds\n"
        f"Original aspect ratio: {aspect_ratio}\n"
        f"Original Creative Brief:\n{creative_brief}\n\n"
        f"Reference manifest (text only; media is intentionally not attached):\n{references}\n\n"
        f"Current prompt:\n{current_prompt}\n\n"
        f"Revision instruction:\n{instruction}\n\n"
        "Reference revision rule: preserve each existing <Audio N> that is absent from the Revision instruction. "
        "Each <Audio N> present in the Revision instruction is mutable in this rewrite: follow the instruction's "
        "meaning to decide whether that reference is present, absent, or changed in the revised prompt. Use only "
        "canonical reference tags listed in the current Reference manifest.\n\n"
        f"{_final_contract(mode, current_prompt + ' ' + instruction)}"
    )
    return {
        "schema_version": 1,
        "guide": {key: value for key, value in guide.items() if key != "content"},
        "input": {
            "mode": mode,
            "duration_seconds": duration,
            "aspect_ratio": aspect_ratio,
            "creative_brief": creative_brief,
            "current_prompt": current_prompt,
            "instruction": instruction,
            "media_manifest": manifest,
        },
        "media_inputs": [],
        "supporting_guides": ([{
            key: value
            for key, value in load_guide("base", target_for_mode(mode).id).items()
            if key != "content"
        }] if mode == "Reference" else []),
        "system_prompt": {"custom": system_prompt_custom, "content": system_prompt},
        "messages": _guide_messages(mode, system_prompt) + [{"role": "user", "content": user_content}],
    }


def assemble_lyrics_request(body: dict[str, Any]) -> dict[str, Any]:
    mode = _mode_or_error(_required_text(body, "mode", "Mode"))
    target = target_for_mode(mode)
    # Lyrics is a sub-request of the audio target: the caller sends the caption mode
    # plus target="lyrics", and the registry supplies the lyrics prompt profile.
    lyrics_mode = next(
        (candidate.id for candidate in target.modes if candidate.output_only),
        None,
    )
    if lyrics_mode is None:
        raise AssemblyError("INVALID_MODE", "This target does not support lyrics rewriting.")
    try:
        system_prompt, system_prompt_custom = resolve_system_prompt(
            lyrics_mode,
            body.get("system_prompt_override"),
        )
    except SystemPromptError as error:
        raise AssemblyError(error.code, error.message) from error

    current_lyrics = body.get("current_lyrics", "")
    instruction = body.get("instruction", "")
    use_music_brief = body.get("use_music_brief", True)
    brief = body.get("creative_brief", "")
    if not isinstance(current_lyrics, str):
        raise AssemblyError("INVALID_REQUEST", "Current Lyrics must be text.", {"field": "current_lyrics"})
    if not isinstance(instruction, str):
        raise AssemblyError("INVALID_REQUEST", "Revision instruction must be text.", {"field": "instruction"})
    if not isinstance(use_music_brief, bool):
        raise AssemblyError("INVALID_REQUEST", "Use Music Brief must be a boolean.", {"field": "use_music_brief"})
    if not isinstance(brief, str):
        raise AssemblyError("INVALID_REQUEST", "Music Brief must be text.", {"field": "creative_brief"})
    current_lyrics = normalize_unicode_text(current_lyrics).strip()
    instruction = normalize_unicode_text(instruction).strip()
    brief = normalize_unicode_text(brief).strip() if use_music_brief else ""
    if len(current_lyrics) > 4000:
        raise AssemblyError("LYRICS_TOO_LONG", "Lyrics cannot exceed 4,000 characters.")
    if len(instruction) > 2000:
        raise AssemblyError("INSTRUCTION_TOO_LONG", "The revision instruction cannot exceed 2,000 characters.")
    if len(brief) > 2000:
        raise AssemblyError("BRIEF_TOO_LONG", "Music brief cannot exceed 2,000 characters.")
    if current_lyrics and not instruction:
        raise AssemblyError("INSTRUCTION_REQUIRED", "Describe how the existing Lyrics should change.")
    if not current_lyrics and not instruction and not brief:
        raise AssemblyError("LYRICS_REQUEST_EMPTY", "Add an instruction or include the Music Brief to create Lyrics.")
    try:
        session_id = parse_session_id(body.get("session_id"))
    except ValueError as error:
        raise AssemblyError("INVALID_SESSION", "The session ID is invalid.") from error

    task = "Rewrite the Current Lyrics according to the revision instruction." if current_lyrics else "Create complete new Lyrics."
    user_content = (
        f"Task: {task}\n\n"
        f"Music Brief:\n{brief or 'Not included.'}\n\n"
        f"Current Lyrics:\n{current_lyrics or 'None provided.'}\n\n"
        f"Revision instruction:\n{instruction or 'None provided.'}"
    )
    return {
        "schema_version": 1,
        "guide": {"id": "music3-lyrics-contract", "title": "MiniMax Music 3 Lyrics"},
        "input": {
            "mode": mode,
            "target": "lyrics",
            "duration_seconds": None,
            "aspect_ratio": None,
            "creative_brief": brief,
            "current_lyrics": current_lyrics,
            "instruction": instruction,
            "use_music_brief": use_music_brief,
            "media_manifest": {"session_id": session_id, "mode": mode, "assets": [], "valid": True},
        },
        "media_inputs": [],
        "supporting_guides": [],
        "system_prompt": {"custom": system_prompt_custom, "content": system_prompt},
        "messages": ([{"role": "system", "name": "music3_lyrics_contract", "content": system_prompt}] if system_prompt else [])
        + [{"role": "user", "content": user_content}],
    }
