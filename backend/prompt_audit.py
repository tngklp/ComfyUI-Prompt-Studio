"""Prompt auditing.

Audit behaviour belongs to a generation target, so this module is a thin
dispatcher onto the resolved target's strategy. The exported helpers re-export
the MiniMax H3 rules because H3 is the only target whose output contract is
structurally checkable; other targets audit what applies to them.
"""

from __future__ import annotations

from typing import Any

from .targets import target_for_mode
from .targets.h3 import (
    CAMERA_DIRECTION,
    INTERNAL_VIDEO_REPRESENTATION,
    REFERENCE_SECTIONS,
    TIMESTAMP_CANDIDATE,
    VALID_TIMESTAMP,
    camera_structure_requested,
    internal_video_representation_terms,
    invalid_timestamps,
    reference_sections,
    unsupported_camera_directions,
)

__all__ = [
    "CAMERA_DIRECTION",
    "INTERNAL_VIDEO_REPRESENTATION",
    "REFERENCE_SECTIONS",
    "TIMESTAMP_CANDIDATE",
    "VALID_TIMESTAMP",
    "audit_prompt",
    "camera_structure_requested",
    "internal_video_representation_terms",
    "invalid_timestamps",
    "reference_sections",
    "unsupported_camera_directions",
]


def audit_prompt(
    prompt: str,
    mode: str = "Reference",
    duration_seconds: float | None = None,
    camera_structure_allowed: bool = True,
) -> dict[str, Any]:
    """Audit a prompt using the strategy of the mode that produced it."""
    strategy = target_for_mode(mode).strategy
    return strategy.audit_prompt(
        prompt,
        mode,
        duration_seconds=duration_seconds,
        camera_structure_allowed=camera_structure_allowed,
    )
