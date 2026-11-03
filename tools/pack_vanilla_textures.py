#!/usr/bin/env python3
"""Pack the vanilla armor textures into WebP atlases for the web app.

Mobile browsers have no File System Access API, so a phone user cannot point the
web app at their game folder — and picking 748 files by hand is not an option
either.  The textures therefore ship with the site, but not as 748 files: they
are packed into a handful of pages plus an index, which is what
``web/js/atlas.js`` reads.

Three things make the packed bundle ~6x smaller than the PNGs it replaces, and
none of them is "cut away the empty space" (that is worth a few percent only,
because PNG/WebP already store transparent runs for free):

1. **Lossless WebP** instead of PNG — 1.68 MB → 0.33 MB on its own.
2. **1x storage.**  Every vanilla texture is an exact 2x nearest-neighbour
   upscale of a 1x pixel-art image (see ``docs/贴图裁切说明.md``), so only the
   1x image is stored and ``web/js/atlas.js`` upscales it again on load.  The
   few pixels that break the 2x2 rule (22 files, ~120 pixels) are recorded in
   ``index.json`` as exceptions, so the reconstruction is exact.
3. **Packing by slot** (head / legs / body) instead of by armor set.  Sheets of
   the same slot have the same shape and tile perfectly, and — unlike armor
   sets — every texture belongs to exactly one slot.  See "Why not by set".

Layout written to ``web/data/vanilla``::

    version.txt        metadata + the content checksum
    index.json         pages, sheet rectangles, 1x sizes, stray pixels
    head-0.webp ...    the packed pages
    legs-0.webp ...
    body-0.webp ...

Every page is at most ``MAX_PAGE`` (2048) pixels per side — a hard cap that the
packer refuses to exceed, that ``version.txt`` / ``index.json`` record, and that
``web/js/atlas.js`` re-checks when it loads a bundle.  2048 is the smallest
limit shared by every browser's canvas/decoder (iOS Safari caps the *area*
near 16.7 M pixels, so a page that is 2048 wide must stay shallow — the packer
keeps each page inside ``page_size`` x ``page_size``, default 1024, which also
keeps the decoded page small enough to hold several of them in memory).

Why not pack by armor set:
    ``web/data/armor_sets.json`` lists 204 sets, but 53 of them are incomplete
    and the sets only reference 530 of the 748 textures; the other 218 (128 head
    + 90 legs) belong to no set at all, so set-based pages would still need a
    second "orphans" atlas.  They also pack badly: a set page has to be as tall
    as a head sheet and as wide as a body sheet, and at 2x PNG that made the
    bundle *bigger* than the loose PNGs (2.07 MB vs 1.26 MB).

Usage::

    python3 tools/pack_vanilla_textures.py "/path/to/Content/Images" --version 1.4.5.7

The result is reproducible: re-running it against the same folder produces the
same pages, index and content checksum, which is what
``tests/test_vanilla_bundle.py`` checks.
"""

from __future__ import annotations

import argparse
import array
import hashlib
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "web" / "data" / "vanilla"

#: Hard cap for one packed page, in pixels per side.  Browsers refuse to decode
#: anything bigger, and the tests enforce it.
MAX_PAGE = 2048
#: Default page edge used by the packer.  Must fit the tallest sheet (560 at 1x)
#: and stay well below `MAX_PAGE` so a decoded page is only a few megabytes.
DEFAULT_PAGE_SIZE = 1024
#: The stored textures are this much smaller than the game's own sheets.
SCALE = 2

PATTERNS = (
    (re.compile(r"Armor_Head_\d+\.png$"), ""),
    (re.compile(r"Armor_Legs_\d+\.png$"), ""),
    (re.compile(r"Armor_\d+\.png$"), "Armor"),
)

INDEX_NAME = "index.json"
VERSION_NAME = "version.txt"
FORMAT = "webp-atlas"


# ------------------------------------------------------------------ import -- #


def collect(source: Path) -> list[tuple[Path, str]]:
    """Every armor PNG in ``source`` as ``(path, relative destination)``."""
    found: list[tuple[Path, str]] = []
    for pattern, sub in PATTERNS:
        folder = source / sub if sub else source
        if not folder.is_dir():
            continue
        for path in sorted(folder.iterdir()):
            if path.is_file() and pattern.fullmatch(path.name):
                found.append((path, f"{sub}/{path.name}" if sub else path.name))
    return found


def kind_of(relative: str) -> str:
    """``head`` / ``legs`` / ``body`` for a bundle-relative texture path."""
    if relative.startswith("Armor_Head"):
        return "head"
    if relative.startswith("Armor_Legs"):
        return "legs"
    return "body"


def sheet_key(relative: str) -> str:
    """The lookup key used by the index: the path without its extension."""
    return relative.rsplit(".", 1)[0]


def sample_one_x(image: Image.Image) -> Image.Image:
    """Halve a 2x texture by keeping the top-left pixel of every 2x2 block.

    Sampling the top-left (rather than the bottom-right, which is what the
    generator's ``downscale2`` uses) keeps the number of stray pixels minimal: a
    lone odd pixel only costs itself, not three of its neighbours.
    """
    width, height = image.size
    raw = image.convert("RGBA").tobytes()
    # 4 bytes per pixel, so an `I` array copies whole pixels and a `[0::2]`
    # slice picks every second one without touching the channel order.
    pixels = array.array("I")
    pixels.frombytes(raw)
    kept = array.array("I")
    for y in range(0, height, 2):
        kept.extend(pixels[y * width : (y + 1) * width][0::2])
    return Image.frombytes("RGBA", (width // SCALE, height // SCALE), kept.tobytes())


def find_strays(image: Image.Image, small: Image.Image) -> list[list[int]]:
    """Pixels of the 2x texture that a nearest upscale of ``small`` loses.

    Returns ``[[x, y, r, g, b, a], ...]`` in 2x coordinates — usually empty.
    """
    width, height = image.size
    restored = small.resize(image.size, Image.NEAREST)
    if restored.tobytes() == image.tobytes():
        return []
    original_px = image.load()
    restored_px = restored.load()
    strays: list[list[int]] = []
    for y in range(height):
        for x in range(width):
            want = original_px[x, y]
            if want != restored_px[x, y]:
                strays.append([x, y, *want])
    return strays


# -------------------------------------------------------------------- pack -- #


def pack(items: list[tuple[str, str, Image.Image]], page_size: int) -> list[list[tuple]]:
    """Shelf-pack ``(key, image)`` items into pages of ``page_size`` square.

    Items are ``(key, kind, image)``.  Returns pages of ``(key, image, x, y)``.
    Deterministic: the input order decides the layout.
    """
    pages: list[list[tuple]] = []
    page: list[tuple] = []
    x = y = row_height = 0
    for key, _kind, image in items:
        width, height = image.size
        if width > page_size or height > page_size:
            raise SystemExit(
                f"error: {key} is {width}x{height}, larger than the {page_size}px page"
            )
        if x + width > page_size:
            x = 0
            y += row_height
            row_height = 0
        if y + height > page_size:
            pages.append(page)
            page = []
            x = y = row_height = 0
        page.append((key, image, x, y))
        x += width
        row_height = max(row_height, height)
    if page:
        pages.append(page)
    return pages


def build(source: Path, out: Path, version: str, page_size: int = DEFAULT_PAGE_SIZE) -> dict:
    if not source.is_dir():
        raise SystemExit(f"error: {source} is not a folder")
    if page_size > MAX_PAGE:
        raise SystemExit(f"error: page size {page_size} exceeds the {MAX_PAGE}px browser cap")
    if page_size < 560:
        raise SystemExit(f"error: page size {page_size} cannot hold a 20x560 head sheet")

    entries = collect(source)
    if not entries:
        raise SystemExit(f"error: no armor PNGs found in {source}")

    by_kind: dict[str, list[tuple]] = {"head": [], "legs": [], "body": []}
    counts = {"head": 0, "legs": 0, "body": 0}
    strays: dict[str, list[list[int]]] = {}
    content = hashlib.sha256()

    # sorted by key, which is also the order `bundle_checksum` hashes in, so the
    # content checksum does not depend on how the pages are laid out.
    for path, relative in sorted(entries, key=lambda item: sheet_key(item[1])):
        image = Image.open(path).convert("RGBA")
        if image.width % SCALE or image.height % SCALE:
            raise SystemExit(f"error: {relative} is {image.width}x{image.height}, not a {SCALE}x texture")
        key = sheet_key(relative)
        kind = kind_of(relative)
        small = sample_one_x(image)
        found = find_strays(image, small)
        if found:
            strays[key] = found
        by_kind[kind].append((key, kind, small))
        counts[kind] += 1
        # The checksum covers the *content*, not the encoding, so it survives a
        # different WebP version and proves the pages still hold every pixel.
        content.update(f"{key} {image.width}x{image.height}\n".encode("utf-8"))
        content.update(image.tobytes())

    if out.exists():
        for path in sorted(out.iterdir()):
            if path.is_file():
                path.unlink()
            else:
                raise SystemExit(f"error: {out} contains a folder ({path.name})")
    out.mkdir(parents=True, exist_ok=True)

    pages_meta = []
    sheets: dict[str, list[int]] = {}
    for kind in ("head", "legs", "body"):
        for number, page in enumerate(pack(by_kind[kind], page_size)):
            width = max(x + image.width for _key, image, x, _y in page)
            height = max(y + image.height for _key, image, _x, y in page)
            canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            for _key, image, x, y in page:
                canvas.paste(image, (x, y))
            name = f"{kind}-{number}.webp"
            # `exact=True`: keep the RGB values under fully transparent pixels,
            # so the pixels round-trip byte for byte.
            canvas.save(out / name, "WEBP", lossless=True, quality=100, method=6, exact=True)
            pages_meta.append({"file": name, "w": width, "h": height})
            for key, image, x, y in page:
                sheets[key] = [len(pages_meta) - 1, x, y, image.width, image.height]

    index = {
        "version": version,
        "format": FORMAT,
        "scale": SCALE,
        "pageSize": page_size,
        "maxPage": MAX_PAGE,
        "pages": pages_meta,
        "sheets": dict(sorted(sheets.items())),
        "strays": dict(sorted(strays.items())),
    }
    (out / INDEX_NAME).write_text(
        json.dumps(index, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8"
    )
    for page in pages_meta:
        if page["w"] > MAX_PAGE or page["h"] > MAX_PAGE:
            raise SystemExit(f"error: {page['file']} is {page['w']}x{page['h']}, over the {MAX_PAGE}px cap")

    total = sum(
        path.stat().st_size
        for path in out.iterdir()
        if path.is_file() and path.name != VERSION_NAME
    )
    info = {
        "game": f"Terraria {version}",
        "version": version,
        "source": source.name,
        "format": FORMAT,
        "scale": str(SCALE),
        "page_size": str(page_size),
        "max_page": str(MAX_PAGE),
        "count": str(len(entries)),
        "head": str(counts["head"]),
        "legs": str(counts["legs"]),
        "body": str(counts["body"]),
        "pages": str(len(pages_meta)),
        "strays": str(sum(len(found) for found in strays.values())),
        "total_bytes": str(total),
        "checksum": content.hexdigest()[:16],
    }
    (out / VERSION_NAME).write_text(
        "# ArmorHelper bundled vanilla armor textures\n"
        "# packed from an extracted Content/Images folder by tools/pack_vanilla_textures.py\n"
        "# total_bytes counts the pages and index.json, not this file\n"
        + "".join(f"{key}={value}\n" for key, value in info.items()),
        encoding="utf-8",
    )
    return info


# ------------------------------------------------------------------ verify -- #


def read_version(out: Path = DEFAULT_OUT) -> dict[str, str]:
    """Parse ``version.txt`` (used by the tests)."""
    path = Path(out) / VERSION_NAME
    if not path.is_file():
        return {}
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result


def read_index(out: Path = DEFAULT_OUT) -> dict:
    """Parse ``index.json``."""
    return json.loads((Path(out) / INDEX_NAME).read_text(encoding="utf-8"))


def reconstruct(index: dict, key: str, pages: dict[int, Image.Image], base: Path = DEFAULT_OUT) -> Image.Image:
    """Rebuild one 2x texture from its page (the Python twin of ``atlas.js``)."""
    page_number, x, y, width, height = index["sheets"][key]
    page = pages.get(page_number)
    if page is None:
        page = pages[page_number] = Image.open(
            Path(base) / index["pages"][page_number]["file"]
        ).convert("RGBA")
    cell = page.crop((x, y, x + width, y + height))
    texture = cell.resize((width * index["scale"], height * index["scale"]), Image.NEAREST)
    strays = index.get("strays", {}).get(key) or []
    if strays:
        pixels = texture.load()
        for sx, sy, r, g, b, a in strays:
            pixels[sx, sy] = (r, g, b, a)
    return texture


def bundle_checksum(out: Path = DEFAULT_OUT) -> str:
    """The content checksum of a packed bundle (used by the tests).

    Rebuilds every texture from the pages and hashes it in game order, so the
    result is independent of the image codec and can be compared against the
    checksum the packer wrote from the source PNGs.
    """
    out = Path(out)
    index = read_index(out)
    pages: dict[int, Image.Image] = {}
    digest = hashlib.sha256()
    for key in sorted(index["sheets"]):
        texture = reconstruct(index, key, pages, out)
        digest.update(f"{key} {texture.width}x{texture.height}\n".encode("utf-8"))
        digest.update(texture.tobytes())
    return digest.hexdigest()[:16]


def bundle_bytes(out: Path = DEFAULT_OUT) -> int:
    """Bytes the app actually downloads: the pages plus ``index.json``.

    ``version.txt`` is left out — it is written after the total is known, and it
    is metadata rather than payload.
    """
    return sum(
        path.stat().st_size
        for path in Path(out).iterdir()
        if path.is_file() and path.name != VERSION_NAME
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="an extracted Terraria Content/Images folder")
    parser.add_argument(
        "--version", default="unknown", help="game version to record, e.g. 1.4.5.7"
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=DEFAULT_PAGE_SIZE,
        help=f"page edge in pixels (default {DEFAULT_PAGE_SIZE}, at most {MAX_PAGE})",
    )
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    info = build(args.source, args.output, args.version, args.page_size)
    checksum = bundle_checksum(args.output)
    if checksum != info["checksum"]:
        raise SystemExit(
            f"error: the packed bundle does not reproduce the source ({checksum} != {info['checksum']})"
        )
    print(f"wrote {args.output}")
    for key, value in info.items():
        print(f"  {key}={value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
