"""Tests for the ArmorHelper Python port."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))

from armorhelper import layout as L  # noqa: E402
from armorhelper.export import ExportSettings, export_template  # noqa: E402
from armorhelper.generate import (  # noqa: E402
    generate_arms,
    generate_body_composite,
    generate_body_legacy,
    generate_head,
    generate_legs,
    new_body_frames,
)
from armorhelper.layout import (  # noqa: E402
    ArmorTemplateError,
    bundled_overlay,
    compose_overlay,
    load_template,
)
from reference import reference_sheets  # noqa: E402


@pytest.fixture(scope="module")
def template() -> Image.Image:
    return load_template()


@pytest.fixture(scope="module")
def reference(template) -> dict[str, Image.Image]:
    return reference_sheets(template)


# --------------------------------------------------------------------------- #
# The legacy sheets must stay a byte for byte port of ArmorHelper v1
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "name, builder",
    [
        ("head", generate_head),
        ("legs", generate_legs),
        ("arms", generate_arms),
    ],
)
def test_legacy_sheets_match_reference(template, reference, name, builder):
    mine = builder(template, upscale_to=1)
    assert list(mine.getdata()) == list(reference[name].getdata())


@pytest.mark.parametrize("female", [False, True])
def test_legacy_body_matches_reference(template, reference, female):
    mine = generate_body_legacy(template, female=female, upscale_to=1)
    expected = reference["female" if female else "body"]
    assert list(mine.getdata()) == list(expected.getdata())


# --------------------------------------------------------------------------- #
# Sizes
# --------------------------------------------------------------------------- #


def test_sheet_sizes(template):
    assert generate_head(template).size == (40, 1120)
    assert generate_legs(template).size == (40, 1120)
    assert generate_arms(template).size == (40, 1120)
    assert generate_body_legacy(template).size == (40, 1120)
    assert generate_body_composite(template).size == (360, 224)
    assert generate_body_composite(template, glow_rows=4).size == (360, 448)
    # ArmorHelper v1 worked at 1x and doubled at the very end.
    assert generate_head(template, upscale_to=1).size == (20, 560)


# --------------------------------------------------------------------------- #
# The composite body layout
# --------------------------------------------------------------------------- #


def _occupied_cells(image: Image.Image) -> set[tuple[int, int]]:
    cells = set()
    for row in range(image.height // L.FRAME_H):
        for col in range(image.width // L.FRAME_W):
            box = (col * L.FRAME_W, row * L.FRAME_H, (col + 1) * L.FRAME_W, (row + 1) * L.FRAME_H)
            if image.crop(box).getbbox() is not None:
                cells.add((col, row))
    return cells


def test_every_expected_composite_cell_is_filled(template):
    body = generate_body_composite(template, upscale_to=1)
    occupied = _occupied_cells(body)

    expected = set(L.FRONT_ARM_CELL.values()) | set(L.BACK_ARM_CELL.values())
    # The original leaves the back arm empty on body frames 3, 4 and 5.
    expected -= {L.BACK_ARM_CELL[3], L.BACK_ARM_CELL[4], L.BACK_ARM_CELL[5]}
    expected |= {
        L.TORSO_CELL,
        L.TORSO_JUMP_CELL,
        (0, 2),
        (1, 2),
        (L.COMPOSITE_FRONT_ARM_COL, 0),
        (L.COMPOSITE_BACK_ARM_COL, 0),
    }

    missing = expected - occupied
    assert not missing, f"composite cells without art: {sorted(missing)}"


def test_composite_arms_can_be_left_empty(template):
    body = generate_body_composite(template, fill_composite_arms=False, upscale_to=1)
    occupied = _occupied_cells(body)
    assert (L.COMPOSITE_FRONT_ARM_COL, 0) not in occupied
    assert (L.COMPOSITE_BACK_ARM_COL, 0) not in occupied


def test_composite_shoulders_are_left_empty(template):
    """We keep the shoulders in the torso, so those cells stay blank."""
    body = generate_body_composite(template, upscale_to=1)
    occupied = _occupied_cells(body)
    for cell in (
        L.FRONT_SHOULDER_CELL,
        L.BACK_SHOULDER_CELL,
        (0, 3),
        (1, 3),
    ):
        assert cell not in occupied


def _render_like_the_game(image: Image.Image, frame: int, frame_w: int, frame_h: int) -> Image.Image:
    """Compose one body frame exactly like ``PlayerDrawSet.CreateCompositeData``.

    The body bob is added the way the original tool baked it into its sheets, so
    the result lines up with ``new_body_frames``.
    """
    from armorhelper.imaging import new_canvas, paste_region

    canvas = new_canvas(frame_w, frame_h)
    bob = L.BODY_HEAD_OFFSETS[frame]

    def cell(cell_xy):
        paste_region(
            canvas,
            image,
            (cell_xy[0] * frame_w, cell_xy[1] * frame_h, frame_w, frame_h),
            (0, bob),
        )

    cell(L.BACK_ARM_CELL[frame])
    cell(L.TORSO_JUMP_CELL if frame == 5 else L.TORSO_CELL)
    cell(L.FRONT_ARM_CELL[frame])
    return canvas


def test_front_arm_cells_hold_five_different_poses(template):
    """Body frames 0..4 must each end up with their own arm sprite."""
    body = generate_body_composite(template, upscale_to=1)
    poses = [
        body.crop((col * L.FRAME_W, 0, (col + 1) * L.FRAME_W, L.FRAME_H)).tobytes()
        for col in range(2, 7)
    ]
    assert len(set(poses)) == 5


def test_game_composition_reproduces_the_intended_frames(template):
    """Sampling the generated texture like the engine does must be a no-op.

    The comparison is done at 1x.  Two known differences are expected in the
    new grid:

    * body frame 10 wants its back arm one pixel further left than frames 7..9,
      which share the same cell -- the grouped layout simply cannot express it;
    * frames 15 and 16 carry the one pixel ArmorHelper v1 pasted at an absolute
      offset, which in the legacy sheet did not follow the body bob.
    """
    body = generate_body_composite(template, upscale_to=1)
    intended = new_body_frames(template, upscale_to=1)
    known_differences = {10, 15, 16}

    for frame in range(L.FRAME_COUNT):
        rendered = _render_like_the_game(body, frame, L.FRAME_W, L.FRAME_H)
        want = intended[frame]
        if frame in known_differences:
            continue
        assert list(rendered.getdata()) == list(want.getdata()), f"body frame {frame} differs"


def test_glow_rows_are_a_copy_of_the_first_four(template):
    plain = generate_body_composite(template, upscale_to=1)
    glow = generate_body_composite(template, glow_rows=4, upscale_to=1)
    assert glow.crop((0, 0, 180, 112)).tobytes() == plain.tobytes()
    assert glow.crop((0, 112, 180, 224)).tobytes() == plain.tobytes()


def test_bad_glow_rows_rejected(template):
    with pytest.raises(ValueError):
        generate_body_composite(template, glow_rows=3)


# --------------------------------------------------------------------------- #
# The guide overlay
# --------------------------------------------------------------------------- #


def test_overlay_is_bundled_and_matches_the_template(template):
    overlay = bundled_overlay()
    assert overlay is not None, "ArmorTemplate_overlay.png should ship with the package"
    assert overlay.size == template.size

    # the bundled template already carries the guide, so the overlay is a subset
    for before, after in zip(template.getdata(), overlay.getdata()):
        if after[3] > 1:
            assert before == after
    assert overlay.getbbox() is not None


def test_compose_overlay_is_idempotent_and_keeps_the_art(template):
    overlay = bundled_overlay()
    composed = compose_overlay(template, overlay)
    assert composed.size == template.size
    # nothing the artist drew is lost
    for before, after in zip(template.getdata(), composed.getdata()):
        if before[3] > 1:
            assert after == before
    assert compose_overlay(composed, overlay).tobytes() == composed.tobytes()


def test_compose_overlay_tolerates_a_missing_or_wrong_sized_layer(template):
    assert compose_overlay(template, None).tobytes() == template.tobytes()
    wrong = Image.new("RGBA", (10, 10), (255, 0, 0, 255))
    assert compose_overlay(template, wrong).tobytes() == template.tobytes()


def test_overlay_never_reaches_the_generated_sheets(template):
    """The generator only reads the template; the guide is display only."""
    composed = compose_overlay(template, bundled_overlay())
    for builder in (generate_head, generate_legs, generate_arms, generate_body_legacy):
        assert builder(composed).tobytes() == builder(template).tobytes()
    assert (
        generate_body_composite(composed).tobytes()
        == generate_body_composite(template).tobytes()
    )


# --------------------------------------------------------------------------- #
# Template validation
# --------------------------------------------------------------------------- #


def test_template_size_is_checked(tmp_path):
    path = tmp_path / "wrong.png"
    Image.new("RGBA", (64, 64), (0, 0, 0, 0)).save(path)
    with pytest.raises(ArmorTemplateError):
        load_template(path)


def test_missing_template_reports_error(tmp_path):
    with pytest.raises(ArmorTemplateError):
        load_template(tmp_path / "nope.png")


def test_round_trip_of_the_bundled_template(tmp_path):
    path = tmp_path / "template.png"
    path.write_bytes(L.template_bytes())
    assert load_template(path).size == (128, 80)


# --------------------------------------------------------------------------- #
# Exporting
# --------------------------------------------------------------------------- #


def test_export_uses_vanilla_names(tmp_path, template):
    settings = ExportSettings(
        output_dir=tmp_path,
        targets=("head", "legs", "body"),
        id_head=189,
        id_body=190,
        id_legs=130,
    )
    written = export_template(template, "Stardust", settings)
    names = {path.relative_to(tmp_path).as_posix() for path in written}
    assert names == {"Armor_Head_189.png", "Armor_Legs_130.png", "Armor/Armor_190.png"}
    assert Image.open(tmp_path / "Armor/Armor_190.png").size == (360, 224)


def test_export_uses_friendly_names(tmp_path, template):
    settings = ExportSettings(output_dir=tmp_path, targets=("head", "body"))
    written = export_template(template, "MyArmor", settings)
    names = {path.name for path in written}
    assert names == {"MyArmor_Head.png", "MyArmor_Body.png"}
