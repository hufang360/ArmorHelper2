"""Sheet generation.

Public helpers
--------------

Legacy (Terraria <= 1.4.3) sheets, kept so that the port stays a drop in
replacement for ArmorHelper v1:

``generate_head``          ``_Head.png``   40x1120
``generate_legs``          ``_Legs.png``   40x1120
``generate_arms``          ``_Arms.png``   40x1120  (front arm only)
``generate_body_legacy``   ``_Body.png``   40x1120  (back arm + torso + front arm)

Terraria >= 1.4.4 sheets:

``generate_body_composite``  ``_Body.png``  360x224 (360x448 with a glow mask)

``generate`` is the convenience entry point used by the CLI and the GUI.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from PIL import Image

from . import layout as L
from .imaging import fill_rect, new_canvas, paste_region, upscale

__all__ = [
    "SheetSet",
    "generate_head",
    "generate_legs",
    "generate_arms",
    "generate_body_legacy",
    "generate_body_composite",
    "generate",
    "new_body_frames",
]

#: The vertical position arms sit at, relative to the torso, for frames 6..19.
#: In the original code this was ``12 + BODY_HEAD_OFFSETS[frame]``; the body bob
#: is now applied by the engine, so only the constant part remains.
FRONT_ARM_BASE_Y = 12


@dataclass
class SheetSet:
    """Generated sheets, keyed by logical name."""

    head: Image.Image | None = None
    legs: Image.Image | None = None
    body: Image.Image | None = None
    body_legacy: Image.Image | None = None
    body_legacy_female: Image.Image | None = None
    arms: Image.Image | None = None
    extra: dict[str, Image.Image] = field(default_factory=dict)

    def items(self) -> Iterable[tuple[str, Image.Image]]:
        for name in ("head", "legs", "body", "body_legacy", "body_legacy_female", "arms"):
            image = getattr(self, name)
            if image is not None:
                yield name, image
        yield from self.extra.items()


# --------------------------------------------------------------------------- #
# Individual layers of a body frame
# --------------------------------------------------------------------------- #


def _front_arm_layer(frame: int) -> tuple[L.Rect, tuple[int, int], tuple[tuple[int, int], ...]] | None:
    """``(source rect, offset inside the 20x28 frame, ignored source pixels)``."""
    if 0 <= frame <= 4:
        return L.FRONT_ARM_POSES[frame], L.FRONT_ARM_POSE_OFFSETS[frame], ()
    if frame == 5:
        return L.FRONT_ARM_POSES[1], L.FRONT_ARM_POSE_OFFSETS[1], L.FRONT_ARM_FRAME5_IGNORE
    if 6 <= frame <= 19:
        index = frame - 6
        return L.FRONT_ARM_WALK, (L.FRONT_ARM_OFFSETS[index], FRONT_ARM_BASE_Y), ()
    return None


def _back_arm_layer(
    frame: int,
) -> tuple[tuple[tuple[L.Rect, tuple[int, int]], ...], tuple[L.Rect, tuple[int, int]] | None] | None:
    """``(blits, stray)`` for the back arm of ``frame``, or ``None``.

    ``blits`` are positioned relative to the torso (so the caller adds the body
    bob).  ``stray`` is the single pixel ArmorHelper v1 pasted at an *absolute*
    frame offset for two frames; it is deliberately not bob compensated, which
    is what the original code did.
    """
    if frame == 0:
        return ((L.BACK_ARM, (7, 14)),), None
    if frame == 1:
        return ((L.BACK_ARM, (8, 12)),), None
    if frame == 2:
        return ((L.BACK_ARM, (7, 14)),), None
    if 3 <= frame <= 5:
        # The original tool simply leaves the back arm out for these frames.
        return None
    if 6 <= frame <= 19:
        index = frame - 6
        x = 8 + L.BACK_ARM_OFFSETS[index]
        blits = [(L.BACK_ARM, (x, FRONT_ARM_BASE_Y))]
        stray = (L.BACK_ARM_STRAY_PIXEL, (14, FRONT_ARM_BASE_Y + 6))
        if L.BACK_ARM_OFFSETS[index] == -2:
            return tuple(blits), stray
        return tuple(blits), None
    return None


def _torso_rect(female: bool, frame: int) -> L.Rect:
    if female:
        return L.FEMALE_JUMP_SRC if frame == 5 else L.FEMALE_SRC
    return L.BODY_JUMP_SRC if frame == 5 else L.BODY_SRC


# --------------------------------------------------------------------------- #
# Legacy sheets
# --------------------------------------------------------------------------- #


def _legacy_body_frames(template: Image.Image, female: bool) -> list[Image.Image]:
    """One 20x28 frame per body frame, back arm behind, front arm in front.

    This reproduces ArmorHelper v1 byte for byte, including the two ``Fill``
    calls that clip the back arm (in 1.3 the back arm was not part of the body
    sheet, so the tool erased it before compositing the torso on top).
    """
    frames: list[Image.Image] = []
    for frame in range(L.FRAME_COUNT):
        canvas = new_canvas(L.FRAME_W, L.FRAME_H)
        bob = L.BODY_HEAD_OFFSETS[frame]

        back = _back_arm_layer(frame)
        if back:
            blits, stray = back
            layer = new_canvas(L.FRAME_W, L.FRAME_H)
            for rect, (x, y) in blits:
                paste_region(layer, template, rect, (x, y))
            fill_rect(layer, (8, 21, 6, 1), (0, 0, 0, 0))
            fill_rect(layer, (0, 0, 13, L.FRAME_H), (0, 0, 0, 0))
            paste_region(canvas, layer, (0, 0, L.FRAME_W, L.FRAME_H), (0, bob))
            if stray is not None:
                # The original pasted this pixel at an absolute offset, so it
                # does not follow the body bob.
                paste_region(canvas, template, stray[0], stray[1])

        torso_rect = _torso_rect(female, frame)
        ignore: tuple[tuple[int, int], ...] = ()
        if not female and (frame == 1 or frame >= 6):
            # The original skipped two template pixels so the back arm peeks
            # through the torso.  Its author only did this for the male sheet.
            ignore = ((37, torso_rect[1] + 16), (37, torso_rect[1] + 17))
        paste_region(canvas, template, torso_rect, (0, bob), ignore=ignore)

        front = _front_arm_layer(frame)
        if front:
            rect, (x, y), front_ignore = front
            paste_region(canvas, template, rect, (x, y + bob), ignore=front_ignore)

        frames.append(canvas)
    return frames


def _composite_body_frames(
    template: Image.Image, *, female: bool = False, upscale_to: int = 2
) -> list[Image.Image]:
    """Frames exactly as the game composites them in 1.4.4+ (no clipping).

    Used for the "full armor" previews: the back arm is left untouched and the
    torso is drawn over it, which is what the engine does with the composite
    body texture.
    """
    frames: list[Image.Image] = []
    for frame in range(L.FRAME_COUNT):
        canvas = new_canvas(L.FRAME_W, L.FRAME_H)
        bob = L.BODY_HEAD_OFFSETS[frame]
        back = _back_arm_layer(frame)
        if back:
            blits, stray = back
            for rect, (x, y) in blits:
                paste_region(canvas, template, rect, (x, y + bob))
            if stray is not None:
                paste_region(canvas, template, stray[0], stray[1])
        paste_region(canvas, template, _torso_rect(female, frame), (0, bob))
        front = _front_arm_layer(frame)
        if front:
            rect, (x, y), ignore = front
            paste_region(canvas, template, rect, (x, y + bob), ignore=ignore)
        frames.append(upscale(canvas, upscale_to))
    return frames


def _stack(frames: list[Image.Image]) -> Image.Image:
    frame = frames[0]
    sheet = new_canvas(frame.width, frame.height * len(frames))
    for index, image in enumerate(frames):
        paste_region(sheet, image, (0, 0, image.width, image.height), (0, index * frame.height))
    return sheet


def generate_head(template: Image.Image, *, upscale_to: int = 2) -> Image.Image:
    """``Armor_Head_<id>.png`` — 20 frames of 40x56 (1x: 20x560)."""
    sheet = new_canvas(L.FRAME_W, L.FRAME_H * L.FRAME_COUNT)
    for frame in range(L.FRAME_COUNT):
        paste_region(
            sheet,
            template,
            L.HEAD_SRC,
            (0, frame * L.FRAME_H + L.BODY_HEAD_OFFSETS[frame]),
        )
    return upscale(sheet, upscale_to)


def generate_legs(template: Image.Image, *, upscale_to: int = 2) -> Image.Image:
    """``Armor_Legs_<id>.png`` — 20 frames of 40x56 (1x: 20x560)."""
    sheet = new_canvas(L.FRAME_W, L.FRAME_H * L.FRAME_COUNT)

    # Frames 0..4, 11 and 19: the "front" and "back" half of the leg.
    for k in range(7):
        frame = k if k < 5 else (11 if k == 5 else 19)
        base_y = frame * L.FRAME_H + 19
        for side in (0, 1):
            foot_rect = L.LEG_FOOT_FRONT if side == 1 else L.LEG_FOOT_BACK
            # ``flag`` decides whether this piece is drawn on the left or right.
            if k != 6:
                on_left = side == 1
            else:
                on_left = side == 0
            x = 5 if on_left else 7
            fx = foot_rect[0]
            ignore = ((fx + 1, 21), (fx + 7, 21))
            paste_region(sheet, template, foot_rect, (x, base_y), ignore=ignore)

    # Two extra foot pieces, on body frames 6 and 12.
    paste_region(sheet, template, L.LEG_FOOT_FRONT, (6, 6 * L.FRAME_H + 19))
    paste_region(sheet, template, L.LEG_FOOT_FRONT, (6, 12 * L.FRAME_H + 19))

    # The main leg pieces.
    for m, targets in enumerate(L.LEG_MAPPING):
        column = L.LEG_COLUMN_RIGHT if m >= 5 else L.LEG_COLUMN_LEFT
        source_x, source_y = column
        source_y += (m % 5) * 10
        rect = (source_x, source_y, L.LEG_PIECE_SIZE[0], L.LEG_PIECE_SIZE[1])
        for frame in targets:
            paste_region(sheet, template, rect, (3, frame * L.FRAME_H + 19))

    return upscale(sheet, upscale_to)


def generate_arms(template: Image.Image, *, upscale_to: int = 2) -> Image.Image:
    """``Armor_Arm_<id>.png`` (legacy) — the front arm on its own."""
    sheet = new_canvas(L.FRAME_W, L.FRAME_H * L.FRAME_COUNT)
    for frame in range(L.FRAME_COUNT):
        layer = _front_arm_layer(frame)
        if not layer:
            continue
        rect, (x, y), ignore = layer
        paste_region(
            sheet,
            template,
            rect,
            (x, frame * L.FRAME_H + y + L.BODY_HEAD_OFFSETS[frame]),
            ignore=ignore,
        )
    return upscale(sheet, upscale_to)


def generate_body_legacy(
    template: Image.Image, *, female: bool = False, upscale_to: int = 2
) -> Image.Image:
    """``Armor_Body_<id>.png`` / ``Female_Body_<id>.png`` (legacy)."""
    return upscale(_stack(_legacy_body_frames(template, female)), upscale_to)


def new_body_frames(
    template: Image.Image, *, female: bool = False, upscale_to: int = 2
) -> list[Image.Image]:
    """The composite body frames, upscaled.  Handy for previews."""
    return _composite_body_frames(template, female=female, upscale_to=upscale_to)


# --------------------------------------------------------------------------- #
# Terraria >= 1.4.4 composite body
# --------------------------------------------------------------------------- #


def generate_body_composite(
    template: Image.Image,
    *,
    glow_rows: int = 0,
    fill_composite_arms: bool = True,
    upscale_to: int = 2,
) -> Image.Image:
    """``Content/Images/Armor/Armor_<id>.png`` for Terraria >= 1.4.4.

    The male *and* female torso, both shoulder layers and every arm pose live
    in a single 9 x 4 grid of 40x56 frames.  Arms are placed exactly where
    ArmorHelper v1 used to place them inside the old 20x28 frame; the engine
    draws the cells with the same origin, so the result matches the old tool.

    Parameters
    ----------
    glow_rows:
        ``0`` for a 360x224 texture, ``4`` to also write a glow mask in rows
        4..7 (a copy of rows 0..3) giving a 360x448 texture.
    fill_composite_arms:
        Fill columns 7 and 8 (arms while an item is being used).  Without them
        the arms vanish whenever a weapon or tool is swung.
    """
    if glow_rows not in (0, L.BODY_GLOW_ROWS):
        raise ValueError("glow_rows must be 0 or 4")

    rows = L.BODY_COMPOSITE_ROWS + glow_rows
    sheet = new_canvas(L.FRAME_W * L.BODY_COMPOSITE_COLS, L.FRAME_H * rows)

    def cell_xy(cell: tuple[int, int]) -> tuple[int, int]:
        return cell[0] * L.FRAME_W, cell[1] * L.FRAME_H

    # --- torso -------------------------------------------------------------
    paste_region(sheet, template, L.BODY_SRC, cell_xy(L.TORSO_CELL))
    paste_region(sheet, template, L.BODY_JUMP_SRC, cell_xy(L.TORSO_JUMP_CELL))
    paste_region(sheet, template, L.FEMALE_SRC, cell_xy((0, 2)))
    paste_region(sheet, template, L.FEMALE_JUMP_SRC, cell_xy((1, 2)))

    # --- walking front arms -------------------------------------------------
    for cell, frame in L.FRONT_ARM_CELL_OWNER.items():
        layer = _front_arm_layer(frame)
        if not layer:
            continue
        rect, (x, y), ignore = layer
        # ``y`` already excludes the engine-side body bob.
        paste_region(sheet, template, rect, _offset(cell_xy(cell), (x, y)), ignore=ignore)

    # --- walking back arms --------------------------------------------------
    for cell, frame in L.BACK_ARM_CELL_OWNER.items():
        layer = _back_arm_layer(frame)
        if not layer:
            continue
        blits, stray = layer
        for rect, (x, y) in blits:
            paste_region(sheet, template, rect, _offset(cell_xy(cell), (x, y)))
        if stray is not None:
            paste_region(sheet, template, stray[0], _offset(cell_xy(cell), stray[1]))

    # --- arms used while swinging an item ----------------------------------
    if fill_composite_arms:
        front = _front_arm_layer(0)
        back = _back_arm_layer(0)
        for row in range(L.BODY_COMPOSITE_ROWS):
            if front:
                rect, (x, y), ignore = front
                paste_region(
                    sheet,
                    template,
                    rect,
                    _offset(cell_xy((L.COMPOSITE_FRONT_ARM_COL, row)), (x, y)),
                    ignore=ignore,
                )
            if back:
                blits, stray = back
                for rect, (x, y) in blits:
                    paste_region(
                        sheet,
                        template,
                        rect,
                        _offset(cell_xy((L.COMPOSITE_BACK_ARM_COL, row)), (x, y)),
                    )
                if stray is not None:
                    paste_region(
                        sheet,
                        template,
                        stray[0],
                        _offset(cell_xy((L.COMPOSITE_BACK_ARM_COL, row)), stray[1]),
                    )

    # --- glow mask ----------------------------------------------------------
    if glow_rows:
        for row in range(L.BODY_COMPOSITE_ROWS):
            strip = sheet.crop(
                (0, row * L.FRAME_H, sheet.width, (row + 1) * L.FRAME_H)
            )
            sheet.paste(strip, (0, (row + L.BODY_COMPOSITE_ROWS) * L.FRAME_H))

    return upscale(sheet, upscale_to)


def _offset(point: tuple[int, int], delta: tuple[int, int]) -> tuple[int, int]:
    return point[0] + delta[0], point[1] + delta[1]


# --------------------------------------------------------------------------- #
# Convenience
# --------------------------------------------------------------------------- #


def generate(
    template: Image.Image,
    *,
    head: bool = True,
    legs: bool = True,
    body: bool = True,
    legacy: bool = False,
    glow_rows: int = 0,
    upscale_to: int = 2,
) -> SheetSet:
    """Generate the requested sheets in one call."""
    result = SheetSet()
    if head:
        result.head = generate_head(template, upscale_to=upscale_to)
    if legs:
        result.legs = generate_legs(template, upscale_to=upscale_to)
    if body:
        result.body = generate_body_composite(template, glow_rows=glow_rows, upscale_to=upscale_to)
    if legacy:
        result.body_legacy = generate_body_legacy(template, female=False, upscale_to=upscale_to)
        result.body_legacy_female = generate_body_legacy(
            template, female=True, upscale_to=upscale_to
        )
        result.arms = generate_arms(template, upscale_to=upscale_to)
    return result
