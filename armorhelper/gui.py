"""wxPython front end — a port of the original WinForms window.

The layout mirrors ArmorHelper v1: input list, output folder, a checklist of
options and a big Export button, with the selection remembered in
``config.json`` next to the working directory (just like the original).

The interface is Chinese by default (see :mod:`armorhelper.i18n`); set
``ARMORHELPER_LANG=en`` for English.

Extras the original did not have (because the new composite format needs
them): a glow mask switch, a player skin index and the path to the game's
``Content/Images`` folder for the "Full Armor + Player" previews.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

try:  # pragma: no cover - import guard only
    import wx
    import wx.adv
except ImportError as error:  # pragma: no cover
    raise SystemExit(
        "The graphical interface needs wxPython.\n"
        "    pip install wxPython\n"
        "or run the command line version instead:\n"
        "    python -m armorhelper --help"
    ) from error

from . import __version__
from .export import DEFAULT_TARGETS, TARGETS, ExportSettings, export_template
from .i18n import tr
from .layout import ArmorTemplateError, bundled_template, load_template, template_bytes
from .preview import find_images_dir
from .reverse import reverse_from_images
from .vanilla import all_sets, find_set

log = logging.getLogger("armorhelper")

CONFIG_NAME = "config.json"

#: The original tool recreated its template next to the executable on startup;
#: we do the same so the file is always easy to find.
TEMPLATE_NAME = "ArmorTemplate_v1.png"

FORUM_URL = (
    "https://forums.terraria.org/index.php?threads/"
    "armorhelper-sprite-armor-sets-30x-times-faster.68744/"
)

OK_COLOUR = wx.Colour(198, 246, 200)
STALE_COLOUR = wx.Colour(255, 236, 179)
BAD_COLOUR = wx.Colour(255, 205, 205)


class Entry:
    """One row in the input list."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.last_export: float | None = None


# --------------------------------------------------------------------------- #
# Small widgets
# --------------------------------------------------------------------------- #


class DropListCtrl(wx.ListCtrl):
    """A report list that accepts dragged image files."""

    def __init__(self, parent, on_files) -> None:
        super().__init__(parent, style=wx.LC_REPORT | wx.LC_SINGLE_SEL | wx.BORDER_SUNKEN)
        self.InsertColumn(0, tr("column.file"), width=250)
        self.InsertColumn(1, tr("column.export"), width=210)
        self.SetDropTarget(_FileDropTarget(on_files))

    def add(self, name: str) -> int:
        index = self.InsertItem(self.GetItemCount(), name)
        self.SetItem(index, 1, tr("state.never"))
        return index


class _FileDropTarget(wx.FileDropTarget):
    def __init__(self, on_files) -> None:
        super().__init__()
        self._on_files = on_files

    def OnDropFiles(self, x, y, filenames):  # noqa: N802 - wx naming
        self._on_files([Path(name) for name in filenames])
        return True


class ReverseDialog(wx.Dialog):
    """Ask for the vanilla armor ids to rebuild a template from."""

    def __init__(self, parent) -> None:
        super().__init__(parent, title=tr("reverse.title"), size=(460, 330))
        self.sets = [item for item in all_sets() if item.body is not None]

        panel = wx.Panel(self)
        root = wx.BoxSizer(wx.VERTICAL)

        root.Add(wx.StaticText(panel, label=tr("reverse.search")), 0, wx.LEFT | wx.TOP, 8)
        self.search = wx.TextCtrl(panel)
        self.search.Bind(wx.EVT_TEXT, lambda _e: self._fill_choices())
        root.Add(self.search, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        root.Add(wx.StaticText(panel, label=tr("reverse.pick")), 0, wx.LEFT | wx.TOP, 8)
        self.choice = wx.Choice(panel, choices=[])
        self.choice.Bind(wx.EVT_CHOICE, lambda _e: self._pick())
        root.Add(self.choice, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        grid = wx.FlexGridSizer(cols=2, vgap=6, hgap=8)
        grid.AddGrowableCol(1, 1)
        self.fields = {}
        for key, label_key in (
            ("head", "details.idHead"),
            ("body", "details.idBody"),
            ("legs", "details.idLegs"),
        ):
            ctrl = wx.TextCtrl(panel)
            self.fields[key] = ctrl
            grid.Add(wx.StaticText(panel, label=tr(label_key)), 0, wx.ALIGN_CENTER_VERTICAL)
            grid.Add(ctrl, 1, wx.EXPAND)
        root.Add(grid, 0, wx.EXPAND | wx.ALL, 8)

        root.Add(wx.StaticText(panel, label=tr("reverse.hint")), 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)
        buttons = wx.StdDialogButtonSizer()
        buttons.AddButton(wx.Button(panel, wx.ID_OK))
        buttons.AddButton(wx.Button(panel, wx.ID_CANCEL))
        buttons.Realize()
        root.Add(buttons, 0, wx.EXPAND | wx.ALL, 8)
        panel.SetSizer(root)

        self._fill_choices()
        if self.choice.GetCount():
            self.choice.SetSelection(0)
        self._pick()

    def _fill_choices(self) -> None:
        needle = self.search.GetValue().strip().lower().replace(" ", "")
        self.visible = [
            item
            for item in self.sets
            if not needle
            or needle in item.name.lower()
            or needle in str(item.body)
        ]
        self.choice.Set([f"{item.name}  ({item.body})" for item in self.visible])
        if self.visible:
            self.choice.SetSelection(0)

    def _pick(self) -> None:
        index = self.choice.GetSelection()
        if index == wx.NOT_FOUND or index >= len(self.visible):
            return
        item = self.visible[index]
        self.fields["head"].SetValue("" if item.head is None else str(item.head))
        self.fields["body"].SetValue(str(item.body))
        self.fields["legs"].SetValue("" if item.legs is None else str(item.legs))

    def values(self):
        def as_int(key):
            raw = self.fields[key].GetValue().strip()
            try:
                return int(raw) if raw else None
            except ValueError:
                return None

        return as_int("head"), as_int("body"), as_int("legs")


class StatusPanel(wx.Panel):
    """A one line status strip that can be coloured."""

    def __init__(self, parent) -> None:
        super().__init__(parent)
        self._label = wx.StaticText(self, label="")
        sizer = wx.BoxSizer(wx.HORIZONTAL)
        sizer.Add(self._label, 1, wx.ALIGN_CENTER_VERTICAL | wx.LEFT | wx.RIGHT, 8)
        self.SetSizer(sizer)

    def set(self, text: str, colour: wx.Colour) -> None:
        self._label.SetLabel(text)
        self.SetBackgroundColour(colour)
        self.Refresh()

    def text(self) -> str:
        return self._label.GetLabel()


# --------------------------------------------------------------------------- #
# Main window
# --------------------------------------------------------------------------- #


class ArmorHelperFrame(wx.Frame):
    def __init__(self) -> None:
        super().__init__(
            None,
            title=tr("app.title", version=__version__),
            size=(780, 600),
            style=wx.DEFAULT_FRAME_STYLE,
        )

        self.entries: list[Entry] = []
        self.working = False

        self._restore_template()
        self._build_menu()
        self._build()
        self.SetMinSize(wx.Size(740, 560))
        self.Centre()
        self._apply_icon()
        self.SetDropTarget(_FileDropTarget(self._add_paths))

        self._load_config()
        self._refresh()
        self.Bind(wx.EVT_CLOSE, self._on_close)

    # ------------------------------------------------------------------ ui --
    def _build_menu(self) -> None:
        file_menu = wx.Menu()
        file_menu.Append(wx.ID_OPEN, tr("menu.file.open"))
        file_menu.Append(wx.ID_SAVEAS, tr("menu.file.output"))
        file_menu.AppendSeparator()
        file_menu.Append(wx.ID_EXIT, tr("menu.file.quit"))

        self.template_id = wx.NewIdRef()
        template_menu = wx.Menu()
        template_menu.Append(self.template_id, tr("menu.template.save"))

        self.forum_id = wx.NewIdRef()
        help_menu = wx.Menu()
        help_menu.Append(wx.ID_ABOUT, tr("menu.help.about"))
        help_menu.Append(self.forum_id, tr("menu.help.forum"))

        bar = wx.MenuBar()
        bar.Append(file_menu, tr("menu.file"))
        bar.Append(template_menu, tr("menu.template"))
        bar.Append(help_menu, tr("menu.help"))
        self.SetMenuBar(bar)

        self.Bind(wx.EVT_MENU, lambda _e: self._choose_inputs(), id=wx.ID_OPEN)
        self.Bind(wx.EVT_MENU, lambda _e: self._choose_output(), id=wx.ID_SAVEAS)
        self.Bind(wx.EVT_MENU, lambda _e: self.Close(True), id=wx.ID_EXIT)
        self.Bind(wx.EVT_MENU, lambda _e: self._save_template(), id=self.template_id)
        self.Bind(wx.EVT_MENU, lambda _e: self._about(), id=wx.ID_ABOUT)
        self.Bind(wx.EVT_MENU, lambda _e: wx.LaunchDefaultBrowser(FORUM_URL), id=self.forum_id)

    def _build(self) -> None:
        panel = wx.Panel(self)
        root = wx.BoxSizer(wx.VERTICAL)

        columns = wx.BoxSizer(wx.HORIZONTAL)
        left = wx.BoxSizer(wx.VERTICAL)
        right = wx.BoxSizer(wx.VERTICAL)

        # --- 输入文件 ------------------------------------------------------- #
        inputs = wx.StaticBoxSizer(wx.VERTICAL, panel, tr("group.inputs"))
        self.input_list = DropListCtrl(panel, self._add_paths)
        inputs.Add(self.input_list, 1, wx.EXPAND | wx.ALL, 4)

        input_row = wx.BoxSizer(wx.HORIZONTAL)
        choose = wx.Button(panel, label=tr("button.choose"))
        remove = wx.Button(panel, label=tr("button.remove"))
        template = wx.Button(panel, label=tr("button.saveTemplate"))
        choose.Bind(wx.EVT_BUTTON, lambda _e: self._choose_inputs())
        remove.Bind(wx.EVT_BUTTON, lambda _e: self._remove_selected())
        template.Bind(wx.EVT_BUTTON, lambda _e: self._save_template())
        input_row.Add(choose, 0, wx.RIGHT, 4)
        input_row.Add(remove, 0, wx.RIGHT, 4)
        input_row.Add(template, 0)
        inputs.Add(input_row, 0, wx.ALL, 4)
        left.Add(inputs, 1, wx.EXPAND | wx.ALL, 6)

        # --- 输出目录 ------------------------------------------------------- #
        output = wx.StaticBoxSizer(wx.VERTICAL, panel, tr("group.output"))
        self.output_ctrl = wx.TextCtrl(panel, style=wx.TE_READONLY)
        output.Add(self.output_ctrl, 0, wx.EXPAND | wx.ALL, 4)
        output_button = wx.Button(panel, label=tr("button.choose"))
        output_button.Bind(wx.EVT_BUTTON, lambda _e: self._choose_output())
        output.Add(output_button, 0, wx.ALIGN_CENTER | wx.ALL, 4)
        left.Add(output, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 6)

        # --- 导出 ----------------------------------------------------------- #
        export = wx.StaticBoxSizer(wx.VERTICAL, panel, tr("group.export"))
        self.export_button = wx.Button(panel, label=tr("button.export"), size=(-1, 40))
        self.export_button.Bind(wx.EVT_BUTTON, lambda _e: self._export())
        export.Add(self.export_button, 0, wx.EXPAND | wx.ALL, 4)
        left.Add(export, 0, wx.EXPAND | wx.ALL, 6)

        # --- 选项 ----------------------------------------------------------- #
        options = wx.StaticBoxSizer(wx.VERTICAL, panel, tr("group.options"))
        self.target_box = wx.CheckListBox(
            panel, choices=[tr(f"target.{name}") for name in TARGETS], size=(-1, 210)
        )
        for index, name in enumerate(TARGETS):
            self.target_box.Check(index, name in DEFAULT_TARGETS)
        self.target_box.Bind(wx.EVT_CHECKLISTBOX, lambda _e: self._on_options_changed())
        options.Add(self.target_box, 1, wx.EXPAND | wx.ALL, 4)
        right.Add(options, 1, wx.EXPAND | wx.ALL, 6)

        # --- 详情 ----------------------------------------------------------- #
        details = wx.StaticBoxSizer(wx.VERTICAL, panel, tr("group.details"))
        grid = wx.FlexGridSizer(cols=2, vgap=6, hgap=8)
        grid.AddGrowableCol(1, 1)

        self.glow_check = wx.CheckBox(panel, label=tr("details.glow"))
        self.glow_check.Bind(wx.EVT_CHECKBOX, lambda _e: self._on_options_changed())
        grid.Add(wx.StaticText(panel, label=""), 0)
        grid.Add(self.glow_check, 1, wx.EXPAND)

        self.skin_spin = wx.SpinCtrl(panel, min=0, max=9, initial=0, size=(70, -1))
        grid.Add(wx.StaticText(panel, label=tr("details.skin")), 0, wx.ALIGN_CENTER_VERTICAL)
        grid.Add(self.skin_spin, 0)

        for key, label_key in (
            ("id_head", "details.idHead"),
            ("id_body", "details.idBody"),
            ("id_legs", "details.idLegs"),
        ):
            ctrl = wx.TextCtrl(panel, size=(70, -1))
            setattr(self, key, ctrl)
            grid.Add(wx.StaticText(panel, label=tr(label_key)), 0, wx.ALIGN_CENTER_VERTICAL)
            grid.Add(ctrl, 0)
        details.Add(grid, 0, wx.EXPAND | wx.ALL, 4)

        self.images_ctrl = wx.TextCtrl(panel, style=wx.TE_READONLY)
        images_button = wx.Button(panel, label=tr("button.images"))
        images_button.Bind(wx.EVT_BUTTON, lambda _e: self._choose_images())
        details.Add(wx.StaticText(panel, label=tr("details.images")), 0, wx.ALL, 4)
        details.Add(self.images_ctrl, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 4)
        details.Add(images_button, 0, wx.ALIGN_RIGHT | wx.ALL, 4)
        right.Add(details, 0, wx.EXPAND | wx.ALL, 6)

        reverse = wx.StaticBoxSizer(wx.VERTICAL, panel, tr("group.reverse"))
        self.reverse_button = wx.Button(panel, label=tr("button.reverse"))
        self.reverse_button.Bind(wx.EVT_BUTTON, lambda _e: self._reverse())
        reverse.Add(self.reverse_button, 0, wx.EXPAND | wx.ALL, 4)
        right.Add(reverse, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 6)

        columns.Add(left, 1, wx.EXPAND)
        columns.Add(right, 0, wx.EXPAND)
        root.Add(columns, 1, wx.EXPAND)

        self.status = StatusPanel(panel)
        root.Add(self.status, 0, wx.EXPAND)

        panel.SetSizer(root)
        self.status.set(tr("status.ready"), OK_COLOUR)

    def _apply_icon(self) -> None:
        try:
            from PIL import Image

            template = bundled_template()
            head = template.crop((1, 19, 21, 47)).resize((80, 112), Image.NEAREST)
            bitmap = wx.Bitmap.FromBufferRGBA(80, 112, head.tobytes())
            icon = wx.Icon()
            icon.CopyFromBitmap(bitmap)
            self.SetIcon(icon)
        except Exception:  # noqa: BLE001 - purely cosmetic
            log.debug("could not build the window icon", exc_info=True)

    def _restore_template(self) -> None:
        """Recreate the drawing template in the working directory (like v1 did)."""
        path = Path(TEMPLATE_NAME)
        if path.exists():
            return
        try:
            path.write_bytes(template_bytes())
        except OSError:
            log.debug("could not restore %s", TEMPLATE_NAME, exc_info=True)

    # ------------------------------------------------------------- inputs --
    def _choose_inputs(self) -> None:
        with wx.FileDialog(
            self,
            tr("dialog.chooseInputs"),
            wildcard=tr("dialog.imagesFilter"),
            style=wx.FD_OPEN | wx.FD_MULTIPLE | wx.FD_FILE_MUST_EXIST,
        ) as dialog:
            if dialog.ShowModal() == wx.ID_OK:
                self._add_paths([Path(name) for name in dialog.GetPaths()])

    def _add_paths(self, paths) -> None:
        known = {entry.path for entry in self.entries}
        for path in paths:
            path = Path(path)
            if path in known:
                continue
            self.entries.append(Entry(path))
            self.input_list.add(path.name)
            known.add(path)
        self._save_config()
        self._refresh()

    def _remove_selected(self) -> None:
        index = self.input_list.GetFirstSelected()
        if index == wx.NOT_FOUND:
            return
        self.input_list.DeleteItem(index)
        del self.entries[index]
        self._set_status(tr("status.removed"), STALE_COLOUR)
        self._refresh()

    def _save_template(self) -> None:
        with wx.FileDialog(
            self,
            tr("dialog.saveTemplate"),
            defaultFile=TEMPLATE_NAME,
            wildcard="PNG (*.png)|*.png",
            style=wx.FD_SAVE | wx.FD_OVERWRITE_PROMPT,
        ) as dialog:
            if dialog.ShowModal() != wx.ID_OK:
                return
            target = Path(dialog.GetPath())
            target.write_bytes(template_bytes())
        self._set_status(tr("status.templateSaved", path=target), STALE_COLOUR)

    def _choose_output(self) -> None:
        with wx.DirDialog(self, tr("dialog.chooseOutput"), style=wx.DD_DEFAULT_STYLE) as dialog:
            if dialog.ShowModal() == wx.ID_OK:
                self.output_ctrl.SetValue(dialog.GetPath())
                self._save_config()
                self._refresh()

    def _choose_images(self) -> None:
        with wx.DirDialog(self, tr("dialog.chooseImages")) as dialog:
            if dialog.ShowModal() == wx.ID_OK:
                self.images_ctrl.SetValue(dialog.GetPath())
                self._save_config()
                self._refresh()

    # -------------------------------------------------------------- state --
    def _set_status(self, text: str, colour: wx.Colour) -> None:
        self.status.set(text, colour)

    def _on_options_changed(self) -> None:
        self._save_config()
        self._refresh()

    def _refresh(self) -> None:
        targets = self._selected_targets()
        output = self.output_ctrl.GetValue()
        output_ok = bool(output) and Path(output).is_dir()

        self.export_button.Enable(
            bool(targets) and output_ok and bool(self.entries) and not self.working
        )
        self.export_button.SetLabel(tr("button.working") if self.working else tr("button.export"))

        if self.working:
            return

        now = time.time()
        for index, entry in enumerate(self.entries):
            if not entry.path.exists():
                state, colour = tr("state.missing"), BAD_COLOUR
            elif entry.last_export is None:
                state, colour = tr("state.never"), STALE_COLOUR
            else:
                elapsed = int(now - entry.last_export)
                state = tr("state.ago", seconds=elapsed)
                colour = STALE_COLOUR if elapsed >= 30 else OK_COLOUR
            self.input_list.SetItem(index, 1, state)
            self.input_list.SetItemBackgroundColour(index, colour)

        needs_player = any("player" in target for target in targets)
        images = self.images_ctrl.GetValue()
        player_ok = bool(images) and Path(images).is_dir()

        if not output_ok:
            self._set_status(tr("status.noOutput"), BAD_COLOUR)
        elif not self.entries:
            self._set_status(tr("status.noInput"), BAD_COLOUR)
        elif not targets:
            self._set_status(tr("status.noTarget"), BAD_COLOUR)
        elif needs_player and not player_ok:
            self._set_status(tr("status.needImages"), STALE_COLOUR)
        else:
            self._set_status(tr("status.ready"), OK_COLOUR)

    def _selected_targets(self) -> tuple[str, ...]:
        return tuple(
            name for index, name in enumerate(TARGETS) if self.target_box.IsChecked(index)
        )

    def _settings(self) -> ExportSettings:
        def as_id(ctrl: wx.TextCtrl) -> int | None:
            raw = ctrl.GetValue().strip()
            try:
                return int(raw) if raw else None
            except ValueError:
                return None

        ids = {
            "id_head": as_id(self.id_head),
            "id_body": as_id(self.id_body),
            "id_legs": as_id(self.id_legs),
        }
        if ids["id_body"] is not None:
            for key in ("id_head", "id_legs"):
                if ids[key] is None:
                    ids[key] = ids["id_body"]

        images = self.images_ctrl.GetValue().strip()
        return ExportSettings(
            output_dir=Path(self.output_ctrl.GetValue() or "."),
            targets=self._selected_targets(),
            glow_rows=4 if self.glow_check.GetValue() else 0,
            images_dir=Path(images) if images else None,
            skin=self.skin_spin.GetValue(),
            **ids,
        )

    # ------------------------------------------------------------- export --
    def _export(self) -> None:
        if self.working:
            return
        settings = self._settings()
        self.working = True
        self._refresh()
        self._set_status(tr("status.working"), STALE_COLOUR)
        threading.Thread(target=self._export_worker, args=(settings,), daemon=True).start()

    def _export_worker(self, settings: ExportSettings) -> None:
        errors: list[str] = []
        for entry in list(self.entries):
            try:
                template = load_template(entry.path)
                export_template(template, entry.path.stem, settings)
                entry.last_export = time.time()
            except ArmorTemplateError as error:
                errors.append(f"{entry.path.name}: {error}")
            except Exception as error:  # noqa: BLE001 - never kill the UI thread
                log.exception("export failed for %s", entry.path)
                errors.append(f"{entry.path.name}: {error}")
        wx.CallAfter(self._export_done, errors)

    def _export_done(self, errors: list[str]) -> None:
        self.working = False
        self._refresh()
        self._save_config()
        if errors:
            self._set_status(errors[0], BAD_COLOUR)
            wx.MessageBox("\n".join(errors), tr("dialog.error"), wx.OK | wx.ICON_ERROR, self)
        else:
            self._set_status(tr("status.done"), OK_COLOUR)

    # ------------------------------------------------------------- reverse --
    def _reverse(self) -> None:
        images = self.images_ctrl.GetValue().strip()
        if not images or not Path(images).is_dir():
            wx.MessageBox(tr("reverse.noImages"), tr("dialog.error"), wx.OK | wx.ICON_WARNING, self)
            return

        dialog = ReverseDialog(self)
        try:
            if dialog.ShowModal() != wx.ID_OK:
                return
            head, body, legs = dialog.values()
        finally:
            dialog.Destroy()

        if body is None:
            wx.MessageBox(tr("reverse.badBody"), tr("dialog.error"), wx.OK | wx.ICON_WARNING, self)
            return

        guessed = find_set(body=body)
        name = (guessed.name if guessed and guessed.body == body else None) or str(body)

        with wx.FileDialog(
            self,
            tr("reverse.save"),
            defaultFile=f"ArmorTemplate_{name}_{body}.png",
            wildcard="PNG (*.png)|*.png",
            style=wx.FD_SAVE | wx.FD_OVERWRITE_PROMPT,
        ) as save:
            if save.ShowModal() != wx.ID_OK:
                return
            target = Path(save.GetPath())

        try:
            result = reverse_from_images(images, body=body, head=head, legs=legs, set_name=name)
        except Exception as error:  # noqa: BLE001 - report, never crash
            log.exception("reverse failed")
            wx.MessageBox(
                tr("reverse.failed", error=error), tr("dialog.error"), wx.OK | wx.ICON_ERROR, self
            )
            return

        target.parent.mkdir(parents=True, exist_ok=True)
        result.template.save(target, "PNG")
        self._add_paths([target])
        if result.warnings:
            self._set_status(result.warnings[0], STALE_COLOUR)
        else:
            self._set_status(tr("reverse.done", path=target), OK_COLOUR)

    # --------------------------------------------------------------- misc --
    def _about(self) -> None:
        info = wx.adv.AboutDialogInfo()
        info.SetName(tr("about.name"))
        info.SetVersion(__version__)
        info.SetDescription(tr("about.description"))
        info.SetWebSite(FORUM_URL, tr("about.website"))
        info.AddDeveloper(tr("about.author"))
        wx.adv.AboutBox(info)

    # ------------------------------------------------------------- config --
    def _save_config(self) -> None:
        config = {
            "exportFolder": self.output_ctrl.GetValue(),
            "imagesFolder": self.images_ctrl.GetValue(),
            "glow": bool(self.glow_check.GetValue()),
            "skin": self.skin_spin.GetValue(),
            "exportCheckbox": {
                name: self.target_box.IsChecked(index) for index, name in enumerate(TARGETS)
            },
            "ids": {
                "id_head": self.id_head.GetValue(),
                "id_body": self.id_body.GetValue(),
                "id_legs": self.id_legs.GetValue(),
            },
        }
        try:
            Path(CONFIG_NAME).write_text(json.dumps(config, indent=4), encoding="utf-8")
        except OSError:
            log.debug("could not write %s", CONFIG_NAME, exc_info=True)

    def _load_config(self) -> None:
        path = Path(CONFIG_NAME)
        if path.exists():
            try:
                config = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                config = {}

            for key, ctrl in (
                ("exportFolder", self.output_ctrl),
                ("imagesFolder", self.images_ctrl),
            ):
                value = config.get(key) or ""
                if value:
                    ctrl.SetValue(value)
            self.glow_check.SetValue(bool(config.get("glow", False)))
            try:
                self.skin_spin.SetValue(int(config.get("skin", 0)))
            except (TypeError, ValueError):
                pass

            for name, checked in (config.get("exportCheckbox") or {}).items():
                if name in TARGETS:
                    self.target_box.Check(TARGETS.index(name), bool(checked))
            for key, ctrl in (
                ("id_head", self.id_head),
                ("id_body", self.id_body),
                ("id_legs", self.id_legs),
            ):
                value = (config.get("ids") or {}).get(key)
                if value:
                    ctrl.SetValue(str(value))

        if not self.images_ctrl.GetValue():
            detected = find_images_dir()
            if detected:
                self.images_ctrl.SetValue(str(detected))

        if not self.output_ctrl.GetValue():
            detected_output = find_images_dir()
            if detected_output:
                self.output_ctrl.SetValue(str(detected_output))

    def _on_close(self, event) -> None:
        self._save_config()
        event.Skip()


def run() -> int:
    """Entry point used by ``python -m armorhelper gui`` and ``armorhelper-gui``."""
    app = wx.App(False)
    frame = ArmorHelperFrame()
    frame.Show()
    app.MainLoop()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(run())
