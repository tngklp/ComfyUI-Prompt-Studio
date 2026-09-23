"""Thin standalone host for Prompt Studio."""

from pathlib import Path


VERSION_FILE = Path(__file__).resolve().parents[1] / "VERSION"
__version__ = VERSION_FILE.read_text(encoding="utf-8").strip()
