"""Lookup of vanilla armor sets (head / body / legs armor-slot ids).

Terraria does not store armor sets as data, so ``data/armor_sets.json`` is
derived from the game sources by ``tools/build_armor_sets.py``.  Entries marked
``set-bonus`` come from ``ArmorSetBonuses.cs`` and are authoritative; the rest
were matched by the vanilla naming convention and may need a manual override.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources

__all__ = [
    "ArmorSet",
    "all_sets",
    "find_set",
    "search_sets",
    "describe",
    "display_name",
    "sanitize_filename",
]


#: Terraria's official Simplified Chinese calls exactly one armor piece 护甲
#: (``MeteorSuit`` → 流星护甲) while the rest of the interface says 盔甲.  The
#: data file keeps the name as the game ships it; this fix is applied when a
#: name is displayed.
_DISPLAY_FIXES = (("护甲", "盔甲"),)


def display_name(name: str) -> str:
    """Normalise a localized name for display."""
    for old, new in _DISPLAY_FIXES:
        name = name.replace(old, new)
    return name


@dataclass(frozen=True)
class ArmorSet:
    body: int
    head: int | None
    legs: int | None
    name: str
    zh: str = ""
    confidence: str = "name"

    @property
    def complete(self) -> bool:
        return self.head is not None and self.legs is not None

    @property
    def zh_display(self) -> str:
        """The Chinese name as the interface should show it."""
        return display_name(self.zh)

    def label(self) -> str:
        """``中文名  英文名  (身体 ID)`` — used by the UI lists."""
        parts = [part for part in (self.zh_display, self.name) if part]
        return f"{'  '.join(parts)}  ({self.body})"

    def matches(self, needle: str) -> bool:
        """Case/space insensitive search over every field."""
        needle = needle.strip().lower().replace(" ", "")
        if not needle:
            return True
        if needle in self.name.lower() or needle in self.zh.lower():
            return True
        if needle in display_name(self.zh).lower():
            return True
        if needle.lstrip("-").isdigit():
            wanted = int(needle)
            return wanted in (self.body, self.head, self.legs)
        return False


def describe(item: ArmorSet) -> str:
    label = item.zh_display or item.name
    return (
        f"{label}  {item.name} (body {item.body}"
        f", head {item.head if item.head is not None else '?'}"
        f", legs {item.legs if item.legs is not None else '?'})"
        f"  [{item.confidence}]"
    )


@lru_cache(maxsize=1)
def _data() -> dict:
    path = resources.files(__package__).joinpath("data/armor_sets.json")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def all_sets() -> tuple[ArmorSet, ...]:
    return tuple(
        ArmorSet(
            body=int(entry["body"]),
            head=None if entry.get("head") is None else int(entry["head"]),
            legs=None if entry.get("legs") is None else int(entry["legs"]),
            name=str(entry.get("name") or entry["body"]),
            zh=str(entry.get("zh") or ""),
            confidence=str(entry.get("confidence") or "name"),
        )
        for entry in _data()["sets"]
    )


def find_set(
    *,
    body: int | None = None,
    head: int | None = None,
    legs: int | None = None,
    name: str | None = None,
) -> ArmorSet | None:
    """Find the set that best matches the given criteria."""
    candidates = list(all_sets())
    if body is not None:
        exact = [item for item in candidates if item.body == body]
        if not exact:
            return None
        candidates = exact
    if name:
        named = [item for item in candidates if item.matches(name)]
        if named:
            candidates = named
    if head is not None:
        candidates = [item for item in candidates if item.head == head] or candidates
    if legs is not None:
        candidates = [item for item in candidates if item.legs == legs] or candidates
    if not candidates:
        return None
    # Prefer the most trustworthy entry, then the lowest body id.
    rank = {"set-bonus": 0, "name": 1, "prefix": 2, "none": 3}
    candidates.sort(key=lambda item: (rank.get(item.confidence, 9), item.body))
    return candidates[0]


#: Characters that are not safe in a file name on some platform.
_UNSAFE = set('\\/:*?"<>|\r\n\t')


def sanitize_filename(name: str, fallback: str = "ArmorTemplate") -> str:
    """Make ``name`` safe to use as a file name on every supported platform."""
    cleaned = "".join("_" if char in _UNSAFE else char for char in name).strip(" .")
    return cleaned or fallback


def search_sets(text: str) -> list[ArmorSet]:
    """Fuzzy search by Chinese/English name, id, or any of the three slot ids."""
    return [item for item in all_sets() if item.matches(text)]


def source_info() -> dict:
    data = _data()
    return {"source": data.get("source"), "generated": data.get("generated"), "count": data.get("count")}
