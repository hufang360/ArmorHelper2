"""Loading the player's own skin textures so "Full Armor + Player" works.

Terraria >= 1.4.4 stores the player skin in the same composite layout as the
armor: ``Player_<skin>_<part>.png`` inside ``Content/Images``.

The game ships these as ``.xnb``; ArmorHelper needs plain PNGs, so the user has
to point at an extracted ``Content/Images`` folder (the same folder the armor
sheets are dropped into).
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

from . import layout as L
from .imaging import new_canvas, paste_region

__all__ = [
    "TorsoPart",
    "FRONT_ARM_PART",
    "BACK_ARM_PART",
    "LEGS_PART",
    "find_images_dir",
    "player_frames",
    "player_available",
]

#: ``TextureAssets.Players[skin, n]`` part numbers used by the player renderer.
TORSO_PART = 3
#: Arm skin.  Used for both the front and the back arm in the composite system.
FRONT_ARM_PART = 7
BACK_ARM_PART = 7
#: Legs are still a plain 20 frame, 40x1120 sheet.
LEGS_PART = 10

TorsoPart = int


def find_images_dir(explicit: str | os.PathLike[str] | None = None) -> Path | None:
    """Best effort lookup of a terraria ``Content/Images`` folder with PNGs."""
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))

    for variable in ("ARMORHELPER_IMAGES", "TERRARIA_IMAGES"):
        value = os.environ.get(variable)
        if value:
            candidates.append(Path(value))

    steam_roots = [
        Path.home() / "Library/Application Support/Steam/steamapps/common/Terraria",
        Path("/Applications/Terraria.app/Contents/Resources"),
        Path.home() / ".steam/steam/steamapps/common/Terraria",
        Path.home() / ".local/share/Steam/steamapps/common/Terraria",
        Path("/Volumes/970/Applications/Terraria.app/Contents/Resources"),
    ]
    for root in steam_roots:
        candidates.append(root / "Content/Images")
        candidates.append(root)
        candidates.append(root / "Terraria.app/Contents/Resources/Content/Images")

    for candidate in candidates:
        if not candidate:
            continue
        candidate = Path(candidate)
        if candidate.is_dir():
            if (candidate / f"Player_0_{TORSO_PART}.png").exists():
                return candidate
            nested = candidate / "Content/Images"
            if (nested / f"Player_0_{TORSO_PART}.png").exists():
                return nested
            nested = candidate / "Images"
            if (nested / f"Player_0_{TORSO_PART}.png").exists():
                return nested
    return None


def _part_image(images_dir: Path, skin: int, part: int) -> Image.Image:
    return Image.open(images_dir / f"Player_{skin}_{part}.png").convert("RGBA")


def player_available(images_dir: Path | None, *, skin: int = 0) -> bool:
    if images_dir is None:
        return False
    needed = (TORSO_PART, FRONT_ARM_PART, LEGS_PART)
    return all((Path(images_dir) / f"Player_{skin}_{part}.png").exists() for part in needed)


def player_frames(
    images_dir: str | os.PathLike[str],
    *,
    skin: int = 0,
    female: bool = False,
) -> list[Image.Image]:
    """Compose the player's body into 20 native (40x56) frames.

    The result is always at Terraria's native 2x scale, so it lines up with the
    armor sheets generated with ``upscale_to=2`` (the default).
    """
    images_dir = Path(images_dir)
    torso_sheet = _part_image(images_dir, skin, TORSO_PART)
    arm_sheet = _part_image(images_dir, skin, FRONT_ARM_PART)
    legs_sheet = _part_image(images_dir, skin, LEGS_PART)

    frame_w, frame_h = L.FRAME_W * 2, L.FRAME_H * 2

    def cell(sheet: Image.Image, cell_xy: tuple[int, int]) -> Image.Image:
        # The game's own textures are at the native 2x scale.
        x, y = cell_xy[0] * frame_w, cell_xy[1] * frame_h
        return sheet.crop((x, y, x + frame_w, y + frame_h))

    def long_frame(sheet: Image.Image, index: int) -> Image.Image:
        return sheet.crop((0, index * frame_h, frame_w, (index + 1) * frame_h))

    frames: list[Image.Image] = []
    for frame in range(L.FRAME_COUNT):
        canvas = new_canvas(frame_w, frame_h)

        # Legs first (drawn behind the torso, like the game does).
        paste_region(canvas, long_frame(legs_sheet, frame), (0, 0, frame_w, frame_h), (0, 0))

        # Back arm, then the torso over it.
        paste_region(
            canvas, cell(arm_sheet, L.BACK_ARM_CELL[frame]), (0, 0, frame_w, frame_h), (0, 0)
        )
        if frame == 5:
            torso_cell_xy = (1, 2) if female else L.TORSO_JUMP_CELL
        else:
            torso_cell_xy = (0, 2) if female else L.TORSO_CELL
        paste_region(
            canvas, cell(torso_sheet, torso_cell_xy), (0, 0, frame_w, frame_h), (0, 0)
        )

        # Front arm on top.
        paste_region(
            canvas, cell(arm_sheet, L.FRONT_ARM_CELL[frame]), (0, 0, frame_w, frame_h), (0, 0)
        )

        frames.append(canvas)

    return frames
