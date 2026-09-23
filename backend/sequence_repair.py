"""One contract-only correction using the same frozen request and official guide."""
import copy
import json
import re

from .assembly import _guide_messages
from .models.contract import ModelError
from .sequence_output import LITERAL
from .sequence_format import COMPACT_CONTRACT, compact_content


def normalize_image_task_prefix(prompt, mode, assets):
    """Project impossible source-media task labels onto known image-only roles.

    Only the summary's official task metadata changes. Unknown labels, missing
    media, and every word of scene content still go through normal validation.
    """
    if mode != "Reference" or not assets or any(not a["reference"].startswith("<Picture ") for a in assets):
        return prompt
    roles = {a.get("conditioning") for a in assets}
    if not roles <= {"Reference", "First frame", "Last frame"} or "Reference" not in roles:
        return prompt
    match = re.search(r"(?m)^\s*summary\s*:\s*\[([^\]\r\n]+)\]", prompt)
    if not match:
        return prompt
    tasks = set(match[1].split(" + "))
    impossible = {"video editing", "video continuation", "audio reuse", "audio reference"}
    if not tasks & impossible or not tasks <= impossible | {"keyframe completion", "reference generation"}:
        return prompt
    canonical = (["keyframe completion"] if roles & {"First frame", "Last frame"} else []) + ["reference generation"]
    return prompt[:match.start(1)] + " + ".join(canonical) + prompt[match.end(1):]


def media_contract(mode, assets):
    if mode != "Reference":
        return "Use the selected Base profile's exact frame alignment and three required fields."
    types = ["reference generation"]
    if any(a.get("conditioning") in {"First frame", "Last frame"} for a in assets):
        types.insert(0, "keyframe completion")
    if any(a["reference"].startswith("<Video ") for a in assets):
        types.extend(["video editing", "video continuation"])
    if any(a["reference"].startswith("<Audio ") for a in assets):
        types.extend(["audio reuse", "audio reference"])
    return ("Allowed summary task types for this request: " + ", ".join(types) + ". "
            "No other task types are possible with these inputs. Include keyframe completion when a First or Last frame is supplied. "
            "Neighboring prompt text is not a Video input. Define every supplied First/Last Picture on its own line in subject_definitions; "
            "bind other used reference labels to their subjects there before using them in the narrative.")


def assemble_repair(item, prompt, failure):
    request = copy.deepcopy(item)
    mode = item["input"]["mode"]
    compact = item["input"].get("output_format") == "compact"
    payload = {"original_prompt": prompt, "validator_problems": failure.details,
               "mode": mode, "output_format": "compact" if compact else "official", "duration_seconds": item["input"]["duration_seconds"],
               "media_manifest": item["input"]["media_manifest"]}
    request["sequence_stage"] = "repair"
    if compact:
        request["messages"] = [{"role": "system", "content": COMPACT_CONTRACT}, {"role": "user", "content":
            "This is the only format correction attempt. Remove official section headings from the original prompt. "
            "Keep all scene descriptions, dialogue, timing, sound, camera intent and style verbatim. Do not plan, add content, or rewrite the scene. "
            "Keep overall_soundscape and non_diegetic_music as the final two fields, with their content unchanged. Return the full Compact prompt.\n" + json.dumps(payload, ensure_ascii=False)}]
        return request
    request["messages"] = _guide_messages(mode, "") + [{"role": "user", "content":
        "Correct only objective contract/format violations in the supplied model output. This is the sole repair attempt. "
        "Preserve scene facts, actions, progression, dialogue/monologue verbatim, timing intent, camera intent and style. "
        "Do not add events or visual facts, move actions between intervals, invent missing prose, or creatively improve the prompt. "
        "Keep the entire narrative, overall_soundscape and non_diegetic_music fields unchanged. "
        "Do not plan or generate another scene. Use existing descriptions for missing definitions; if a binding cannot be established "
        "without guessing, leave it unresolved. Return the full corrected prompt only.\n"
        + media_contract(mode, item["input"]["media_manifest"]["assets"]) + "\n" + json.dumps(payload, ensure_ascii=False)}]
    return request


def preserve_content(original, candidate, mode, output_format="official"):
    """Contract repair may edit bindings and task metadata, never the actual scene."""
    fields = ["detailed_description" if mode == "Reference" else "integrated_multimodal_description",
              "overall_soundscape", "non_diegetic_music"]
    def content(text, index):
        text = re.sub(r"\n```\s*$", "", text)
        end = r"(?=^\s*" + fields[index + 1] + r"\s*:)" if index < 2 else r"\Z"
        match = re.search(r"(?ms)^\s*" + fields[index] + r"\s*:[ \t]*(.*?)" + end, text)
        return re.sub(r"\s+", " ", match[1]).strip() if match else None
    changed = compact_content(original) != compact_content(candidate) if output_format == "compact" else any(content(original, i) != content(candidate, i) for i in range(3))
    if (changed
            or LITERAL.findall(original) != LITERAL.findall(candidate)):
        raise ModelError("INVALID_SEQUENCE_PROMPT", "The model changed scene content during its format correction.",
                         {"contract_failure": "the format correction changed narrative or sound content", "repairable": False})


def attention_message(failure, item):
    detail = (failure.details or {}).get("contract_failure", failure.message) if isinstance(failure.details, dict) else failure.message
    assets = item["input"]["media_manifest"]["assets"]
    duration = item["input"]["duration_seconds"]
    seconds = min(5, duration)
    time_hint = (f"Use MM:SS.mmm within this {duration:g}s chunk. For example, {seconds:g} seconds is "
                 f"00:{seconds:02.0f}.000. 05:00.000 means five minutes. Edit the time if intended, or Regenerate / Refine.")
    if "timestamp" in detail.lower() or "cut time" in detail.lower():
        return "The model returned an invalid local time.\n\n" + detail.rstrip(".") + ".\n\n" + time_hint
    if item["input"].get("output_format") == "compact":
        return ("The model could not finish the Compact output. This is a generated-output issue; you do not need to change your inputs.\n\n"
                + detail.rstrip(".") + ". Edit or Regenerate / Refine. Expected: scene description, then overall_soundscape: Room ambience. and non_diegetic_music: N/A (unless music was requested).")
    explanations = []
    problems = failure.details.get("problems", [detail]) if isinstance(failure.details, dict) else [detail]
    for problem in problems:
        if "source-video task" in problem:
            explanations.append("The model selected video editing or video continuation, but this chunk has no Video input. "
                                "Use [keyframe completion + reference generation] when First/Last and references are supplied, or [reference generation] for references only.")
        elif "audio-reference task" in problem:
            explanations.append("The model selected an audio task, but this chunk has no Audio input. Suggested fix: remove that task type from summary.")
        elif "standalone frame definition" in problem:
            asset = next((a for a in assets if problem.startswith(a["reference"])), None)
            role = asset.get("conditioning", "frame").lower() if asset else "frame"
            tag = asset["reference"] if asset else "the supplied Picture"
            shot = "[Shot 1]" if role == "first frame" else "the final local shot"
            explanations.append(f"The model omitted the {role} definition for {tag}. Expected something like:\n{tag} is the {role} of {shot}, ...")
        elif "definition" in problem or "binding" in problem:
            explanations.append("The model used a reference label without defining it or linking it to its source. "
                                "In subject_definitions, link the actual source, for example: <Subject 1> is the person from <Picture 1>. Use this chunk's labels and existing facts.")
        elif "alignment" in problem and item["input"]["mode"] == "I2VA":
            explanations.append("The model omitted or changed the first-frame binding. Expected:\nFor the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.")
        elif "prefix" in problem:
            explanations.append("The model did not use the required task prefix. Suggested fix: " + media_contract(item["input"]["mode"], assets))
        elif "timestamp" in problem or "cut time" in problem:
            explanations.append(problem.rstrip(".") + ". " + time_hint)
        elif "shot" in problem:
            explanations.append(problem.rstrip(".") + ". Start with [Shot 1] followed by action prose. Only requested cuts add [Shot 2] At 00:05.000, ... with an in-range cut time.")
        elif "label" in problem or "absent" in problem:
            available = ", ".join(a["reference"] for a in assets) or "none"
            explanations.append(problem.rstrip(".") + ". Available media labels for this chunk: " + available + ". Use only these labels, or Regenerate / Refine.")
        else:
            narrative = "detailed_description" if item["input"]["mode"] == "Reference" else "integrated_multimodal_description"
            explanations.append("The model's output needs review: " + problem.rstrip(".") + ". Required narrative field: " + narrative +
                                ": [Shot 1] Scene and action. Keep overall_soundscape and non_diegetic_music below it. Edit the format or Regenerate / Refine.")
    return "The model could not finish the prompt formatting. This is a generated-output issue; you do not need to change your inputs.\n\n" + "\n\n".join(explanations)
