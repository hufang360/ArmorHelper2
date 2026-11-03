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
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("downloading the template applies the guide overlay", { skip }, async () => {
  const { root, art } = await artOnlyWeb();
  const served = await serve(root, { harness: HARNESS });
  try {
    const payload = await openInBrowser(chrome, `${served.base}/__harness.html`, scratch(), served);
    assert.equal(payload.error, undefined, payload.error);

    const download = payload.download;
    assert.equal(download.error, undefined, download.error);
    assert.equal(download.size, "128x80");

    const bare = art.data.filter((_, index) => index % 4 === 3 && art.data[index] > 1).length;
    assert.equal(download.rawOpaque, bare, "the served template should be art only");
    assert.ok(download.producedOpaque > bare, "the overlay was not drawn on the download");
    assert.equal(download.producedOpaque, bare + 4395);
    assert.equal(download.identicalToRaw, false);
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
    assert.equal(payload.targets, 12);
    assert.equal(payload.checkboxes, 18);
    assert.deepEqual(payload.tabs, ["导出贴图", "预览贴图", "反向还原", "设置"]);
    assert.ok(payload.subtitle.includes("网页版"), payload.subtitle);
    assert.equal(payload.guide, true);
    assert.ok(payload.guideLabel.includes("参考线"), payload.guideLabel);
    assert.equal(payload.downloadButton, "BUTTON");
    assert.equal(payload.favicon, "data/icon.png");
    assert.equal(payload.logo, "data/icon.png");
    assert.equal(payload.download.error, undefined, payload.download.error);
    assert.equal(payload.download.size, "128x80");

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
    }

    // the hover popover really shows the template the button downloads
    const popover = payload.popover;
    assert.equal(popover.hiddenAtStart, true);
    assert.equal(popover.visible, true);
    assert.equal(popover.width, 128 * 4 + 4); // magnified 4x + the 2px border
    assert.equal(popover.hiddenAfter, true);

    // a plain export, and the history entry it leaves behind
    const exported = payload.exported;
    assert.ok(exported.files.length > 0);
    assert.equal(exported.previews, 3);
    assert.ok(exported.sizes.includes("40×1120"), exported.sizes);
    assert.ok(exported.history.length >= 1);
    assert.ok(exported.history[0].includes("MyArmor"), exported.history[0]);
    assert.equal(exported.stored[0].files, exported.files.length);
    assert.ok(exported.stored[0].thumb.startsWith("data:image/png"), exported.stored[0].thumb);

    // the empty results card matches the input card ...
    const before = exported.heightsBefore;
    assert.ok(Math.abs(before.results - before.left) <= 2, JSON.stringify(before));
    assert.ok(before.forced.endsWith("px"), JSON.stringify(before));
    // ... and once there is a result the content decides
    const after = exported.heightsAfter;
    assert.equal(after.forced, "");
    assert.ok(after.results > 0);

    // the result card's buttons really do something (this used to throw
    // "save.save is not a function" because of a shadowed local)
    const buttons = exported.buttons;
    assert.deepEqual(buttons.labels, ["打包下载 (zip)", "写入输出目录"]);
    assert.ok(!buttons.status.includes("not a function"), buttons.status);
    assert.equal(buttons.signature, "PK");

    const zipped = readZip(Buffer.from(buttons.base64, "base64"));
    assert.deepEqual(
      zipped.map((entry) => entry.name),
      ["MyArmor_Head.png", "MyArmor_Legs.png", "MyArmor_Body.png"],
    );
    const head = zipped.find((entry) => entry.name === "MyArmor_Head.png");
    const { decodePNG } = await import("../../tools/lib/png.mjs");
    assertSamePixels(decodePNG(head.data), goldenImage("head"), "zipped head sheet");

    // a language switch redraws the cards instead of leaving the old wording
    const captions = exported.captions;
    assert.deepEqual(captions.before, ["绘制模板 (128×80)", "生成效果 (20 帧)", "GIF 动画"]);
    assert.equal(captions.english[0], "Drawing template (128x80)");
    assert.equal(captions.englishFiles, exported.files.length);
    assert.deepEqual(captions.chinese, captions.before);

    // the gif-full* targets are real files (the web app used to ignore them)
    const gifTargets = payload.gifTargets;
    assert.deepEqual(gifTargets.labels, [
      "GIF 全身盔甲",
      "GIF 全身盔甲（女性）",
      "GIF 全身盔甲 + 玩家",
      "GIF 全身盔甲 + 玩家（女性）",
    ]);
    assert.deepEqual(gifTargets.names, [
      "MyArmor_Head.png",
      "MyArmor_Legs.png",
      "MyArmor_Body.png",
      "MyArmor_FullArmor.gif",
      "MyArmor_FullArmorFemale.gif",
      "MyArmor_FullArmorPlayer.gif",
      "MyArmor_FullArmorPlayerFemale.gif",
    ]);

    // the preview-sheets tab: three labelled slots, speed/size, and the GIFs
    const gifs = payload.gifs;
    assert.equal(gifs.error, undefined, gifs.error);
    // a body sheet in the head slot is refused, in the user's language
    assert.equal(gifs.wrongSlotFilled, false);
    assert.ok(gifs.wrongSlotStatus.includes("Armor_190.png"), gifs.wrongSlotStatus);
    assert.ok(gifs.wrongSlotStatus.includes("还缺"), gifs.wrongSlotStatus);
    assert.equal(gifs.disabled, false);
    assert.deepEqual(gifs.filled, [true, true, true]);
    assert.deepEqual(gifs.titles, [
      "头部（Armor_Head_ · 40×1120px）",
      "身体（Armor_ · 360×224，整数倍也行）",
      "腿部（Armor_Legs_ · 40×1120px）",
    ]);
    assert.deepEqual(gifs.thumbs.map((thumb) => thumb.hidden), [false, false, false]);
    assert.deepEqual(gifs.thumbs.map((thumb) => thumb.src), ["data:", "data:", "data:"]);
    // tall sheets show their first frame at 2x, the body grid shows all 9x4 cells
    assert.deepEqual(gifs.thumbs.map((thumb) => thumb.width), [80, 360, 80]);
    assert.ok(gifs.sheetStatus.includes("头部 ✓"), gifs.sheetStatus);
    assert.deepEqual(gifs.files, [
      "Armor_190_FullArmor.png",
      "Armor_190_FullArmorFemale.png",
      "Armor_190_FullArmor.gif",
      "Armor_190_FullArmorFemale.gif",
    ]);
    assert.equal(gifs.previews, 3);
    assert.deepEqual(gifs.captions.slice(0, 2), ["全身盔甲（男）", "全身盔甲（女）"]);
    assert.deepEqual(gifs.sources.slice(0, 3), ["blob:", "blob:", "data:"]);
    assert.ok(gifs.status.includes("已生成"), gifs.status);
    // 2x was chosen, so the GIFs (and their preview) are twice as wide
    assert.deepEqual(gifs.widths.slice(0, 2), [80, 80]);
    assert.ok(gifs.widths[2] > 800, String(gifs.widths[2])); // the 20 frame contact sheet
    assert.ok(Math.abs(gifs.heightsBefore.results - gifs.heightsBefore.left) <= 2);
    assert.ok(gifs.heightsBefore.forced.endsWith("px"));
    assert.equal(gifs.heightsAfter.forced, "");
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
    assert.equal(meta.Name, "星尘板甲");
    assert.ok(meta.Author);
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
    assert.equal(player.hintVisible, true);
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
    assert.ok(reverseAll.files > 100, `${reverseAll.files} files`);
    assert.ok(reverseAll.status.includes("已还原"), reverseAll.status);
    assert.ok(reverseAll.history >= 2, `${reverseAll.history} history entries`);
  } finally {
    await served.close();
  }
});
