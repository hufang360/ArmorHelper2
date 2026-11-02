#!/usr/bin/env python3
"""Bundle the three player textures the web app needs for "overlay player".

The preview features draw the player's body under the armor, which needs

    Player_0_3.png    360 x 224    torso
    Player_0_7.png    360 x 224    arms
    Player_0_10.png    40 x 1120   legs

The desktop app reads them from the user's ``Content/Images``.  Browsers can
only do that on Chromium, so the site ships a copy as well: on a phone (or
Firefox / Safari) the overlay then works with no folder at all.

Usage::

    python3 tools/import_player_textures.py "/path/to/Content/Images"
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "web" / "data" / "player"

PARTS = ("Player_0_3.png", "Player_0_7.png", "Player_0_10.png")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="an extracted Terraria Content/Images folder")
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--version", default="", help="game version to record in version.txt")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    total = 0
    for name in PARTS:
        source = args.source / name
        if not source.is_file():
            print(f"missing {source}", file=sys.stderr)
            return 1
        shutil.copy2(source, args.output / name)
        total += source.stat().st_size
        print(f"copied {name}  ({source.stat().st_size} bytes)")

    version = args.version or "terraria"
    (args.output / "version.txt").write_text(
        f"# Player body textures bundled for the web preview\n"
        f"version={version}\n"
        f"count={len(PARTS)}\n"
        f"bytes={total}\n",
        encoding="utf-8",
    )
    print(f"wrote {args.output / 'version.txt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
