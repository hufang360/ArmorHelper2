"""Checks that keep the documentation honest.

The crop table in ``docs/贴图裁切说明.md`` is the reference people will copy
coordinates from, so it is parsed back and compared against the layout tables
the generator actually uses.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from armorhelper import layout as L  # noqa: E402

DOC = ROOT / "docs" / "贴图裁切说明.md"
REQUIREMENTS = ROOT / "docs" / "需求文档.md"
WEB_REQUIREMENTS = ROOT / "docs" / "Web版需求文档.md"
README = ROOT / "README.md"

CELL_W = L.FRAME_W * 2  # 40
CELL_H = L.FRAME_H * 2  # 56

ROW_RE = re.compile(
    r"^\| `(\d+),(\d+)` \| `(\d+),(\d+)` \| `(\d+),(\d+)` \| (.+?) \| (.+?) \| (.+?) \| (\d+) \|$"
)


def test_crop_doc_exists_and_links_from_the_other_docs():
    assert DOC.exists()
    assert "贴图裁切说明.md" in README.read_text(encoding="utf-8")
    assert "贴图裁切说明.md" in REQUIREMENTS.read_text(encoding="utf-8")


def test_crop_table_covers_the_whole_9x4_grid():
    rows = [ROW_RE.match(line) for line in DOC.read_text(encoding="utf-8").splitlines()]
    matched = [match for match in rows if match]
    assert len(matched) == L.BODY_COMPOSITE_COLS * L.BODY_COMPOSITE_ROWS == 36

    seen = set()
    for match in matched:
        col, row, left, upper, right, lower = (int(value) for value in match.groups()[:6])
        assert (col, row) not in seen, f"({col},{row}) listed twice"
        seen.add((col, row))
        assert (left, upper) == (col * CELL_W, row * CELL_H), f"({col},{row}) left/upper"
        assert (right, lower) == (col * CELL_W + CELL_W, row * CELL_H + CELL_H), f"({col},{row})"


def test_crop_table_matches_the_layout_tables():
    """Every documented cell has to agree with the frame -> cell mapping."""
    text = DOC.read_text(encoding="utf-8")
    documented = {
        (int(m.group(1)), int(m.group(2))): m.group(7)
        for m in (ROW_RE.match(line) for line in text.splitlines())
        if m
    }
    assert len(documented) == 36

    for frame, cell in L.FRONT_ARM_CELL.items():
        assert cell in documented, f"front arm cell {cell} missing from the doc"
        assert "前臂" in documented[cell], f"cell {cell} should be a front arm"
    for frame, cell in L.BACK_ARM_CELL.items():
        if frame in (3, 4, 5):
            continue  # the game never draws the back arm on those frames
        assert "后臂" in documented[cell], f"cell {cell} should be a back arm"

    for cell, label in (
        (L.TORSO_CELL, "男性躯干"),
        (L.TORSO_JUMP_CELL, "男性躯干"),
        ((0, 2), "女性躯干"),
        ((1, 2), "女性躯干"),
        (L.FRONT_SHOULDER_CELL, "男性前肩"),
        (L.BACK_SHOULDER_CELL, "男性后肩"),
        ((0, 3), "女性前肩"),
        ((1, 3), "女性后肩"),
        ((L.COMPOSITE_FRONT_ARM_COL, 0), "前臂"),
        ((L.COMPOSITE_BACK_ARM_COL, 0), "后臂"),
    ):
        assert label in documented[cell], f"cell {cell}: {documented[cell]!r} lacks {label!r}"


def test_docs_point_at_the_reverse_tool():
    text = DOC.read_text(encoding="utf-8")
    assert "armorhelper reverse" in text
    assert "tools/inspect_armor.py" in text


def test_the_ui_never_says_hujia():
    """The interface and the docs consistently use 盔甲."""
    for path in (README, DOC, REQUIREMENTS, WEB_REQUIREMENTS):
        assert "护甲" not in path.read_text(encoding="utf-8"), path


def test_web_requirements_is_linked_and_complete():
    text = WEB_REQUIREMENTS.read_text(encoding="utf-8")
    assert "Web版需求文档.md" in REQUIREMENTS.read_text(encoding="utf-8")
    assert "Web版需求文档.md" in README.read_text(encoding="utf-8")
    # every web requirement has an id and appears in the acceptance table
    for prefix in ("WG-", "WFR-", "WUI-", "WNFR-", "WC-", "WL-"):
        assert prefix in text, prefix
    # the web app is pure static and deployed to Pages
    assert "GitHub Pages" in text
    assert "pages.yml" in text or "GitHub Actions" in text
    assert "http.server" in text
    assert "File System Access" in text
    # and it must not describe a server API any more
    assert "/api/" not in text
    assert "armorhelper web" not in text
