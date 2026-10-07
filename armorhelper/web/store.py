"""Persistent settings for the web front end.

The desktop GUI keeps its state in ``config.json``; the web version keeps its
own in ``web-config.json`` so the two never fight over, say, the target
checklist.  The first time the web version starts it seeds itself from
``config.json`` (if any) so the folder paths carry over.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from ..config import UiState
from ..config import load as load_gui_config
from ..config import save as save_state

__all__ = ["CONFIG_NAME", "load", "save", "reset"]

log = logging.getLogger("armorhelper")

CONFIG_NAME = "web-config.json"


def load(path: str | Path = CONFIG_NAME, *, seed: str | Path = "config.json") -> UiState:
    """Read the web settings, seeding from the GUI config on first use."""
    file = Path(path)
    if file.exists():
        return load_gui_config(file)

    state = load_gui_config(seed)
    if Path(seed).exists():
        log.info("seeded %s from %s", file, seed)
    # The web UI always has something to show, so make sure a folder is set.
    save(state, file)
    return state


def save(state: UiState, path: str | Path = CONFIG_NAME) -> None:
    save_state(state, path)


def reset(path: str | Path = CONFIG_NAME) -> None:
    file = Path(path)
    try:
        file.unlink()
    except FileNotFoundError:
        pass


def as_dict(state: UiState) -> dict:
    """A JSON friendly snapshot (used by ``GET /api/state``)."""
    return json.loads(json.dumps(state.to_dict(), ensure_ascii=False))
