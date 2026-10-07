"""The logic behind the web front end.

Everything the HTTP layer needs is a plain method here, so the routes stay thin
and the whole thing is testable without a socket.  All image work is delegated
to the same ``armorhelper`` package the desktop version uses, which guarantees
identical output.
"""

from __future__ import annotations

import base64
import binascii
import io
import logging
import shutil
import tempfile
import time
import uuid
import zipfile
from pathlib import Path
from urllib.parse import quote

from PIL import Image

from .. import __version__
from ..compose import full_armor_frames, save_gif, tint_frames
from ..compose import overlay as overlay_frames
from ..export import DEFAULT_TARGETS, TARGETS, ExportSettings, export_template
from ..i18n import MESSAGES, tr
from ..imaging import fill_rect, new_canvas, paste_region, upscale
from ..layout import template_bytes
from ..preview import find_images_dir, player_available, player_frames
from ..reverse import reverse_from_images, texture_paths
from ..vanilla import all_sets, find_set, sanitize_filename
from . import store

__all__ = ["Api", "ApiError"]

log = logging.getLogger("armorhelper")

#: How many generated jobs to keep in the temporary folder.
MAX_JOBS = 24

#: Frame preview scaling and layout.
PREVIEW_SCALE = 3
PREVIEW_COLUMNS = 10


class ApiError(Exception):
    """An error that should be reported to the browser as a 400."""


class Job:
    def __init__(self, name: str, folder: Path) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.name = name
        self.folder = folder
        self.created = time.time()
        self.files: list[dict] = []
        self.written: list[str] = []
        self.warnings: list[str] = []
        self.preview: str | None = None
        self.gif: str | None = None
        self.kind = "export"

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "files": self.files,
            "written": self.written,
            "warnings": self.warnings,
            "preview": self.preview,
            "gif": self.gif,
        }


class Api:
    def __init__(self, *, workspace: Path | None = None, config_path: Path | None = None) -> None:
        self.root = Path(workspace) if workspace else Path(tempfile.mkdtemp(prefix="armorhelper-web-"))
        self.config_path = Path(config_path) if config_path else Path(store.CONFIG_NAME)
        self.root.mkdir(parents=True, exist_ok=True)
        self.state = store.load(self.config_path)
        self.jobs: dict[str, Job] = {}

    # ------------------------------------------------------------------ #
    # settings
    # ------------------------------------------------------------------ #
    def get_state(self) -> dict:
        data = store.as_dict(self.state)
        data["defaults"] = list(DEFAULT_TARGETS)
        data["version"] = __version__
        data["detectedImages"] = self.state.images_folder or None
        data["templateUrl"] = "/api/template"
        return data

    def update_state(self, patch: dict) -> dict:
        if not isinstance(patch, dict):
            raise ApiError("expected a JSON object")
        state = self.state

        if "exportFolder" in patch:
            state.export_folder = str(patch["exportFolder"] or "")
        if "imagesFolder" in patch:
            state.images_folder = str(patch["imagesFolder"] or "")
        if "glow" in patch:
            state.glow = bool(patch["glow"])
        if "skin" in patch:
            try:
                state.skin = max(0, min(9, int(patch["skin"])))
            except (TypeError, ValueError):
                raise ApiError("skin must be a number") from None
        if "language" in patch:
            state.language = str(patch["language"] or "")
        if "targets" in patch and isinstance(patch["targets"], dict):
            for name, value in patch["targets"].items():
                if name in state.targets:
                    state.targets[name] = bool(value)
        if "ids" in patch and isinstance(patch["ids"], dict):
            for key in ("id_head", "id_body", "id_legs"):
                if key in patch["ids"]:
                    state.ids[key] = str(patch["ids"][key] or "")

        store.save(state, self.config_path)
        return self.get_state()

    def detect_images_dir(self) -> dict:
        found = find_images_dir()
        if found:
            self.state.images_folder = str(found)
            store.save(self.state, self.config_path)
        return {"path": str(found) if found else None, **self.get_state()}

    # ------------------------------------------------------------------ #
    # assets
    # ------------------------------------------------------------------ #
    @staticmethod
    def template_png() -> bytes:
        return template_bytes()

    @staticmethod
    def i18n() -> dict:
        return {"messages": MESSAGES, "targets": list(TARGETS)}

    @staticmethod
    def targets() -> dict:
        return {"targets": list(TARGETS), "defaults": list(DEFAULT_TARGETS)}

    # ------------------------------------------------------------------ #
    # vanilla browsing
    # ------------------------------------------------------------------ #
    @staticmethod
    def sets(query: str = "") -> dict:
        from ..vanilla import search_sets

        items = search_sets(query) if query else list(all_sets())
        return {
            "sets": [
                {
                    "body": item.body,
                    "head": item.head,
                    "legs": item.legs,
                    "name": item.name,
                    "zh": item.zh_display,
                    "label": item.label(),
                    "confidence": item.confidence,
                    "complete": item.complete,
                }
                for item in items
            ]
        }

    @staticmethod
    def browse(path: str = "") -> dict:
        target = Path(path).expanduser() if path else Path.cwd()
        if not target.exists() or not target.is_dir():
            target = target.parent if target.parent.is_dir() else Path.cwd()
        try:
            entries = sorted(
                (entry for entry in target.iterdir() if entry.is_dir() and not entry.name.startswith(".")),
                key=lambda entry: entry.name.lower(),
            )
        except PermissionError:
            raise ApiError(f"cannot read {target}") from None

        shortcuts = [Path.home(), Path.cwd(), Path("/Volumes") if Path("/Volumes").exists() else Path("/")]
        seen, unique = set(), []
        for item in shortcuts:
            if item.is_dir() and str(item) not in seen:
                seen.add(str(item))
                unique.append(str(item))

        return {
            "path": str(target),
            "parent": str(target.parent) if target.parent != target else None,
            "directories": [{"name": entry.name, "path": str(entry)} for entry in entries],
            "shortcuts": unique,
        }

    # ------------------------------------------------------------------ #
    # jobs
    # ------------------------------------------------------------------ #
    def _new_job(self, name: str) -> Job:
        self._evict()
        folder = Path(tempfile.mkdtemp(prefix=f"{name}-", dir=self.root))
        job = Job(name, folder)
        self.jobs[job.id] = job
        return job

    def _evict(self) -> None:
        if len(self.jobs) < MAX_JOBS:
            return
        oldest = sorted(self.jobs.values(), key=lambda job: job.created)
        for job in oldest[: len(self.jobs) - MAX_JOBS + 1]:
            shutil.rmtree(job.folder, ignore_errors=True)
            self.jobs.pop(job.id, None)

    def job(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if job is None:
            raise ApiError(f"unknown job {job_id}")
        return job

    def job_file(self, job_id: str, name: str) -> Path:
        """Resolve ``name`` inside the job folder (sub folders allowed)."""
        parts = [part for part in name.replace("\\", "/").split("/") if part not in ("", ".")]
        if not parts or any(part == ".." for part in parts):
            raise ApiError("bad file name")
        folder = self.job(job_id).folder
        path = folder.joinpath(*parts)
        if not path.is_file() or not path.resolve().is_relative_to(folder.resolve()):
            raise ApiError(f"no such file: {name}")
        return path

    def job_zip(self, job_id: str) -> bytes:
        job = self.job(job_id)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(job.folder.rglob("*")):
                if not path.is_file():
                    continue
                relative = path.relative_to(job.folder)
                if any(part.startswith("_") for part in relative.parts):
                    continue  # preview sheets and GIFs
                archive.write(path, relative.as_posix())
        return buffer.getvalue()

    def _register(self, job: Job, path: Path, *, preview: bool = True) -> dict:
        with Image.open(path) as image:
            width, height = image.size
        relative = path.relative_to(job.folder).as_posix()
        entry = {
            "name": path.name,
            "relative": relative,
            "size": path.stat().st_size,
            "width": width,
            "height": height,
            "url": f"/api/job/{job.id}/{quote(relative)}",
            "preview": preview,
        }
        job.files.append(entry)
        return entry

    # ------------------------------------------------------------------ #
    # export
    # ------------------------------------------------------------------ #
    def _settings(self, targets: list[str] | None, *, output: Path | None = None) -> ExportSettings:
        chosen = [name for name in (targets or []) if name in TARGETS]
        if not chosen:
            chosen = [name for name, on in self.state.targets.items() if on] or list(DEFAULT_TARGETS)

        def as_id(key: str) -> int | None:
            raw = (self.state.ids.get(key) or "").strip()
            try:
                return int(raw) if raw else None
            except ValueError:
                return None

        ids = {"id_head": as_id("id_head"), "id_body": as_id("id_body"), "id_legs": as_id("id_legs")}
        if ids["id_body"] is not None:
            for key in ("id_head", "id_legs"):
                if ids[key] is None:
                    ids[key] = ids["id_body"]

        return ExportSettings(
            output_dir=Path(output) if output else Path("."),
            targets=tuple(chosen),
            glow_rows=4 if self.state.glow else 0,
            images_dir=Path(self.state.images_folder) if self.state.images_folder else None,
            skin=self.state.skin,
            **ids,
        )

    def generate(self, payload: dict) -> dict:
        uploads = payload.get("files") or []
        if not uploads:
            raise ApiError("no template images were uploaded")

        results = []
        for upload in uploads:
            name = str(upload.get("name") or "template.png")
            raw = upload.get("data") or ""
            try:
                blob = base64.b64decode(raw, validate=True)
            except (binascii.Error, ValueError):
                raise ApiError(f"{name}: invalid base64 payload") from None
            results.append(self._generate_one(name, blob, payload))

        return {"jobs": results}

    def _generate_one(self, name: str, blob: bytes, payload: dict) -> dict:
        stem = Path(name).stem or "template"
        job = self._new_job(stem)

        try:
            with Image.open(io.BytesIO(blob)) as image:
                template = image.convert("RGBA")
        except Exception:
            raise ApiError(f"{name}: not a readable image") from None
        if template.size != (128, 80):
            raise ApiError(
                f"{name}: expected a 128x80 template, got {template.width}x{template.height}"
            )

        settings = self._settings(payload.get("targets"), output=job.folder)
        written = export_template(template, stem, settings)

        # Also drop the sheets into the configured output folder, keeping the
        # vanilla ``Armor/`` sub folder so the result is drop in ready.
        job.written = self._copy_to_output(written, settings)

        for path in written:
            self._register(job, path)

        job.preview, job.gif = self._build_previews(job, template, settings, payload)
        return job.as_dict()

    def _build_previews(
        self, job: Job, template: Image.Image, settings: ExportSettings, payload: dict
    ) -> tuple[str | None, str | None]:
        """Compose the 20 frames so the browser can show the armor in action."""
        female = bool(payload.get("female"))
        frames = full_armor_frames(template, female=female, upscale_to=2)

        player = None
        if payload.get("player") and player_available(settings.images_dir, skin=settings.skin):
            player = tint_frames(
                player_frames(settings.images_dir, skin=settings.skin, female=female)
            )
            frames = overlay_frames(player, frames)

        scale = max(1, PREVIEW_SCALE)
        columns = max(1, PREVIEW_COLUMNS)
        rows = (len(frames) + columns - 1) // columns
        cell_w, cell_h = frames[0].width * scale, frames[0].height * scale
        gap = 2 * scale
        sheet = new_canvas(columns * cell_w + (columns + 1) * gap, rows * cell_h + (rows + 1) * gap)
        for index, frame in enumerate(frames):
            col, row = index % columns, index // columns
            x = gap + col * (cell_w + gap)
            y = gap + row * (cell_h + gap)
            fill_rect(sheet, (x - 1, y - 1, cell_w + 2, cell_h + 2), (0, 0, 0, 40))
            paste_region(sheet, upscale(frame, scale), (0, 0, cell_w, cell_h), (x, y))

        sheet_path = job.folder / "_preview_sheet.png"
        sheet.save(sheet_path, "PNG")
        preview_url = f"/api/job/{job.id}/{sheet_path.name}"

        gif_path = job.folder / "_preview.gif"
        try:
            save_gif(frames, gif_path, upscale_to=scale)
            gif_url = f"/api/job/{job.id}/{gif_path.name}"
        except Exception:  # noqa: BLE001 - a broken GIF must not fail the export
            log.exception("could not build the GIF preview")
            gif_url = None
        return preview_url, gif_url

    def _copy_to_output(self, written: list[Path], settings: ExportSettings) -> list[str]:
        """Also drop the sheets into the configured output folder, if any."""
        target = Path(self.state.export_folder) if self.state.export_folder else None
        if not target or not target.is_dir():
            return []
        copied = []
        for path in written:
            destination = target / path.name
            try:
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, destination)
            except OSError:
                log.warning("could not write %s", destination, exc_info=True)
                continue
            copied.append(str(destination))
        return copied

    # ------------------------------------------------------------------ #
    # reverse
    # ------------------------------------------------------------------ #
    def reverse(self, payload: dict) -> dict:
        images = self._images_dir(payload)
        body = self._as_id(payload, "body", required=True)
        head = self._as_id(payload, "head")
        legs = self._as_id(payload, "legs")

        item = find_set(body=body)
        if item is not None and item.body != body:
            item = None
        label = sanitize_filename((item.zh_display if item and item.zh else None) or f"Armor{body}")

        job = self._new_job(f"reverse-{label}-{body}")
        result = reverse_from_images(
            images, body=body, head=head, legs=legs, set_name=item.name if item else None
        )
        path = job.folder / f"ArmorTemplate_{label}_{body}.png"
        result.template.save(path, "PNG")
        self._register(job, path)
        job.kind = "reverse"
        job.warnings = list(result.warnings)

        # Show what the rebuilt template produces, so the result can be judged
        # without downloading anything.
        try:
            frames = full_armor_frames(result.template, female=False, upscale_to=2)
            sheet = self._compose_sheet(frames)
            sheet_path = job.folder / "_preview_sheet.png"
            sheet.save(sheet_path, "PNG")
            job.preview = f"/api/job/{job.id}/{sheet_path.name}"
        except Exception:  # noqa: BLE001
            log.exception("could not build the reverse preview")

        job.written = self._copy_reverse_to_output(path)
        return job.as_dict()

    def _compose_sheet(self, frames) -> Image.Image:
        scale, columns = max(1, PREVIEW_SCALE), max(1, PREVIEW_COLUMNS)
        rows = (len(frames) + columns - 1) // columns
        cell_w, cell_h = frames[0].width * scale, frames[0].height * scale
        gap = 2 * scale
        sheet = new_canvas(columns * cell_w + (columns + 1) * gap, rows * cell_h + (rows + 1) * gap)
        for index, frame in enumerate(frames):
            col, row = index % columns, index // columns
            x = gap + col * (cell_w + gap)
            y = gap + row * (cell_h + gap)
            fill_rect(sheet, (x - 1, y - 1, cell_w + 2, cell_h + 2), (0, 0, 0, 40))
            paste_region(sheet, upscale(frame, scale), (0, 0, cell_w, cell_h), (x, y))
        return sheet

    def _copy_reverse_to_output(self, path: Path) -> list[str]:
        folder = Path(self.state.export_folder) if self.state.export_folder else None
        if not folder or not folder.is_dir():
            return []
        destination = folder / path.name
        try:
            shutil.copy2(path, destination)
        except OSError:
            log.warning("could not write %s", destination, exc_info=True)
            return []
        return [str(destination)]

    def reverse_all(self, payload: dict) -> dict:
        images = self._images_dir(payload)
        target_dir = Path(self.state.export_folder) if self.state.export_folder else None
        if target_dir is None or not target_dir.is_dir():
            raise ApiError(tr("status.noOutput"))
        target_dir = target_dir / "ArmorTemplate"
        target_dir.mkdir(parents=True, exist_ok=True)

        jobs = []
        for item in all_sets():
            if not item.complete:
                continue
            paths = texture_paths(images, head=item.head, body=item.body, legs=item.legs)
            if all(path is not None for path in paths.values()):
                jobs.append(item)
        if not jobs:
            raise ApiError(tr("reverse.allNone", dir=images))

        job = self._new_job("reverse-all")
        job.kind = "reverse-all"
        failed: list[str] = []
        produced: list[Path] = []
        for item in jobs:
            try:
                result = reverse_from_images(
                    images, body=item.body, head=item.head, legs=item.legs, set_name=item.name
                )
                label = sanitize_filename(item.zh_display or item.name)
                path = target_dir / f"ArmorTemplate_{label}_{item.body}.png"
                result.template.save(path, "PNG")
                produced.append(path)
                shutil.copy2(path, job.folder / path.name)
            except Exception as error:  # noqa: BLE001 - keep going
                log.exception("reverse failed for %s", item.name)
                failed.append(f"{item.name}: {error}")

        for path in produced:
            self._register(job, job.folder / path.name)
        if failed:
            job.warnings = failed[:20]
        job.written = [str(path) for path in produced]
        return {**job.as_dict(), "total": len(jobs), "failed": len(failed), "directory": str(target_dir)}

    # ------------------------------------------------------------------ #
    # helpers
    # ------------------------------------------------------------------ #
    def _images_dir(self, payload: dict) -> Path:
        raw = str(payload.get("images") or self.state.images_folder or "").strip()
        if not raw:
            raise ApiError(tr("reverse.noImages"))
        path = Path(raw).expanduser()
        if not path.is_dir():
            raise ApiError(tr("reverse.noImages"))
        return path

    @staticmethod
    def _as_id(payload: dict, key: str, *, required: bool = False) -> int | None:
        raw = payload.get(key)
        if raw in (None, ""):
            if required:
                raise ApiError(tr("reverse.badBody"))
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            raise ApiError(tr("reverse.badBody")) from None
