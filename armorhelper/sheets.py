"""Full-body previews straight from Terraria's finished armor sheets.

This is the mirror image of :mod:`armorhelper.generate`: instead of expanding a
128x80 drawing template, it reads the three textures the game actually ships

    Content/Images/Armor_Head_<id>.png    40 x 1120   20 frames
    Content/Images/Armor_Legs_<id>.png    40 x 1120   20 frames
    Content/Images/Armor/Armor_<id>.png   360 x 224    9 x 4 grid

and composes the 20 full-body frames the way ``PlayerDrawSet.CreateCompositeData``
does (back shoulder -> back arm -> torso -> front shoulder -> front arm, legs
behind, head on top).

Why not ``reverse`` first?  The round trip through the drawing template is
lossless for the head, only 90~100% for the legs and 90~97% for the body
(overlapping feet, four arm poses merged into one).  Rendering the sheets
directly avoids that loss entirely, so an arbitrary vanilla / modded / remixed
texture pack can be previewed exactly as the game draws it.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from PIL import Image

from . import layout as L
from .imaging import new_canvas, paste_region, upscale

__all__ = [
    "SHEET_ROLES",
    "SheetSet",
    "detect_role",
    "detect_id",
    "compose_frames",
    "normalize_sheets",
    "load_sheet",
    "load_sheets",
    "load_sheets_from_dir",
    "stack_sheet",
    "export_sheet_previews",
]

SHEET_ROLES: tuple[str, ...] = ("head", "body", "legs")

_HEAD_HINTS = ("head", "helm", "hat")
_LEGS_HINTS = ("leg", "greave", "boot")
_BODY_HINTS = ("body", "armor", "torso", "breastplate", "chest")


def detect_role(name: str | os.PathLike[str]) -> str | None:
    """Guess which of the three textures ``name`` is, from its file name.

    Understands the tool's own output (``MyArmor_Head.png``), vanilla names
    (``Armor_Head_52.png``, ``Armor/Armor_32.png``) and the usual modding
    spellings.  Returns ``None`` when the name says nothing useful.
    """
    stem = Path(name).stem.lower()
    if stem.startswith("player_"):
        # Player skin sheets use the same composite layout but are not armor.
        return None
    if any(hint in stem for hint in _HEAD_HINTS):
        return "head"
    if any(hint in stem for hint in _LEGS_HINTS):
        return "legs"
    if any(hint in stem for hint in _BODY_HINTS):
        return "body"
    return None


def detect_id(name: str | os.PathLike[str]) -> int | None:
    """The trailing ``_<number>`` of a vanilla texture name, if there is one."""
    match = re.search(r"_(\d+)$", Path(name).stem)
    return int(match.group(1)) if match else None


def _cell_size(role: str, image: Image.Image) -> tuple[int, int]:
    """Validate a sheet and return its ``(cell width, cell height)``."""
    if role == "body":
        if image.width % L.BODY_COMPOSITE_COLS:
            raise ValueError(
                f"body sheet: {image.width}x{image.height} is not "
                f"{L.BODY_COMPOSITE_COLS} columns wide"
            )
        cell_w = image.width // L.BODY_COMPOSITE_COLS
        rows = L.BODY_COMPOSITE_ROWS
    else:
        cell_w = image.width
        rows = L.FRAME_COUNT

    scale = L.FRAME_H / L.FRAME_W
    cell_h = round(cell_w * scale)
    if cell_w <= 0 or cell_h <= 0 or abs(cell_h - cell_w * scale) > 0.001:
        raise ValueError(
            f"{role} sheet: {image.width}x{image.height} does not have the "
            f"{L.FRAME_W}x{L.FRAME_H} frame aspect ratio"
        )
    if image.height < cell_h * rows:
        # A few vanilla head sheets are 40x1118: the last frame is 2px short
        # (the engine simply samples transparent pixels there).  Tolerate a
        # short final frame, but nothing worse.
        minimum = cell_h * (rows if role == "body" else rows - 1)
        if image.height < minimum:
            raise ValueError(
                f"{role} sheet: {image.width}x{image.height} is too small, expected "
                f"{image.width}x{cell_h * rows} (or at least {minimum} with a short last frame)"
            )
    return cell_w, cell_h


def normalize_sheets(sheets: dict[str, Image.Image]) -> dict[str, Image.Image]:
    """Bring sheets of mixed scale (1x, 2x, ...) onto a common cell size.

    The largest cell wins (at least the game's native 2x, so 1x art still
    produces a readable GIF) and everything smaller is nearest-neighbour
    upscaled, exactly like the generator does.
    """
    present = {role: image for role, image in sheets.items() if image is not None}
    if not present:
        return {}

    sizes = {}
    for role, image in present.items():
        cell_w, cell_h = _cell_size(role, image)
        if (cell_w * L.FRAME_H) % L.FRAME_W:
            raise ValueError(
                f"{role} sheet: {cell_w}x{cell_h} cells are not a whole-number "
                f"multiple of the {L.FRAME_W}x{L.FRAME_H} frame"
            )
        sizes[role] = (cell_w, cell_h)

    # 1x art is upscaled to the game's native 2x so the GIFs stay readable.
    target_w = max(max(cell_w for cell_w, _ in sizes.values()), L.FRAME_W * 2)
    normalized: dict[str, Image.Image] = {}
    for role, image in present.items():
        cell_w, _cell_h = sizes[role]
        if target_w % cell_w:
            raise ValueError(
                f"{role} sheet is {cell_w}px per cell, which does not divide the "
                f"{target_w}px of the largest sheet"
            )
        factor = target_w // cell_w
        normalized[role] = image if factor == 1 else upscale(image, factor)
    return normalized


def compose_frames(
    *,
    head: Image.Image | None = None,
    body: Image.Image | None = None,
    legs: Image.Image | None = None,
    female: bool = False,
) -> list[Image.Image]:
    """Compose 20 full-body frames from the three armor sheets.

    Every frame is ``40x56`` (the game's native 2x scale; 1x art is upscaled).
    Sheets may be omitted; whatever is missing is simply not drawn.  The draw
    order is the game's: legs, back shoulder, back arm, torso, front shoulder,
    front arm, head.
    """
    normalized = normalize_sheets({"head": head, "body": body, "legs": legs})
    if not normalized:
        raise ValueError("no sheets to compose")

    # Every sheet is now on the same grid; take the geometry from any of them.
    some = next(iter(normalized.values()))
    role = next(iter(normalized))
    cell_w, cell_h = _cell_size(role, some)

    torso_cell, torso_jump_cell = L.TORSO_CELL_FOR(female)
    front_shoulder, back_shoulder = L.SHOULDER_CELLS_FOR(female)

    def cell(sheet: Image.Image, xy: tuple[int, int]) -> tuple[tuple[int, int, int, int], tuple[int, int]]:
        return (xy[0] * cell_w, xy[1] * cell_h, cell_w, cell_h), (0, 0)

    def stack_frame(sheet: Image.Image, index: int) -> tuple[tuple[int, int, int, int], tuple[int, int]]:
        return (0, index * cell_h, cell_w, cell_h), (0, 0)

    frames: list[Image.Image] = []
    for index in range(L.FRAME_COUNT):
        canvas = new_canvas(cell_w, cell_h)

        if "legs" in normalized:
            paste_region(canvas, normalized["legs"], *stack_frame(normalized["legs"], index))

        if "body" in normalized:
            sheet = normalized["body"]
            rect, xy = cell(sheet, back_shoulder)
            paste_region(canvas, sheet, rect, xy)
            rect, xy = cell(sheet, L.BACK_ARM_CELL[index])
            paste_region(canvas, sheet, rect, xy)
            torso = torso_jump_cell if index == 5 else torso_cell
            rect, xy = cell(sheet, torso)
            paste_region(canvas, sheet, rect, xy)
            rect, xy = cell(sheet, front_shoulder)
            paste_region(canvas, sheet, rect, xy)
            rect, xy = cell(sheet, L.FRONT_ARM_CELL[index])
            paste_region(canvas, sheet, rect, xy)

        if "head" in normalized:
            paste_region(canvas, normalized["head"], *stack_frame(normalized["head"], index))

        frames.append(canvas)
    return frames


def stack_sheet(frames: list[Image.Image]) -> Image.Image:
    """Stack frames vertically, the layout used by the head/legs sheets."""
    if not frames:
        raise ValueError("no frames to stack")
    width, height = frames[0].size
    sheet = new_canvas(width, height * len(frames))
    for index, frame in enumerate(frames):
        paste_region(sheet, frame, (0, 0, width, height), (0, index * height))
    return sheet


def export_sheet_previews(
    sheets: SheetSet,
    output_dir: str | os.PathLike[str],
    *,
    stem: str | None = None,
    female: bool = True,
    player: bool = True,
    images_dir: str | os.PathLike[str] | None = None,
    skin: int = 0,
) -> list[Path]:
    """Write the 20 frame sheets and the GIFs for ``sheets``.

    Produces ``<stem>_FullArmor.png/.gif``, the female variants and — when a
    ``Content/Images`` folder with player textures is available — the
    ``*Player*`` variants.  Returns the files written.
    """
    from .compose import overlay, save_gif, tint_frames
    from .preview import find_images_dir, player_available, player_frames

    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    stem = stem or sheets.name()

    male = sheets.frames(female=False)
    female_frames = sheets.frames(female=True) if female else None
    written: list[Path] = []

    def write_png(frames: list[Image.Image], name: str) -> None:
        path = output / name
        stack_sheet(frames).save(path, "PNG")
        written.append(path)

    def write_gif(frames: list[Image.Image], name: str) -> None:
        path = output / name
        save_gif(frames, path, upscale_to=1)
        written.append(path)

    write_png(male, f"{stem}_FullArmor.png")
    write_gif(male, f"{stem}_FullArmor.gif")
    if female_frames is not None:
        write_png(female_frames, f"{stem}_FullArmorFemale.png")
        write_gif(female_frames, f"{stem}_FullArmorFemale.gif")

    images = Path(images_dir) if images_dir else find_images_dir()
    # Player art is always native 2x; only composite at that scale.
    if player and male[0].width == L.FRAME_W * 2 and player_available(images, skin=skin):
        def with_player(frames: list[Image.Image], is_female: bool) -> list[Image.Image]:
            player = tint_frames(player_frames(images, skin=skin, female=is_female))
            return overlay(player, frames)

        player_male = with_player(male, False)
        write_png(player_male, f"{stem}_FullArmorPlayer.png")
        write_gif(player_male, f"{stem}_FullArmorPlayer.gif")
        if female_frames is not None:
            player_female = with_player(female_frames, True)
            write_png(player_female, f"{stem}_FullArmorPlayerFemale.png")
            write_gif(player_female, f"{stem}_FullArmorPlayerFemale.gif")

    return written


# --------------------------------------------------------------------------- #
# Loading files
# --------------------------------------------------------------------------- #


@dataclass
class SheetSet:
    """The three textures of one armor set, plus what was learned about them."""

    head: Image.Image | None = None
    body: Image.Image | None = None
    legs: Image.Image | None = None
    head_id: int | None = None
    body_id: int | None = None
    legs_id: int | None = None
    paths: dict[str, Path] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def roles(self) -> tuple[str, ...]:
        return tuple(role for role in SHEET_ROLES if getattr(self, role) is not None)

    @property
    def missing(self) -> tuple[str, ...]:
        return tuple(role for role in SHEET_ROLES if getattr(self, role) is None)

    def frames(self, *, female: bool = False) -> list[Image.Image]:
        return compose_frames(head=self.head, body=self.body, legs=self.legs, female=female)

    def name(self, fallback: str = "Armor") -> str:
        """A safe file name stem, preferring the body id (``Armor_32``)."""
        if self.body_id is not None:
            return f"Armor_{self.body_id}"
        for role in ("body", "head", "legs"):
            path = self.paths.get(role)
            if path is not None:
                return path.stem
        return fallback


def load_sheet(path: str | os.PathLike[str], role: str | None = None) -> tuple[str, Image.Image]:
    """Load one PNG and return ``(role, image)``, guessing the role if needed."""
    path = Path(path)
    with Image.open(path) as source:
        image = source.convert("RGBA")
    guessed = role or detect_role(path)
    if guessed is None:
        # Fall back to the dimensions: the body grid is wide, head/legs are tall.
        if image.width > image.height:
            guessed = "body"
        else:
            raise ValueError(
                f"{path.name}: cannot tell whether this is the head, body or legs "
                "sheet — pass it with --head/--body/--legs"
            )
    if guessed not in SHEET_ROLES:
        raise ValueError(f"{path.name}: unknown sheet role {guessed!r}")
    _cell_size(guessed, image)
    return guessed, image


def load_sheets(paths: Iterable[str | os.PathLike[str]]) -> SheetSet:
    """Load and classify a batch of texture files (order does not matter)."""
    result = SheetSet()
    for path in paths:
        role, image = load_sheet(path)
        if getattr(result, role) is not None:
            result.warnings.append(
                f"more than one {role} sheet: keeping {result.paths[role].name}, ignoring {Path(path).name}"
            )
            continue
        setattr(result, role, image)
        setattr(result, f"{role}_id", detect_id(path))
        result.paths[role] = Path(path)
    return result


def load_sheets_from_dir(directory: str | os.PathLike[str]) -> SheetSet:
    """Load armor-looking PNGs in ``directory``.

    The body sheets live in the ``Armor/`` sub folder in a real
    ``Content/Images`` tree, so that folder is scanned too (but no deeper).
    Files whose names look like armor but whose size is wrong are skipped with
    a warning; only the first sheet of each role is kept.
    """
    directory = Path(directory)
    roots = [directory]
    if (directory / "Armor").is_dir():
        roots.append(directory / "Armor")

    result = SheetSet()
    for root in roots:
        for path in sorted(root.iterdir()):
            if not path.is_file() or path.suffix.lower() not in (".png", ".bmp"):
                continue
            role = detect_role(path)
            if role is None:
                continue
            try:
                role, image = load_sheet(path, role)
            except (OSError, ValueError) as error:
                result.warnings.append(f"skipped {path.name}: {error}")
                continue
            if getattr(result, role) is not None:
                result.warnings.append(
                    f"more than one {role} sheet: keeping {result.paths[role].name}, "
                    f"ignoring {path.name}"
                )
                continue
            setattr(result, role, image)
            setattr(result, f"{role}_id", detect_id(path))
            result.paths[role] = path

    if not result.roles:
        raise ValueError(f"no usable armor sheets found in {directory}")
    return result
