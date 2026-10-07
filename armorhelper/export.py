"""Turning a template into files on disk."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from .compose import full_armor_frames, gif_frame_order, overlay, save_gif, tint_frames
from .generate import SheetSet, generate
from .imaging import new_canvas, paste_region
from .preview import find_images_dir, player_available, player_frames

__all__ = [
    "TARGETS",
    "ExportSettings",
    "export_template",
    "stack_frames",
]

log = logging.getLogger("armorhelper")

#: Everything the tool knows how to produce.
TARGETS: tuple[str, ...] = (
    "head",
    "legs",
    "body",
    "legacy",
    "full",
    "full-female",
    "full-player",
    "full-player-female",
    "gif-full",
    "gif-full-female",
    "gif-full-player",
    "gif-full-player-female",
)

#: What the original tool had ticked on first run.
DEFAULT_TARGETS: tuple[str, ...] = ("head", "legs", "body")


@dataclass
class ExportSettings:
    output_dir: Path
    targets: tuple[str, ...] = DEFAULT_TARGETS
    id_head: int | None = None
    id_body: int | None = None
    id_legs: int | None = None
    body_subdir: str = "Armor"
    glow_rows: int = 0
    images_dir: Path | None = None
    skin: int = 0
    names: dict[str, str] = field(default_factory=dict)

    def wants(self, target: str) -> bool:
        return target in self.targets

    @property
    def wants_previews(self) -> bool:
        return any(
            target in self.targets
            for target in ("full", "full-female", "full-player", "full-player-female")
        ) or any(target.startswith("gif-") for target in self.targets)


def _write(image: Image.Image, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG")
    log.info("wrote %s (%dx%d)", path, image.width, image.height)
    return path


def _write_gif(frames, path: Path) -> Path:
    save_gif(frames, path, upscale_to=1)
    log.info("wrote %s (%d frames)", path, len(gif_frame_order()))
    return path


def stack_frames(frames: list[Image.Image]) -> Image.Image:
    """Vertically stack frames into one sheet."""
    width = frames[0].width
    height = sum(frame.height for frame in frames)
    sheet = new_canvas(width, height)
    y = 0
    for frame in frames:
        paste_region(sheet, frame, (0, 0, frame.width, frame.height), (0, y))
        y += frame.height
    return sheet


def vanilla_names(stem: str, settings: ExportSettings) -> dict[str, str]:
    """Map logical sheet names to file names (vanilla names when ids are set)."""
    if settings.id_body is None and settings.id_head is None and settings.id_legs is None:
        return {
            "head": f"{stem}_Head.png",
            "legs": f"{stem}_Legs.png",
            "body": f"{stem}_Body.png",
            "body_legacy": f"{stem}_BodyLegacy.png",
            "body_legacy_female": f"{stem}_BodyLegacyFemale.png",
            "arms": f"{stem}_ArmsLegacy.png",
        }
    body_id = settings.id_body if settings.id_body is not None else settings.id_head
    head_id = settings.id_head if settings.id_head is not None else body_id
    legs_id = settings.id_legs if settings.id_legs is not None else body_id
    return {
        "head": f"Armor_Head_{head_id}.png",
        "legs": f"Armor_Legs_{legs_id}.png",
        "body": f"{settings.body_subdir}/Armor_{body_id}.png",
        "body_legacy": f"Armor_Body_{body_id}.png",
        "body_legacy_female": f"Female_Body_{body_id}.png",
        "arms": f"Armor_Arm_{body_id}.png",
    }


def export_template(
    template: Image.Image,
    stem: str,
    settings: ExportSettings,
    *,
    upscale_to: int = 2,
) -> list[Path]:
    """Generate every requested sheet for one template and write it out."""
    settings.output_dir = Path(settings.output_dir)
    names = settings.names or vanilla_names(stem, settings)
    written: list[Path] = []

    sheets: SheetSet = generate(
        template,
        head=settings.wants("head"),
        legs=settings.wants("legs"),
        body=settings.wants("body"),
        legacy=settings.wants("legacy"),
        glow_rows=settings.glow_rows,
        upscale_to=upscale_to,
    )
    for key, image in sheets.items():
        if key in names:
            written.append(_write(image, settings.output_dir / names[key]))

    if not settings.wants_previews:
        return written

    frames_male = full_armor_frames(template, female=False, upscale_to=upscale_to)
    frames_female = None

    def female_frames() -> list[Image.Image]:
        nonlocal frames_female
        if frames_female is None:
            frames_female = full_armor_frames(template, female=True, upscale_to=upscale_to)
        return frames_female

    if settings.wants("full"):
        written.append(_write(stack_frames(frames_male), settings.output_dir / f"{stem}_FullArmor.png"))
    if settings.wants("full-female"):
        written.append(
            _write(stack_frames(female_frames()), settings.output_dir / f"{stem}_FullArmorFemale.png")
        )

    images_dir = settings.images_dir or find_images_dir()
    if any(t.startswith("full-player") or t.startswith("gif-full-player") for t in settings.targets):
        if not player_available(images_dir, skin=settings.skin):
            log.warning(
                "player textures not found (looked in %s); skipping the "
                "'Full Armor + Player' outputs.  Pass --images <Terraria/Content/Images>.",
                images_dir,
            )
            images_dir = None

    if images_dir is not None:
        if settings.wants("full-player"):
            player = tint_frames(player_frames(images_dir, skin=settings.skin, female=False))
            composed = overlay(player, frames_male)
            written.append(
                _write(stack_frames(composed), settings.output_dir / f"{stem}_FullArmorPlayer.png")
            )
        if settings.wants("full-player-female"):
            player = tint_frames(player_frames(images_dir, skin=settings.skin, female=True))
            composed = overlay(player, female_frames())
            written.append(
                _write(
                    stack_frames(composed),
                    settings.output_dir / f"{stem}_FullArmorPlayerFemale.png",
                )
            )

    if settings.wants("gif-full"):
        written.append(_write_gif(frames_male, settings.output_dir / f"{stem}_FullArmor.gif"))
    if settings.wants("gif-full-female"):
        written.append(
            _write_gif(female_frames(), settings.output_dir / f"{stem}_FullArmorFemale.gif")
        )
    if images_dir is not None:
        if settings.wants("gif-full-player"):
            player = tint_frames(player_frames(images_dir, skin=settings.skin, female=False))
            composed = overlay(player, frames_male)
            written.append(
                _write_gif(composed, settings.output_dir / f"{stem}_FullArmorPlayer.gif")
            )
        if settings.wants("gif-full-player-female"):
            player = tint_frames(player_frames(images_dir, skin=settings.skin, female=True))
            composed = overlay(player, female_frames())
            written.append(
                _write_gif(
                    composed, settings.output_dir / f"{stem}_FullArmorPlayerFemale.gif"
                )
            )

    return written
