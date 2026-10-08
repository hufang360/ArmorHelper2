"""The ArmorHelper template layout and the frame tables it encodes.

Template (``ArmorTemplate_v1.png``, 128x80) regions
---------------------------------------------------

Arms, top row (all rects are ``(x, y, w, h)`` in template pixels)::

    (1, 1, 12, 16)    front arm, body frame 0
    (14, 1, 12, 16)   front arm, body frame 1 (also reused for frame 5)
    (27, 1, 16, 16)   front arm, body frame 2
    (44, 1, 17, 16)   front arm, body frame 3
    (62, 1, 16, 16)   front arm, body frame 4
    (79, 1, 13, 11)   front arm, "walk" pose (body frames 6..19)
    (94, 1, 12, 11)   back arm, every body frame
    (101, 8, 1, 1)    a single pixel the original tool pasted for two frames

Body columns::

    (1,  19, 20, 28)  head
    (23, 19, 20, 28)  male torso            (23, 48, 20, 28)  male torso, frame 5
    (44, 19, 20, 28)  female torso          (44, 48, 20, 28)  female torso, frame 5

Legs::

    (66, 19 + 10*m, 16, 9)   left leg piece for m in 0..4
    (83, 19 + 10*m, 16, 9)   right leg piece for m in 0..4
    (100, 19, 9, 9)          front foot
    (110, 19, 9, 9)          back foot

Frame tables
------------

``FRONT_ARM_OFFSETS``/``BACK_ARM_OFFSETS``/``BODY_HEAD_OFFSETS`` are copied
verbatim from the original tool.  ``BODY_HEAD_OFFSETS`` is the vertical bob of
the body during the walk cycle; vanilla head sheets bake the very same bob into
their frames, which is why it is still applied to the head and legs output.
"""

from __future__ import annotations

import os
from functools import lru_cache
from importlib import resources
from typing import Final

from PIL import Image

from . import TEMPLATE_SIZE, ArmorTemplateError

__all__ = [
    "Rect",
    "HEAD_SRC",
    "BODY_SRC",
    "BODY_JUMP_SRC",
    "FEMALE_SRC",
    "FEMALE_JUMP_SRC",
    "FRONT_ARM_POSES",
    "FRONT_ARM_WALK",
    "FRONT_ARM_FRAME5_IGNORE",
    "BACK_ARM",
    "BACK_ARM_STRAY_PIXEL",
    "LEG_COLUMN_LEFT",
    "LEG_COLUMN_RIGHT",
    "LEG_FOOT_FRONT",
    "LEG_FOOT_BACK",
    "FRONT_ARM_OFFSETS",
    "BACK_ARM_OFFSETS",
    "BODY_HEAD_OFFSETS",
    "LEG_MAPPING",
    "FRAME_COUNT",
    "FRAME_W",
    "FRAME_H",
    "HEAD_SHEET_SIZE",
    "BODY_COMPOSITE_COLS",
    "BODY_COMPOSITE_ROWS",
    "FRONT_ARM_CELL",
    "BACK_ARM_CELL",
    "TORSO_CELL",
    "TORSO_JUMP_CELL",
    "FRONT_SHOULDER_CELL",
    "BACK_SHOULDER_CELL",
    "COMPOSITE_FRONT_ARM_COL",
    "COMPOSITE_BACK_ARM_COL",
    "load_template",
    "template_bytes",
    "OVERLAY_FILENAME",
    "bundled_overlay",
    "overlay_bytes",
    "compose_overlay",
]

Rect = tuple[int, int, int, int]

# --------------------------------------------------------------------------- #
# Template regions
# --------------------------------------------------------------------------- #

HEAD_SRC: Final[Rect] = (1, 19, 20, 28)

BODY_SRC: Final[Rect] = (23, 19, 20, 28)
BODY_JUMP_SRC: Final[Rect] = (23, 48, 20, 28)
FEMALE_SRC: Final[Rect] = (44, 19, 20, 28)
FEMALE_JUMP_SRC: Final[Rect] = (44, 48, 20, 28)

#: Front arm sprites for body frames 0..4.
FRONT_ARM_POSES: Final[tuple[Rect, ...]] = (
    (1, 1, 12, 16),
    (14, 1, 12, 16),
    (27, 1, 16, 16),
    (44, 1, 17, 16),
    (62, 1, 16, 16),
)

#: Where each of the five front arm poses is pasted inside its 20x28 frame.
FRONT_ARM_POSE_OFFSETS: Final[tuple[tuple[int, int], ...]] = (
    (0, 9),
    (0, 5),
    (2, 5),
    (2, 8),
    (2, 9),
)

#: The "walk" front arm sprite, used for body frames 6..19.
FRONT_ARM_WALK: Final[Rect] = (79, 1, 13, 11)

#: Body frame 5 reuses pose 1 but with these template pixels masked out.
FRONT_ARM_FRAME5_IGNORE: Final[tuple[tuple[int, int], ...]] = (
    (22, 9),
    (22, 10),
    (22, 11),
    (22, 12),
)

BACK_ARM: Final[Rect] = (94, 1, 12, 11)
BACK_ARM_STRAY_PIXEL: Final[Rect] = (101, 8, 1, 1)

LEG_COLUMN_LEFT: Final[tuple[int, int]] = (66, 19)
LEG_COLUMN_RIGHT: Final[tuple[int, int]] = (83, 19)
LEG_PIECE_SIZE: Final[tuple[int, int]] = (16, 9)
LEG_FOOT_FRONT: Final[Rect] = (100, 19, 9, 9)
LEG_FOOT_BACK: Final[Rect] = (110, 19, 9, 9)

# --------------------------------------------------------------------------- #
# Frame tables (verbatim from ArmorHelper v1)
# --------------------------------------------------------------------------- #

FRAME_COUNT: Final[int] = 20
FRAME_W: Final[int] = 20
FRAME_H: Final[int] = 28
HEAD_SHEET_SIZE: Final[tuple[int, int]] = (FRAME_W * 2, FRAME_H * 2 * FRAME_COUNT)  # 40x1120

FRONT_ARM_OFFSETS: Final[tuple[int, ...]] = (0, -1, -1, -1, -1, 0, 0, 0, 1, 2, 2, 1, 0, 0)
BACK_ARM_OFFSETS: Final[tuple[int, ...]] = (0, 1, 1, 1, 0, 0, 0, 0, -1, -2, -2, -1, 0, 0)
BODY_HEAD_OFFSETS: Final[tuple[int, ...]] = (
    0, 0, 0, 0, 0, 0, 0, -1, -1, -1, 0, 0, 0, 0, -1, -1, -1, 0, 0, 0,
)

#: ``LEG_MAPPING[m]`` lists the body frames that leg piece ``m`` is used for.
LEG_MAPPING: Final[tuple[tuple[int, ...], ...]] = (
    (5,), (7,), (8,), (9,), (10,), (13,), (14,), (15,), (16,), (17, 18),
)

# --------------------------------------------------------------------------- #
# Terraria >= 1.4.4 "composite" body texture layout
# --------------------------------------------------------------------------- #
#
# ``Armor_<id>.png`` (inside Content/Images/Armor) is a grid of 40x56 frames.
# Every cell is looked up by the game as:
#
#   torso          (0, 0) male / (1, 0) male while jumping
#                  (0, 2) female / (1, 2) female while jumping
#   front shoulder (0, 1) male / (0, 3) female
#   back shoulder  (1, 1) male / (1, 3) female
#   front arm      (2..6, 0) body frames 0..4
#                  (2..6, 1) body frames 5..19 (grouped)
#   back arm       same column, row + 2
#   front arm, item use   (7, 0..3) -- one row per "stretch"
#   back arm, item use    (8, 0..3)
#
# Armors with a glow mask are twice as tall; rows 4..7 are the glow mask and
# the game samples them with a +224 px (4 rows) offset.

BODY_COMPOSITE_COLS: Final[int] = 9
BODY_COMPOSITE_ROWS: Final[int] = 4
BODY_GLOW_ROWS: Final[int] = 4
BODY_COMPOSITE_SIZE: Final[tuple[int, int]] = (
    FRAME_W * 2 * BODY_COMPOSITE_COLS,
    FRAME_H * 2 * BODY_COMPOSITE_ROWS,
)  # 360x224

TORSO_CELL: Final[tuple[int, int]] = (0, 0)
TORSO_JUMP_CELL: Final[tuple[int, int]] = (1, 0)
FRONT_SHOULDER_CELL: Final[tuple[int, int]] = (0, 1)
BACK_SHOULDER_CELL: Final[tuple[int, int]] = (1, 1)
COMPOSITE_FRONT_ARM_COL: Final[int] = 7
COMPOSITE_BACK_ARM_COL: Final[int] = 8

#: body frame -> front arm cell.  Taken from ``PlayerDrawSet.CreateCompositeData``.
_FRONT_ARM_CELL_BY_FRAME: Final[dict[int, tuple[int, int]]] = {
    0: (2, 0),
    1: (3, 0),
    2: (4, 0),
    3: (5, 0),
    4: (6, 0),
    5: (2, 1),
    6: (3, 1),
    7: (4, 1),
    8: (4, 1),
    9: (4, 1),
    10: (4, 1),
    11: (3, 1),
    12: (3, 1),
    13: (3, 1),
    14: (5, 1),
    15: (6, 1),
    16: (6, 1),
    17: (5, 1),
    18: (3, 1),
    19: (3, 1),
}

FRONT_ARM_CELL: Final[dict[int, tuple[int, int]]] = dict(_FRONT_ARM_CELL_BY_FRAME)
BACK_ARM_CELL: Final[dict[int, tuple[int, int]]] = {
    frame: (col, row + 2) for frame, (col, row) in _FRONT_ARM_CELL_BY_FRAME.items()
}

#: For every cell, the lowest body frame that uses it.  Used to pick the art
#: that goes into a shared cell (the offsets agree between the grouped frames).
FRONT_ARM_CELL_OWNER: Final[dict[tuple[int, int], int]] = {
    cell: min(f for f, c in FRONT_ARM_CELL.items() if c == cell)
    for cell in set(FRONT_ARM_CELL.values())
}
BACK_ARM_CELL_OWNER: Final[dict[tuple[int, int], int]] = {
    cell: min(f for f, c in BACK_ARM_CELL.items() if c == cell)
    for cell in set(BACK_ARM_CELL.values())
}


# --------------------------------------------------------------------------- #
# Loading the bundled template
# --------------------------------------------------------------------------- #


def template_bytes() -> bytes:
    """Raw bytes of the bundled template PNG."""
    return resources.files(__package__).joinpath("data/ArmorTemplate_v1.png").read_bytes()


@lru_cache(maxsize=1)
def bundled_template() -> Image.Image:
    """The bundled template as an RGBA image (cached)."""
    import io

    with Image.open(io.BytesIO(template_bytes())) as image:
        return image.convert("RGBA")


#: Optional guide layer shipped next to the template.  It holds the region
#: backgrounds, the divider lines and the border — everything that is not armor
#: art.  It is composited on top of a template for *display* and for the drawing
#: base the artist gets; the generator never reads it.
OVERLAY_FILENAME = "ArmorTemplate_overlay.png"


def overlay_bytes() -> bytes | None:
    """Raw bytes of the bundled guide overlay, or ``None`` when absent."""
    try:
        return resources.files(__package__).joinpath(f"data/{OVERLAY_FILENAME}").read_bytes()
    except (FileNotFoundError, OSError):
        return None


@lru_cache(maxsize=1)
def bundled_overlay() -> Image.Image | None:
    """The bundled guide overlay as an RGBA image (cached), or ``None``."""
    import io

    raw = overlay_bytes()
    if raw is None:
        return None
    with Image.open(io.BytesIO(raw)) as image:
        return image.convert("RGBA")


def compose_overlay(
    template: Image.Image, overlay: Image.Image | None = None
) -> Image.Image:
    """Draw the guide overlay on top of ``template``.

    Pixels of the overlay are written straight over the template (the same
    "replace, do not blend" rule the generator uses), and a missing or
    differently sized overlay is ignored so this is always safe to call.
    """
    from .imaging import paste_region

    layer = bundled_overlay() if overlay is None else overlay
    if layer is None or layer.size != template.size:
        return template
    result = template.copy()
    paste_region(result, layer, (0, 0, layer.width, layer.height), (0, 0))
    return result


def load_template(path: str | os.PathLike[str] | None = None) -> Image.Image:
    """Load and validate an ArmorHelper template.

    ``path`` may be ``None`` to load the bundled template.  The image must be
    exactly 128x80, just like the original tool demanded.
    """
    if path is None:
        image = bundled_template().copy()
    else:
        try:
            with Image.open(path) as source:
                image = source.convert("RGBA")
        except FileNotFoundError:
            raise ArmorTemplateError(f"Input image not found: {path}") from None
        except OSError as error:  # not an image, truncated, ...
            raise ArmorTemplateError(f"Cannot read {path}: {error}") from None

    if image.size != TEMPLATE_SIZE:
        raise ArmorTemplateError(
            "Bad input! Use the template PNG provided with ArmorHelper as a base and "
            f"do not change its size (expected {TEMPLATE_SIZE[0]}x{TEMPLATE_SIZE[1]}, "
            f"got {image.width}x{image.height})."
        )
    return image
