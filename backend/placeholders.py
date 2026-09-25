"""Manual reference placeholders.

A *placeholder* is a media slot the user has declared without providing a file.
It exists so a reference-driven prompt can be written *before* the media is ready:
the user reserves ``<Picture 1>``, describes what will go there in their own words,
and the prompt model writes the prompt from that description instead of from an
image it cannot see.

Why this has to be a first-class concept rather than a fake asset: the whole
generation path keys off the media manifest. A placeholder that were merely a
frontend-only row would still leave the Creative Brief's ``<Picture 1>`` tag
failing ``_validate_reference_tags`` on the backend, and the placeholder would
still be counted as an attached image, so the vision-capability check would
demand a projector the user deliberately does not need.

So a placeholder is stored as a real asset that is inert everywhere it matters:

* it holds no file, so it never becomes a ``media_input`` and never claims a
  vision capability;
* it never contributes an estimated visual token, so it cannot trigger a context
  upgrade;
* it still owns a reference tag, so it satisfies reference-tag validation; and
* it carries the user's own description, which is the only thing the prompt model
  is told about it.

The last point is what makes the feature safe: the description is authored by the
user, so nothing about the future image is invented by the prompt model.
"""

from __future__ import annotations

from typing import Any

# Placeholder kinds the UI offers. ``audio`` is deliberately absent: audio is never
# analysed by the prompt model anyway, so it never had the problem this solves.
PLACEHOLDER_KINDS = ("image", "video")

PLACEHOLDER_STATUS = "placeholder"

PLACEHOLDER_DESCRIPTION_LIMIT = 1000

# A placeholder occupies a real slot, so it needs a kind the registry already
# understands for limits and reference naming.
_VALID_KINDS = frozenset(PLACEHOLDER_KINDS)


class PlaceholderError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def is_placeholder(asset: dict[str, Any] | None) -> bool:
    """True when an asset is a declared-but-absent media slot."""
    return bool(asset) and asset.get("status") == PLACEHOLDER_STATUS


def has_file(asset: dict[str, Any] | None) -> bool:
    """True when the asset holds real bytes the prompt model could be shown.

    A placeholder and a ``needs_edit`` asset are both *unresolved*: neither can be
    sent to a vision model. They differ in intent - a placeholder is deliberately
    absent, while ``needs_edit`` is present but awaiting a trim - so the two are
    checked separately and never conflated.
    """
    if not asset:
        return False
    return asset.get("status") not in {PLACEHOLDER_STATUS, "needs_edit"}


def unresolved_assets(assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [asset for asset in assets if not has_file(asset)]


def validate_placeholder(kind: Any, description: Any, reference: Any = None) -> tuple[str, str]:
    """Validate the inputs for a new placeholder and return ``(kind, description)``."""
    if not isinstance(kind, str) or kind not in _VALID_KINDS:
        raise PlaceholderError(
            "INVALID_PLACEHOLDER_KIND",
            f"A reference placeholder must be one of {', '.join(sorted(_VALID_KINDS))}.",
        )
    if not isinstance(description, str) or not description.strip():
        raise PlaceholderError(
            "PLACEHOLDER_DESCRIPTION_REQUIRED",
            "Describe what this reference will contain, or the prompt model has nothing to work from.",
        )
    text = description.strip()
    if len(text) > PLACEHOLDER_DESCRIPTION_LIMIT:
        raise PlaceholderError(
            "PLACEHOLDER_DESCRIPTION_TOO_LONG",
            f"A reference description cannot exceed {PLACEHOLDER_DESCRIPTION_LIMIT:,} characters.",
        )
    if reference is not None and not isinstance(reference, str):
        raise PlaceholderError("INVALID_REQUEST", "The reference tag must be text.")
    return kind, text


def placeholder_line(asset: dict[str, Any]) -> str:
    """One manifest line describing a placeholder for the prompt model.

    Phrased as a declaration rather than a description of an image, because the
    model must not treat the user's note as observed content.
    """
    reference = asset.get("reference") or asset.get("filename") or "reference"
    description = str(asset.get("description") or "").strip()
    kind = asset.get("type") or "image"
    return (
        f"{reference}: no {kind} attached. The user declares in advance that "
        f"{reference} will carry: {description} "
        f"(Write the prompt from this declaration only. Do not claim to have seen "
        f"{reference} and do not invent details beyond it.)"
    )
