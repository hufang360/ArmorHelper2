"""Frame composition and GIF export (the "Full Armor" outputs)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from . import layout as L
from .generate import generate_head, generate_legs, new_body_frames
from .imaging import new_canvas, paste_region, upscale

__all__ = [
    "SKIN_TINT",
    "full_armor_frames",
    "gif_frame_order",
    "overlay",
    "save_gif",
    "tint_frames",
]

#: The tint ArmorHelper v1 used for the player skin in "Full Armor + Player".
SKIN_TINT = (255 / 255, 150 / 255, 89 / 255)


def full_armor_frames(
    template: Image.Image, *, female: bool = False, upscale_to: int = 2
) -> list[Image.Image]:
    """20 frames (40x56 each) of the armor set, no player drawn."""
    head = generate_head(template, upscale_to=upscale_to)
    legs = generate_legs(template, upscale_to=upscale_to)
    body = new_body_frames(template, female=female, upscale_to=upscale_to)
    frame_w = L.FRAME_W * upscale_to
    frame_h = L.FRAME_H * upscale_to

    frames: list[Image.Image] = []
    for index, body_frame in enumerate(body):
        canvas = new_canvas(frame_w, frame_h)
        # Legs behind, then the body (back arm, torso, front arm), then the head.
        paste_region(canvas, legs, (0, index * frame_h, frame_w, frame_h), (0, 0))
        paste_region(canvas, body_frame, (0, 0, frame_w, frame_h), (0, 0))
        paste_region(canvas, head, (0, index * frame_h, frame_w, frame_h), (0, 0))
        frames.append(canvas)
    return frames


def tint_frames(frames, tint=SKIN_TINT) -> list[Image.Image]:
    """Multiply the RGB of every frame (used for the player's skin)."""
    from .imaging import multiply_color

    return [multiply_color(frame, tint) for frame in frames]


def overlay(base_frames, layer_frames) -> list[Image.Image]:
    """Draw ``layer_frames`` on top of ``base_frames`` (same length)."""
    result = []
    for base, layer in zip(base_frames, layer_frames):
        canvas = base.copy()
        paste_region(canvas, layer, (0, 0, layer.width, layer.height), (0, 0))
        result.append(canvas)
    return result


def gif_frame_order() -> list[int]:
    """The frame sequence ArmorHelper v1 used for its GIFs.

    Two full walk cycles, a short pause on frame 0, a four frame "jump"
    sequence and another pause.
    """
    order: list[int] = []
    for group in range(5):
        pause = group in (2, 4)
        jump = group == 3
        if jump:
            start, stop = 1, 5
        elif pause:
            start, stop = 6, 10
        else:
            start, stop = 0, 20
        for index in range(start, stop):
            order.append(0 if pause else index)
    return order


def _shared_palette(frames: list[Image.Image]) -> Image.Image:
    """Build one palette for every frame so the GIF does not flicker."""
    width = max(frame.width for frame in frames)
    height = sum(frame.height for frame in frames)
    strip = new_canvas(width, height)
    y = 0
    for frame in frames:
        paste_region(strip, frame, (0, 0, frame.width, frame.height), (0, y))
        y += frame.height
    # ``colors=255`` keeps index 255 free for transparency.
    return strip.convert("RGB").quantize(colors=255, method=Image.MEDIANCUT)


def save_gif(
    frames: list[Image.Image],
    path: str | Path,
    *,
    order: list[int] | None = None,
    duration: int = 66,
    upscale_to: int = 2,
) -> Path:
    """Write an animated GIF with a shared palette and a transparent background."""
    if order is None:
        order = gif_frame_order()
    if not frames:
        raise ValueError("no frames to write")

    scaled = [upscale(frames[index], upscale_to) for index in order]
    palette = _shared_palette(scaled)
    transparent_index = 255

    converted: list[Image.Image] = []
    for frame in scaled:
        rgba = frame.convert("RGBA")
        indexed = rgba.convert("RGB").quantize(palette=palette)
        transparent = rgba.getchannel("A").point(lambda value: 255 if value <= 1 else 0)
        indexed.paste(transparent_index, mask=transparent)
        converted.append(indexed)

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    converted[0].save(
        path,
        save_all=True,
        append_images=converted[1:],
        duration=duration,
        loop=0,
        transparency=transparent_index,
        disposal=2,
        optimize=False,
    )
    return path
