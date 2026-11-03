"""The packed vanilla textures that make the web app work on a phone.

The bundle lives in ``web/data/vanilla`` and is produced by
``tools/pack_vanilla_textures.py``: a few WebP pages plus ``index.json`` instead
of 748 loose PNGs.  These tests keep it honest — the metadata in ``version.txt``
has to match the files on disk, every page has to fit in the browser cap, the
pages have to reproduce the recorded content checksum, and — when the original
extracted folder is available — the packer has to rebuild the bundle from it.

The 2048px page cap is a hard requirement, not a preference: a browser cannot
decode a bigger page, so it is asserted here, recorded in ``version.txt``
(``max_page``) and ``index.json`` (``maxPage``), and enforced by the packer and
by ``web/js/atlas.js``.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from pack_vanilla_textures import (  # noqa: E402
    MAX_PAGE,
    bundle_bytes,
    bundle_checksum,
    collect,
    read_index,
    read_version,
    reconstruct,
    sample_one_x,
)

BUNDLE = ROOT / "web" / "data" / "vanilla"

#: Point this at an extracted ``Content/Images`` to also check reproducibility.
SOURCE_ENV = "ARMORHELPER_VANILLA_SOURCE"

REQUIRED_KEYS = (
    "game",
    "version",
    "format",
    "scale",
    "page_size",
    "max_page",
    "count",
    "head",
    "legs",
    "body",
    "pages",
    "strays",
    "total_bytes",
    "checksum",
)


@pytest.fixture(scope="module")
def info() -> dict[str, str]:
    if not BUNDLE.is_dir():
        pytest.skip("no vanilla bundle is checked in")
    return read_version(BUNDLE)


@pytest.fixture(scope="module")
def index(info) -> dict:
    return read_index(BUNDLE)


@pytest.fixture(scope="module")
def pages(index):
    return {}


def test_bundle_has_a_version_file(info):
    assert info, "web/data/vanilla/version.txt is missing"
    for key in REQUIRED_KEYS:
        assert key in info, f"version.txt is missing {key}"
    assert info["game"].startswith("Terraria ")
    assert re.fullmatch(r"\d+(\.\d+)*", info["version"]), info["version"]
    assert info["format"] == "webp-atlas"
    assert int(info["scale"]) == 2
    assert int(info["count"]) > 0


def test_bundle_holds_only_the_packed_files(info):
    """No loose textures: the pages and the index are all that ships."""
    files = sorted(path.name for path in BUNDLE.iterdir() if path.is_file())
    assert "version.txt" in files and "index.json" in files
    unexpected = [name for name in files if not (name.endswith(".webp") or name in ("version.txt", "index.json"))]
    assert not unexpected, f"unexpected files in the bundle: {unexpected}"
    assert not list(BUNDLE.rglob("*.png")), "the bundle still contains loose PNGs"


def test_version_counts_match_the_index(info, index):
    assert len(index["pages"]) == int(info["pages"])
    assert len(index["sheets"]) == int(info["count"])

    by_kind = {"head": 0, "legs": 0, "body": 0}
    for key in index["sheets"]:
        if key.startswith("Armor_Head"):
            by_kind["head"] += 1
        elif key.startswith("Armor_Legs"):
            by_kind["legs"] += 1
        elif key.startswith("Armor/Armor_"):
            by_kind["body"] += 1
        else:
            pytest.fail(f"unexpected texture key in the index: {key}")

    for kind, count in by_kind.items():
        assert int(info[kind]) == count, kind
    assert sum(by_kind.values()) == int(info["count"])


def test_every_page_fits_the_2048_cap(info, index):
    """The page cap is a browser limit; it is recorded and enforced everywhere."""
    assert int(info["max_page"]) == MAX_PAGE
    assert int(index["maxPage"]) == MAX_PAGE
    assert MAX_PAGE == 2048

    for page in index["pages"]:
        assert page["w"] <= MAX_PAGE and page["h"] <= MAX_PAGE, page
        assert 0 < page["w"] and 0 < page["h"], page
    # the packer keeps pages inside page_size, which has to fit the tallest sheet
    assert int(index["pageSize"]) == int(info["page_size"])
    assert int(index["pageSize"]) <= MAX_PAGE


def test_the_javascript_reader_knows_the_same_cap():
    script = (ROOT / "web" / "js" / "atlas.js").read_text(encoding="utf-8")
    match = re.search(r"export const ATLAS_MAX_PAGE = (\d+);", script)
    assert match, "web/js/atlas.js must publish ATLAS_MAX_PAGE"
    assert int(match.group(1)) == MAX_PAGE
    assert "maxPage" in script, "the reader has to validate the index's own cap"


def test_pages_are_webp_files_of_the_recorded_size(index):
    for page in index["pages"]:
        path = BUNDLE / page["file"]
        assert path.is_file(), page["file"]
        with Image.open(path) as image:
            assert image.format == "WEBP", page["file"]
            assert image.size == (page["w"], page["h"]), page["file"]
            assert image.mode in ("RGBA", "RGB"), page["file"]


def test_every_sheet_rect_is_inside_its_page(index):
    for key, (number, x, y, width, height) in index["sheets"].items():
        page = index["pages"][number]
        assert x >= 0 and y >= 0, key
        assert width > 0 and height > 0, key
        assert x + width <= page["w"] and y + height <= page["h"], key
        # 1x sheets are half the game texture; both halves have to be whole
        assert width * index["scale"] >= 20 and height * index["scale"] >= 20, key


def test_stray_pixels_are_inside_their_texture_and_really_differ(index, pages):
    scale = index["scale"]
    for key, strays in index["strays"].items():
        _number, _x, _y, width, height = index["sheets"][key]
        texture = reconstruct(index, key, pages, BUNDLE)
        assert texture.size == (width * scale, height * scale), key
        for sx, sy, r, g, b, a in strays:
            assert 0 <= sx < texture.width and 0 <= sy < texture.height, (key, sx, sy)
            assert texture.getpixel((sx, sy)) == (r, g, b, a), (key, sx, sy)
    assert int(read_version(BUNDLE)["strays"]) == sum(len(found) for found in index["strays"].values())


def test_the_pages_reproduce_the_recorded_content_checksum(info):
    """Decoding the pages has to give back exactly what the packer hashed."""
    assert bundle_checksum(BUNDLE) == info["checksum"]


def test_total_bytes_matches(info):
    assert bundle_bytes(BUNDLE) == int(info["total_bytes"])


def test_bundled_textures_are_valid_images(index, pages):
    """Spot check the three kinds, including a 9x8 glow body sheet."""
    for key, size in (
        ("Armor_Head_1", (40, 1120)),
        ("Armor_Legs_1", (40, 1120)),
        ("Armor/Armor_1", (360, 224)),
        ("Armor_Head_189", (40, 1120)),
        ("Armor/Armor_190", (360, 448)),
    ):
        texture = reconstruct(index, key, pages, BUNDLE)
        assert texture.size == size, key
        assert texture.mode == "RGBA"


def test_bundle_covers_the_known_sets(index):
    """Most sets in the table should be reversible from the bundle alone."""
    table = json.loads((ROOT / "web" / "data" / "armor_sets.json").read_text(encoding="utf-8"))
    complete = [
        item
        for item in table["sets"]
        if item["head"] is not None and item["legs"] is not None and item["body"] is not None
    ]
    usable = [
        item
        for item in complete
        if f"Armor_Head_{item['head']}" in index["sheets"]
        and f"Armor_Legs_{item['legs']}" in index["sheets"]
        and f"Armor/Armor_{item['body']}" in index["sheets"]
    ]
    assert len(usable) >= 140, f"only {len(usable)} of {len(complete)} sets are bundled"


def test_the_packer_refuses_a_page_over_the_cap(tmp_path):
    source = tmp_path / "Images"
    source.mkdir()
    Image.new("RGBA", (40, 1120), (0, 0, 0, 0)).save(source / "Armor_Head_1.png")
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "tools" / "pack_vanilla_textures.py"),
            str(source),
            "--version",
            "test",
            "--page-size",
            str(MAX_PAGE * 2),
            "-o",
            str(tmp_path / "out"),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode != 0
    assert str(MAX_PAGE) in result.stderr


def test_one_x_sampling_is_a_nearest_neighbour_halving():
    sheet = Image.new("RGBA", (4, 4))
    for x in range(4):
        for y in range(4):
            sheet.putpixel((x, y), (x * 10, y * 10, 0, 255))
    half = sample_one_x(sheet)
    assert half.size == (2, 2)
    assert half.getpixel((0, 0)) == (0, 0, 0, 255)
    assert half.getpixel((1, 1)) == (20, 20, 0, 255)


def test_pack_script_is_reproducible(tmp_path, info):
    """Re-running the packer against the same source gives the same bundle."""
    source = os.environ.get(SOURCE_ENV)
    if not source or not Path(source).is_dir():
        pytest.skip(f"set {SOURCE_ENV} to an extracted Content/Images to check this")

    out = tmp_path / "vanilla"
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "tools" / "pack_vanilla_textures.py"),
            source,
            "--version",
            info["version"],
            "-o",
            str(out),
        ],
        capture_output=True,
        text=True,
        timeout=900,
    )
    assert result.returncode == 0, result.stderr

    fresh = read_version(out)
    for key in ("count", "head", "legs", "body", "pages", "strays", "checksum", "format", "scale", "max_page"):
        assert fresh[key] == info[key], key

    # The packed pages have to rebuild the source textures pixel for pixel, so
    # compare every sheet with the PNG the game shipped.
    index = read_index(out)
    for path, relative in collect(Path(source)):
        key = relative.rsplit(".", 1)[0]
        expected = Image.open(path).convert("RGBA")
        produced = reconstruct(index, key, {}, out)
        assert produced.size == expected.size, key
        assert produced.tobytes() == expected.tobytes(), key


def test_collect_finds_every_armor_png(tmp_path):
    """The collector must ignore everything that is not an armor texture."""
    (tmp_path / "Armor").mkdir()
    for name in ("Armor_Head_7.png", "Armor_Legs_7.png", "Armor_7.png"):
        (tmp_path / name).write_bytes(b"x")
    (tmp_path / "Armor" / "Armor_9.png").write_bytes(b"x")
    # decoys
    for name in ("Player_0_3.png", "Armor_Head_x.png", "NPC_Head_1.png"):
        (tmp_path / name).write_bytes(b"x")
    (tmp_path / "Armor" / "Armor_9_bak.png").write_bytes(b"x")

    found = collect(tmp_path)
    assert sorted(relative for _path, relative in found) == [
        "Armor/Armor_9.png",
        "Armor_Head_7.png",
        "Armor_Legs_7.png",
    ]


def test_the_web_app_reads_the_bundle_from_the_right_place():
    """The reader has to ask for the packed bundle in `data/vanilla`."""
    script = (ROOT / "web" / "app.js").read_text(encoding="utf-8")
    assert 'const BUILTIN_DIR = "data/vanilla"' in script
    assert "data/vanilla/version.txt" in script or "${BUILTIN_DIR}/version.txt" in script
    assert "${BUILTIN_DIR}/${BUILTIN_INDEX}" in script
    assert "createAtlasReader" in script
    # and it must be the last resort, after the folder and the uploads
    reader = script[script.index("function textureReader()") : script.index("function textureReader()") + 1600]
    assert reader.index("readFromFolder") < reader.index("state.textures.get")
    assert reader.index("state.textures.get") < reader.index("state.atlas")


def test_bundle_is_not_gitignored():
    result = subprocess.run(
        ["git", "check-ignore", "-q", str(BUNDLE / "index.json")],
        cwd=ROOT,
        capture_output=True,
    )
    assert result.returncode != 0, "the bundled textures must be committed"


def test_the_index_is_compact_enough_to_ship(info, index):
    """The index is fetched on every boot, so keep an eye on its size."""
    size = (BUNDLE / "index.json").stat().st_size
    assert size < 64 * 1024, f"index.json grew to {size} bytes"
    assert json.loads((BUNDLE / "index.json").read_text(encoding="utf-8"))["version"] == info["version"]
