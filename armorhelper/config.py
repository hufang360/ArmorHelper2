"""The GUI's persistent state (``config.json``).

The file is written next to the working directory, exactly like ArmorHelper v1
did.  The original keys (``exportFolder``, ``exportCheckbox``) are still read so
an old ``config.json`` keeps working, and everything the window needs to look
the same on the next start is added on top:

``inputs``       the input file list, so the window reopens where you left it
``lastExport``   per file timestamp, so "Last export was ..." survives a restart
``window``       size, position and maximised flag
``columns``      the input list column widths
``lastDir``      the folder the file dialogs start in
``language``     the interface language chosen in the UI
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

__all__ = ["CONFIG_NAME", "UiState", "load", "save"]

log = logging.getLogger("armorhelper")

CONFIG_NAME = "config.json"

#: Column widths used when ``columns`` is missing.
DEFAULT_COLUMNS = (250, 210)

#: A sane window size when nothing has been stored yet.
DEFAULT_WINDOW = (780, 600)

#: ArmorHelper v1 wrote ``exportCheckbox`` as a plain ``bool[]`` in this order
#: (Head, Body, Body (Female), Legs, Arms, Full Armor, ...), so it is mapped
#: onto the current target names instead of being read positionally.
V1_CHECKBOX_ORDER = (
    "head",
    "body",
    "body",  # Body (Female) — our body sheet covers both
    "legs",
    "legacy",  # Arms
    "full",
    "full-female",
    "full-player",
    "full-player-female",
    "gif-full",
    "gif-full-female",
    "gif-full-player",
    "gif-full-player-female",
)


def _default_targets() -> dict[str, bool]:
    from .export import DEFAULT_TARGETS, TARGETS

    return {name: name in DEFAULT_TARGETS for name in TARGETS}


@dataclass
class UiState:
    export_folder: str = ""
    images_folder: str = ""
    glow: bool = False
    skin: int = 0
    language: str = ""
    targets: dict[str, bool] = field(default_factory=_default_targets)
    ids: dict[str, str] = field(
        default_factory=lambda: {"id_head": "", "id_body": "", "id_legs": ""}
    )
    inputs: list[str] = field(default_factory=list)
    last_export: dict[str, float] = field(default_factory=dict)
    last_dir: str = ""
    window: dict = field(default_factory=dict)
    columns: list[int] = field(default_factory=lambda: list(DEFAULT_COLUMNS))

    # ------------------------------------------------------------------ io --
    def to_dict(self) -> dict:
        return {
            "exportFolder": self.export_folder,
            "imagesFolder": self.images_folder,
            "glow": self.glow,
            "skin": self.skin,
            "language": self.language,
            "exportCheckbox": dict(self.targets),
            "ids": dict(self.ids),
            "inputs": list(self.inputs),
            "lastExport": {key: round(value, 3) for key, value in self.last_export.items()},
            "lastDir": self.last_dir,
            "window": dict(self.window),
            "columns": list(self.columns),
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "UiState":  # noqa: C901 - tolerant reader
        state = cls()
        if not isinstance(raw, dict):
            return state

        state.export_folder = str(raw.get("exportFolder") or "")
        state.images_folder = str(raw.get("imagesFolder") or "")
        state.glow = bool(raw.get("glow", False))
        try:
            state.skin = max(0, min(9, int(raw.get("skin", 0))))
        except (TypeError, ValueError):
            state.skin = 0
        state.language = str(raw.get("language") or "")
        state.last_dir = str(raw.get("lastDir") or "")

        state.targets = _default_targets()
        stored = raw.get("exportCheckbox")
        if isinstance(stored, dict):
            for name, value in stored.items():
                if name in state.targets:
                    state.targets[name] = bool(value)
        elif stored:
            # A v1 list replaces the defaults instead of adding to them.
            state.targets = dict.fromkeys(state.targets, False)
            for name, value in zip(V1_CHECKBOX_ORDER, stored):
                state.targets[name] = state.targets.get(name, False) or bool(value)

        stored_ids = raw.get("ids")
        if isinstance(stored_ids, dict):
            for key in ("id_head", "id_body", "id_legs"):
                value = stored_ids.get(key)
                if value not in (None, ""):
                    state.ids[key] = str(value)

        inputs = raw.get("inputs")
        if isinstance(inputs, list):
            state.inputs = [str(item) for item in inputs if isinstance(item, str)]
        last = raw.get("lastExport")
        if isinstance(last, dict):
            for key, value in last.items():
                try:
                    state.last_export[str(key)] = float(value)
                except (TypeError, ValueError):
                    continue

        window = raw.get("window")
        if isinstance(window, dict):
            cleaned = {}
            for key in ("x", "y", "width", "height"):
                try:
                    cleaned[key] = int(window[key])
                except (KeyError, TypeError, ValueError):
                    continue
            if "maximized" in window:
                cleaned["maximized"] = bool(window["maximized"])
            state.window = cleaned

        columns = raw.get("columns")
        if isinstance(columns, list) and len(columns) == len(DEFAULT_COLUMNS):
            try:
                state.columns = [max(40, int(value)) for value in columns]
            except (TypeError, ValueError):
                pass
        return state


def load(path: str | Path = CONFIG_NAME) -> UiState:
    """Read the configuration, falling back to defaults on any problem."""
    file = Path(path)
    if not file.exists():
        return UiState()
    try:
        raw = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        log.debug("could not read %s", file, exc_info=True)
        return UiState()
    return UiState.from_dict(raw)


def save(state: UiState, path: str | Path = CONFIG_NAME) -> None:
    """Write the configuration; failures are not fatal."""
    file = Path(path)
    try:
        file.write_text(
            json.dumps(state.to_dict(), indent=4, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    except OSError:
        log.debug("could not write %s", file, exc_info=True)
