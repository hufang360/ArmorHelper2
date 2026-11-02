"""Rendering full-body frames/GIFs straight from the finished armor sheets."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

from armorhelper.cli import main  # noqa: E402
from armorhelper.compose import full_armor_frames  # noqa: E402
from armorhelper.generate import (  # noqa: E402
    generate_body_composite,
    generate_head,
    generate_legs,
)
from armorhelper.layout import load_template  # noqa: E402
from armorhelper.sheets import (  # noqa: E402
    SheetSet,
    compose_frames,
    detect_id,
    detect_role,
    load_sheet,
    load_sheets,
    load_sheets_from_dir,
    normalize_sheets,
    stack_sheet,
)

import inspect_armor  # noqa: E402  (tools/inspect_armor.py)


@pytest.fixture(scope="module")
def template():
    return load_template()


@pytest.fixture(scope="module")
def sheets(template):
    return {
        "head": generate_head(template),
        "body": generate_body_composite(template),
        "legs": generate_legs(template),
    }


# --------------------------------------------------------------------------- #
# Name detection
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "name, role, ident",
    [
        ("Armor_Head_52.png", "head", 52),
        ("Armor_Legs_31.png", "legs", 31),
        ("Armor_32.png", "body", 32),
        ("Armor/Armor_1.png", "body", 1),
        ("MyArmor_Head.png", "head", None),
        ("MyArmor_Legs.png", "legs", None),
        ("MyArmor_Body.png", "body", None),
        ("Female_Body_12.png", "body", 12),
        ("Armor_Helmet.png", "head", None),
        ("Greaves_3.png", "legs", 3),
        ("Player_0_3.png", None, 3),
        ("thing.png", None, None),
    ],
)
def test_detect_role_and_id(name, role, ident):
    assert detect_role(name) == role
    assert detect_id(name) == ident


def test_explicit_role_wins(tmp_path):
    path = tmp_path / "mystery.png"
    generate_head(load_template()).save(path)
    role, image = load_sheet(path, "head")
    assert role == "head"
    assert image.size == (40, 1120)


def test_unknown_name_uses_the_dimensions(tmp_path):
    wide = tmp_path / "tall.png"
    generate_body_composite(load_template()).save(wide)
    role, _image = load_sheet(wide)
    assert role == "body"

    tall = tmp_path / "mystery.png"
    generate_legs(load_template()).save(tall)
    with pytest.raises(ValueError, match="cannot tell"):
        load_sheet(tall)


def test_load_sheets_spot_the_roles_from_any_order(tmp_path):
    paths = {}
    for role, image in (
        ("head", generate_head(load_template())),
        ("body", generate_body_composite(load_template())),
        ("legs", generate_legs(load_template())),
    ):
        paths[role] = tmp_path / f"Armor_{role.title()}_5.png"
        image.save(paths[role])

    result = load_sheets([paths["legs"], paths["body"], paths["head"]])
    assert result.roles == ("head", "body", "legs")
    assert (result.head_id, result.body_id, result.legs_id) == (5, 5, 5)
    assert result.missing == ()
    assert result.name() == "Armor_5"


def test_load_sheets_from_a_directory(tmp_path):
    generate_head(load_template()).save(tmp_path / "Armor_Head_7.png")
    generate_body_composite(load_template()).save(tmp_path / "Armor_7.png")
    generate_legs(load_template()).save(tmp_path / "Armor_Legs_7.png")
    (tmp_path / "unrelated.png").write_bytes(b"not a texture")

    result = load_sheets_from_dir(tmp_path)
    assert result.roles == ("head", "body", "legs")


def test_load_sheets_from_a_vanilla_images_tree(tmp_path):
    """A real Content/Images folder keeps the body sheet in Armor/."""
    root = tmp_path / "Content" / "Images"
    (root / "Armor").mkdir(parents=True)
    generate_head(load_template()).save(root / "Armor_Head_7.png")
    generate_body_composite(load_template()).save(root / "Armor" / "Armor_7.png")
    generate_legs(load_template()).save(root / "Armor_Legs_7.png")

    result = load_sheets_from_dir(root)
    assert result.roles == ("head", "body", "legs")
    assert result.name() == "Armor_7"


def test_duplicate_roles_keep_the_first_and_warn(tmp_path):
    head = generate_head(load_template())
    head.save(tmp_path / "Armor_Head_1.png")
    head.save(tmp_path / "Armor_Head_2.png")
    result = load_sheets(sorted(tmp_path.glob("*.png")))
    assert result.head_id == 1
    assert any("more than one head" in warning for warning in result.warnings)


# --------------------------------------------------------------------------- #
# Composition
# --------------------------------------------------------------------------- #


def test_frames_match_the_generator_where_the_arm_cells_are_shared(sheets, template):
    """Frames 0..6 own their arm cells, so the two pipelines must agree exactly.

    Later frames reuse a walk-arm cell that the generator filled with one
    specific frame's offset; sampling the sheet therefore reproduces *that*
    offset, which is what the game does too.
    """
    male = compose_frames(**sheets, female=False)
    reference = full_armor_frames(template, female=False)
    for index in range(7):
        assert male[index].tobytes() == reference[index].tobytes(), f"frame {index}"

    female = compose_frames(**sheets, female=True)
    reference_female = full_armor_frames(template, female=True)
    for index in range(7):
        assert female[index].tobytes() == reference_female[index].tobytes(), f"female frame {index}"


def test_composition_matches_the_engine_renderer(sheets):
    """Body sampling has to be identical to ``tools/inspect_armor.py``."""
    expected = inspect_armor.render_frames(sheets["body"], list(range(20)))
    produced = compose_frames(body=sheets["body"])
    for index, (a, b) in enumerate(zip(produced, expected)):
        assert a.tobytes() == b.tobytes(), f"frame {index}"


def test_missing_sheets_are_skipped(sheets):
    only_legs = compose_frames(legs=sheets["legs"])
    assert all(frame.getbbox() is not None for frame in only_legs)
    with pytest.raises(ValueError, match="no sheets"):
        compose_frames()


def test_every_frame_is_a_whole_body(sheets):
    frames = compose_frames(**sheets)
    assert len(frames) == 20
    assert {frame.size for frame in frames} == {(40, 56)}
    # the head sheet carries the head, so every frame has pixels up top
    assert all(frame.crop((0, 0, 40, 12)).getbbox() is not None for frame in frames)


def test_mixed_scale_sheets_are_upscaled(sheets):
    small = {
        role: image.resize((image.width // 2, image.height // 2), Image.NEAREST)
        for role, image in sheets.items()
    }
    assert small["body"].size == (180, 112)
    normalized = normalize_sheets(small)
    assert normalized["body"].size == (360, 224)
    assert normalized["head"].size == (40, 1120)

    reference = compose_frames(**sheets)
    produced = compose_frames(**small)
    for index, (a, b) in enumerate(zip(produced, reference)):
        assert a.tobytes() == b.tobytes(), f"frame {index}"


def test_short_last_frame_is_tolerated(sheets):
    head = sheets["head"].crop((0, 0, 40, 1118))
    frames = compose_frames(head=head, body=sheets["body"], legs=sheets["legs"])
    assert len(frames) == 20
    assert frames[19].size == (40, 56)


def test_player_variants_are_optional(tmp_path, monkeypatch):
    inputs = _write_sheets(tmp_path / "in")
    images = tmp_path / "Images"
    images.mkdir()
    # A player skin is just three textures; blank ones are enough here.
    Image.new("RGBA", (360, 224)).save(images / "Player_0_3.png")
    Image.new("RGBA", (360, 224)).save(images / "Player_0_7.png")
    Image.new("RGBA", (40, 1120)).save(images / "Player_0_10.png")
    monkeypatch.setenv("ARMORHELPER_IMAGES", str(images))

    quiet = ["--no-female", "-q"]
    output = tmp_path / "out"
    assert main(["gif", "-i", *inputs, "-o", str(output), "--no-player", *quiet]) == 0
    assert not list(output.glob("*Player*"))

    assert main(["gif", "-i", *inputs, "-o", str(output), *quiet]) == 0
    names = {path.name for path in output.iterdir()}
    assert {
        "Armor_32_FullArmorPlayer.png",
        "Armor_32_FullArmorPlayer.gif",
    } <= names


def test_gif_command_rejects_an_ambiguous_directory(tmp_path, capsys):
    _write_sheets(tmp_path / "in")
    generate_body_composite(load_template()).save(tmp_path / "in" / "Armor_33.png")
    assert main(["gif", "-i", str(tmp_path / "in"), "-o", str(tmp_path / "out")]) == 1
    error = capsys.readouterr().err
    assert "several armor sets" in error
    assert "body: Armor_32.png, Armor_33.png" in error


def test_bad_sizes_are_reported():
    with pytest.raises(ValueError, match="columns wide"):
        compose_frames(body=Image.new("RGBA", (100, 224)))
    with pytest.raises(ValueError, match="too small"):
        compose_frames(head=Image.new("RGBA", (40, 560)))


def test_stack_sheet_is_the_familiar_40x1120_layout(sheets):
    frames = compose_frames(**sheets)
    stacked = stack_sheet(frames)
    assert stacked.size == (40, 1120)
    for index in range(20):
        assert stacked.crop((0, index * 56, 40, (index + 1) * 56)).tobytes() == frames[index].tobytes()


def test_sheet_set_frames_and_name(sheets, tmp_path):
    result = SheetSet(**sheets, body_id=32)
    assert result.roles == ("head", "body", "legs")
    assert result.name() == "Armor_32"
    assert len(result.frames(female=True)) == 20
    assert SheetSet(head=sheets["head"], paths={"head": tmp_path / "Mine_Head.png"}).name() == "Mine_Head"


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def _write_sheets(directory: Path) -> list[str]:
    template = load_template()
    paths = {
        "head": directory / "Armor_Head_52.png",
        "body": directory / "Armor_32.png",
        "legs": directory / "Armor_Legs_31.png",
    }
    directory.mkdir(parents=True, exist_ok=True)
    generate_head(template).save(paths["head"])
    generate_body_composite(template).save(paths["body"])
    generate_legs(template).save(paths["legs"])
    return [str(path) for path in paths.values()]


def test_gif_command_writes_frames_and_gifs(tmp_path):
    inputs = _write_sheets(tmp_path / "in")
    output = tmp_path / "out"
    assert main(["gif", "-i", *inputs, "-o", str(output), "--no-player", "-q"]) == 0

    names = {path.name for path in output.iterdir()}
    assert names == {
        "Armor_32_FullArmor.png",
        "Armor_32_FullArmor.gif",
        "Armor_32_FullArmorFemale.png",
        "Armor_32_FullArmorFemale.gif",
    }

    with Image.open(output / "Armor_32_FullArmor.png") as image:
        assert image.size == (40, 1120)
    with Image.open(output / "Armor_32_FullArmor.gif") as image:
        assert image.size == (40, 56)
        # Pillow merges the identical frames of the two "pause" groups, so the
        # file has fewer frames than the classic 52 step sequence.
        assert image.n_frames > 20


def test_gif_command_can_skip_the_female_variant(tmp_path):
    inputs = _write_sheets(tmp_path / "in")
    output = tmp_path / "out"
    assert main(["gif", "-i", *inputs, "-o", str(output), "--no-female", "--no-player", "-q"]) == 0
    names = {path.name for path in output.iterdir()}
    assert names == {"Armor_32_FullArmor.png", "Armor_32_FullArmor.gif"}


def test_gif_command_accepts_explicit_roles(tmp_path):
    template = load_template()
    paths = {
        "head": tmp_path / "a.png",
        "body": tmp_path / "b.png",
        "legs": tmp_path / "c.png",
    }
    generate_head(template).save(paths["head"])
    generate_body_composite(template).save(paths["body"])
    generate_legs(template).save(paths["legs"])

    output = tmp_path / "out"
    args = ["gif", "-o", str(output), "--no-female", "--no-player", "-q", "--name", "Custom"]
    for role, path in paths.items():
        args += [f"--{role}", str(path)]
    assert main(args) == 0
    assert (output / "Custom_FullArmor.gif").is_file()


def test_gif_command_reads_a_directory(tmp_path, capsys):
    _write_sheets(tmp_path / "in")
    output = tmp_path / "out"
    assert main(["gif", "-i", str(tmp_path / "in"), "-o", str(output), "--no-female", "--no-player", "-q"]) == 0
    assert (output / "Armor_32_FullArmor.gif").is_file()
    assert capsys.readouterr().err == ""


def test_gif_command_reads_a_content_images_tree(tmp_path):
    root = tmp_path / "Images"
    (root / "Armor").mkdir(parents=True)
    generate_head(load_template()).save(root / "Armor_Head_32.png")
    generate_body_composite(load_template()).save(root / "Armor" / "Armor_32.png")
    generate_legs(load_template()).save(root / "Armor_Legs_32.png")

    output = tmp_path / "out"
    args = ["gif", "-i", str(root), "-o", str(output), "--no-female", "--no-player", "-q"]
    assert main(args) == 0
    assert (output / "Armor_32_FullArmor.gif").is_file()


def test_gif_command_reports_bad_input(tmp_path, capsys):
    bad = tmp_path / "Armor_Head_1.png"
    Image.new("RGBA", (10, 10)).save(bad)
    assert main(["gif", "-i", str(bad), "-o", str(tmp_path / "out"), "-q"]) == 1
    assert "too small" in capsys.readouterr().err
