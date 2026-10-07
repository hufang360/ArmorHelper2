"""Tiny translation layer for the graphical interface.

Chinese is the default; English is kept for anyone who wants the original
wording.  Override with ``ARMORHELPER_LANG=en`` or ``--lang en``.

Only user facing strings live here.  Log messages, the command line help and
the generated file names stay in English so that scripts and bug reports remain
comparable across languages.
"""

from __future__ import annotations

import os

__all__ = ["LANGUAGES", "DEFAULT_LANGUAGE", "set_language", "get_language", "tr", "TARGET_LABELS"]

LANGUAGES = ("zh_CN", "en")
DEFAULT_LANGUAGE = "zh_CN"

MESSAGES: dict[str, dict[str, str]] = {
    "zh_CN": {
        # ---- window / menus ------------------------------------------------
        "app.title": "ArmorHelper {version} — 泰拉护甲贴图生成",
        "menu.file": "文件(&F)",
        "menu.file.open": "添加输入图片...\tCtrl+O",
        "menu.file.output": "选择输出目录...\tCtrl+Shift+O",
        "menu.file.quit": "退出\tCtrl+Q",
        "menu.template": "模板(&T)",
        "menu.template.save": "保存绘制模板...",
        "menu.help": "帮助(&H)",
        "menu.help.about": "关于",
        "menu.help.forum": "论坛原帖",
        # ---- groups / columns ---------------------------------------------
        "group.inputs": "输入文件",
        "group.output": "输出目录",
        "group.export": "导出",
        "group.options": "选项",
        "group.details": "详情",
        "column.file": "文件",
        "column.export": "上次导出",
        # ---- buttons ------------------------------------------------------
        "button.choose": "选择...",
        "button.remove": "移除",
        "button.saveTemplate": "保存模板...",
        "button.export": "导出",
        "button.working": "处理中...",
        "button.images": "泰拉贴图目录...",
        # ---- details ------------------------------------------------------
        "details.glow": "生成发光遮罩 (360×448)",
        "details.skin": "玩家肤色:",
        "details.idHead": "头部 ID:",
        "details.idBody": "身体 ID:",
        "details.idLegs": "腿部 ID:",
        "details.images": "预览所需玩家贴图（Content/Images）:",
        # ---- targets ------------------------------------------------------
        "target.head": "头部贴图 (Armor_Head)",
        "target.legs": "腿部贴图 (Armor_Legs)",
        "target.body": "身体贴图（1.4.4+ 复合格式）",
        "target.legacy": "身体 / 手臂贴图（1.3 旧格式）",
        "target.full": "全身护甲",
        "target.full-female": "全身护甲（女性）",
        "target.full-player": "全身护甲 + 玩家",
        "target.full-player-female": "全身护甲 + 玩家（女性）",
        "target.gif-full": "GIF 全身护甲",
        "target.gif-full-female": "GIF 全身护甲（女性）",
        "target.gif-full-player": "GIF 全身护甲 + 玩家",
        "target.gif-full-player-female": "GIF 全身护甲 + 玩家（女性）",
        # ---- input list state ---------------------------------------------
        "state.missing": "文件不存在",
        "state.never": "从未导出",
        "state.ago": "上次导出于 {seconds} 秒前",
        # ---- status -------------------------------------------------------
        "status.ready": "就绪。",
        "status.noOutput": "输出目录不存在。",
        "status.noInput": "请至少添加一张输入图片。",
        "status.noTarget": "请至少勾选一个选项。",
        "status.needImages": "「全身护甲 + 玩家」预览需要指向泰拉的 Content/Images 目录。",
        "status.working": "正在处理...",
        "status.done": "完成。",
        "status.templateSaved": "模板已保存到 {path}",
        "status.removed": "已移除 1 个文件。",
        # ---- dialogs ------------------------------------------------------
        "dialog.chooseInputs": "选择输入图片...",
        "dialog.imagesFilter": "图片 (*.png;*.bmp)|*.png;*.bmp|所有文件 (*.*)|*.*",
        "dialog.saveTemplate": "保存绘制模板",
        "dialog.chooseOutput": "选择输出目录",
        "dialog.chooseImages": "选择泰拉的 Content/Images 目录",
        "dialog.error": "ArmorHelper 出错了",
        "about.name": "ArmorHelper",
        "about.description": (
            "Mirsario 的 ArmorHelper 的 Python 重写版，\n"
            "已适配泰拉 1.4.4+ 的复合玩家贴图格式。\n\n"
            "模板画法与工作流程与原版完全一致。"
        ),
        "about.website": "原版论坛帖",
        "about.author": "原工具与模板美术：Mirsario",
        "template.restored": "已在当前目录生成模板：{path}",
    },
    "en": {
        "app.title": "ArmorHelper {version} — Terraria armor sheet generator",
        "menu.file": "&File",
        "menu.file.open": "&Add input files...\tCtrl+O",
        "menu.file.output": "Choose &output folder...\tCtrl+Shift+O",
        "menu.file.quit": "&Quit\tCtrl+Q",
        "menu.template": "&Template",
        "menu.template.save": "Save drawing &template...",
        "menu.help": "&Help",
        "menu.help.about": "&About",
        "menu.help.forum": "Forum page",
        "group.inputs": "Input Files",
        "group.output": "Output Folder",
        "group.export": "Export",
        "group.options": "Options",
        "group.details": "Details",
        "column.file": "File",
        "column.export": "Last export",
        "button.choose": "Choose...",
        "button.remove": "Remove",
        "button.saveTemplate": "Save template...",
        "button.export": "Export",
        "button.working": "Working...",
        "button.images": "Terraria Images...",
        "details.glow": "Write a glow mask (360x448)",
        "details.skin": "Player skin:",
        "details.idHead": "Head id:",
        "details.idBody": "Body id:",
        "details.idLegs": "Legs id:",
        "details.images": "Player textures for the previews (Content/Images):",
        "target.head": "Head sheet  (Armor_Head)",
        "target.legs": "Legs sheet  (Armor_Legs)",
        "target.body": "Body sheet  (composite, 1.4.4+)",
        "target.legacy": "Body / Arms sheets  (1.3 legacy)",
        "target.full": "Full Armor",
        "target.full-female": "Full Armor (Female)",
        "target.full-player": "Full Armor + Player",
        "target.full-player-female": "Full Armor + Player (Female)",
        "target.gif-full": "GIF Full Armor",
        "target.gif-full-female": "GIF Full Armor (Female)",
        "target.gif-full-player": "GIF Full Armor + Player",
        "target.gif-full-player-female": "GIF Full Armor + Player (Female)",
        "state.missing": "missing",
        "state.never": "Never exported",
        "state.ago": "Last export was {seconds}s ago",
        "status.ready": "Ready.",
        "status.noOutput": "Output folder does not exist.",
        "status.noInput": "Add at least one input image.",
        "status.noTarget": "Tick at least one option.",
        "status.needImages": "The 'Full Armor + Player' outputs need a Terraria Content/Images folder.",
        "status.working": "Working...",
        "status.done": "Done.",
        "status.templateSaved": "Template saved to {path}",
        "status.removed": "Removed 1 file.",
        "dialog.chooseInputs": "Choose Input Files...",
        "dialog.imagesFilter": "Images (*.png;*.bmp)|*.png;*.bmp|All files (*.*)|*.*",
        "dialog.saveTemplate": "Save the drawing template",
        "dialog.chooseOutput": "Choose Output Folder",
        "dialog.chooseImages": "Choose Terraria's Content/Images folder",
        "dialog.error": "ArmorHelper error",
        "about.name": "ArmorHelper",
        "about.description": (
            "Python port of Mirsario's ArmorHelper, updated for the\n"
            "Terraria 1.4.4+ composite player textures.\n\n"
            "The template drawing and workflow are unchanged."
        ),
        "about.website": "Original forum thread",
        "about.author": "Original tool and template art: Mirsario",
        "template.restored": "Wrote the drawing template to {path}",
    },
}

#: Target key -> translation key.  The order matches ``export.TARGETS``.
TARGET_LABELS: dict[str, str] = {
    "head": "target.head",
    "legs": "target.legs",
    "body": "target.body",
    "legacy": "target.legacy",
    "full": "target.full",
    "full-female": "target.full-female",
    "full-player": "target.full-player",
    "full-player-female": "target.full-player-female",
    "gif-full": "target.gif-full",
    "gif-full-female": "target.gif-full-female",
    "gif-full-player": "target.gif-full-player",
    "gif-full-player-female": "target.gif-full-player-female",
}

_current = DEFAULT_LANGUAGE


def _normalise(code: str | None) -> str:
    if not code:
        return DEFAULT_LANGUAGE
    code = code.replace("-", "_")
    if code in MESSAGES:
        return code
    short = code.split("_")[0]
    for language in MESSAGES:
        if language.split("_")[0] == short:
            return language
    return DEFAULT_LANGUAGE


def set_language(code: str | None) -> str:
    """Select the interface language, returning the one actually used."""
    global _current
    _current = _normalise(code)
    return _current


def get_language() -> str:
    return _current


def tr(key: str, **kwargs) -> str:
    """Translate ``key``; unknown keys fall back to the key itself."""
    table = MESSAGES.get(_current, MESSAGES[DEFAULT_LANGUAGE])
    text = table.get(key) or MESSAGES[DEFAULT_LANGUAGE].get(key) or key
    return text.format(**kwargs) if kwargs else text


# Pick up the environment variable at import time.
set_language(os.environ.get("ARMORHELPER_LANG"))
