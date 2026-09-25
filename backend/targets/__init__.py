"""Generation-target registry.

A *generation target* is the model a prompt is written **for** (MiniMax H3,
MiniMax Music 3, Qwen Image 2.1, ...). This is deliberately distinct from a
*prompt model*, which is the LLM that writes the prompt; the prompt-model layer
lives in ``backend/catalog.py`` and ``backend/models/``.

Targets are declared as data in ``targets.json`` at the repository root and
resolved here. Behaviour that cannot be expressed as data (output validation,
audit rules, repair vocabulary) lives in a per-target *strategy* module named by
the ``strategy`` field, resolved lazily so importing a target never imports
every strategy.

Mirrors the lineage -> policy -> verified-configuration pattern already used by
``backend/models/gguf_policies.py``.
"""

from __future__ import annotations

import importlib
import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any, Iterator

TARGETS_PATH = Path(__file__).resolve().parent.parent.parent / "targets.json"
SCHEMA_VERSION = 1

CATEGORIES = frozenset({"video", "audio", "image", "image-edit"})


class TargetError(ValueError):
    """Raised when the target registry is malformed or a lookup fails."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ModeOptionChoice:
    """One selectable value of a mode option.

    ``prompt_tag`` is the exact vocabulary the target's own guide uses, so the
    registry can validate a stored selection without importing the strategy.
    """

    id: str
    label: str
    hint: str = ""
    prompt_tag: str | None = None


@dataclass(frozen=True)
class ModeOption:
    """A per-mode choice the user makes before generating.

    Options exist because some targets have a small, closed set of settings that
    change the *content* of the prompt rather than its framing - Anima's content
    rating and prompt style, for example. They are declared as data so the
    interface renders them without hardcoding a target, and so the backend can
    reject an unknown value instead of silently ignoring it.

    A ``default`` of ``None`` is meaningful: it means "no default, let the user
    opt in", which is how an optional tag stays absent until it is asked for.
    """

    id: str
    label: str
    hint: str
    choices: tuple[ModeOptionChoice, ...]
    default: str | None = None
    scope: str = "prompt"

    def choice(self, choice_id: str) -> ModeOptionChoice:
        for candidate in self.choices:
            if candidate.id == choice_id:
                return candidate
        raise TargetError(
            "INVALID_OPTION",
            f"{choice_id!r} is not a value of {self.id!r}.",
        )

    @property
    def choice_ids(self) -> tuple[str, ...]:
        return tuple(candidate.id for candidate in self.choices)


@dataclass(frozen=True)
class Mode:
    """One selectable input mode of a target (for example MiniMax H3 ``T2VA``)."""

    id: str
    label: str
    title: str
    hint: str
    target_id: str
    guide: str | None = None
    system_prompt: str | None = None
    requires_media: bool = False
    limits: dict[str, int] = field(default_factory=dict)
    instruction_field: str | None = None
    instruction_limit: int | None = None
    output_only: bool = False
    options: tuple[ModeOption, ...] = ()

    @property
    def total_limit(self) -> int | None:
        return self.limits.get("total")

    def limit_for(self, media_type: str) -> int | None:
        """Per-type limit, falling back to the combined total when unset."""
        return self.limits.get(media_type, self.limits.get("total"))

    def option(self, option_id: str) -> ModeOption:
        for candidate in self.options:
            if candidate.id == option_id:
                return candidate
        raise TargetError("INVALID_OPTION", f"{option_id!r} is not an option of {self.id!r}.")

    @property
    def option_ids(self) -> tuple[str, ...]:
        return tuple(candidate.id for candidate in self.options)


@dataclass(frozen=True)
class GuideRef:
    id: str
    title: str
    filename: str
    source_sha256: str | None
    source_url: str | None
    # True when the guide comes from an upstream document but was deliberately
    # edited in-repo, so it carries provenance without a verbatim pin. A pinned
    # guide must be byte-identical to upstream, which an adapted one never is.
    adapted: bool = False


@dataclass(frozen=True)
class OutputContract:
    profile: str
    brief_limit: int
    requires_duration: bool = False
    requires_aspect_ratio: bool = False
    shot_numbering: bool = False
    timestamp_syntax: bool = False
    lyrics_limit: int | None = None
    edit_instruction_limit: int | None = None


@dataclass(frozen=True)
class DurationRange:
    min: float
    max: float
    default: float


@dataclass(frozen=True)
class Target:
    """A generation target plus everything needed to prompt it."""

    id: str
    label: str
    category: str
    workspace: str
    description: str
    strategy_path: str
    output_tokens: int
    aspect_ratios: tuple[str, ...]
    durations: DurationRange | None
    default_mode: str
    default_aspect_ratio: str | None
    media_capabilities: tuple[str, ...]
    guides: tuple[GuideRef, ...]
    system_prompts: dict[str, str]
    output_contract: OutputContract
    modes: tuple[Mode, ...]
    guide_source_root: str | None = None
    guide_revision: str | None = None

    def mode(self, mode_id: str) -> Mode:
        for candidate in self.modes:
            if candidate.id == mode_id:
                return candidate
        raise TargetError(
            "INVALID_MODE",
            f"{mode_id!r} is not a mode of {self.label}.",
        )

    def has_mode(self, mode_id: str) -> bool:
        return any(candidate.id == mode_id for candidate in self.modes)

    def guide(self, guide_id: str) -> GuideRef:
        for candidate in self.guides:
            if candidate.id == guide_id:
                return candidate
        raise TargetError("INVALID_GUIDE", f"{guide_id!r} is not a guide of {self.label}.")

    @property
    def mode_ids(self) -> tuple[str, ...]:
        return tuple(candidate.id for candidate in self.modes)

    @property
    def supports_media(self) -> bool:
        return bool(self.media_capabilities)

    @property
    def strategy(self) -> ModuleType:
        """Import and cache the behaviour module for this target."""
        return _load_strategy(self.strategy_path)


@lru_cache(maxsize=16)
def _load_strategy(dotted_path: str) -> ModuleType:
    # Resolve relative to this package instead of importing the absolute
    # ``backend.targets.*`` path: standalone runs with the repo root on
    # ``sys.path`` (so ``backend`` is a top-level package), but inside
    # ComfyUI the extension is imported as a ``custom_nodes`` subpackage
    # and no top-level ``backend`` module exists. Accept both bare ids
    # (``qwen_image``) and legacy absolute paths (``backend.targets.qwen_image``).
    name = dotted_path
    prefix = "backend.targets."
    if name.startswith(prefix):
        name = name[len(prefix):]
    try:
        return importlib.import_module(f".{name}", package=__package__)
    except ImportError as error:  # pragma: no cover - guarded by validation
        raise TargetError(
            "STRATEGY_UNAVAILABLE",
            f"Could not load the strategy module {dotted_path!r}: {error}",
        ) from error


def _require(mapping: dict[str, Any], key: str, where: str, kind: type) -> Any:
    if key not in mapping:
        raise TargetError("MALFORMED_TARGET", f"{where} is missing the required {key!r} field.")
    value = mapping[key]
    if not isinstance(value, kind):
        raise TargetError(
            "MALFORMED_TARGET",
            f"{where}.{key} must be {kind.__name__}, got {type(value).__name__}.",
        )
    return value


def _parse_duration(raw: Any, where: str) -> DurationRange | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise TargetError("MALFORMED_TARGET", f"{where}.durations must be an object or null.")
    minimum = float(_require(raw, "min", f"{where}.durations", (int, float)))
    maximum = float(_require(raw, "max", f"{where}.durations", (int, float)))
    default = float(_require(raw, "default", f"{where}.durations", (int, float)))
    if not minimum <= default <= maximum:
        raise TargetError(
            "MALFORMED_TARGET",
            f"{where}.durations.default must sit between min and max.",
        )
    return DurationRange(minimum, maximum, default)


def _parse_guide(raw: dict[str, Any], target: dict[str, Any], where: str) -> GuideRef:
    guide_id = _require(raw, "id", where, str)
    filename = _require(raw, "filename", where, str)
    source_root = target.get("guide_source_root")
    # The vendored file is often renamed locally (Qwen Image 2.1 renames the
    # upstream t2i/edit prompts), so an explicit upstream filename may be needed
    # to build a source URL that resolves. Defaults to the local filename.
    source_filename = raw.get("source_filename", filename)
    if source_root is not None and not isinstance(source_root, str):
        raise TargetError("MALFORMED_TARGET", f"{where}.guide_source_root must be a string.")
    if not isinstance(source_filename, str):
        raise TargetError("MALFORMED_TARGET", f"{where}.source_filename must be a string.")
    sha256 = raw.get("source_sha256")
    if sha256 is not None and not isinstance(sha256, str):
        raise TargetError("MALFORMED_TARGET", f"{where}.source_sha256 must be a string or null.")
    adapted = bool(raw.get("adapted", False))
    # An adapted guide must not be pinned: the pin asserts byte-equality with
    # upstream, and an adapted file differs by definition, so the two together
    # always fail the integrity check at load.
    if adapted and sha256 is not None:
        raise TargetError(
            "MALFORMED_TARGET",
            f"{where} is marked adapted but also pins source_sha256; an adapted guide is edited, "
            "so it cannot match the upstream digest. Drop the pin or the adapted flag.",
        )
    return GuideRef(
        id=guide_id,
        title=_require(raw, "title", where, str),
        filename=filename,
        source_sha256=sha256,
        source_url=(
            f"{source_root.rstrip('/')}/{source_filename}" if source_root else None
        ),
        adapted=adapted,
    )


def _parse_mode_option(raw: dict[str, Any], where: str) -> ModeOption:
    option_id = _require(raw, "id", where, str)
    choices_raw = _require(raw, "choices", where, list)
    if not choices_raw:
        raise TargetError("MALFORMED_TARGET", f"{where}.choices must be a non-empty list.")
    choices: list[ModeOptionChoice] = []
    for index, entry in enumerate(choices_raw):
        choice_where = f"{where}.choices[{index}]"
        if not isinstance(entry, dict):
            raise TargetError("MALFORMED_TARGET", f"{choice_where} must be an object.")
        prompt_tag = entry.get("prompt_tag")
        if prompt_tag is not None and not isinstance(prompt_tag, str):
            raise TargetError("MALFORMED_TARGET", f"{choice_where}.prompt_tag must be a string or null.")
        choices.append(
            ModeOptionChoice(
                id=_require(entry, "id", choice_where, str),
                label=entry.get("label") or _require(entry, "id", choice_where, str),
                hint=entry.get("hint", ""),
                prompt_tag=prompt_tag,
            )
        )
    choice_ids = [choice.id for choice in choices]
    duplicates = [value for value in dict.fromkeys(choice_ids) if choice_ids.count(value) > 1]
    if duplicates:
        raise TargetError("MALFORMED_TARGET", f"{where} declares duplicate choice ids: {duplicates}.")

    default = raw.get("default")
    # `None` is a legitimate default: it means the option is opt-in and its tag is
    # omitted until the user chooses a value.
    if default is not None:
        if not isinstance(default, str):
            raise TargetError("MALFORMED_TARGET", f"{where}.default must be a string or null.")
        if default not in choice_ids:
            raise TargetError(
                "MALFORMED_TARGET",
                f"{where}.default {default!r} is not one of its choices.",
            )

    return ModeOption(
        id=option_id,
        label=_require(raw, "label", where, str),
        hint=raw.get("hint", ""),
        choices=tuple(choices),
        default=default,
        scope=raw.get("scope", "prompt"),
    )


def _parse_mode(raw: dict[str, Any], target: dict[str, Any], where: str) -> Mode:
    limits = raw.get("limits") or {}
    if not isinstance(limits, dict) or not all(
        isinstance(key, str) and isinstance(value, int) and not isinstance(value, bool)
        for key, value in limits.items()
    ):
        raise TargetError("MALFORMED_TARGET", f"{where}.limits must map media types to integers.")
    options_raw = raw.get("options") or []
    if not isinstance(options_raw, list):
        raise TargetError("MALFORMED_TARGET", f"{where}.options must be a list.")
    options = tuple(
        _parse_mode_option(entry, f"{where}.options[{index}]")
        for index, entry in enumerate(options_raw)
    )
    option_ids = [option.id for option in options]
    duplicate_options = [value for value in dict.fromkeys(option_ids) if option_ids.count(value) > 1]
    if duplicate_options:
        raise TargetError("MALFORMED_TARGET", f"{where} declares duplicate option ids: {duplicate_options}.")
    return Mode(
        id=_require(raw, "id", where, str),
        label=raw.get("label") or _require(raw, "id", where, str),
        title=raw.get("title") or raw.get("label") or _require(raw, "id", where, str),
        hint=raw.get("hint", ""),
        target_id=_require(target, "id", "target", str),
        guide=raw.get("guide"),
        system_prompt=raw.get("system_prompt"),
        requires_media=bool(raw.get("requires_media", False)),
        limits=limits,
        instruction_field=raw.get("instruction_field"),
        instruction_limit=raw.get("instruction_limit"),
        output_only=bool(raw.get("output_only", False)),
        options=options,
    )


def _parse_target(raw: dict[str, Any]) -> Target:
    target_id = _require(raw, "id", "target", str)
    where = f"target {target_id!r}"
    category = _require(raw, "category", where, str)
    if category not in CATEGORIES:
        raise TargetError(
            "MALFORMED_TARGET",
            f"{where}.category must be one of {sorted(CATEGORIES)}, got {category!r}.",
        )

    guides_raw = raw.get("guides") or []
    if not isinstance(guides_raw, list):
        raise TargetError("MALFORMED_TARGET", f"{where}.guides must be a list.")
    guides = tuple(
        _parse_guide(entry, raw, f"{where}.guides[{index}]")
        for index, entry in enumerate(guides_raw)
    )

    modes_raw = raw.get("modes")
    if not isinstance(modes_raw, list) or not modes_raw:
        raise TargetError("MALFORMED_TARGET", f"{where}.modes must be a non-empty list.")
    modes = tuple(
        _parse_mode(entry, raw, f"{where}.modes[{index}]")
        for index, entry in enumerate(modes_raw)
    )
    duplicates = [mode_id for mode_id in dict.fromkeys(m.id for m in modes) if [m.id for m in modes].count(mode_id) > 1]
    if duplicates:
        raise TargetError("MALFORMED_TARGET", f"{where} declares duplicate mode ids: {duplicates}.")

    mode_ids = {mode.id for mode in modes}
    for mode in modes:
        if mode.guide is not None and mode.guide not in {guide.id for guide in guides}:
            raise TargetError(
                "MALFORMED_TARGET",
                f"{where} mode {mode.id!r} references unknown guide {mode.guide!r}.",
            )

    default_mode = raw.get("default_mode") or modes[0].id
    if default_mode not in mode_ids:
        raise TargetError(
            "MALFORMED_TARGET",
            f"{where}.default_mode {default_mode!r} is not one of its modes.",
        )

    contract_raw = _require(raw, "output_contract", where, dict)
    contract = OutputContract(
        profile=_require(contract_raw, "profile", f"{where}.output_contract", str),
        brief_limit=int(_require(contract_raw, "brief_limit", f"{where}.output_contract", int)),
        requires_duration=bool(contract_raw.get("requires_duration", False)),
        requires_aspect_ratio=bool(contract_raw.get("requires_aspect_ratio", False)),
        shot_numbering=bool(contract_raw.get("shot_numbering", False)),
        timestamp_syntax=bool(contract_raw.get("timestamp_syntax", False)),
        lyrics_limit=contract_raw.get("lyrics_limit"),
        edit_instruction_limit=contract_raw.get("edit_instruction_limit"),
    )

    aspect_ratios = raw.get("aspect_ratios") or []
    if not isinstance(aspect_ratios, list) or not all(isinstance(item, str) for item in aspect_ratios):
        raise TargetError("MALFORMED_TARGET", f"{where}.aspect_ratios must be a list of strings.")

    default_aspect = raw.get("default_aspect_ratio")
    if contract.requires_aspect_ratio:
        if not aspect_ratios:
            raise TargetError(
                "MALFORMED_TARGET",
                f"{where} requires an aspect ratio but declares none.",
            )
        if default_aspect not in aspect_ratios:
            raise TargetError(
                "MALFORMED_TARGET",
                f"{where}.default_aspect_ratio must be one of its aspect_ratios.",
            )

    capabilities = raw.get("media_capabilities") or []
    if not isinstance(capabilities, list):
        raise TargetError("MALFORMED_TARGET", f"{where}.media_capabilities must be a list.")

    system_prompts = raw.get("system_prompts") or {}
    if not isinstance(system_prompts, dict):
        raise TargetError("MALFORMED_TARGET", f"{where}.system_prompts must be an object.")

    return Target(
        id=target_id,
        label=_require(raw, "label", where, str),
        category=category,
        workspace=_require(raw, "workspace", where, str),
        description=raw.get("description", ""),
        strategy_path=_require(raw, "strategy", where, str),
        output_tokens=int(_require(raw, "output_tokens", where, int)),
        aspect_ratios=tuple(aspect_ratios),
        durations=_parse_duration(raw.get("durations"), where),
        default_mode=default_mode,
        default_aspect_ratio=default_aspect,
        media_capabilities=tuple(capabilities),
        guides=guides,
        system_prompts=dict(system_prompts),
        output_contract=contract,
        modes=modes,
        guide_source_root=raw.get("guide_source_root"),
        guide_revision=raw.get("guide_revision"),
    )


@lru_cache(maxsize=1)
def _registry() -> dict[str, Target]:
    try:
        raw = json.loads(TARGETS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise TargetError("REGISTRY_MISSING", f"No target registry at {TARGETS_PATH}.") from error
    except json.JSONDecodeError as error:
        raise TargetError("REGISTRY_MALFORMED", f"targets.json is not valid JSON: {error}") from error

    if not isinstance(raw, dict):
        raise TargetError("REGISTRY_MALFORMED", "targets.json must contain an object.")
    version = raw.get("$schema_version")
    if version != SCHEMA_VERSION:
        raise TargetError(
            "REGISTRY_VERSION",
            f"targets.json schema version {version!r} is not supported (expected {SCHEMA_VERSION}).",
        )
    entries = raw.get("targets")
    if not isinstance(entries, list) or not entries:
        raise TargetError("REGISTRY_MALFORMED", "targets.json must declare a non-empty targets list.")

    targets: dict[str, Target] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise TargetError("REGISTRY_MALFORMED", "Every target must be an object.")
        target = _parse_target(entry)
        if target.id in targets:
            raise TargetError("REGISTRY_MALFORMED", f"Duplicate target id {target.id!r}.")
        targets[target.id] = target

    _validate_mode_uniqueness(targets)
    return targets


def _validate_mode_uniqueness(targets: dict[str, Target]) -> None:
    """Mode ids address guides and system prompts, so they must be globally unique."""
    seen: dict[str, str] = {}
    for target in targets.values():
        for mode in target.modes:
            owner = seen.get(mode.id)
            if owner is not None:
                raise TargetError(
                    "REGISTRY_MALFORMED",
                    f"Mode id {mode.id!r} is declared by both {owner!r} and {target.id!r}; "
                    "mode ids are used as global API keys and must be unique.",
                )
            seen[mode.id] = target.id


def targets() -> tuple[Target, ...]:
    return tuple(_registry().values())


def target_ids() -> tuple[str, ...]:
    return tuple(_registry())


def target(target_id: str) -> Target:
    try:
        return _registry()[target_id]
    except KeyError as error:
        raise TargetError("UNKNOWN_TARGET", f"Unknown generation target {target_id!r}.") from error


def target_for_mode(mode_id: str) -> Target:
    for candidate in _registry().values():
        if candidate.has_mode(mode_id):
            return candidate
    raise TargetError("INVALID_MODE", "The selected mode is not supported.")


def mode(mode_id: str) -> Mode:
    return target_for_mode(mode_id).mode(mode_id)


def iter_modes() -> Iterator[Mode]:
    for candidate in _registry().values():
        yield from candidate.modes


def mode_ids() -> tuple[str, ...]:
    return tuple(candidate.id for candidate in iter_modes())


def mode_limits(mode_id: str) -> dict[str, int]:
    """Per-mode media limits, retained for the media store's call shape."""
    return dict(mode(mode_id).limits)


def mode_options(mode_id: str) -> tuple[ModeOption, ...]:
    """Declared options of a mode, in display order."""
    return mode(mode_id).options


def resolve_mode_options(mode_id: str, requested: Any) -> dict[str, str | None]:
    """Validate a caller-supplied option selection against the registry.

    Returns every declared option id mapped to its value, so a caller can rely on
    the full key set.

    ``None`` means *no selection*, which is different from a choice whose
    ``prompt_tag`` is null. ``none`` on the rating option is an explicit decision to
    omit the tag and must be reported as such; an unset option simply defers to the
    guide. Both are kept distinguishable by returning the choice id for the former
    and ``None`` for the latter.
    """
    declared = mode(mode_id).options
    if not declared:
        # A mode with no options accepts none; a stray value is a caller error
        # rather than something to silently drop.
        if requested:
            raise TargetError("INVALID_OPTION", f"{mode_id} does not accept mode options.")
        return {}
    if requested is None:
        requested = {}
    if not isinstance(requested, dict):
        raise TargetError("INVALID_OPTION", "Mode options must be an object.")

    unknown = sorted(key for key in requested if key not in {option.id for option in declared})
    if unknown:
        raise TargetError(
            "INVALID_OPTION",
            f"{unknown[0]!r} is not an option of {mode_id}.",
        )

    resolved: dict[str, str | None] = {}
    for option in declared:
        if option.id not in requested:
            resolved[option.id] = option.default
            continue
        value = requested[option.id]
        if value is None or value == "":
            # An explicit null or empty value clears the selection. That is only
            # meaningful for an opt-in option; a required option must be given a
            # value rather than being silently defaulted.
            if option.default is None:
                resolved[option.id] = None
                continue
            raise TargetError(
                "INVALID_OPTION",
                f"{option.id} requires one of {', '.join(option.choice_ids)}.",
            )
        if not isinstance(value, str):
            raise TargetError("INVALID_OPTION", f"{option.id} must be a string.")
        resolved[option.id] = option.choice(value).id
    return resolved


def supports_media_mode(mode_id: str) -> bool:
    return mode(mode_id).requires_media


def output_tokens(mode_id: str) -> int:
    return target_for_mode(mode_id).output_tokens


def strategy_for_mode(mode_id: str) -> ModuleType:
    return target_for_mode(mode_id).strategy


def registry_fingerprint() -> str:
    """Stable digest of the registry, used by tests and diagnostics."""
    import hashlib

    payload = json.dumps(
        [
            {
                "id": candidate.id,
                "category": candidate.category,
                "modes": list(candidate.mode_ids),
                "contract": candidate.output_contract.profile,
            }
            for candidate in targets()
        ],
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def reset_cache() -> None:
    """Drop memoised registry state (tests and local development only)."""
    _registry.cache_clear()
    _load_strategy.cache_clear()
