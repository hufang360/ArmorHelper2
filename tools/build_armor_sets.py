#!/usr/bin/env python3
"""Generate ``armorhelper/data/armor_sets.json`` from a Terraria source tree.

The mapping ``head / body / legs`` armor-slot ids that belong to the same armor
set is not stored anywhere in the game as data, so it is derived from two
sources:

1. ``Terraria.DataStructures/ArmorSetBonuses.cs`` — the sets that have a set
   bonus are listed explicitly by *item* id.  Those are authoritative.
2. Constant **names** in ``Terraria.ID/ArmorIDs.cs``.  Vanilla names follow a
   strict ``<Set>Helmet / <Set>Breastplate / <Set>Greaves`` convention, so the
   set name can be recovered by stripping the slot suffix.

Usage::

    python3 tools/build_armor_sets.py /path/to/tr-code-1458
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path

HEAD_SUFFIXES = (
    "Headgear", "Headphones", "Earmuffs", "Bandana", "Goggles", "Helmet", "Crown",
    "Horns", "Tiara", "Beard", "Visor", "Mask", "Hood", "Helm", "Wig", "Hat",
    "Cap", "Bow", "Veil", "Head", "Band", "Face",
)
BODY_SUFFIXES = (
    "Breastplate", "Chestplate", "Chainmail", "Scalemail", "Sweater", "Jacket",
    "Clothier", "Trousers", "Tunic", "Shirt", "Robe", "Dress", "Armor", "Coat",
    "Vest", "Mail", "Suit", "Plate", "Body", "Wrap", "Cloak", "Cape", "Blouse", "Gi",
)
LEG_SUFFIXES = (
    "Pantaloons", "Leggings", "Trousers", "Greaves", "Shorts", "Skirt", "Boots",
    "Pants", "Legs", "Heels", "Tail",
)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def parse_armor_ids(source: Path) -> dict[str, dict[str, int]]:
    text = read(source / "Terraria.ID/ArmorIDs.cs")
    result = {}
    for cls, nxt, key in (
        ("Head", "Body", "head"),
        ("Body", "Legs", "body"),
        ("Legs", "HandOn", "legs"),
    ):
        start = text.find(f"public class {cls}\n")
        stop = text.find(f"public class {nxt}\n", start)
        segment = text[start:stop]
        result[key] = {
            m.group(1): int(m.group(2))
            for m in re.finditer(r"public const int (\w+) = (\d+);", segment)
        }
    return result


def parse_item_ids(source: Path) -> dict[int, str]:
    text = read(source / "Terraria.ID/ItemID.cs")
    return {
        int(m.group(2)): m.group(1)
        for m in re.finditer(r"public const short (\w+) = (\d+);", text)
    }


def parse_item_slots(source: Path) -> dict[int, dict[str, int]]:
    """``itemID -> {"headSlot": n, "bodySlot": n, ...}`` from ``Item.cs``.

    Item defaults are split over ``SetDefaults1..5`` in 1.4.4+, so every one of
    them is scanned.  The slot assignments sit right at the top of each ``case``
    block.
    """
    text = read(source / "Terraria/Item.cs")
    bounds = [
        (m.start(), m.group(1))
        for m in re.finditer(
            r"\n\t(?:public|private|internal|protected) void (SetDefaults\w*)\(int [a-zA-Z]+\)", text
        )
    ]
    bounds.append((len(text), "END"))

    slots: dict[int, dict[str, int]] = {}
    for index in range(len(bounds) - 1):
        segment = text[bounds[index][0] : bounds[index + 1][0]]
        labels = [(m.start(), int(m.group(1))) for m in re.finditer(r"\n\t+case (\d+):", segment)]
        for position, (start, item_id) in enumerate(labels):
            stop = labels[position + 1][0] if position + 1 < len(labels) else len(segment)
            chunk = segment[start:stop]
            found = {}
            for key in ("headSlot", "bodySlot", "legSlot"):
                match = re.search(rf"\b{key} = (\d+);", chunk)
                if match:
                    found[key] = int(match.group(1))
            if found:
                slots.setdefault(item_id, {}).update(found)
    return slots


def parse_localization(path: Path) -> dict[str, str]:
    """``ItemID constant name -> translated item name`` (zh-Hans by default)."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    names = data.get("ItemName")
    return names if isinstance(names, dict) else {}


def parse_set_bonuses(source: Path) -> list[list[int]]:
    text = read(source / "Terraria.DataStructures/ArmorSetBonuses.cs")
    groups = []
    for match in re.finditer(r'Add\(\s*Benefits\.\w+,\s*"[^"]+",\s*([\d,\s]+)\)', text):
        ids = [int(piece) for piece in match.group(1).replace(" ", "").split(",") if piece]
        if ids:
            groups.append(ids)
    return groups


def strip_suffix(name: str, suffixes: tuple[str, ...]) -> str:
    for suffix in suffixes:
        if name.endswith(suffix) and len(name) > len(suffix):
            return name[: -len(suffix)]
    return name


def common_prefix(a: str, b: str) -> int:
    count = 0
    for left, right in zip(a, b):
        if left != right:
            break
        count += 1
    return count


def guess_slot(body_name: str, table: dict[str, int], suffixes: tuple[str, ...]):
    """Best effort: exact stem first, then the longest shared name prefix."""
    stem = strip_suffix(body_name, BODY_SUFFIXES)
    exact = [name for name in table if strip_suffix(name, suffixes) == stem]
    if exact:
        exact.sort(key=len)
        return table[exact[0]], exact[0], "name"
    best = None
    for name in table:
        length = common_prefix(body_name, name)
        if length < 4:
            continue
        if len(body_name) > length and not body_name[length].isupper():
            continue
        score = (length, -len(name))
        if best is None or score > best[0]:
            best = (score, table[name], name)
    if best:
        return best[1], best[2], "prefix"
    return None, None, None


def build(source: Path, *, localization: Path | None = None) -> dict:
    armor = parse_armor_ids(source)
    item_names = parse_item_ids(source)
    heads, bodies, legs = armor["head"], armor["body"], armor["legs"]
    body_names = {value: name for name, value in bodies.items()}

    # Chinese (or whatever the localization is) names, keyed by armor slot id.
    translated = parse_localization(
        localization or source / "Terraria.Localization.Content.zh-Hans.Items.json"
    )
    item_to_body = {
        entry["bodySlot"]: item_id
        for item_id, entry in parse_item_slots(source).items()
        if "bodySlot" in entry
    }

    def localized(body_id: int) -> str:
        item_id = item_to_body.get(body_id)
        name = item_names.get(item_id) if item_id is not None else None
        if name is None:
            # Fall back to the identically named item, if there is one.
            name = body_names.get(body_id)
        return translated.get(name, "") if name else ""

    by_name: dict[str, dict[str, int]] = {}
    for key, table in (("head", heads), ("body", bodies), ("legs", legs)):
        for name, value in table.items():
            by_name.setdefault(name, {})[key] = value

    # --- 1. authoritative set-bonus groups ---------------------------------
    sets: dict[int, dict] = {}
    for group in parse_set_bonuses(source):
        triple: dict[str, int] = {}
        for item_id in group:
            name = item_names.get(item_id)
            if not name:
                continue
            entry = by_name.get(name)
            if entry:
                triple.update(entry)
        body_id = triple.get("body")
        if body_id is None:
            continue
        sets[body_id] = {
            "body": body_id,
            "head": triple.get("head"),
            "legs": triple.get("legs"),
            "name": body_names.get(body_id, str(body_id)),
            "zh": localized(body_id),
            "confidence": "set-bonus",
        }

    # --- 2. name based matching for everything else ------------------------
    for body_name, body_id in bodies.items():
        if body_id in sets:
            continue
        head_id, _, head_how = guess_slot(body_name, heads, HEAD_SUFFIXES)
        leg_id, leg_name, leg_how = guess_slot(body_name, legs, LEG_SUFFIXES)
        if leg_name == body_name:
            # A dress-style body can be its own "legs" texture; that is not a
            # useful guess for the template, which has separate regions.
            leg_id, leg_how = None, None
        confidence = "name" if (head_how or leg_how) == "name" else "prefix"
        if head_id is None and leg_id is None:
            confidence = "none"
        sets[body_id] = {
            "body": body_id,
            "head": head_id,
            "legs": leg_id,
            "name": body_name,
            "zh": localized(body_id),
            "confidence": confidence,
        }

    ordered = [sets[key] for key in sorted(sets)]
    return {
        "source": "Terraria (rowid 1.4.5.x) — derived from ArmorIDs.cs + ArmorSetBonuses.cs",
        "generated": date.today().isoformat(),
        "count": len(ordered),
        "sets": ordered,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="path to a decompiled Terraria source tree")
    parser.add_argument(
        "--localization",
        type=Path,
        default=None,
        help="localization json (default: <source>/Terraria.Localization.Content.zh-Hans.Items.json)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "armorhelper/data/armor_sets.json",
    )
    args = parser.parse_args()

    data = build(args.source, localization=args.localization)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    complete = sum(1 for s in data["sets"] if s["head"] is not None and s["legs"] is not None)
    translated = sum(1 for s in data["sets"] if s.get("zh"))
    print(f"wrote {args.output}")
    print(f"  {data['count']} body armors, {complete} with both a head and a legs guess")
    print(f"  {translated} with a localized name")
    from collections import Counter

    print("  confidence:", dict(Counter(s["confidence"] for s in data["sets"])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
