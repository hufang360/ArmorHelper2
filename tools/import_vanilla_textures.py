#!/usr/bin/env python3
"""Bundle the vanilla armor textures into the web app.

Mobile browsers have no File System Access API, so a phone user cannot point the
web app at their game folder — and picking 748 files by hand is not an option
either.  Copying the extracted PNGs into ``web/data/vanilla/`` makes the reverse
conversion work out of the box.

Only armor related files are copied, and the body sheets keep their ``Armor/``
sub folder so the paths match what the game uses::

    web/data/vanilla/
        version.txt
        Armor_Head_1.png ...        (Content/Images/Armor_Head_<id>.png)
        Armor_Legs_1.png ...        (Content/Images/Armor_Legs_<id>.png)
        Armor/Armor_1.png ...       (Content/Images/Armor/Armor_<id>.png)

Usage::

    python3 tools/import_vanilla_textures.py "/path/to/Content/Images" --version 1.4.5.7

The result is reproducible: re-running it against the same folder produces byte
identical files, which is what ``tests/test_vanilla_bundle.py`` checks.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "web" / "data" / "vanilla"

PATTERNS = (
    (re.compile(r"Armor_Head_\d+\.png$"), ""),
    (re.compile(r"Armor_Legs_\d+\.png$"), ""),
    (re.compile(r"Armor_\d+\.png$"), "Armor"),
)

VERSION_NAME = "version.txt"


def collect(source: Path) -> list[tuple[Path, str]]:
    """Every armor PNG in ``source`` as ``(path, relative destination)``."""
    found: list[tuple[Path, str]] = []
    for pattern, sub in PATTERNS:
        folder = source / sub if sub else source
        if not folder.is_dir():
            continue
        for path in sorted(folder.iterdir()):
            if path.is_file() and pattern.fullmatch(path.name):
                found.append((path, f"{sub}/{path.name}" if sub else path.name))
    return found


def build(source: Path, out: Path, version: str) -> dict:
    if not source.is_dir():
        raise SystemExit(f"error: {source} is not a folder")

    entries = collect(source)
    if not entries:
        raise SystemExit(f"error: no armor PNGs found in {source}")

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    counts = {"head": 0, "legs": 0, "body": 0}
    total = 0
    for path, relative in entries:
        destination = out / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        total += destination.stat().st_size
        if relative.startswith("Armor_Head"):
            counts["head"] += 1
        elif relative.startswith("Armor_Legs"):
            counts["legs"] += 1
        else:
            counts["body"] += 1

    # A checksum over the file list, so the test suite can prove that the
    # checked in bundle is exactly what the script produces.
    digest = hashlib.sha256()
    for path, relative in sorted(entries, key=lambda item: item[1]):
        digest.update(relative.encode("utf-8"))
        digest.update(str(path.stat().st_size).encode("ascii"))
        digest.update(path.read_bytes())
        digest.update(b"\n")

    info = {
        "game": f"Terraria {version}",
        "version": version,
        "source": source.name,
        "count": len(entries),
        "total_bytes": total,
        "checksum": digest.hexdigest()[:16],
        **counts,
    }
    (out / VERSION_NAME).write_text(
        "# ArmorHelper bundled vanilla armor textures\n"
        "# copied from an extracted Content/Images folder by tools/import_vanilla_textures.py\n"
        + "".join(f"{key}={value}\n" for key, value in info.items()),
        encoding="utf-8",
    )
    return info


def bundle_checksum(out: Path = DEFAULT_OUT) -> str:
    """Recompute the checksum of a bundled folder (used by the tests)."""
    folder = Path(out)
    entries = []
    for path in sorted(folder.rglob("*.png")):
        entries.append((path.relative_to(folder).as_posix(), path))
    digest = hashlib.sha256()
    for relative, path in sorted(entries):
        digest.update(relative.encode("utf-8"))
        digest.update(str(path.stat().st_size).encode("ascii"))
        digest.update(path.read_bytes())
        digest.update(b"\n")
    return digest.hexdigest()[:16]


def read_version(out: Path = DEFAULT_OUT) -> dict[str, str]:
    """Parse ``version.txt`` (used by the tests)."""
    path = Path(out) / VERSION_NAME
    if not path.is_file():
        return {}
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="an extracted Terraria Content/Images folder")
    parser.add_argument(
        "--version", default="unknown", help="game version to record, e.g. 1.4.5.7"
    )
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    info = build(args.source, args.output, args.version)
    print(f"wrote {args.output}")
    for key, value in info.items():
        print(f"  {key}={value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
