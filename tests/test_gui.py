"""Smoke tests for the wxPython front end.

They are skipped when wxPython is not installed or no display is available.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TEMPLATE = ROOT / "armorhelper" / "data" / "ArmorTemplate_v1.png"

wx = pytest.importorskip("wx")

from armorhelper.generate import (  # noqa: E402
    generate_body_composite,
    generate_head,
    generate_legs,
)
from armorhelper.layout import compose_overlay, load_template  # noqa: E402


@pytest.fixture(scope="module")
def app():
    try:
        instance = wx.App(False)
    except Exception as error:  # pragma: no cover - headless machines
        pytest.skip(f"wx cannot start: {error}")
    yield instance


@pytest.fixture()
def frame(app, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    from armorhelper.gui import ArmorHelperFrame

    window = ArmorHelperFrame()
    yield window
    window.Destroy()


def test_window_builds_with_default_options(frame):
    from armorhelper.i18n import tr

    assert frame._selected_targets() == ("head", "legs", "body")
    assert not frame.export_button.IsEnabled()  # no input files yet
    assert frame.status.text() == tr("status.noOutput")


def test_interface_is_chinese_by_default():
    from armorhelper.i18n import get_language, set_language, tr

    previous = get_language()
    try:
        set_language("zh_CN")
        assert tr("button.export") == "导出"
        assert tr("group.inputs") == "输入文件"
        set_language("en")
        assert tr("button.export") == "Export"
        assert tr("group.inputs") == "Input Files"
        set_language("fr")  # unknown -> falls back to Chinese
        assert get_language() == "zh_CN"
    finally:
        set_language(previous)


def test_the_drawing_template_is_restored_next_to_the_config(frame, tmp_path):
    from armorhelper.gui import TEMPLATE_NAME
    from armorhelper.layout import bundled_overlay, load_template

    restored = tmp_path / TEMPLATE_NAME
    assert restored.exists()
    with Image.open(restored) as image:
        assert image.size == (128, 80)

    # it is the template with the guide overlay drawn on, not the raw file
    expected = compose_overlay(load_template(), bundled_overlay())
    assert restored.read_bytes() == _png_bytes(expected)


def _png_bytes(image) -> bytes:
    import io

    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def test_adding_an_input_enables_export(frame, tmp_path):
    frame._add_paths([TEMPLATE])
    frame.output_ctrl.SetValue(str(tmp_path))
    frame._refresh()
    assert len(frame.entries) == 1
    from armorhelper.i18n import tr

    assert frame.export_button.IsEnabled()
    assert frame.status.text() == tr("status.ready")


def test_settings_are_read_from_the_widgets(frame, tmp_path):
    frame.output_ctrl.SetValue(str(tmp_path))
    frame.glow_check.SetValue(True)
    frame.skin_spin.SetValue(3)
    frame.id_body.SetValue("190")

    settings = frame._settings()
    assert settings.output_dir == tmp_path
    assert settings.glow_rows == 4
    assert settings.skin == 3
    assert (settings.id_head, settings.id_body, settings.id_legs) == (190, 190, 190)


def test_reverse_dialog_lists_chinese_english_and_id(frame):
    from armorhelper.gui import ReverseDialog

    dialog = ReverseDialog(frame)
    try:
        dialog.search.SetValue("星尘")
        wx.Yield()
        entries = [dialog.choice.GetString(i) for i in range(dialog.choice.GetCount())]
        assert entries == ["星尘板甲  StardustPlate  (190)"]

        dialog._pick()
        assert dialog.values() == (189, 190, 130)
    finally:
        dialog.Destroy()


def test_reverse_dialog_search_accepts_english(frame):
    from armorhelper.gui import ReverseDialog

    dialog = ReverseDialog(frame)
    try:
        dialog.search.SetValue("stardust")
        wx.Yield()
        assert dialog.choice.GetCount() == 1
        assert "StardustPlate" in dialog.choice.GetString(0)
    finally:
        dialog.Destroy()


def test_reverse_uses_the_output_folder(frame, tmp_path, monkeypatch):
    """The rebuilt template goes straight into the output folder."""
    images = tmp_path / "Images"
    (images / "Armor").mkdir(parents=True)
    template = load_template(TEMPLATE)
    generate_head(template).save(images / "Armor_Head_7.png")
    generate_legs(template).save(images / "Armor_Legs_7.png")
    generate_body_composite(template).save(images / "Armor" / "Armor_7.png")

    output = tmp_path / "out"
    output.mkdir()
    frame.images_ctrl.SetValue(str(images))
    frame.output_ctrl.SetValue(str(output))
    monkeypatch.setattr(frame, "_ask_reverse_ids", lambda: (7, 7, 7))

    frame._reverse()

    produced = list(output.glob("*.png"))
    assert len(produced) == 1
    assert Image.open(produced[0]).size == (128, 80)
    # ... and it is queued up for the next export.
    assert [entry.path for entry in frame.entries] == produced


def test_reverse_asks_for_the_output_folder_when_it_is_empty(frame, tmp_path, monkeypatch):
    """An unset output folder triggers the picker, and the choice is kept."""
    images = tmp_path / "Images"
    (images / "Armor").mkdir(parents=True)
    template = load_template(TEMPLATE)
    generate_head(template).save(images / "Armor_Head_7.png")
    generate_legs(template).save(images / "Armor_Legs_7.png")
    generate_body_composite(template).save(images / "Armor" / "Armor_7.png")

    chosen = tmp_path / "picked"
    chosen.mkdir()
    frame.images_ctrl.SetValue(str(images))
    frame.output_ctrl.SetValue("")
    monkeypatch.setattr(frame, "_ask_for_output_dir", lambda: str(chosen))
    monkeypatch.setattr(frame, "_ask_reverse_ids", lambda: (7, 7, 7))

    frame._reverse()

    assert frame.output_ctrl.GetValue() == str(chosen)  # control updated
    assert list(chosen.glob("*.png"))
    assert frame.status.text().startswith("已还原模板")


def test_reverse_aborts_when_the_output_folder_picker_is_cancelled(frame, tmp_path, monkeypatch):
    images = tmp_path / "Images"
    (images / "Armor").mkdir(parents=True)
    frame.images_ctrl.SetValue(str(images))
    frame.output_ctrl.SetValue("")
    monkeypatch.setattr(frame, "_ask_for_output_dir", lambda: None)
    called = []
    monkeypatch.setattr(frame, "_ask_reverse_ids", lambda: called.append(True))

    frame._reverse()

    assert not called, "the armor picker must not open before a folder is chosen"
    assert frame.output_ctrl.GetValue() == ""


#: Copper, Necro and Wood — their head/legs ids are unique in the set table, so
#: nothing else can accidentally look reversible.
VANILLA_BODIES = (1, 7, 32)


@pytest.fixture()
def vanilla_images(tmp_path) -> Path:
    """A stand-in Content/Images folder holding three complete armor sets."""
    from armorhelper.vanilla import find_set

    template = load_template(TEMPLATE)
    root = tmp_path / "Images"
    (root / "Armor").mkdir(parents=True)
    for body in VANILLA_BODIES:
        item = find_set(body=body)
        for armor_id in {item.head, item.legs}:
            generate_head(template).save(root / f"Armor_Head_{armor_id}.png")
            generate_legs(template).save(root / f"Armor_Legs_{armor_id}.png")
        generate_body_composite(template).save(root / "Armor" / f"Armor_{body}.png")
    return root


def test_reverse_all_writes_into_the_ArmorTemplate_subfolder(frame, vanilla_images, tmp_path, monkeypatch):
    from armorhelper.gui import REVERSE_ALL_SUBDIR

    output = tmp_path / "out"
    output.mkdir()
    frame.images_ctrl.SetValue(str(vanilla_images))
    frame.output_ctrl.SetValue(str(output))
    monkeypatch.setattr(wx, "MessageBox", lambda *a, **k: wx.YES)
    monkeypatch.setattr(wx, "LaunchDefaultApplication", lambda *a, **k: True)

    frame._reverse_all()
    for _ in range(600):
        wx.Yield()
        if not frame.working:
            break
        time.sleep(0.01)

    assert not frame.working
    target = output / REVERSE_ALL_SUBDIR
    assert target.is_dir()
    produced = sorted(path.name for path in target.glob("*.png"))
    assert len(produced) == 3
    assert all(name.startswith("ArmorTemplate_") for name in produced)
    assert "已还原 3 套" in frame.status.text()


def test_reverse_all_lists_only_sets_with_textures(frame, vanilla_images):
    jobs = frame._reversible_sets(vanilla_images)
    assert sorted(item.body for item in jobs) == sorted(VANILLA_BODIES)


def test_reverse_all_reports_when_nothing_matches(frame, tmp_path):
    empty = tmp_path / "empty"
    (empty / "Armor").mkdir(parents=True)
    assert frame._reversible_sets(empty) == []


def test_reverse_all_asks_for_the_output_folder(frame, vanilla_images, tmp_path, monkeypatch):
    from armorhelper.gui import REVERSE_ALL_SUBDIR

    chosen = tmp_path / "picked"
    chosen.mkdir()
    frame.images_ctrl.SetValue(str(vanilla_images))
    frame.output_ctrl.SetValue("")
    monkeypatch.setattr(frame, "_ask_for_output_dir", lambda: str(chosen))
    monkeypatch.setattr(wx, "MessageBox", lambda *a, **k: wx.YES)
    monkeypatch.setattr(wx, "LaunchDefaultApplication", lambda *a, **k: True)

    frame._reverse_all()
    for _ in range(600):
        wx.Yield()
        if not frame.working:
            break
        time.sleep(0.01)

    assert frame.output_ctrl.GetValue() == str(chosen)
    assert len(list((chosen / REVERSE_ALL_SUBDIR).glob("*.png"))) == 3


def test_output_dir_is_reused_when_it_exists(frame, tmp_path):
    frame.output_ctrl.SetValue(str(tmp_path))
    assert frame.ensure_output_dir() == tmp_path


def test_export_writes_the_selected_sheets(frame, tmp_path):
    import time

    frame._add_paths([TEMPLATE])
    frame.output_ctrl.SetValue(str(tmp_path))
    frame._export()

    # The export runs on a worker thread and reports back through wx.CallAfter,
    # so the event queue has to be pumped.
    for _ in range(400):
        wx.Yield()
        if not frame.working:
            break
        time.sleep(0.01)

    assert not frame.working
    assert (tmp_path / f"{TEMPLATE.stem}_Body.png").exists()


def test_the_reverse_buttons_are_disabled_while_working(frame, tmp_path):
    frame.working = True
    frame._refresh()
    assert not frame.reverse_button.IsEnabled()
    assert not frame.reverse_all_button.IsEnabled()
    frame.working = False
    frame._refresh()
    assert frame.reverse_button.IsEnabled()
    assert frame.reverse_all_button.IsEnabled()


def test_config_round_trip(frame, tmp_path):
    frame.output_ctrl.SetValue(str(tmp_path))
    frame.id_body.SetValue("42")
    frame.target_box.Check(0, False)
    frame._save_config()

    from armorhelper.gui import ArmorHelperFrame

    second = ArmorHelperFrame()
    try:
        assert second.id_body.GetValue() == "42"
        assert not second.target_box.IsChecked(0)
    finally:
        second.Destroy()
