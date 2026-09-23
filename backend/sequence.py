"""Sequence data and request assembly. No host, provider, or graph dependencies."""
from __future__ import annotations

import copy
import re
from typing import Any

from .assembly import AssemblyError, CAPABILITY_BY_TYPE, _guide_messages, _media_line
from .guides import guide_for_mode
from .pipeline import _asset_data_uri
from .media import STORE, parse_session_id
from .sequence_plan import interval_context
from .models.contract import ModelError
from .prompt_audit import reference_sections
from .targets import target_for_mode
from .sequence_repair import media_contract, normalize_image_task_prefix
from .sequence_output import validate_output, without_literals, LITERAL
from .sequence_format import COMPACT_CONTRACT, validate_compact


def _sequence_target(state: dict):
    """The generation target a sequence draft writes for."""
    mode_id = state.get("mode")
    if not isinstance(mode_id, str) or not mode_id:
        return target_for_mode("T2VA")
    return target_for_mode(mode_id)


def validate_sequence(body: dict) -> dict:
    state = copy.deepcopy(body.get("sequence"))
    def invalid(message):
        raise AssemblyError("INVALID_SEQUENCE", message)
    if not isinstance(state, dict) or state.get("version") != 1:
        invalid("Expected a version 1 Sequence draft.")
    if state.get("outputFormat", "official") not in {"official", "compact"}:
        invalid("Choose Official or Compact output.")
    for name in ("brief", "instructions"):
        if not isinstance(state.get(name), str) or not state[name].strip():
            invalid(f"Sequence {name} is required.")
    if len(state["brief"]) > 8000 or len(state["instructions"]) > 32000:
        invalid("The Creative Brief or Sequence Instructions are too long.")
    allowed_ratios = set(_sequence_target(state).aspect_ratios)
    if state.get("aspectRatio") not in allowed_ratios:
        invalid("Select a supported aspect ratio.")
    chunks = state.get("chunks")
    if not isinstance(chunks, list) or not chunks:
        invalid("Keep at least one chunk.")
    ids = set()
    for c in chunks:
        if not isinstance(c, dict) or not isinstance(c.get("id"), str) or not c["id"] or c["id"] in ids:
            invalid("Chunks need unique identities.")
        ids.add(c["id"])
        d = c.get("duration")
        if isinstance(d, bool) or not isinstance(d, int) or not 1 <= d <= 15:
            invalid("Chunk duration must be between 1 and 15 seconds.")
        if any(not isinstance(c.get(k), str) for k in ("instruction", "prompt")):
            invalid("Chunk instructions and prompts must be text.")
        if "attention" in c and (not isinstance(c["attention"], str) or len(c["attention"]) > 8000):
            invalid("Chunk attention must be a short text explanation.")
        for key in ("additions", "exclusions"):
            if not isinstance(c.get(key), list) or any(not isinstance(x, str) for x in c[key]):
                invalid("Reference assignments must be asset identities.")
    if not isinstance(state.get("references"), list) or any(not isinstance(x, str) for x in state["references"]):
        invalid("References must be asset identities.")
    if any(state.get(k) is not None and not isinstance(state[k], str) for k in ("first", "last")):
        invalid("Frame assignments must be asset identities.")
    if body.get("action") not in {"missing", "generate", "refine", "all"}:
        invalid("Unknown Sequence operation.")
    if not isinstance(body.get("operation_id"), str) or not body["operation_id"]:
        invalid("Sequence operation identity is required.")
    if body["action"] in {"generate", "refine"} and body.get("chunk_id") not in ids:
        invalid("The requested chunk no longer exists.")
    if body["action"] == "refine" and (not isinstance(body.get("instruction"), str) or not body["instruction"].strip()):
        invalid("Describe the refinement.")
    for k in ("thinking", "unload_after"):
        if not isinstance(body.get(k, False), bool):
            invalid(f"{k} must be a boolean.")
    seed = body.get("seed")
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int) or seed < 0):
        invalid("Seed must be a non-negative integer.")
    try:
        parse_session_id(body.get("session_id"))
    except ValueError:
        invalid("Invalid media session.")
    return state


def timeline(state):
    start = 0
    result = []
    for index, c in enumerate(state["chunks"]):
        result.append({**c, "index": index + 1, "start": start, "end": start + c["duration"]})
        start += c["duration"]
    return result


def conditioning(state, index):
    chunk = state["chunks"][index]
    refs = list(dict.fromkeys([r for r in state["references"] if r not in chunk["exclusions"]] + chunk["additions"]))
    items = [(r, "Reference") for r in refs]
    if index == 0 and state.get("first"):
        items.insert(0, (state["first"], "First frame"))
    if index == len(state["chunks"]) - 1 and state.get("last"):
        items.append((state["last"], "Last frame"))
    roles = {role for _, role in items}
    mode = "Reference" if refs else "FL2VA" if {"First frame", "Last frame"} <= roles else "I2VA" if "First frame" in roles else "L2VA" if "Last frame" in roles else "T2VA"
    return mode, items


def snapshot_media(state, session_id):
    """Freeze prepared model visuals as bytes, never paths to mutable revisions."""
    result = {}
    for index in range(len(state["chunks"])):
        for asset_id, role in conditioning(state, index)[1]:
            if asset_id not in result:
                asset = copy.deepcopy(STORE.get(session_id, asset_id))
                if asset.get("status") == "needs_edit":
                    raise AssemblyError("MEDIA_NEEDS_EDIT", "Apply the media edit before generation.")
                item = {"asset": asset, "public": STORE.public(asset)}
                if asset["type"] != "audio":
                    item["uri"] = _asset_data_uri(session_id, asset_id, "image" if asset["type"] == "image" else "contact_sheet")
                result[asset_id] = item
            if role != "Reference" and result[asset_id]["asset"]["type"] != "image":
                raise AssemblyError("INVALID_FRAME", "First and last frames must be images.")
    return result


def normalize_local_timestamps(prompt, duration):
    """Normalize an unambiguous seconds:milliseconds typo in temporal prose only.

    Quoted visible text and dialogue are content, never timestamp syntax. Unknown
    notation or out-of-interval values fail rather than being shifted or guessed.
    """
    protected = LITERAL
    temporal = re.compile(r"(?i)\b(at|by|between|from|until|to|and)\s+(\d{2}:\d{2,3}(?:\.\d{1,3})?)(?![\d:])")
    def clean(text):
        def replace(match):
            raw = match[2]
            canonical = re.fullmatch(r"(\d{2}):(\d{2})\.(\d{3})", raw)
            short = re.fullmatch(r"(\d{2}):(\d{3})", raw)
            two_part = re.fullmatch(r"(\d{2}):(\d{2})", raw)
            if canonical:
                minutes, seconds, milliseconds = map(int, canonical.groups())
                value = minutes * 60 + seconds + milliseconds / 1000
                if seconds < 60 and value <= duration:
                    return match[0]
            elif short:
                seconds, milliseconds = map(int, short.groups())
                if seconds + milliseconds / 1000 <= duration:
                    return match[0][:match.start(2)-match.start()] + f"00:{seconds:02d}.{milliseconds:03d}"
            elif two_part:
                first, second = map(int, two_part.groups())
                # MM:SS and malformed seconds:fraction are plausible. Different
                # fractional widths must agree; never guess a decimal position.
                candidates = {first * 1000 + second * 10, first * 1000 + second}
                if second < 60:
                    candidates.add((first * 60 + second) * 1000)
                candidates = {value for value in candidates if value <= duration * 1000}
                if len(candidates) == 1:
                    value = candidates.pop()
                    minutes, rest = divmod(value, 60000)
                    seconds, milliseconds = divmod(rest, 1000)
                    return match[0][:match.start(2)-match.start()] + f"{minutes:02d}:{seconds:02d}.{milliseconds:03d}"
            raise ModelError("INVALID_SEQUENCE_PROMPT", f"Ambiguous or out-of-range local timestamp {raw!r}; Prompt Studio cannot safely infer the intended time.")
        return temporal.sub(replace, text)
    parts, start = [], 0
    for match in protected.finditer(prompt):
        parts.extend((clean(prompt[start:match.start()]), match[0]))
        start = match.end()
    parts.append(clean(prompt[start:]))
    return "".join(parts)


def plain_chunk_prompt(text, mode, duration, assets=None, output_format="official"):
    """Lossless cleanup followed by objective H3 validation, never semantic repair."""
    fence = re.fullmatch(r"\s*```(?:text)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*", text)
    prompt = fence[1] if fence else text
    if output_format == "compact":
        return validate_compact(normalize_local_timestamps(prompt, duration), duration, assets)
    fields = reference_sections() if mode == "Reference" else (
        "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music")
    matches = list(re.finditer(r"(?m)^\s*(" + "|".join(fields) + r")\s*:[ \t]*", without_literals(prompt)))
    def invalid():
        raise ModelError("INVALID_SEQUENCE_PROMPT", "The chunk has an unsupported wrapper or incomplete prompt sections. Prompt Studio cannot safely supply missing content.")
    if [m[1] for m in matches] != list(fields):
        invalid()
    prefix = prompt[:matches[0].start()].strip()
    if mode in {"T2VA", "Reference"}:
        if prefix:
            invalid()
    for i, match in enumerate(matches):
        end = matches[i+1].start() if i+1 < len(matches) else len(prompt)
        if not prompt[match.end():end].strip():
            invalid()
    prompt = normalize_image_task_prefix(prompt, mode, assets)
    return validate_output(normalize_local_timestamps(prompt, duration), mode, duration, assets)


def assemble_chunk(state, index, body, media, action_plan=None):
    compact = state.get("outputFormat", "official") == "compact"
    rows = timeline(state)
    c = rows[index]
    mode, assigned = conditioning(state, index)
    counts = {"image": 0, "video": 0, "audio": 0}
    assets, inputs = [], []
    for asset_id, role in assigned:
        frozen = media[asset_id]
        asset = {**frozen["public"]}
        kind = asset["type"]
        counts[kind] += 1
        tag = f"<{ {'image': 'Picture', 'video': 'Video', 'audio': 'Audio'}[kind]} {counts[kind]}>"
        asset.update(reference=tag, conditioning=role)
        assets.append(asset)
        if kind == "audio":
            continue  # Same declared-only audio policy as Single; never pretend it was analyzed.
        inputs.append({"asset_id": asset_id, "reference": f"{tag} ({role})", "type": kind,
                       "requires_capability": CAPABILITY_BY_TYPE[kind], "content_url": asset["content_url"],
                       "frames": [{"timestamp": f["timestamp"], "content_url": f["url"]} for f in asset.get("frames", [])],
                       "visual_width": asset.get("prepared_width") if kind == "image" else asset.get("contact_sheet_width"),
                       "visual_height": asset.get("prepared_height") if kind == "image" else asset.get("contact_sheet_height"),
                       "snapshot_asset": frozen["asset"], "snapshot_uri": frozen["uri"]})
    if counts["image"] > 9 or counts["video"] > 3 or counts["audio"] > 3 or len(assets) > 12:
        raise AssemblyError("INVALID_MEDIA_MANIFEST", "Effective chunk media exceeds the Reference limits (9 images, 3 videos, 3 audio, 12 total).")
    previous_index = next((i for i in range(index - 1, -1, -1) if rows[i]["prompt"].strip()), None)
    previous = rows[previous_index]["prompt"] if previous_index is not None else ""
    outline = "\n".join(f"C{r['index']} · {r['start']}–{r['end']}s · {r['instruction']}" for r in rows)
    total = rows[-1]["end"]
    position = "only / final" if len(rows) == 1 else "first" if index == 0 else "final" if index == len(rows) - 1 else "middle"
    bindings = []
    for asset, (asset_id, role) in zip(assets, assigned):
        authoring = "first frame" if role == "First frame" else "last frame" if role == "Last frame" else f"reference {state['references'].index(asset_id) + 1}" if asset_id in state["references"] else "chunk-added reference"
        bindings.append(f"{authoring} → {asset['reference']} ({role}): {_media_line(asset)}")
    text = (f"CREATIVE BRIEF (whole sequence)\n{state['brief']}\n\n"
            f"SEQUENCE HORIZON — context only, not output\n"
            f"Total duration: {total}s. Current chunk: {c['index']} of {len(rows)} ({position}).\n"
            f"Global range: {c['start']}–{c['end']}s. Remaining after this clip: {total-c['end']}s.\n"
            f"Local target duration: {c['duration']}s; output timeline: 0–{c['duration']}s.\n"
            "Timestamp syntax is MM:SS.mmm (minutes:seconds.milliseconds). Five seconds is 00:05.000; "
            "05:00.000 means five minutes. These short clips always use 00 minutes. "
            "For an event within the opening shot, write its time inside the action prose, for example: "
            "[Shot 1] She walks. At 00:05.000, she turns. Do not put a cut timestamp on [Shot 1].\n"
            f"Absolute event time t maps to local t - {c['start']} only when it falls in this interval.\n"
            f"Global first frame: {'assigned to opening only' if state.get('first') else 'none'}. "
            f"Global last frame: {'reserved for final clip only' if state.get('last') else 'none'}.\n"
            f"SEQUENCE OUTLINE (global intervals and user directions)\n{outline}\n\n"
            f"CURRENT TARGET\nChunk Direction: {c['instruction'] or 'None'}\n"
            f"Aspect ratio: {state['aspectRatio']}\nH3 profile: {mode}\n\n"
            "CURRENT EFFECTIVE CONDITIONING — only these assets are supplied\n" + ("\n".join(bindings) or "None") + "\n\n")
    context = ("PRECEDING CLIP CONTEXT — continue its end state; do not replay it. "
              "Its labels and times belong to that preceding clip, not the current target.\n"
            + (f"Preceding global end: {rows[previous_index]['end']}s. "
               f"Gap before current clip: {c['start']-rows[previous_index]['end']}s.\n" if previous_index is not None else "")
            + f"<preceding_clip>\n{previous or 'None — establish the opening.'}\n</preceding_clip>")
    following = next((p for p in rows[index + 1:] if p["prompt"].strip()), None)
    if following:
        context += (f"\n\nFOLLOWING KEEP CLIP — approach its opening; do not perform its actions now. "
                    f"Global start: {following['start']}s; gap after current clip: {following['start']-c['end']}s. "
                    f"Its media labels and times belong to its own request.\n<following_clip>\n{following['prompt']}\n</following_clip>")
    if body["action"] == "refine":
        context += f"\n\nCURRENT PROMPT\n{c['prompt']}\n\nREFINE INSTRUCTION\n{body['instruction']}"
    text = context + "\n\n" + text
    text += (f"\nWRITE THIS TARGET ONLY: {c['duration']} seconds, local 0–{c['duration']}s, "
             f"{position} interval of the sequence; {len(rows)-index-1} clips remain afterward. "
             + ("Use plain descriptive prose for this target. " if compact else "Use [Shot 1] for this continuous target unless the user requested cuts. ")
             + "Honor explicit camera requests but otherwise add no camera moves. "
             + ("Match the supplied last frame at this target's end. " if index == len(rows)-1 and state.get("last") else "")
             + "Continue from the preceding clip's end state without replaying it. Use only current media labels. "
             + ("Return a standalone natural-language description followed by overall_soundscape and non_diegetic_music. " if compact else
                "Return the official guide's complete sections for this local clip only. "
                + ("Include standalone Picture definitions for supplied first/last keyframes; other images define Subjects. " if mode == "Reference" else "Use the three Base fields and the selected profile's exact alignment instruction. ")))
    text = f"SEQUENCE INSTRUCTIONS FOR THIS REQUEST\n{state['instructions']}\n\n" + text
    if action_plan is not None:
        text += interval_context(action_plan, index, compact=compact)
    text += "\nCamera continuity: retain the existing viewpoint; no tracking, zoom, pan, dolly or cut unless explicitly requested by the user.\n"
    if mode == "Reference" and not compact:
        text += "Accepted neighboring prompts supply scene context, not a source video. Classify this target using only its effective media: video editing/continuation requires an actual Video asset; keyframe completion applies when First or Last is supplied.\n"
    text += (COMPACT_CONTRACT if compact else media_contract(mode, assets)) + "\n"
    example = min(5, c["duration"])
    text += (f"FINAL LOCAL CHECK: all output times belong to 0–{c['duration']} seconds, never the global sequence clock. "
             f"For this {c['start']}–{c['end']}s interval, global {c['start']+example}s would be local "
             f"00:{example:02d}.000, after subtracting {c['start']}s. Translate any actual requested event accordingly; "
             "this conversion example does not request a new event. Keep media roles exactly as listed for this target. "
             "An appearance reference is not a first/last frame, even if a neighboring prompt used the same Picture number for a frame.\n")
    guide = {"id": "sequence_compact", "title": "Compact video prompt"} if compact else guide_for_mode(mode)
    return {"schema_version": 1, "completion_policy": "single_call", "guide": {k:v for k,v in guide.items() if k != "content"},
            "input": {"mode": mode, "output_format": state.get("outputFormat", "official"), "duration_seconds": c["duration"], "aspect_ratio": state["aspectRatio"], "creative_brief": state["brief"],
                      "media_manifest": {"session_id": body["session_id"], "mode": mode, "assets": assets, "valid": True}},
            "media_inputs": inputs, "supporting_guides": [], "system_prompt": {"custom": True, "content": state["instructions"]},
            "messages": ([{"role": "system", "content": COMPACT_CONTRACT}] if compact else _guide_messages(mode, "")) + [{"role": "user", "content": text}]}
