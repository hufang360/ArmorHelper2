"""A literal transcription of ArmorHelper v1's ``GenerateSheets``.

This exists purely to test the port: it is written the way the C# original was
(a 20x560 array of colours, absolute ``Point`` offsets, ``Fill`` calls) without
reusing any of the generator's helpers.

See ``docs/armorhelper-v1.decompiled.cs`` for the decompiled source this mirrors.
"""

from __future__ import annotations

from typing import Iterable

from PIL import Image

FRAME_W = 20
FRAME_H = 28
FRAMES = 20
SHEET_H = FRAME_H * FRAMES

FRONT_ARM_OFFSETS = (0, -1, -1, -1, -1, 0, 0, 0, 1, 2, 2, 1, 0, 0)
BACK_ARM_OFFSETS = (0, 1, 1, 1, 0, 0, 0, 0, -1, -2, -2, -1, 0, 0)
BODY_HEAD_OFFSETS = (0, 0, 0, 0, 0, 0, 0, -1, -1, -1, 0, 0, 0, 0, -1, -1, -1, 0, 0, 0)
LEG_MAPPING = ((5,), (7,), (8,), (9,), (10,), (13,), (14,), (15,), (16,), (17, 18))


def _blank() -> list[list[tuple[int, int, int, int] | None]]:
    return [[None] * SHEET_H for _ in range(FRAME_W)]


def _copy(
    source: Image.Image,
    dest: list[list],
    rect: tuple[int, int, int, int],
    point: tuple[int, int],
    ignored: Iterable[tuple[int, int]] | None = None,
) -> None:
    rx, ry, rw, rh = rect
    px, py = point
    ignored_set = set(ignored or ())
    for i in range(rh):
        for j in range(rw):
            sx = rx + j
            sy = ry + i
            dx = px + j
            dy = py + i
            if not (0 <= sx < source.width and 0 <= sy < source.height):
                continue
            if not (0 <= dx < FRAME_W and 0 <= dy < SHEET_H):
                continue
            if (sx, sy) in ignored_set:
                continue
            pixel = source.getpixel((sx, sy))
            if pixel[3] > 1:
                dest[dx][dy] = pixel


def _fill(dest: list[list], rect: tuple[int, int, int, int], colour) -> None:
    rx, ry, rw, rh = rect
    for i in range(rh):
        for j in range(rw):
            x = rx + j
            y = ry + i
            if 0 <= x < FRAME_W and 0 <= y < SHEET_H:
                dest[x][y] = colour


def _front_arm(source: Image.Image, dest: list[list]) -> None:
    _copy(source, dest, (1, 1, 12, 16), (0, 9))
    _copy(source, dest, (14, 1, 12, 16), (0, 33))
    _copy(source, dest, (27, 1, 16, 16), (2, 61))
    _copy(source, dest, (44, 1, 17, 16), (2, 92))
    _copy(source, dest, (62, 1, 16, 16), (2, 121))
    _copy(source, dest, (14, 1, 12, 16), (0, 145), ((22, 9), (22, 10), (22, 11), (22, 12)))
    for k in range(14):
        num = k + 6
        _copy(
            source,
            dest,
            (79, 1, 13, 11),
            (FRONT_ARM_OFFSETS[k], num * 28 + 12 + BODY_HEAD_OFFSETS[num]),
        )


def _back_arm(source: Image.Image, dest: list[list]) -> None:
    layer = _blank()
    _copy(source, layer, (94, 1, 12, 11), (7, 14))
    _copy(source, layer, (94, 1, 12, 11), (8, 40))
    _copy(source, layer, (94, 1, 12, 11), (7, 70))
    for k in range(14):
        num = k + 6
        _copy(
            source,
            layer,
            (94, 1, 12, 11),
            (8 + BACK_ARM_OFFSETS[k], num * 28 + 12 + BODY_HEAD_OFFSETS[num]),
        )
        if BACK_ARM_OFFSETS[k] == -2:
            _copy(source, layer, (101, 8, 1, 1), (14, num * 28 + 18))
    for l in range(20):
        _fill(layer, (8, 21 + 28 * l, 6, 1), None)
    _fill(layer, (0, 0, 13, SHEET_H), None)
    for x in range(FRAME_W):
        for y in range(SHEET_H):
            if layer[x][y] is not None:
                dest[x][y] = layer[x][y]


def _head(source: Image.Image, dest: list[list]) -> None:
    for k in range(20):
        _copy(source, dest, (1, 19, 20, 28), (0, k * 28 + BODY_HEAD_OFFSETS[k]))


def _body(source: Image.Image, dest: list[list]) -> None:
    _back_arm(source, dest)
    for k in range(20):
        num = 48 if k == 5 else 19
        ignored = None if (k != 1 and k <= 5) else ((37, num + 16), (37, num + 17))
        _copy(source, dest, (23, num, 20, 28), (0, k * 28 + BODY_HEAD_OFFSETS[k]), ignored)
    _front_arm(source, dest)


def _female(source: Image.Image, dest: list[list]) -> None:
    _back_arm(source, dest)
    for k in range(20):
        _copy(
            source,
            dest,
            (44, 48 if k == 5 else 19, 20, 28),
            (0, k * 28 + BODY_HEAD_OFFSETS[k]),
        )
    _front_arm(source, dest)


def _legs(source: Image.Image, dest: list[list]) -> None:
    for k in range(7):
        num = (k if k < 5 else (11 if k == 5 else 19)) * 28
        for l in range(2):
            flag = l == (1 if k != 6 else 0)
            fx = 100 if l == 1 else 110
            _copy(
                source,
                dest,
                (fx, 19, 9, 9),
                (5 if flag else 7, 19 + num),
                ((fx + 1, 21), (fx + 7, 21)),
            )
    _copy(source, dest, (100, 19, 9, 9), (6, 187))
    _copy(source, dest, (100, 19, 9, 9), (6, 355))
    for m in range(10):
        sx = 83 if m >= 5 else 66
        rect = (sx, 19 + (m % 5) * 10, 16, 9)
        for frame in LEG_MAPPING[m]:
            _copy(source, dest, rect, (3, 19 + frame * 28))


def _to_image(dest: list[list]) -> Image.Image:
    image = Image.new("RGBA", (FRAME_W, SHEET_H), (0, 0, 0, 0))
    pixels = image.load()
    for x in range(FRAME_W):
        for y in range(SHEET_H):
            colour = dest[x][y]
            if colour is not None:
                pixels[x, y] = colour
    return image


def reference_sheets(source: Image.Image) -> dict[str, Image.Image]:
    """The five sheets ArmorHelper v1 produced, at 1x."""
    result = {}
    for name, builder in (("head", _head), ("legs", _legs), ("arms", _front_arm),
                          ("body", _body), ("female", _female)):
        dest = _blank()
        builder(source, dest)
        result[name] = _to_image(dest)
    return result
