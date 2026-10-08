"""The bundled vanilla textures that make the web app work on a phone.

The bundle lives in ``web/data/vanilla`` and is produced by
``tools/import_vanilla_textures.py``.  These tests keep it honest: the counts in
``version.txt`` have to match the files on disk, the checksum has to match the
actual bytes, and — when the original extracted folder is available — the
script has to reproduce the bundle exactly.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from import_vanilla_textures import bundle_checksum, collect, read_version  # noqa: E402

BUNDLE = ROOT / "web" / "data" / "vanilla"

#: Point this at an extracted ``Content/Images`` to also check reproducibility.
SOURCE_ENV = "ARMORHELPER_VANILLA_SOURCE"


@pytest.fixture(scope="module")
def info() -> dict[str, str]:
    if not BUNDLE.is_dir():
        pytest.skip("no vanilla bundle is checked in")
    return read_version(BUNDLE)


def test_bundle_has_a_version_file(info):
    assert info, "web/data/vanilla/version.txt is missing"
    assert info["game"].startswith("Terraria ")
    assert re.fullmatch(r"\d+(\.\d+)*", info["version"]), info["version"]
    assert int(info["count"]) > 0


def test_version_file_counts_match_the_files(info):
    files = sorted(BUNDLE.rglob("*.png"))
    assert len(files) == int(info["count"])

    by_kind = {"head": 0, "legs": 0, "body": 0}
    for path in files:
        name = path.name
        if re.fullmatch(r"Armor_Head_\d+\.png", name):
            by_kind["head"] += 1
        elif re.fullmatch(r"Armor_Legs_\d+\.png", name):
            by_kind["legs"] += 1
        elif re.fullmatch(r"Armor_\d+\.png", name) and path.parent.name == "Armor":
            by_kind["body"] += 1
        else:
            pytest.fail(f"unexpected file in the bundle: {path.relative_to(BUNDLE)}")

    for kind, expected in by_kind.items():
        assert int(info[kind]) == expected, kind
    assert sum(by_kind.values()) == int(info["count"])


def test_body_sheets_keep_their_armor_subfolder(info):
    """`Armor_1.png` must stay in `Armor/`, matching the game's layout."""
    assert (BUNDLE / "Armor" / "Armor_1.png").is_file()
    assert not (BUNDLE / "Armor_1.png").exists()
    assert (BUNDLE / "Armor_Head_1.png").is_file()
    assert (BUNDLE / "Armor_Legs_1.png").is_file()


def test_checksum_matches_the_bytes(info):
    assert bundle_checksum(BUNDLE) == info["checksum"]


def test_total_bytes_matches(info):
    total = sum(path.stat().st_size for path in BUNDLE.rglob("*.png"))
    assert total == int(info["total_bytes"])


def test_bundled_textures_are_valid_images():
    """Spot check a few, including one of every kind."""
    for relative, size in (
        ("Armor_Head_1.png", (40, 1120)),
        ("Armor_Legs_1.png", (40, 1120)),
        ("Armor/Armor_1.png", (360, 224)),
        ("Armor_Head_189.png", (40, 1120)),
        ("Armor/Armor_190.png", (360, 448)),
    ):
        with Image.open(BUNDLE / relative) as image:
            assert image.size == size, relative
            assert image.mode in ("RGBA", "P", "RGB")


def test_bundle_covers_the_known_sets():
    """Most sets in the table should be reversible from the bundle alone."""
    from armorhelper.vanilla import all_sets

    complete = [item for item in all_sets() if item.complete]
    usable = [
        item
        for item in complete
        if (BUNDLE / f"Armor_Head_{item.head}.png").is_file()
        and (BUNDLE / f"Armor_Legs_{item.legs}.png").is_file()
        and (BUNDLE / "Armor" / f"Armor_{item.body}.png").is_file()
    ]
    assert len(usable) >= 140, f"only {len(usable)} of {len(complete)} sets are bundled"


def test_import_script_is_reproducible(tmp_path, info):
    """Re-running the importer against the same source gives the same bundle."""
    source = os.environ.get(SOURCE_ENV)
    if not source or not Path(source).is_dir():
        pytest.skip(f"set {SOURCE_ENV} to an extracted Content/Images to check this")

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "tools" / "import_vanilla_textures.py"),
            source,
            "--version",
            info["version"],
            "-o",
            str(tmp_path / "vanilla"),
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert result.returncode == 0, result.stderr

    rebuilt = tmp_path / "vanilla"
    assert bundle_checksum(rebuilt) == info["checksum"]

    fresh = read_version(rebuilt)
    for key in ("count", "head", "legs", "body", "total_bytes", "checksum"):
        assert fresh[key] == info[key], key


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
    """The reader has to ask for `data/vanilla/<the game's own path>`."""
    script = (ROOT / "web" / "app.js").read_text(encoding="utf-8")
    assert 'const BUILTIN_DIR = "data/vanilla"' in script
    assert "data/vanilla/version.txt" in script or "${BUILTIN_DIR}/version.txt" in script
    assert "${BUILTIN_DIR}/${path}" in script
    # and it must be the last resort, after the folder and the uploads
    reader = script[script.index("function textureReader()") : script.index("function textureReader()") + 1600]
    assert reader.index("readFromFolder") < reader.index("state.textures.get")
    assert reader.index("state.textures.get") < reader.index("${BUILTIN_DIR}/${path}")


def test_bundle_is_not_gitignored():
    result = subprocess.run(
        ["git", "check-ignore", "-q", str(BUNDLE / "Armor_Head_1.png")],
        cwd=ROOT,
        capture_output=True,
    )
    assert result.returncode != 0, "the bundled textures must be committed"
