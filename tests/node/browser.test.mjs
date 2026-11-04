/**
 * End-to-end: the real app in headless Chrome.
 *
 * `harness.html` loads `web/` in an iframe, drives it (drag files in, click the
 * buttons, tick boxes, switch the language) and POSTs everything it saw back to
 * `/__done`.  That gives a deterministic wait — no sleeping on the clock — and
 * lets the assertions below run in plain Node.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WEB, assertSamePixels, goldenImage, png } from "./lib/helpers.mjs";
import { findChrome, openInBrowser, readZip, serve } from "./lib/browser.mjs";
import { encodePNG } from "../../web/js/png.js";

const HARNESS = join(import.meta.dirname, "harness.html");
const chrome = findChrome();
const skip = chrome ? false : "no Chrome/Chromium available";

const scratch = () => mkdtempSync(join(tmpdir(), "armorhelper-browser-"));

test("the browser smoke test passes", { skip }, async () => {
  const served = await serve(WEB);
  try {
    const payload = await openInBrowser(chrome, `${served.base}/tests/smoke.html`, scratch(), served);
    assert.equal(payload.error, undefined, payload.error);

    const failures = payload.results.filter((item) => !item.ok);
    assert.deepEqual(
      failures.map((item) => `${item.name}: ${item.detail}`),
      [],
    );
    assert.ok(payload.total >= 15, `${payload.total} checks`);
    assert.equal(payload.failures, 0);
  } finally {
    await served.close();
  }
});

/** A copy of `web/` whose template has the guide stripped out. */
async function artOnlyWeb() {
  const root = join(scratch(), "web");
  cpSync(WEB, root, { recursive: true, filter: (source) => !source.includes("data/vanilla") });

  const template = png(join(WEB, "data", "ArmorTemplate_v1.png"));
  const overlay = png(join(WEB, "data", "ArmorTemplate_overlay.png"));

  const art = { width: template.width, height: template.height, data: new Uint8Array(template.data.length) };
  for (let index = 0; index < template.data.length; index += 4) {
    if (overlay.data[index + 3] <= 1 && template.data[index + 3] > 1) {
      art.data.set(template.data.subarray(index, index + 4), index);
    }
  }
  writeFileSync(join(root, "data", "ArmorTemplate_v1.png"), await encodePNG(art));
  return { root, art };
}

test("the guide overlay is drawn on the downloaded template", { skip }, async () => {
  const { root, art } = await artOnlyWeb();
  const served = await serve(root, { harness: HARNESS });
  try {
    const payload = await openInBrowser(chrome, `${served.base}/__harness.html`, scratch(), served);
    assert.equal(payload.error, undefined, payload.error);

    const [plain, merged] = payload.dropTools.artOpaque;
    const bare = art.data.filter((_, index) => index % 4 === 3 && art.data[index] > 1).length;
    // the served template is the art only, so the difference is the overlay
    assert.equal(plain, bare, "the guide-off download should be the template itself");
    assert.equal(merged, bare + 4395, "the overlay was not drawn on the download");
  } finally {
    await served.close();
  }
});

test("the app boots, fills itself in and does every job", { skip }, async () => {
  const served = await serve(WEB, { harness: HARNESS });
  try {
    const payload = await openInBrowser(chrome, `${served.base}/__harness.html`, scratch(), served);
    assert.equal(payload.error, undefined, `${payload.error} | requests=${served.state.paths.join(", ")}`);

    // a static page has no backend, so the status bar must not claim a connection
    assert.ok(payload.status.includes("就绪"), payload.status);
    assert.ok(!payload.status.includes("已连接"), payload.status);
    assert.ok(payload.sets > 150, `${payload.sets} sets`);
    // no export targets are left: every output is always generated
    // the export page's guide switch is the drop area icon, not a checkbox;
    // the reverse page keeps a checkbox of its own
    assert.deepEqual(payload.checkboxIds, [
      "opt-female",
      "opt-player",
      "gif-player",
      "rev-guide",
      "set-glow",
      "set-verify",
    ]);
    assert.deepEqual(payload.tabs, ["导出贴图", "预览贴图", "反向还原", "设置"]);
    assert.ok(payload.subtitle.includes("网页版"), payload.subtitle);
    assert.equal(payload.guide, true);
    assert.ok(payload.guideLabel.includes("参考线"), payload.guideLabel);
    assert.equal(payload.favicon, "data/icon.png");
    assert.equal(payload.logo, "data/icon.png");
    // on a clean profile: nothing to open yet
    assert.equal(payload.historyDisabled, true);

    // the bundled textures are what a phone user relies on
    assert.ok(payload.source.includes("内置"), payload.source);
    assert.ok(payload.source.includes("748"), payload.source);

    // "rebuild this set" has to produce a template preview with head and legs in
    // it — with no folder and no uploads, i.e. from the bundled atlas alone.
    for (const label of ["builtin", "uploaded"]) {
      const reverse = payload[label];
      assert.equal(reverse.error, undefined, `${label}: ${reverse.error}`);
      const missing = reverse.warnings.filter(
        (text) => text.includes("not found") || text.includes("cannot be recovered") || text.includes("left empty"),
      );
      assert.deepEqual(missing, [], `${label} could not find a texture`);
      assert.deepEqual(reverse.files, ["ArmorTemplate_星尘板甲_190.png"], label);
      assert.equal(reverse.previews, 3, label);
      assert.ok(reverse.captions[0].includes("绘制模板"), reverse.captions[0]);
      assert.ok(reverse.captions[1].includes("20 帧"), reverse.captions[1]);
      assert.equal(reverse.widths[0], 128 * 4 + 4, `${reverse.widths[0]}`);
      // the guide switch is checked here: this is the only template preview left
      assert.equal(reverse.guideChanged, true, `${label} guide overlay`);
    }


    // the drop area's own tools: demo template, guide overlay, download
    const dropTools = payload.dropTools;
    assert.equal(dropTools.loaded, true);
    // tooltips are translated text, never the browser's own title bubble
    assert.deepEqual(dropTools.titles, [null, null, null]);
    assert.deepEqual(dropTools.tooltips, [
      "叠加标注画面",
      "下载当前模板",
      "清空当前模板",
      "载入内置绘制模板作为示例",
    ]);
    assert.deepEqual(dropTools.pressed, ["true", "false"]);
    // the tools read top to bottom: clear, guide, history, download
    assert.deepEqual(dropTools.beforeLoad.tools, [
      "drop-clear",
      "drop-guide",
      "history-toggle",
      "drop-download",
    ]);
    // they only appear on hover now, so they no longer need to be faint;
    // the guide button is disabled on the demo template, and a disabled
    // button keeps its own dimmed value
    assert.ok(
      dropTools.toolOpacity.every((value) => value === 0.25 || value > 0.6),
      JSON.stringify(dropTools.toolOpacity),
    );
    // the animation box and the "nothing here yet" line wait for a template
    assert.equal(dropTools.beforeLoad.boxShown, false);
    assert.equal(dropTools.beforeLoad.resultText, "");
    assert.equal(dropTools.boxShownAfterLoad, true);
    assert.equal(dropTools.afterClear.boxShown, false);
    assert.equal(dropTools.afterClear.resultText, "");
    // the two GIF selects are a size below .form-select-sm
    assert.ok(dropTools.selectStyle.font < 14, JSON.stringify(dropTools.selectStyle));
    assert.ok(dropTools.selectStyle.height < 26, JSON.stringify(dropTools.selectStyle));
    // the demo picture is already annotated, so the toggle is disabled for it
    assert.equal(dropTools.guideDisabledOnDemo, true);
    assert.equal(dropTools.guideEnabledOnFlat, true);
    assert.equal(dropTools.guideRedraws, true);
    // the merged download carries the guide lines, the plain one is the original
    assert.ok(dropTools.changed > 0, JSON.stringify(dropTools));
    assert.equal(dropTools.plainMatchesFlat, true);

    // a plain export, and the history entry it leaves behind
    const exported = payload.exported;
    assert.ok(exported.files.length > 0);
    // the animation sits beside the drop area, not in the result card
    assert.equal(exported.previewVisible, true);
    // the transport plays, pauses, and steps one frame at a time
    const transport = exported.transport;
    assert.equal(transport.playingAtStart, true);
    assert.equal(transport.advanced, true);
    assert.equal(transport.pausedNow, true);
    assert.equal(transport.stayedPut, true);
    assert.equal(transport.nextDelta, 1);
    assert.equal(transport.prevDelta, 0);
    // the GIF's own frame order: 5 passes over the 20 frames, 52 steps
    assert.equal(transport.total, 52);
    // 2x by default, so the canvas is 80x112 instead of the native 40x56
    assert.deepEqual(transport.canvasSize, [80, 112]);
    assert.equal(transport.sizeValue, "2");
    // both selects keep one fixed width
    assert.equal(transport.selectWidths[0], transport.selectWidths[1]);
    // dimensions carry their unit, and the size in KB is gone
    // the material pack table drops the px unit; the file list keeps it
    assert.ok(exported.sizes.includes("40×1120"), exported.sizes);
    assert.ok(!exported.sizes.includes("px"), exported.sizes);
    assert.ok(!/\d+ KB/.test(exported.sizes), exported.sizes);
    // the set id is editable inside the 1.4 table
    assert.equal(exported.setId, "0");
    assert.ok(exported.history.length >= 1);
    assert.ok(exported.history[0].includes("MyArmor"), exported.history[0]);
    // the history counts every generated file: 6 sheets + 4 PNG + 4 GIF
    assert.equal(exported.stored[0].files, 14);
    assert.ok(exported.stored[0].thumb.startsWith("data:image/png"), exported.stored[0].thumb);

    // the corner links: the wiki follows the language, the source does not
    const links = exported.links;
    assert.equal(links.zh.wiki.href, "https://terraria.wiki.gg/zh/wiki/Armor_IDs");
    assert.equal(links.en.wiki.href, "https://terraria.wiki.gg/wiki/Armor_IDs");
    assert.equal(links.zh.wiki.tooltip, "wiki:盔甲ID");
    assert.equal(links.en.wiki.tooltip, "wiki: armor IDs");
    assert.equal(links.zh.repo.href, "https://github.com/hufang360/ArmorHelper2");
    assert.equal(links.en.repo.href, links.zh.repo.href);
    assert.equal(links.zh.repo.tooltip, "开源仓库（GitHub）");
    for (const link of [links.zh.wiki, links.zh.repo]) {
      assert.equal(link.target, "_blank");
      assert.equal(link.rel, "noopener");
      assert.equal(link.icon, true);
      // the tooltip doubles as the accessible name
      assert.ok(link.label.length > 0, JSON.stringify(link));
    }

    // the results are not a card any more: no forced height, content decides
    const before = exported.heightsBefore;
    assert.equal(before.forced, "");
    // they grow with the content once a template is loaded
    assert.ok(exported.heightsAfter.results > 0, JSON.stringify(exported.heightsAfter));

    // one template at a time: the second replaces the first, and the card is
    // redrawn for it instead of keeping the old file's result
    // the card no longer shows the template name, so check its content instead
    // no title any more: the results are a bare block
    assert.deepEqual(exported.replaced.titles, []);
    assert.ok(exported.replaced.resultsText.includes("Armor_Head_0.png"), exported.replaced.resultsText);
    assert.ok(exported.replaced.resultsText.includes("Armor_Head_0.png"), exported.replaced.resultsText);
    assert.ok(!exported.replaced.resultsText.includes("MyArmor"), exported.replaced.resultsText);

    // WFR-02: a template that is not 128x80 is refused, and nothing is written
    assert.equal(exported.wrongSize.hasResult, true); // the good template is still there
    assert.deepEqual(exported.wrongSize.titles, []); // the bad one was not taken
    assert.ok(exported.wrongSize.status.includes("128×80"), exported.wrongSize.status);


    // the result card's buttons really do something (this used to throw
    // "save.save is not a function" because of a shadowed local)
    const buttons = exported.buttons;
    // the export action lives inside the active tab
    assert.deepEqual(buttons.labels, ["下载材质包"]);
    assert.deepEqual(exported.ui.cardActions, ["下载材质包"]);
    assert.deepEqual(exported.ui.cards, []);
    assert.ok(!buttons.status.includes("not a function"), buttons.status);
    assert.equal(buttons.signature, "PK");

    const zipped = readZip(Buffer.from(buttons.base64, "base64"));
    // the 1.4.4 tab's button writes a resource pack
    assert.deepEqual(
      zipped.map((entry) => entry.name),
      [
        "pack.json",
        "Content/",
        "Content/Images/",
        "Content/Images/Armor_Head_0.png",
        "Content/Images/Armor_Legs_0.png",
        "Content/Images/Armor/",
        "Content/Images/Armor/Armor_0.png",
      ],
    );
    const head = zipped.find((entry) => entry.name === "Content/Images/Armor_Head_0.png");
    const { decodePNG } = await import("../../tools/lib/png.mjs");
    assertSamePixels(decodePNG(head.data), goldenImage("head"), "zipped head sheet");

    // a language switch redraws the cards instead of leaving the old wording
    const captions = exported.captions;
    assert.deepEqual(captions.before, ["头", "身", "腿"]);
    assert.equal(captions.english[0], "Head");
    assert.equal(captions.englishFiles, exported.files.length);
    assert.deepEqual(captions.chinese, captions.before);
    assert.deepEqual(exported.files, ["Armor_Head_0.png", "Armor/Armor_0.png", "Armor_Legs_0.png"]);

    // the GIFs are real files in the 全身盔甲 tab
    const gifTargets = payload.gifTargets;
    assert.deepEqual(gifTargets.labels, ["1.4", "1.3", "全身盔甲"]);
    assert.equal(gifTargets.active, "全身盔甲", JSON.stringify(gifTargets));
    // the full armour tab lists the four PNGs, then the four GIFs
    assert.deepEqual(gifTargets.names, [
      "FullArmor.png",
      "FullArmorFemale.png",
      "FullArmorPlayer.png",
      "FullArmorPlayerFemale.png",
      "FullArmor.gif",
      "FullArmorFemale.gif",
      "FullArmorPlayer.gif",
      "FullArmorPlayerFemale.gif",
    ]);

    // the results block: three tabs, each with its own zip
    const packCards = payload.packCards;
    assert.equal(packCards.info.length, 2);
    const [tab144, tab13] = packCards.info;
    assert.deepEqual(tab144.tabs, ["1.4", "1.3", "全身盔甲"]);
    assert.equal(tab144.activeTab, "1.4");
    assert.equal(tab13.activeTab, "1.3");
    // only 1.4.4+ writes a pack.json, so only its tab offers the inputs
    assert.deepEqual(tab144.inputs, ["材质包名称", "作者", "由 ArmorHelper 生成"]);
    assert.deepEqual(tab13.inputs, []);
    assert.equal(tab144.button, "下载材质包");
    assert.equal(tab13.button, "打包下载");
    assert.deepEqual(tab144.rows, [
      ["Armor_Head_0.png", "40×1120", "便装假发", "头部，20 帧"],
      ["Armor/Armor_0.png", "360×224", "便装衣", "身体，包括男身和女身"],
      ["Armor_Legs_0.png", "40×1120", "便装裤", "腿部，20 帧"],
    ]);
    // the ID sits between the size and the description
    assert.deepEqual(tab144.headers, ["文件名", "尺寸", "盔甲 ID", "说明"]);
    assert.deepEqual(tab13.headers, ["文件名", "尺寸", "说明"]);
    assert.deepEqual(tab144.columns, ["头", "身", "腿"]);
    // the 1.4 table carries one editable ID per part, with its vanilla name
    assert.deepEqual(tab144.ids, [
      { value: "0", name: "便装假发" },
      { value: "0", name: "便装衣" },
      { value: "0", name: "便装裤" },
    ]);
    // the other tabs have no ID column
    assert.deepEqual(tab13.ids, []);
    // 1.3: table order follows the preview columns
    assert.deepEqual(tab13.rows, [
      ["Armor_Head_0.png", "40×1120", "头部，20 帧"],
      ["Armor_Body_0.png", "40×1120", "男性身体，20 帧"],
      ["Female_Body_0.png", "40×1120", "女性身体，20 帧"],
      ["Armor_Arm_0.png", "40×1120", "手臂，20 帧"],
      ["Armor_Legs_0.png", "40×1120", "腿部，20 帧"],
    ]);
    assert.deepEqual(tab13.columns, ["头", "男身", "女身", "手臂", "腿"]);
    assert.equal(tab144.sheets, 3);
    assert.equal(tab13.sheets, 5);
    // the 全身盔甲 tab has its own zip of the eight files
    assert.equal(packCards.full.rows.length, 8);
    assert.equal(packCards.full.button, "打包下载");

    const [pack144, pack13, packFull] = packCards.packs.map((pack) => ({
      ...pack,
      entries: readZip(Buffer.from(pack.base64, "base64")).map((entry) => entry.name),
    }));
    assert.equal(pack144.signature, "PK");
    assert.deepEqual(pack144.entries, [
      "pack.json",
      "Content/",
      "Content/Images/",
      "Content/Images/Armor_Head_0.png",
      "Content/Images/Armor_Legs_0.png",
      "Content/Images/Armor/",
      "Content/Images/Armor/Armor_0.png",
    ]);
    // 1.3 had no resource packs, so its zip carries no pack.json
    assert.equal(pack13.signature, "PK");
    assert.deepEqual(pack13.entries, [
      "Content/",
      "Content/Images/",
      "Content/Images/Armor_Head_0.png",
      "Content/Images/Armor_Legs_0.png",
      "Content/Images/Armor_Body_0.png",
      "Content/Images/Female_Body_0.png",
      "Content/Images/Armor_Arm_0.png",
    ]);
    // the full armour zip carries the eight generated files, not the sheets
    assert.equal(packFull.signature, "PK");
    assert.deepEqual(packFull.entries, [
      "FullArmor.png",
      "FullArmorFemale.png",
      "FullArmorPlayer.png",
      "FullArmorPlayerFemale.png",
      "FullArmor.gif",
      "FullArmorFemale.gif",
      "FullArmorPlayer.gif",
      "FullArmorPlayerFemale.gif",
    ]);

    // the player switch and the female switch both redraw the animation
    assert.equal(exported.previewVisible, true);
    assert.equal(exported.playerChanged, true);
    assert.equal(exported.femaleChanged, true);

    // the action row is text only now: upload / demo / history
    const ui = exported.ui;
    assert.equal(ui.uploadLabel, "上传");
    // a template is loaded here, so the button demoted itself to a secondary one
    assert.equal(ui.uploadSecondaryAfter, true);
    assert.equal(payload.uploadPrimaryAtStart, true);
    // history is an icon in the drop area now, named by its tooltip
    assert.equal(ui.historyLabel, "最近导出");
    assert.equal(ui.historyHasIcon, true);
    assert.equal(ui.uploadIcon, false);
    // the pack button lives in the tab content, as a primary action
    assert.equal(ui.cardActions.includes("下载材质包"), true);
    assert.equal(ui.packButtonPrimary, true);
    // the file summary and the file list are gone: the drop area shows the file
    assert.equal(ui.summary, false);
    assert.equal(ui.list, false);

    // the preview-sheets tab: three labelled slots, speed/size, and the GIFs
    const gifs = payload.gifs;
    assert.equal(gifs.error, undefined, gifs.error);
    // a body sheet in the head slot is refused, in the user's language
    assert.equal(gifs.wrongSlotFilled, false);
    // the "still missing" line is gone: only the reason is reported
    assert.ok(gifs.wrongSlotStatus.includes("Armor_190.png"), gifs.wrongSlotStatus);
    assert.ok(!gifs.wrongSlotStatus.includes("还缺"), gifs.wrongSlotStatus);
    assert.equal(gifs.disabled, false);
    // the demo button builds the gold set out of the bundled atlas
    assert.deepEqual(gifs.demo.slots, ["Armor_Head_26.png", "Armor_4.png", "Armor_Legs_4.png"]);
    assert.deepEqual(gifs.demo.sizes, ["40×1118", "360×224", "40×1120"]);
    assert.equal(gifs.demo.enabled, true);
    // upload, demo, then the pack button: the pack is hidden until it can run
    assert.deepEqual(gifs.demo.buttonOrder, ["upload-sheets", "load-sheets-demo", "do-pack"]);
    assert.equal(gifs.demo.packHiddenAtStart, true);
    // the release version shows in the header
    assert.equal(gifs.demo.version, "v2.2.0");
    // one upload button feeds all three slots; the clear button is gone
    assert.equal(gifs.buttons.hasClear, false);
    assert.equal(gifs.buttons.hasUploadInput, true);
    // upload is primary until the sheets are in, then the pack button takes over
    assert.equal(gifs.buttons.uploadPrimary, false);
    assert.equal(gifs.buttons.uploadSecondary, true);
    assert.equal(gifs.buttons.packPrimary, true);
    assert.equal(gifs.buttons.packSecondary, false);
    // the player note is a tooltip now, not a paragraph
    assert.equal(gifs.buttons.playerInfo, "勾选后会先画上玩家本体（已内置原版玩家贴图，手机上也能用）。");
    assert.equal(gifs.buttons.hintParagraph, false);
    // names that say nothing are matched by shape, then by file size
    assert.deepEqual(gifs.buttons.bulkNames, ["3.png", "1.png", "2.png"]);
    // a single tall sheet alone is reported, and the reader is told to drag it
    assert.ok(gifs.buttons.lonelyStatus.includes("4.png"), gifs.buttons.lonelyStatus);
    assert.ok(gifs.buttons.lonelyStatus.includes("拖到"), gifs.buttons.lonelyStatus);
    // the swap icon really trades the two sheets, both ways
    assert.equal(gifs.buttons.swapped, true);
    assert.equal(gifs.buttons.swappedBack, true);
    assert.deepEqual(gifs.filled, [true, true, true]);
    assert.deepEqual(gifs.titles, ["头", "身体", "腿"]);
    assert.deepEqual(gifs.thumbs.map((thumb) => thumb.hidden), [false, false, false]);
    assert.deepEqual(gifs.thumbs.map((thumb) => thumb.src), ["data:", "data:", "data:"]);
    // every slot shows the whole sheet that was dropped in
    assert.deepEqual(gifs.thumbs.map((thumb) => thumb.width), [40, 360, 40]);
    // the body box is 360x224 itself, head and legs are half as wide
    assert.deepEqual(gifs.boxes, [
      [180, 224],
      [360, 224],
      [180, 224],
    ]);
    // "remove" is an icon button with no label text
    assert.deepEqual(gifs.clearIcons.map((icon) => icon.svg), [true, true, true]);
    assert.deepEqual(gifs.clearIcons.map((icon) => icon.text), ["", "", ""]);
    assert.deepEqual(gifs.clearIcons.map((icon) => icon.visible), [true, true, true]);
    // only the head and the legs offer the swap, and it names itself
    assert.deepEqual(gifs.swapIcons.map((icon) => icon.id), ["sheet-head-swap", "sheet-legs-swap"]);
    assert.deepEqual(gifs.swapIcons.map((icon) => icon.visible), [true, true]);
    assert.deepEqual(gifs.swapIcons.map((icon) => icon.tooltip), ["交换头部与腿部的贴图", "交换头部与腿部的贴图"]);
    // the file name and the size sit on separate lines
    assert.deepEqual(
      gifs.slotInfo.map((info) => info.lines.length),
      [2, 2, 2],
    );
    assert.ok(gifs.slotInfo[0].lines[0].startsWith("Armor_Head"), JSON.stringify(gifs.slotInfo));
    assert.ok(/^\d+×\d+$/.test(gifs.slotInfo[0].lines[1]), JSON.stringify(gifs.slotInfo));
    // a filled slot shows its own tick, so the status line is empty
    assert.equal(gifs.sheetStatus, "");
    assert.deepEqual(gifs.files, [
      "Armor_190_FullArmor.png",
      "Armor_190_FullArmorFemale.png",
      "Armor_190_FullArmor.gif",
      "Armor_190_FullArmorFemale.gif",
    ]);
    assert.equal(gifs.previews, 3);
    assert.deepEqual(gifs.captions.slice(0, 2), ["全身盔甲（男）", "全身盔甲（女）"]);
    assert.deepEqual(gifs.sources.slice(0, 3), ["blob:", "blob:", "data:"]);
    // no generate button: filling the three slots is what draws the card
    assert.equal(gifs.drewItself, true);
    // 2x was chosen, so the GIFs (and their preview) are twice as wide
    assert.deepEqual(gifs.widths.slice(0, 2), [80, 80]);
    assert.ok(gifs.widths[2] > 800, String(gifs.widths[2])); // the 20 frame contact sheet
    assert.equal(gifs.settings.gifSpeed, "slow");
    assert.equal(gifs.settings.gifSize, 2);

    // "make resource pack": the zip has to carry the game's folder layout
    const pack = payload.pack;
    assert.equal(pack.error, undefined, pack.error);
    assert.equal(pack.enabled, true);
    assert.equal(pack.name, "Armor_190-pack-pc.zip");
    assert.ok(pack.status.includes("已生成材质包"), pack.status);

    const entries = readZip(Buffer.from(pack.base64, "base64"));
    assert.deepEqual(
      entries.map((entry) => entry.name),
      [
        "pack.json",
        "Content/",
        "Content/Images/",
        "Content/Images/Armor_Head_190.png",
        "Content/Images/Armor_Legs_190.png",
        "Content/Images/Armor/",
        "Content/Images/Armor/Armor_190.png",
      ],
    );

    const meta = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "pack.json").data));
    // the defaults the inputs advertise: 盔甲 / ArmorHelper2 / description
    assert.equal(meta.Name, "盔甲");
    assert.equal(meta.Author, "ArmorHelper2");
    assert.ok(meta.Description);
    assert.deepEqual(meta.Version, { major: 1, minor: 0 });

    // the three PNGs are exactly the sheets that were dropped in
    for (const [name, reference] of [
      ["Content/Images/Armor_Head_190.png", "head"],
      ["Content/Images/Armor_Legs_190.png", "legs"],
      ["Content/Images/Armor/Armor_190.png", "body"],
    ]) {
      const image = decodePNG(entries.find((entry) => entry.name === name).data);
      assertSamePixels(image, goldenImage(reference), name);
    }

    // "overlay player" works with no folder at all (bundled player textures)
    const player = payload.player;
    assert.equal(player.error, undefined, player.error);
    // the note lives in the info icon's tooltip
    assert.ok(player.hintText.includes("内置"), player.hintText);
    assert.deepEqual(player.files, [
      "Armor_190_FullArmor.png",
      "Armor_190_FullArmorFemale.png",
      "Armor_190_FullArmorPlayer.png",
      "Armor_190_FullArmorPlayerFemale.png",
      "Armor_190_FullArmor.gif",
      "Armor_190_FullArmorFemale.gif",
      "Armor_190_FullArmorPlayer.gif",
      "Armor_190_FullArmorPlayerFemale.gif",
    ]);
    assert.equal(player.previews, 5);
    // clearing the slots empties the card again, still without a button
    assert.equal(player.clearedPreviews, 0);
    // no placeholder text and no heading once the slots are empty
    assert.equal(player.clearedText, "");
    assert.deepEqual(player.warnings, []);

    // nothing the page did may have thrown on the way (this is what caught the
    // leftover `!!images` in renderFolders)
    assert.deepEqual(payload.errors, []);

    // cancelling the long "rebuild every set" task
    const cancelled = payload.cancelled;
    assert.equal(cancelled.sawCancelButton, true);
    assert.equal(cancelled.sawBar, true);
    assert.ok(cancelled.status.includes("已取消"), cancelled.status);
    assert.equal(cancelled.cancelHiddenAfter, true);

    // ... and letting it finish reports progress on the way
    const reverseAll = payload.reverseAll;
    assert.equal(reverseAll.sawProgress, true);
    // the Bootstrap progress bar fills as the job advances
    assert.equal(reverseAll.sawFill, true);
    assert.ok(reverseAll.files > 100, `${reverseAll.files} files`);
    assert.ok(reverseAll.status.includes("已还原"), reverseAll.status);
    assert.ok(reverseAll.history >= 2, `${reverseAll.history} history entries`);
  } finally {
    await served.close();
  }
});
