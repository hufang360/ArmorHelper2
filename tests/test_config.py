"""Tests for the persistent GUI state (``config.json``)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from armorhelper.config import DEFAULT_COLUMNS, UiState, load, save  # noqa: E402
from armorhelper.export import DEFAULT_TARGETS, TARGETS  # noqa: E402


def test_defaults_match_the_original_tool():
    state = UiState()
    assert state.targets == {name: name in DEFAULT_TARGETS for name in TARGETS}
    assert state.ids == {"id_head": "", "id_body": "", "id_legs": ""}
    assert list(state.columns) == list(DEFAULT_COLUMNS)
    assert state.inputs == []


def test_round_trip(tmp_path):
    path = tmp_path / "config.json"
    state = UiState(
        export_folder="/out",
        images_folder="/images",
        glow=True,
        skin=4,
        language="en",
        last_dir="/last",
        inputs=["/a.png", "/b.png"],
        last_export={"/a.png": 123.5},
    )
    state.targets["legacy"] = True
    state.ids["id_body"] = "190"
    state.window = {"x": 10, "y": 20, "width": 800, "height": 640, "maximized": False}
    state.columns = [300, 190]
    save(state, path)

    restored = load(path)
    assert restored.export_folder == "/out"
    assert restored.images_folder == "/images"
    assert restored.glow is True
    assert restored.skin == 4
    assert restored.language == "en"
    assert restored.last_dir == "/last"
    assert restored.inputs == ["/a.png", "/b.png"]
    assert restored.last_export == {"/a.png": 123.5}
    assert restored.targets["legacy"] is True
    assert restored.ids["id_body"] == "190"
    assert restored.window["width"] == 800
    assert restored.columns == [300, 190]


def test_reads_an_armorhelper_v1_config(tmp_path):
    """v1 wrote ``exportCheckbox`` as a plain bool[] and knew nothing else."""
    path = tmp_path / "config.json"
    path.write_text(
        json.dumps(
            {
                "exportFolder": "/old/out",
                "exportCheckbox": [True, True, True, False, True] + [False] * 8,
                "importFolder": None,
            }
        ),
        encoding="utf-8",
    )
    state = load(path)
    assert state.export_folder == "/old/out"
    # v1 order: Head, Body, Body(Female), Legs, Arms, ...
    assert state.targets["head"] is True
    assert state.targets["body"] is True
    assert state.targets["legs"] is False
    assert state.targets["legacy"] is True  # v1 "Arms"
    assert state.targets["full"] is False
    assert state.window == {}
    assert state.language == ""


def test_survives_garbage(tmp_path):
    path = tmp_path / "config.json"
    path.write_text("{not json", encoding="utf-8")
    assert load(path).targets == UiState().targets

    path.write_text(json.dumps({"exportCheckbox": "nope", "ids": 3, "columns": [1], "skin": "x"}))
    state = load(path)
    assert state.targets == UiState().targets
    assert state.columns == list(DEFAULT_COLUMNS)
    assert state.skin == 0


def test_missing_file_gives_defaults(tmp_path):
    state = load(tmp_path / "nope.json")
    assert state.export_folder == ""


@pytest.mark.parametrize("skin, expected", [(-5, 0), (99, 9), (3, 3)])
def test_skin_is_clamped(tmp_path, skin, expected):
    state = UiState.from_dict({"skin": skin})
    assert state.skin == expected


def test_save_is_atomic_enough_to_not_raise_on_a_bad_path(tmp_path):
    save(UiState(), tmp_path / "missing" / "deep" / "config.json")  # must not raise
