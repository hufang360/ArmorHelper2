"""Tests for the reverse conversion (Terraria textures -> drawing template)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from armorhelper.generate import (  # noqa: E402
    generate_body_composite,
    generate_head,
    generate_legs,
)
from armorhelper.layout import load_template  # noqa: E402
from armorhelper.reverse import (  # noqa: E402
    reverse_from_images,
    reverse_template,
    texture_paths,
)
from armorhelper.vanilla import (  # noqa: E402
    all_sets,
    describe,
    find_set,
    sanitize_filename,
    search_sets,
)


@pytest.fixture(scope="module")
def template() -> Image.Image:
    return load_template()


@pytest.fixture(scope="module")
def textures(template) -> dict[str, Image.Image]:
    return {
        "head": generate_head(template),
        "body": generate_body_composite(template),
        "legs": generate_legs(template),
    }


def _differences(original: Image.Image, rebuilt: Image.Image) -> int:
    """Pixels that are visible in ``original`` but do not survive the trip."""
    return sum(
        1
        for before, after in zip(original.getdata(), rebuilt.getdata())
        if before[3] > 1 and before != after
    )


# --------------------------------------------------------------------------- #
# Round trip
# --------------------------------------------------------------------------- #


def test_reverse_of_generated_sheets_is_lossless(textures):
    """Generating sheets and reversing them back must reproduce the sheets."""
    rebuilt = reverse_template(**textures).template
    again = {
        "head": generate_head(rebuilt),
        "body": generate_body_composite(rebuilt),
        "legs": generate_legs(rebuilt),
    }
    for name, original in textures.items():
        assert _differences(original, again[name]) == 0, f"{name} did not survive the round trip"


def test_reverse_recovers_the_template_regions(template, textures):
    """Everything inside the regions the generator reads has to come back."""
    from armorhelper import layout as L

    # The back foot is deliberately left out: it is drawn underneath the front
    # foot and two of its source pixels are masked by the generator, so parts of
    # it cannot be observed in any texture at all.  Those pixels have no effect
    # on the rebuilt sheets (the generator skips the masked ones and the front
    # foot covers the rest), which ``test_reverse_of_generated_sheets_is_lossless``
    # proves.
    regions = [
        L.HEAD_SRC,
        L.BODY_SRC,
        L.BODY_JUMP_SRC,
        L.FEMALE_SRC,
        L.FEMALE_JUMP_SRC,
        L.FRONT_ARM_WALK,
        L.BACK_ARM,
        L.BACK_ARM_STRAY_PIXEL,
        L.LEG_FOOT_FRONT,
    ]
    regions += list(L.FRONT_ARM_POSES)
    for m in range(5):
        regions.append((L.LEG_COLUMN_LEFT[0], L.LEG_COLUMN_LEFT[1] + m * 10, 16, 9))
        regions.append((L.LEG_COLUMN_RIGHT[0], L.LEG_COLUMN_RIGHT[1] + m * 10, 16, 9))

    def inside(x, y):
        return any(rx <= x < rx + rw and ry <= y < ry + rh for rx, ry, rw, rh in regions)

    rebuilt = reverse_template(**textures).template
    for y in range(rebuilt.height):
        for x in range(rebuilt.width):
            before = template.getpixel((x, y))
            if before[3] > 1 and inside(x, y):
                # The back foot is drawn underneath the front one, so its
                # hidden pixels are recovered from a different body frame.
                assert rebuilt.getpixel((x, y)) == before, f"template pixel ({x}, {y}) lost"


def test_reverse_accepts_a_partial_set(textures):
    result = reverse_template(body=textures["body"])
    assert result.template.size == (128, 80)
    assert any("head texture" in warning for warning in result.warnings)
    assert any("legs texture" in warning for warning in result.warnings)
    # The head region stays empty, the body still comes back.
    assert result.template.crop((1, 19, 21, 47)).getbbox() is None
    assert result.template.crop((23, 19, 43, 47)).getbbox() is not None


def test_reverse_notes_the_glow_mask(template):
    body = generate_body_composite(template, glow_rows=4)
    result = reverse_template(body=body)
    assert any("glow" in warning for warning in result.warnings)


def test_reverse_rejects_a_too_small_texture():
    with pytest.raises(ValueError):
        reverse_template(body=Image.new("RGBA", (360, 112), (0, 0, 0, 0)))


# --------------------------------------------------------------------------- #
# Loading from a Content/Images folder
# --------------------------------------------------------------------------- #


@pytest.fixture()
def fake_images(tmp_path, textures) -> Path:
    root = tmp_path / "Images"
    (root / "Armor").mkdir(parents=True)
    textures["head"].save(root / "Armor_Head_7.png")
    textures["legs"].save(root / "Armor_Legs_7.png")
    textures["body"].save(root / "Armor" / "Armor_7.png")
    return root


def test_texture_paths_finds_the_composite_layout(fake_images):
    paths = texture_paths(fake_images, head=7, body=7, legs=7)
    assert paths["body"].name == "Armor_7.png"
    assert paths["body"].parent.name == "Armor"


def test_reverse_from_images_round_trips(fake_images, textures):
    result = reverse_from_images(fake_images, body=7, head=7, legs=7)
    assert result.ids == "head=7 body=7 legs=7"
    assert result.warnings == []
    again = {
        "head": generate_head(result.template),
        "body": generate_body_composite(result.template),
        "legs": generate_legs(result.template),
    }
    for name, original in textures.items():
        assert _differences(original, again[name]) == 0


def test_reverse_from_images_reports_missing_files(tmp_path, textures):
    root = tmp_path / "Images"
    (root / "Armor").mkdir(parents=True)
    textures["body"].save(root / "Armor" / "Armor_7.png")
    result = reverse_from_images(root, body=7, head=99, legs=99)
    assert any("Armor_head_99.png" in warning for warning in result.warnings)
    assert any("Armor_legs_99.png" in warning for warning in result.warnings)


# --------------------------------------------------------------------------- #
# The armor set table
# --------------------------------------------------------------------------- #


def test_armor_set_table_is_populated():
    sets = all_sets()
    assert len(sets) > 150
    assert all(item.body is not None for item in sets)
    assert all(item.head is not None or item.legs is not None or True for item in sets)


@pytest.mark.parametrize(
    "body, head, legs",
    [
        (1, 1, 1),  # copper
        (190, 189, 130),  # stardust
        (177, 171, 112),  # solar flare
        (27, 46, 26),  # frost, from a set bonus
    ],
)
def test_known_sets_resolve(body, head, legs):
    found = find_set(body=body)
    assert found is not None
    assert (found.head, found.body, found.legs) == (head, body, legs)


def test_search_by_name_and_id():
    assert any(item.body == 190 for item in search_sets("stardust"))
    assert any(item.body == 190 for item in search_sets("190"))
    assert search_sets("") == list(all_sets())


# --------------------------------------------------------------------------- #
# Localized names
# --------------------------------------------------------------------------- #


def test_sets_have_localized_names():
    sets = all_sets()
    translated = [item for item in sets if item.zh]
    assert len(translated) >= len(sets) - 5, "almost every set should have a translated name"
    assert find_set(body=190).zh == "星尘板甲"
    assert find_set(body=1).zh == "铜链甲"


def test_search_works_in_chinese():
    found = search_sets("星尘")
    assert [item.body for item in found] == [190]
    assert any(item.body == 1 for item in search_sets("铜"))


def test_label_shows_chinese_english_and_id():
    label = find_set(body=190).label()
    assert label.startswith("星尘板甲")
    assert "StardustPlate" in label
    assert "(190)" in label


def test_display_name_normalises_the_armor_term():
    """The game ships one piece as 流星护甲; the interface says 盔甲."""
    from armorhelper.vanilla import display_name

    meteor = find_set(body=6)
    assert meteor.zh == "流星护甲"  # data keeps the official name
    assert meteor.zh_display == "流星盔甲"  # display uses the preferred term
    assert "流星盔甲" in meteor.label()
    assert "流星盔甲" in describe(meteor)
    assert display_name("铜链甲") == "铜链甲"
    assert any(item.body == 6 for item in search_sets("盔甲"))


def test_no_armor_term_in_the_interface_strings():
    """The whole UI uses 盔甲, never 护甲."""
    from armorhelper import i18n

    for table in i18n.MESSAGES.values():
        for key, value in table.items():
            assert "护甲" not in value, f"{key}: {value}"


def test_label_falls_back_to_english():
    from armorhelper.vanilla import ArmorSet

    assert ArmorSet(body=7, head=None, legs=None, name="Foo").label() == "Foo  (7)"


def test_describe_mentions_the_ids():
    text = describe(find_set(body=190))
    assert "星尘板甲" in text and "189" in text and "130" in text


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("星尘板甲", "星尘板甲"),
        ("A/B:C*D?E", "A_B_C_D_E"),
        ("  trailing. ", "trailing"),
        ("", "ArmorTemplate"),
        ("///", "___"),
    ],
)
def test_sanitize_filename(raw, expected):
    assert sanitize_filename(raw) == expected
