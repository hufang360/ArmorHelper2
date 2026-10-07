#!/usr/bin/env python3
"""Inspect a Terraria >= 1.4.4 armor body texture.

Renders (or just measures) ``Armor/Armor_<id>.png`` the way the game samples it
and prints an ASCII preview, so a generated sheet can be compared against a
vanilla one.

    python tools/inspect_armor.py path/to/Armor_190.png
    python tools/inspect_armor.py path/to/Armor_190.png --frames 0,1,5 --render out.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from armorhelper import layout as L  # noqa: E402
from armorhelper.imaging import new_canvas, paste_region  # noqa: E402

# The game's textures are at the native 2x scale: 40x56 per cell.
FRAME_W, FRAME_H = L.FRAME_W * 2, L.FRAME_H * 2


def cell_bbox(image: Image.Image, col: int, row: int) -> tuple[int, int, int, int] | None:
    x, y = col * FRAME_W, row * FRAME_H
    box = image.crop((x, y, x + FRAME_W, y + FRAME_H)).getbbox()
    return box


def report(image: Image.Image) -> None:
    cols = image.width // FRAME_W
    rows = image.height // FRAME_H
    print(f"{image.width}x{image.height}  grid {rows} rows x {cols} columns of {FRAME_W}x{FRAME_H}")
    if image.width % FRAME_W or image.height % FRAME_H:
        print(f"  warning: not an exact multiple of {FRAME_W}x{FRAME_H} cells")
    for row in range(rows):
        parts = []
        for col in range(cols):
            box = cell_bbox(image, col, row)
            if box is None:
                parts.append(f"c{col}: -")
            else:
                x0, y0, x1, y1 = box
                parts.append(f"c{col}:{x1 - x0}x{y1 - y0}")
        print(f"  row{row}: " + " | ".join(parts))


def render_frames(image: Image.Image, frames: list[int]) -> list[Image.Image]:
    """Compose frames exactly like ``PlayerDrawSet.CreateCompositeData`` does."""
    result = []
    for frame in frames:
        canvas = new_canvas(FRAME_W, FRAME_H)
        back = L.BACK_ARM_CELL[frame]
        paste_region(
            canvas,
            image,
            (back[0] * FRAME_W, back[1] * FRAME_H, FRAME_W, FRAME_H),
            (0, 0),
        )
        if frame == 5:
            torso = L.TORSO_JUMP_CELL
        else:
            torso = L.TORSO_CELL
        paste_region(
            canvas,
            image,
            (torso[0] * FRAME_W, torso[1] * FRAME_H, FRAME_W, FRAME_H),
            (0, 0),
        )
        front = L.FRONT_ARM_CELL[frame]
        paste_region(
            canvas,
            image,
            (front[0] * FRAME_W, front[1] * FRAME_H, FRAME_W, FRAME_H),
            (0, 0),
        )
        result.append(canvas)
    return result


def show_ascii(frames: list[Image.Image], labels: list[int], scale: int = 2) -> None:
    width = max(frame.width for frame in frames) // scale
    height = max(frame.height for frame in frames) // scale
    for label, frame in zip(labels, frames):
        print(f"--- body frame {label}")
        for y in range(height):
            row = ""
            for x in range(width):
                alpha = max(
                    frame.getpixel((x * scale + dx, y * scale + dy))[3]
                    for dx in range(scale)
                    for dy in range(scale)
                )
                row += "#" if alpha > 16 else "."
            if row.strip("."):
                print(f"{y * scale:3d} {row}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--frames", default="0,5", help="comma separated body frames to render")
    parser.add_argument("--scale", type=int, default=2, help="ASCII downscale factor")
    parser.add_argument("--render", type=Path, help="also write the rendered frames to a PNG")
    args = parser.parse_args()

    image = Image.open(args.image).convert("RGBA")
    report(image)

    frames = [int(piece) for piece in args.frames.split(",") if piece.strip()]
    composed = render_frames(image, frames)
    show_ascii(composed, frames, scale=args.scale)

    if args.render:
        sheet = new_canvas(FRAME_W, FRAME_H * len(composed))
        for index, frame in enumerate(composed):
            paste_region(sheet, frame, (0, 0, FRAME_W, FRAME_H), (0, index * FRAME_H))
        args.render.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(args.render)
        print(f"wrote {args.render}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
