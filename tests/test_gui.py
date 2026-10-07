"""Smoke tests for the wxPython front end.

They are skipped when wxPython is not installed or no display is available.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TEMPLATE = ROOT / "armorhelper" / "data" / "ArmorTemplate_v1.png"

wx = pytest.importorskip("wx")


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

    assert (tmp_path / TEMPLATE_NAME).exists()
    assert (tmp_path / TEMPLATE_NAME).read_bytes() == (
        ROOT / "armorhelper" / "data" / "ArmorTemplate_v1.png"
    ).read_bytes()


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
