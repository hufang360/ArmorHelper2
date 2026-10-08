#!/usr/bin/env python3
"""Export the Python side's data so the standalone web app can use it.

The web version (``web/``) is plain JavaScript and shares nothing with the
Python package at runtime, but it must agree with it exactly.  Rather than
copying constants by hand, this script writes them out:

``web/data/layout.json``          template regions, frame tables, cell maps
``web/data/armor_sets.json``      the vanilla armor set table
``web/data/i18n.json``            the interface strings (zh_CN / en)
``web/data/ArmorTemplate_v1.png`` the drawing template

Run it whenever the Python side changes::

    python3 tools/export_web.py
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from armorhelper import __version__, layout as L  # noqa: E402
from armorhelper.export import DEFAULT_TARGETS, TARGETS  # noqa: E402
from armorhelper.generate import _back_arm_layer, _front_arm_layer  # noqa: E402
from armorhelper.i18n import MESSAGES  # noqa: E402
from armorhelper.vanilla import all_sets  # noqa: E402

DEFAULT_OUT = ROOT / "web" / "data"


def _rect(rect) -> list[int]:
    return [int(value) for value in rect]


def _point(point) -> list[int]:
    return [int(point[0]), int(point[1])]


def _layers() -> dict:
    """The per-frame layer tables, computed with the real code."""
    front_arms: dict[str, list] = {}
    back_arms: dict[str, list] = {}
    for frame in range(L.FRAME_COUNT):
        front = _front_arm_layer(frame)
        if front is not None:
            rect, offset, ignore = front
            front_arms[str(frame)] = [_rect(rect), _point(offset), [_point(p) for p in ignore]]
        back = _back_arm_layer(frame)
        if back is not None:
            blits, stray = back
            back_arms[str(frame)] = {
                "blits": [[_rect(rect), _point(offset)] for rect, offset in blits],
                "stray": None if stray is None else [_rect(stray[0]), _point(stray[1])],
            }
    return {"frontArm": front_arms, "backArm": back_arms}


def build_layout() -> dict:
    cells = {str(frame): list(cell) for frame, cell in L.FRONT_ARM_CELL.items()}
    back_cells = {str(frame): list(cell) for frame, cell in L.BACK_ARM_CELL.items()}
    owners: dict[str, int] = {}
    for cell, frame in L.FRONT_ARM_CELL_OWNER.items():
        owners[f"{cell[0]},{cell[1]}"] = int(frame)
    back_owners: dict[str, int] = {}
    for cell, frame in L.BACK_ARM_CELL_OWNER.items():
        back_owners[f"{cell[0]},{cell[1]}"] = int(frame)

    return {
        "version": __version__,
        "templateSize": list(L.TEMPLATE_SIZE),
        "frame": {"w": L.FRAME_W, "h": L.FRAME_H, "count": L.FRAME_COUNT},
        "bodyComposite": {
            "cols": L.BODY_COMPOSITE_COLS,
            "rows": L.BODY_COMPOSITE_ROWS,
            "glowRows": L.BODY_GLOW_ROWS,
        },
        "regions": {
            "head": _rect(L.HEAD_SRC),
            "body": _rect(L.BODY_SRC),
            "bodyJump": _rect(L.BODY_JUMP_SRC),
            "female": _rect(L.FEMALE_SRC),
            "femaleJump": _rect(L.FEMALE_JUMP_SRC),
            "frontArmPoses": [_rect(r) for r in L.FRONT_ARM_POSES],
            "frontArmWalk": _rect(L.FRONT_ARM_WALK),
            "backArm": _rect(L.BACK_ARM),
            "backArmStray": _rect(L.BACK_ARM_STRAY_PIXEL),
            "legColumnLeft": _point(L.LEG_COLUMN_LEFT),
            "legColumnRight": _point(L.LEG_COLUMN_RIGHT),
            "legPiece": _point(L.LEG_PIECE_SIZE),
            "legFootFront": _rect(L.LEG_FOOT_FRONT),
            "legFootBack": _rect(L.LEG_FOOT_BACK),
            "frontArmFrame5Ignore": [_point(p) for p in L.FRONT_ARM_FRAME5_IGNORE],
        },
        "offsets": {
            "frontArm": list(L.FRONT_ARM_OFFSETS),
            "backArm": list(L.BACK_ARM_OFFSETS),
            "bodyHead": list(L.BODY_HEAD_OFFSETS),
            "frontArmBaseY": 12,
        },
        "legMapping": [list(group) for group in L.LEG_MAPPING],
        "cells": {
            "frontArm": cells,
            "backArm": back_cells,
            "frontArmOwner": owners,
            "backArmOwner": back_owners,
            "torso": list(L.TORSO_CELL),
            "torsoJump": list(L.TORSO_JUMP_CELL),
            "frontShoulder": list(L.FRONT_SHOULDER_CELL),
            "backShoulder": list(L.BACK_SHOULDER_CELL),
            "compositeFrontArmCol": L.COMPOSITE_FRONT_ARM_COL,
            "compositeBackArmCol": L.COMPOSITE_BACK_ARM_COL,
        },
        "layers": _layers(),
        "targets": {"all": list(TARGETS), "defaults": list(DEFAULT_TARGETS)},
    }


def build_sets() -> dict:
    return {
        "version": __version__,
        "sets": [
            {
                "body": item.body,
                "head": item.head,
                "legs": item.legs,
                "name": item.name,
                "zh": item.zh,
                "confidence": item.confidence,
            }
            for item in all_sets()
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    package_data = ROOT / "armorhelper" / "data"

    (args.output / "layout.json").write_text(
        json.dumps(build_layout(), indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (args.output / "armor_sets.json").write_text(
        json.dumps(build_sets(), indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (args.output / "i18n.json").write_text(
        json.dumps({"version": __version__, "messages": MESSAGES}, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    shutil.copy2(package_data / "ArmorTemplate_v1.png", args.output / "ArmorTemplate_v1.png")

    # the optional guide overlay travels with the template
    overlay = package_data / "ArmorTemplate_overlay.png"
    if overlay.exists():
        shutil.copy2(overlay, args.output / overlay.name)
    else:
        (args.output / overlay.name).unlink(missing_ok=True)

    for name in ("layout.json", "armor_sets.json", "i18n.json", "ArmorTemplate_v1.png", "ArmorTemplate_overlay.png"):
        size = (args.output / name).stat().st_size
        print(f"wrote {args.output / name}  ({size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
