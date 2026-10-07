"""Small pixel helpers used by the sheet generator.

Everything here works on ``PIL.Image`` objects in ``RGBA`` mode.  The generator
works at 1x (one pixel of art == one pixel of the template) and only upscales
at the very end, exactly like the original C# tool did with its ``Color[,]``
arrays.

The original code had three primitives:

``Copy``   - blit a source rectangle, skipping pixels whose alpha is <= 1
``Fill``   - overwrite a rectangle with a solid colour (alpha included)
``Upscaled`` - duplicate every pixel into a 2x2 block (nearest neighbour 2x)

They are reproduced here so that the legacy output stays pixel identical.
"""

from __future__ import annotations

from typing import Iterable, Sequence

from PIL import Image

__all__ = [
    "new_canvas",
    "alpha_mask",
    "paste_region",
    "fill_rect",
    "upscale",
    "crop_frame",
    "overlay_frame",
    "multiply_color",
]

Point = tuple[int, int]
Rect = tuple[int, int, int, int]


def new_canvas(width: int, height: int) -> Image.Image:
    """A fully transparent RGBA image."""
    return Image.new("RGBA", (width, height), (0, 0, 0, 0))


def alpha_mask(image: Image.Image, threshold: int = 1) -> Image.Image:
    """Return an ``L`` mask that is 255 where alpha > ``threshold``."""
    return image.getchannel("A").point(lambda value: 255 if value > threshold else 0)


def multiply_color(image: Image.Image, factor: Sequence[float]) -> Image.Image:
    """Multiply RGB by ``factor`` (0..1 per channel), keeping alpha."""
    red, green, blue, alpha = image.split()
    red = red.point(lambda value: int(value * factor[0]) & 0xFF)
    green = green.point(lambda value: int(value * factor[1]) & 0xFF)
    blue = blue.point(lambda value: int(value * factor[2]) & 0xFF)
    return Image.merge("RGBA", (red, green, blue, alpha))


def paste_region(
    dest: Image.Image,
    source: Image.Image,
    rect: Rect,
    xy: Point,
    *,
    ignore: Iterable[Point] = (),
    tint: Sequence[float] | None = None,
    threshold: int = 1,
) -> None:
    """Blit ``rect`` of ``source`` onto ``dest`` at ``xy``.

    Pixels with ``alpha <= threshold`` are skipped (they never erase anything
    already on the destination), which mirrors the original ``Copy`` helper.

    ``ignore`` is a set of points in *source image* coordinates that should be
    skipped, also mirroring the original behaviour.

    ``tint`` multiplies the RGB channels of the pasted pixels (used to draw the
    skin layer of the "full armor + player" previews).
    """
    x, y, width, height = rect
    if width <= 0 or height <= 0:
        return

    region = source.crop((x, y, x + width, y + height))
    if region.mode != "RGBA":
        region = region.convert("RGBA")

    if tint is not None:
        region = multiply_color(region, tint)

    mask = alpha_mask(region, threshold)

    ignored = [point for point in ignore if x <= point[0] < x + width and y <= point[1] < y + height]
    if ignored:
        mask = mask.copy()
        pixels = mask.load()
        for point in ignored:
            pixels[point[0] - x, point[1] - y] = 0

    if mask.getbbox() is None:
        return

    dest.paste(region, xy, mask)


def fill_rect(dest: Image.Image, rect: Rect, color: tuple[int, int, int, int]) -> None:
    """Overwrite ``rect`` with ``color`` (alpha included)."""
    x, y, width, height = rect
    if width <= 0 or height <= 0:
        return
    dest.paste(Image.new("RGBA", (width, height), color), (x, y))


def upscale(image: Image.Image, factor: int = 2) -> Image.Image:
    """Nearest neighbour upscale (the original duplicated every pixel)."""
    if factor == 1:
        return image
    return image.resize((image.width * factor, image.height * factor), Image.NEAREST)


def crop_frame(sheet: Image.Image, frame: int, width: int, height: int) -> Image.Image:
    """Extract frame ``frame`` of a vertically stacked sheet."""
    return sheet.crop((0, frame * height, width, (frame + 1) * height))


def overlay_frame(base: Image.Image, layer: Image.Image, xy: Point = (0, 0)) -> None:
    """Draw ``layer`` over ``base`` in place (transparent pixels are skipped)."""
    paste_region(base, layer, (0, 0, layer.width, layer.height), xy)
