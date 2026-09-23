"""Objective standalone prompt checks. No inference, semantic repair, or style scoring."""
from __future__ import annotations

import re

from .models.contract import ModelError


LITERAL = re.compile(r'''<d>[\s\S]*?</d>|"(?:\\.|[^"\\])*"|“[^”]*”|‘[^’]*’|(?<!\w)'[^'\r\n]*'(?!\w)''')
LABEL = re.compile(r"<(Subject|Picture|Video|Audio) (\d+)>")
STAMP = re.compile(r"(?<![\d:])(\d{2}):(\d{2})\.(\d{3})(?![\d:])")


def invalid(detail, repairable=False):
    raise ModelError("INVALID_SEQUENCE_PROMPT", f"Invalid standalone prompt: {detail}.",
                     {"contract_failure": detail, "repairable": repairable})


def without_literals(text):
    return LITERAL.sub(lambda m: re.sub(r"[^\r\n]", " ", m[0]), text)


def validate_output(prompt, mode, duration, assets=None):
    """Validate the supplied guide's syntax against this request's local namespace.

    Literals are excluded from syntax checks. Word counts and story consistency
    remain model-quality concerns; neither missing prose nor times are invented.
    """
    text = without_literals(prompt)
    if "```" in text or re.search(r"(?i)\bChunk\s+\d+\b", text):
        invalid("output contains a wrapper or sequence chunk label")
    dialogue = LITERAL.sub(lambda m: m[0] if m[0].startswith("<d>") else "", prompt)
    if dialogue.count("<d>") != dialogue.count("</d>") or re.search(r"<d>(?:(?!</d>)[\s\S])*<d>", dialogue):
        invalid("incomplete dialogue markup")
    for m in re.finditer(r"<(?:Subject|Picture|Video|Audio)\b", text, re.IGNORECASE):
        if not LABEL.match(text, m.start()):
            invalid("malformed H3 reference label")
    field = "detailed_description" if mode == "Reference" else "integrated_multimodal_description"
    def section(name, following):
        return re.search(r"(?ms)^\s*" + name + r"\s*:[ \t]*(.*?)^\s*" + following + r"\s*:", text)[1].strip()
    narrative = section(field, "overall_soundscape")
    labels = list(re.finditer(r"\[Shot (\d+)\]", narrative))
    if not labels or labels[0][1] != "1":
        invalid("the local narrative must start with [Shot 1]")
    if mode != "Reference" and narrative[:labels[0].start()].strip():
        invalid("the Base narrative must begin with [Shot 1]")
    headers = [labels[0]] + [m for m in labels[1:] if re.match(r"\s+At\b", narrative[m.end():]) or not narrative[:m.start()].split("\n")[-1].strip()]
    if [int(m[1]) for m in headers] != list(range(1, len(headers) + 1)):
        invalid("shot numbering must be consecutive and request-local")
    if any(int(m[1]) > len(headers) or int(m[1]) < 1 for m in labels):
        invalid("an undefined local shot is referenced")
    previous_cut = 0
    for i, header in enumerate(headers):
        cut = re.match(r"\s+At\s+(\d{2}:\d{2}\.\d{3})\b", narrative[header.end():])
        if i == 0:
            if cut:
                invalid("the first shot must not have a cut timestamp")
        else:
            if not cut:
                invalid("each later shot needs its local cut timestamp")
            m = STAMP.fullmatch(cut[1])
            seconds = int(m[1]) * 60 + int(m[2]) + int(m[3]) / 1000
            if not previous_cut < seconds < duration:
                invalid("cut times must increase strictly inside the local duration")
            previous_cut = seconds
    for m in STAMP.finditer(narrative):
        if int(m[2]) >= 60 or int(m[1]) * 60 + int(m[2]) + int(m[3]) / 1000 > duration:
            invalid("a narrative timestamp exceeds the local duration")
    # Bare 9:16 is an aspect ratio, not a timestamp. Decimal timestamps and
    # two-digit minute notation remain syntax; prose time cues are checked by cleanup.
    for m in re.finditer(r"(?<![\d:])(?:\d{2,3}:\d{2,3}(?:\.\d+)?|\d:\d{2,3}\.\d+)(?![\d:])", narrative):
        if not STAMP.fullmatch(m[0]):
            invalid("ambiguous or noncanonical narrative timestamp " + m[0])

    if mode in {"I2VA", "FL2VA", "L2VA"}:
        final = len(headers)
        alignment = {
            "I2VA": "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.",
            "FL2VA": f"How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot {final}) aligns with the {duration:.2f}-second mark of the target video.",
            "L2VA": f"How the reference pictures align with the target video — <Picture 1> (from [Shot {final}]) aligns with the {duration:.2f}-second mark of the target video.",
        }[mode]
        if prompt.splitlines()[0].strip() != alignment:
            invalid("the Base frame-alignment instruction does not match this local target", True)

    if assets is not None:
        available = {a["reference"] for a in assets}
        for m in LABEL.finditer(text):
            if m[1] != "Subject" and m[0] not in available:
                invalid(f"{m[0]} is absent from current effective media")
        if mode != "Reference":
            for m in re.finditer(r"\bPicture (\d+)\b", text):
                if f"<Picture {m[1]}>" not in available:
                    invalid(f"Picture {m[1]} is absent from current effective media")
        if mode != "Reference" and re.search(r"<Subject \d+>", text):
            invalid("Subject labels require Reference mode definitions")
    if mode == "Reference":
        problems = []
        def problem(detail, repairable=True):
            problems.append(detail)
        definitions = section("subject_definitions", "summary")
        defined = set(re.findall(r"(?m)^\s*(<Subject [1-9]\d*>)", definitions))
        if any(m[0] not in defined for m in LABEL.finditer(text) if m[1] == "Subject"):
            problem("a Subject is used without its own definition", True)
        sources = {m[0] for m in LABEL.finditer(definitions)}
        if any(m[0] not in sources for m in LABEL.finditer(text)):
            problem("a reference label is used without a definition or source binding", True)
        for asset in assets or []:
            if asset.get("conditioning") in {"First frame", "Last frame"}:
                if not re.search(r"(?m)^\s*" + re.escape(asset["reference"]) + r"\s", definitions):
                    problem(f"{asset['reference']} needs a standalone frame definition", True)
        summary = section("summary", "retention_analysis")
        if not re.match(r"\[(?:keyframe completion|reference generation|video editing|video continuation|audio reuse|audio reference)(?: \+ (?:keyframe completion|reference generation|video editing|video continuation|audio reuse|audio reference))*\]", summary):
            problem("Reference summary needs the official task-type prefix", True)
        task_types = summary.split("]", 1)[0][1:].split(" + ")
        if assets is not None:
            if any(t in task_types for t in ("video editing", "video continuation")) and not any(a["reference"].startswith("<Video ") for a in assets):
                problem("a source-video task requires an effective Video asset", True)
            if any(a.get("conditioning") in {"First frame", "Last frame"} for a in assets) and "keyframe completion" not in task_types:
                problem("the supplied frame anchor requires keyframe completion in the task prefix", True)
            if any(t in task_types for t in ("audio reuse", "audio reference")) and not any(a["reference"].startswith("<Audio ") for a in assets):
                problem("an audio-reference task requires an effective Audio asset", True)
        if problems:
            raise ModelError("INVALID_SEQUENCE_PROMPT", "Invalid standalone prompt: " + "; ".join(problems),
                             {"contract_failure": "; ".join(problems), "problems": problems, "repairable": True})
    return prompt
