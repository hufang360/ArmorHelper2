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

__all__ = ["ArmorSet", "all_sets", "find_set", "search_sets", "describe"]


@dataclass(frozen=True)
class ArmorSet:
    body: int
    head: int | None
    legs: int | None
    name: str
    confidence: str = "name"

    @property
    def complete(self) -> bool:
        return self.head is not None and self.legs is not None


def describe(item: ArmorSet) -> str:
    return (
        f"{item.name} (body {item.body}"
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
        needle = name.strip().lower().replace(" ", "")
        named = [item for item in candidates if needle in item.name.lower()]
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


def search_sets(text: str) -> list[ArmorSet]:
    """Fuzzy search by set name, id, or any of the three slot ids."""
    needle = text.strip().lower().replace(" ", "")
    if not needle:
        return list(all_sets())
    found = []
    for item in all_sets():
        haystack = [item.name.lower()]
        if needle.isdigit():
            haystack += [str(item.body), str(item.head), str(item.legs)]
        if any(needle in value for value in haystack):
            found.append(item)
    return found


def source_info() -> dict:
    data = _data()
    return {"source": data.get("source"), "generated": data.get("generated"), "count": data.get("count")}
