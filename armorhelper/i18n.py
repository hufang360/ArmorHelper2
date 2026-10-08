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
        "app.title": "ArmorHelper {version} — 泰拉盔甲贴图生成",
        "menu.file": "文件(&F)",
        "menu.file.open": "添加输入图片...\tCtrl+O",
        "menu.file.output": "选择输出目录...\tCtrl+Shift+O",
        "menu.file.quit": "退出\tCtrl+Q",
        "menu.template": "模板(&T)",
        "menu.template.save": "保存绘制模板...",
        "menu.view": "视图(&V)",
        "menu.language": "界面语言",
        "menu.help": "帮助(&H)",
        "menu.help.about": "关于",
        "menu.help.forum": "论坛原帖",
        # ---- groups / columns ---------------------------------------------
        "group.inputs": "输入文件",
        "group.output": "输出目录",
        "group.export": "导出",
        "group.options": "选项",
        "group.details": "详情",
        "group.reverse": "反向还原",
        "column.file": "文件",
        "column.export": "上次导出",
        # ---- buttons ------------------------------------------------------
        "button.choose": "选择...",
        "button.remove": "移除",
        "button.saveTemplate": "保存模板...",
        "button.export": "导出",
        "button.working": "处理中...",
        "button.images": "泰拉贴图目录...",
        "button.reverse": "从原版 ID 还原模板...",
        "button.reverseAll": "还原全部套装...",
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
        "target.full": "全身盔甲",
        "target.full-female": "全身盔甲（女性）",
        "target.full-player": "全身盔甲 + 玩家",
        "target.full-player-female": "全身盔甲 + 玩家（女性）",
        "target.gif-full": "GIF 全身盔甲",
        "target.gif-full-female": "GIF 全身盔甲（女性）",
        "target.gif-full-player": "GIF 全身盔甲 + 玩家",
        "target.gif-full-player-female": "GIF 全身盔甲 + 玩家（女性）",
        # ---- input list state ---------------------------------------------
        "state.missing": "文件不存在",
        "state.never": "从未导出",
        "state.ago": "上次导出于 {seconds} 秒前",
        # ---- status -------------------------------------------------------
        "status.ready": "就绪。",
        "status.noOutput": "输出目录不存在。",
        "status.noInput": "请至少添加一张输入图片。",
        "status.noTarget": "请至少勾选一个选项。",
        "status.needImages": "「全身盔甲 + 玩家」预览需要指向泰拉的 Content/Images 目录。",
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
        # ---- web -----------------------------------------------------------
        "web.subtitle": "泰拉盔甲贴图工具 · 网页版",
        "web.tab.export": "导出贴图",
        "web.tab.reverse": "反向还原",
        "web.tab.settings": "设置",
        "web.drop": "把 128×80 的绘制模板拖到这里，或点击选择（可多选）",
        "web.dropActive": "松手即可添加",
        "web.downloadTemplate": "下载绘制模板",
        "web.downloadTemplateHint": "下载的模板会叠加上参考线（可在「预览选项」里关掉）",
        "web.selected": "已选 {count} 个文件",
        "web.clear": "清空",
        "web.options": "导出选项",
        "web.previewOptions": "预览选项",
        "web.female": "女性版本",
        "web.player": "叠加玩家",
        "web.export": "开始导出",
        "web.exporting": "正在导出...",
        "web.results": "导出结果",
        "web.downloadAll": "打包下载 (zip)",
        "web.written": "已写入输出目录：",
        "web.previewSheet": "20 帧预览",
        "web.previewTemplate": "绘制模板 (128×80)",
        "web.previewFrames": "生成效果 (20 帧)",
        "web.previewGif": "GIF 动画",
        "web.reverseTitle": "从原版盔甲还原模板",
        "web.reverseSet": "盔甲套",
        "web.reverseSearch": "搜索中文名 / 英文名 / ID",
        "web.reverseDo": "还原这一套",
        "web.reverseAll": "还原全部套装",
        "web.reverseAllHint": "把贴图齐全的套装全部还原到「输出目录/ArmorTemplate」",
        "web.idsHint": "身体 ID 必填；头/腿留空时按套装表自动查找。",
        "web.browse": "浏览...",
        "web.cancel": "取消",
        "web.browseTitle": "选择目录",
        "web.browseUp": "上一层",
        "web.browseUse": "使用此目录",
        "web.detect": "自动探测",
        "web.settingsTitle": "设置",
        "web.saveSettings": "保存设置",
        "web.saved": "设置已保存",
        "web.connected": "已连接",
        "web.jobFiles": "生成的文件",
        "web.empty": "还没有内容。",
        "web.working": "处理中...",
        "web.playerHint": "需要在「设置」里选择泰拉 Content/Images 目录（含 Player_0_3.png 等），或先上传玩家贴图。",
        "web.textureSource": "原版贴图来源",
        "web.pickImages": "选择 Content/Images 目录",
        "web.pickFiles": "或选择贴图文件...",
        "web.pickOutput": "选择输出目录",
        "web.clearOutput": "清除",
        "web.outputFolder": "输出目录（可直接指向游戏 Content/Images）",
        "web.verify": "生成后做往返自检（反推模板再重新生成，应与原贴图一致）",
        "web.guideOverlay": "模板预览叠加参考线",
        "web.builtinTextures": "使用内置贴图：{version} · {count} 张",
        "web.noSets": "套装表加载失败：data/armor_sets.json 读不到或内容不对。请确认通过静态服务器打开（不能直接双击 index.html）。",
        "web.stalePage": "页面与脚本版本不一致（缺少：{selectors}）。请强制刷新（Cmd/Ctrl+Shift+R）后再试。",
        "web.usingFolder": "使用文件夹：{name}",
        "web.usingUploads": "使用上传的 {count} 个文件",
        "web.noFolderSupport": "当前浏览器不支持直接写入文件夹，请用下载 / 打包下载。Chrome / Edge 支持。",
        "web.needTextures": "请先选择 Content/Images 目录或上传贴图文件。",
        "web.needOutput": "请先在「设置」里选择输出目录。",
        "web.savedTo": "已写入 {count} 个文件到输出目录",
        "web.zip": "打包下载 (zip)",
        "web.files": "文件",
        "web.previews": "预览",
        "web.rebuilt": "已还原 {count} 套盔甲",
        "web.dropped": "不是 128×80 的模板图：{name}",
        "web.outputName": "输出目录：{name}",
        # ---- reverse ------------------------------------------------------
        "reverse.title": "从原版盔甲还原模板",
        "reverse.pick": "盔甲套：",
        "reverse.hint": "身体 ID 必填；头/腿留空时按原版命名或套装加成自动查找。\n还原结果会写入上面的「输出目录」。",
        "reverse.search": "搜索：",
        "reverse.noImages": "请先在「详情」里选择泰拉的 Content/Images 目录。",
        "reverse.badBody": "请输入有效的身体 ID。",
        "reverse.save": "保存还原出的模板",
        "reverse.overwrite": "{name}\n\n该文件已存在，要覆盖吗？",
        "reverse.overwriteTitle": "覆盖确认",
        "reverse.failed": "还原失败：{error}",
        "reverse.done": "已还原模板：{path}",
        "reverse.unknown": "（未知）",
        # ---- reverse all ---------------------------------------------------
        "reverse.allTitle": "还原全部套装",
        "reverse.allNone": "在 {dir} 里没有找到可还原的盔甲贴图。",
        "reverse.allConfirm": "将还原 {count} 套盔甲到：\n{dir}\n\n已存在的同名文件会被覆盖，是否继续？",
        "reverse.allProgress": "正在还原 {index}/{total}：{name}",
        "reverse.allDone": "已还原 {count} 套盔甲到 {dir}",
        "reverse.allDoneOpen": "已还原 {count} 套盔甲到：\n{dir}\n\n是否打开该目录？",
        "reverse.allFailed": "{count} 套还原失败，详见控制台日志。",
    },
    "en": {
        "app.title": "ArmorHelper {version} — Terraria armor sheet generator",
        "menu.file": "&File",
        "menu.file.open": "&Add input files...\tCtrl+O",
        "menu.file.output": "Choose &output folder...\tCtrl+Shift+O",
        "menu.file.quit": "&Quit\tCtrl+Q",
        "menu.template": "&Template",
        "menu.template.save": "Save drawing &template...",
        "menu.view": "&View",
        "menu.language": "Interface language",
        "menu.help": "&Help",
        "menu.help.about": "&About",
        "menu.help.forum": "Forum page",
        "group.inputs": "Input Files",
        "group.output": "Output Folder",
        "group.export": "Export",
        "group.options": "Options",
        "group.details": "Details",
        "group.reverse": "Reverse",
        "column.file": "File",
        "column.export": "Last export",
        "button.choose": "Choose...",
        "button.remove": "Remove",
        "button.saveTemplate": "Save template...",
        "button.export": "Export",
        "button.working": "Working...",
        "button.images": "Terraria Images...",
        "button.reverse": "Rebuild template from ids...",
        "button.reverseAll": "Rebuild every set...",
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
        "web.subtitle": "Terraria armor sheets, in the browser",
        "web.tab.export": "Export",
        "web.tab.reverse": "Reverse",
        "web.tab.settings": "Settings",
        "web.drop": "Drop a 128x80 template here, or click to choose (multiple allowed)",
        "web.dropActive": "Release to add",
        "web.downloadTemplate": "Download the drawing template",
        "web.downloadTemplateHint": "The downloaded template has the guide overlay drawn on it (toggle it in Preview options)",
        "web.selected": "{count} file(s) selected",
        "web.clear": "Clear",
        "web.options": "What to export",
        "web.previewOptions": "Preview options",
        "web.female": "Female",
        "web.player": "Draw the player",
        "web.export": "Export",
        "web.exporting": "Exporting...",
        "web.results": "Results",
        "web.downloadAll": "Download all (zip)",
        "web.written": "Also written to the output folder:",
        "web.previewSheet": "20 frame preview",
        "web.previewTemplate": "Drawing template (128x80)",
        "web.previewFrames": "Result (20 frames)",
        "web.previewGif": "GIF animation",
        "web.reverseTitle": "Rebuild a template from vanilla armor",
        "web.reverseSet": "Armor set",
        "web.reverseSearch": "Search Chinese / English name or id",
        "web.reverseDo": "Rebuild this set",
        "web.reverseAll": "Rebuild every set",
        "web.reverseAllHint": "Writes every complete set into <output>/ArmorTemplate",
        "web.idsHint": "The body id is required; head/legs are looked up when left empty.",
        "web.browse": "Browse...",
        "web.cancel": "Cancel",
        "web.browseTitle": "Choose a folder",
        "web.browseUp": "Up",
        "web.browseUse": "Use this folder",
        "web.detect": "Detect",
        "web.settingsTitle": "Settings",
        "web.saveSettings": "Save settings",
        "web.saved": "Settings saved",
        "web.connected": "Connected",
        "web.jobFiles": "Generated files",
        "web.empty": "Nothing here yet.",
        "web.working": "Working...",
        "web.playerHint": "Pick your Terraria Content/Images folder in Settings (it holds Player_0_3.png), or upload the player textures.",
        "web.textureSource": "Vanilla textures",
        "web.pickImages": "Choose Content/Images",
        "web.pickFiles": "or pick texture files...",
        "web.pickOutput": "Choose output folder",
        "web.clearOutput": "Clear",
        "web.outputFolder": "Output folder (point it at the game's Content/Images)",
        "web.verify": "Round trip self check after export (rebuild the template, regenerate, compare)",
        "web.guideOverlay": "Draw the guide overlay on template previews",
        "web.builtinTextures": "Using the bundled textures: {version} · {count} files",
        "web.noSets": "The armor set table failed to load: data/armor_sets.json is missing or invalid. Make sure the page is served over HTTP, not opened from disk.",
        "web.stalePage": "The page and the scripts are out of step (missing: {selectors}). Hard reload (Cmd/Ctrl+Shift+R) and try again.",
        "web.usingFolder": "Using the folder: {name}",
        "web.usingUploads": "Using {count} uploaded file(s)",
        "web.noFolderSupport": "This browser cannot write to a folder; use the download / zip buttons instead. Chrome and Edge can.",
        "web.needTextures": "Choose a Content/Images folder or upload texture files first.",
        "web.needOutput": "Choose an output folder in Settings first.",
        "web.savedTo": "Wrote {count} file(s) to the output folder",
        "web.zip": "Download all (zip)",
        "web.files": "Files",
        "web.previews": "Preview",
        "web.rebuilt": "Rebuilt {count} armor sets",
        "web.dropped": "Not a 128x80 template: {name}",
        "web.outputName": "Output folder: {name}",
        "reverse.title": "Rebuild a template from vanilla armor",
        "reverse.pick": "Armor set:",
        "reverse.hint": "The body id is required; head/legs are looked up when left empty.\nThe template is written to the Output Folder above.",
        "reverse.search": "Search:",
        "reverse.noImages": "Choose Terraria's Content/Images folder first (Details panel).",
        "reverse.badBody": "Enter a valid body id.",
        "reverse.save": "Save the rebuilt template",
        "reverse.overwrite": "{name}\n\nThis file already exists. Overwrite it?",
        "reverse.overwriteTitle": "Overwrite?",
        "reverse.failed": "Reverse failed: {error}",
        "reverse.done": "Rebuilt template: {path}",
        "reverse.unknown": " (unknown)",
        "reverse.allTitle": "Rebuild every set",
        "reverse.allNone": "No reversible armor textures found in {dir}.",
        "reverse.allConfirm": "{count} armor sets will be rebuilt into:\n{dir}\n\nExisting files are overwritten. Continue?",
        "reverse.allProgress": "Rebuilding {index}/{total}: {name}",
        "reverse.allDone": "Rebuilt {count} armor sets into {dir}",
        "reverse.allDoneOpen": "Rebuilt {count} armor sets into:\n{dir}\n\nOpen the folder?",
        "reverse.allFailed": "{count} sets failed, see the log for details.",
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
