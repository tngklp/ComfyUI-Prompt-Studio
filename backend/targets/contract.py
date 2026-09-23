"""Shared interface for generation-target strategies.

A *strategy* holds the behaviour of one generation target that cannot be
expressed as data in ``targets.json``: how to audit a generated prompt, which
output contract to append, which media tasks are legal, and how to phrase a
repair request.

Every strategy module named by a target's ``strategy`` field must expose the
callables declared in :class:`TargetStrategy`. They are plain module-level
functions so a strategy stays importable without constructing anything, and so
:mod:`backend.targets` can resolve them lazily with ``importlib``.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class TargetStrategy(Protocol):
    """Behaviour contract implemented by every ``backend.targets.<id>`` module."""

    def final_contract(self, mode: str, task_text: str) -> str:
        """Closing instruction appended to the assembled request."""

    def audit_prompt(self, prompt: str, mode: str, **context: Any) -> dict[str, Any]:
        """Structural audit of a generated prompt."""

    def media_contract(self) -> str:
        """Vocabulary of legal media task types for repair prompts."""

    def narrow_repair_messages(self, **kwargs: Any) -> list[dict[str, str]]:
        """Repair messages for a single-chunk correction."""

    def multimodal_repair_messages(self, **kwargs: Any) -> list[dict[str, str]]:
        """Repair messages that also carry the accepted media."""


def strategy_for(strategy_module: Any, name: str) -> Any:
    """Fetch ``name`` from a strategy module, failing loudly when it is absent.

    Used by the shared pipeline so a half-implemented strategy surfaces a clear
    error instead of an ``AttributeError`` deep inside generation.
    """
    try:
        attribute = getattr(strategy_module, name)
    except AttributeError as error:
        raise TypeError(
            f"Strategy {strategy_module.__name__!r} does not implement {name!r}."
        ) from error
    if not callable(attribute):
        raise TypeError(f"Strategy {strategy_module.__name__!r}.{name} is not callable.")
    return attribute


def supports(strategy_module: Any, name: str) -> bool:
    return callable(getattr(strategy_module, name, None))
