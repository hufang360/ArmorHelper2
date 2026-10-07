"""Command line smoke tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from armorhelper.cli import main  # noqa: E402
from armorhelper.generate import (  # noqa: E402
    generate_body_composite,
    generate_head,
    generate_legs,
)
from armorhelper.layout import load_template  # noqa: E402

TEMPLATE = ROOT / "armorhelper" / "data" / "ArmorTemplate_v1.png"


def test_template_command(tmp_path):
    target = tmp_path / "tpl.png"
    assert main(["template", "-o", str(target)]) == 0
    assert Image.open(target).size == (128, 80)


def test_export_command_writes_the_default_sheets(tmp_path):
    assert main(["-i", str(TEMPLATE), "-o", str(tmp_path), "-q"]) == 0
    names = {path.name for path in tmp_path.iterdir()}
    assert names == {"ArmorTemplate_v1_Head.png", "ArmorTemplate_v1_Legs.png", "ArmorTemplate_v1_Body.png"}


def test_export_command_reports_bad_input(tmp_path, capsys):
    bad = tmp_path / "bad.png"
    Image.new("RGBA", (10, 10)).save(bad)
    assert main(["-i", str(bad), "-o", str(tmp_path), "-q"]) == 1
    assert "128x80" in capsys.readouterr().err


def test_targets_command(capsys):
    assert main(["targets"]) == 0
    assert "body" in capsys.readouterr().out


def test_sets_command(capsys):
    assert main(["sets", "--search", "stardust"]) == 0
    out = capsys.readouterr().out
    assert "StardustPlate" in out and "189" in out and "130" in out


@pytest.fixture()
def fake_images(tmp_path) -> Path:
    template = load_template(TEMPLATE)
    root = tmp_path / "Images"
    (root / "Armor").mkdir(parents=True)
    generate_head(template).save(root / "Armor_Head_7.png")
    generate_legs(template).save(root / "Armor_Legs_7.png")
    generate_body_composite(template).save(root / "Armor" / "Armor_7.png")
    return root


def test_reverse_command(fake_images, tmp_path, capsys):
    target = tmp_path / "out" / "Copper.png"
    assert main(["reverse", "--images", str(fake_images), "--body", "7", "-o", str(target)]) == 0
    assert Image.open(target).size == (128, 80)
    assert "ArmorTemplate" not in capsys.readouterr().err


def test_reverse_command_needs_a_body(fake_images, tmp_path):
    assert main(["reverse", "--images", str(fake_images), "-o", str(tmp_path / "x.png")]) == 1


def test_reverse_command_skips_existing_files(fake_images, tmp_path, capsys):
    target = tmp_path / "one.png"
    arguments = ["reverse", "--images", str(fake_images), "--body", "7", "-o", str(target)]
    assert main(arguments) == 0
    assert main(arguments) == 1  # refuses to overwrite without --force
    assert "exists" in capsys.readouterr().err
