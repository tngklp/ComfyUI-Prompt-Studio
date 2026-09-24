"""Render the standalone PWA icons from web/assets/prompt-studio-launcher.svg.

The build ships pre-rendered PNGs because a Chromium install prompt wants real
bitmaps; the SVG stays the single source of truth for the mark. Keeping the
geometry in this script means the icons can be regenerated after a brand change
without adding an SVG rasteriser to the runtime dependencies.

Usage: python scripts/render_pwa_icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
TARGET_DIR = ROOT / "standalone" / "ui" / "icons"

# Geometry mirrors the SVG's 120x120 viewBox.
PANEL_TOP = (0x2B, 0x2F, 0x37)
PANEL_BOTTOM = (0x15, 0x17, 0x1B)
PANEL_BORDER = (0x3B, 0x40, 0x4A)
ACCENT_TOP = (0xB7, 0x9D, 0xFB)
ACCENT_BOTTOM = (0xA7, 0x8B, 0xFA)

BARS = [
    (28, 38, 46, "#5d6470"),
    (28, 56, 60, "#8d94a1"),
    (28, 74, 34, None),  # None -> accent gradient
]


def _lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def _linear_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    gradient = Image.new("RGB", (1, size))
    for y in range(size):
        gradient.putpixel((0, y), _lerp(top, bottom, y / max(1, size - 1)))
    return gradient.resize((size, size))


def _hex(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))


def render(size: int) -> Image.Image:
    # Draw at 4x then downsample so the rounded corners and 5.5px radii stay smooth.
    scale = 4
    canvas = Image.new("RGBA", (120 * scale, 120 * scale), (0, 0, 0, 0))
    panel = _linear_gradient(120 * scale, PANEL_TOP, PANEL_BOTTOM).convert("RGBA")
    mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (6 * scale, 6 * scale, 114 * scale, 114 * scale), radius=26 * scale, fill=255
    )
    canvas.paste(panel, (0, 0), mask)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (6 * scale, 6 * scale, 114 * scale, 114 * scale),
        radius=26 * scale,
        outline=PANEL_BORDER,
        width=3 * scale,
    )
    accent = _linear_gradient(120 * scale, ACCENT_TOP, ACCENT_BOTTOM)
    for x, y, width, colour in BARS:
        box = (x * scale, y * scale, (x + width) * scale, (y + 11) * scale)
        if colour is None:
            bar_mask = Image.new("L", canvas.size, 0)
            ImageDraw.Draw(bar_mask).rounded_rectangle(box, radius=5 * scale + 1, fill=255)
            canvas.paste(accent, (0, 0), bar_mask)
        else:
            draw.rounded_rectangle(box, radius=5 * scale + 1, fill=_hex(colour) + (255,))
    for line in (((78, 79.5), (90, 79.5)), ((84, 73.5), (84, 85.5))):
        draw.line(
            [(line[0][0] * scale, line[0][1] * scale), (line[1][0] * scale, line[1][1] * scale)],
            fill=ACCENT_TOP + (255,),
            width=round(4.5 * scale),
        )
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        target = TARGET_DIR / f"prompt-studio-{size}.png"
        render(size).save(target, "PNG", optimize=True)
        print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
