/**
 * The export result: every sheet a template produces, in three tabs.
 *
 * There is no export button.  A valid template plus the current options is the
 * whole input, so the card is redrawn whenever either changes; the debounce
 * (`scheduleExport`) is what keeps a burst of option changes from generating
 * the same sheets four times.
 *
 * Runs are numbered: a slow, older run must not overwrite a newer result.
 */

import { $, say } from "./dom.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import { currentSkin, loadPlayerParts } from "./textures.js";
import { effectiveIds, outputNames } from "./ids.js";
import { addHistory } from "./history.js";
import { clearResult, keepUrl, showResult } from "./result.js";
import { exportGif, gifDelay, gifFrames, setPreviewGif } from "./gifs.js";
import { legacyPackBlob, resourcePackBlob } from "./pack.js";
import { countDifferences, stackFrames } from "../js/bitmap.js";
import {
  SKIN_TINT,
  fullArmorFrames,
  gifFrameOrder,
  overlay,
  playerFrames,
  tintFrames,
} from "../js/compose.js";
import { sanitizeFilename } from "../js/data.js";
import {
  generateArms,
  generateBodyComposite,
  generateBodyLegacy,
  generateHead,
  generateLegs,
} from "../js/generate.js";
import { gifBlob } from "../js/gif.js";
import { pngBlob } from "../js/png.js";
import { reverseTemplate } from "../js/reverse.js";
import { zipBlobAsync } from "../js/zip.js";

/** A newer change must not be overwritten by a slower, older run. */
let exportRun = 0;
let exportTimer = null;
/** The template whose result is already in the history. */
let historyFile = null;

/** Rebuild the export results. Called by a new template and by every option. */
export function scheduleExport(delay = 120) {
  clearTimeout(exportTimer);
  exportTimer = setTimeout(() => void renderExport(), delay);
}

/**
 * Draw the whole export result for the current template and options.
 *
 * There is no export button: a valid template plus the current options is the
 * whole input, so the card is redrawn whenever either changes. History is only
 * written for a new template, or toggling a checkbox would fill it up.
 */
async function renderExport() {
  const file = state.files[0];
  if (!file?.bitmap) {
    clearResult("export");
    return;
  }
  const run = ++exportRun;
  try {
    const female = $("#opt-female").checked;
    const wantsPlayer = $("#opt-player").checked;
    // reload when the skin changed too: the parts are per skin
    if (wantsPlayer && (!state.playerParts || state.playerParts.skin !== currentSkin())) {
      state.playerParts = await loadPlayerParts();
    }

    const stem = file.name.replace(/\.[^.]+$/, "") || "template";
    const names = outputNames();
    const ids = effectiveIds();

    // every PNG below also goes into the tab zips
    const sheetBlobs = [];
    // name -> row: the tabs share the head and legs sheets
    const rowByName = new Map();
    // name -> bitmap, for the round trip self check
    const sheets = new Map();

    /** One table row plus its download link, from an encoded blob. */
    const blobRow = (name, blob, width, height, descKey, labelKey) => {
      const cached = rowByName.get(name);
      if (cached) return cached;
      const row = { name, descKey, labelKey, width, height, url: URL.createObjectURL(blob) };
      rowByName.set(name, row);
      sheetBlobs.push({ name, blob });
      return row;
    };
    const sheetRow = async (name, bitmap, descKey) => {
      const cached = rowByName.get(name);
      if (cached) return cached;
      sheets.set(name, bitmap);
      return blobRow(name, await pngBlob(bitmap), bitmap.width, bitmap.height, descKey);
    };
    // a preview column carries the sheet's own size: a tall strip is shown at
    // its native width, the wide body sheet fills the column
    const col = (labelKey, row) => ({ ...row, labelKey });

    // 1.4.4+ reads head, legs and the composite body from a resource pack
    const pack144 = {
      head: generateHead(file.bitmap),
      legs: generateLegs(file.bitmap),
      body: generateBodyComposite(file.bitmap, { glowRows: state.config.glow ? 4 : 0 }),
    };
    // 1.3 shipped the body as three separate sheets and had no resource packs
    const pack13 = {
      head: generateHead(file.bitmap),
      legs: generateLegs(file.bitmap),
      body: generateBodyLegacy(file.bitmap, false),
      female: generateBodyLegacy(file.bitmap, true),
      arms: generateArms(file.bitmap),
    };
    const headRow = await sheetRow(names.head, pack144.head, "web.sheetDesc.head");
    const legsRow = await sheetRow(names.legs, pack144.legs, "web.sheetDesc.legs");
    const body144 = await sheetRow(names.body, pack144.body, "web.sheetDesc.body144");
    const bodyMale = await sheetRow(names.bodyLegacy, pack13.body, "web.sheetDesc.bodyMale");
    const bodyFemale = await sheetRow(names.bodyLegacyFemale, pack13.female, "web.sheetDesc.bodyFemale");
    const arms = await sheetRow(names.arms, pack13.arms, "web.sheetDesc.arm");

    const packTabs = [
      {
        id: "144",
        labelKey: "web.tab.pack144",
        table: [
          { ...headRow, part: "head" },
          { ...body144, part: "body" },
          { ...legsRow, part: "legs" },
        ],
        idColumn: true,
        columns: [
          col("web.sheetCol.head", headRow),
          col("web.sheetCol.body", body144),
          col("web.sheetCol.legs", legsRow),
        ],
        pack: {
          name: `Armor_${ids.body}-pack-pc.zip`,
          labelKey: "web.packMake",
          // pack.json is written from the inputs next to the button
          fields: true,
          run: () => resourcePackBlob(pack144, ids.body, state.config.pack),
        },
      },
      {
        id: "13",
        labelKey: "web.tab.pack13",
        table: [
          { ...headRow, part: "head" },
          { ...bodyMale, part: "body" },
          { ...bodyFemale, part: "body" },
          { ...arms, part: "body" },
          { ...legsRow, part: "legs" },
        ],
        columns: [
          col("web.sheetCol.head", headRow),
          col("web.sheetCol.bodyMale", bodyMale),
          col("web.sheetCol.bodyFemale", bodyFemale),
          col("web.sheetCol.arm", arms),
          col("web.sheetCol.legs", legsRow),
        ],
        pack: {
          name: `Armor_${ids.body}-legacy.zip`,
          labelKey: "web.packZip",
          run: () => legacyPackBlob(pack13, ids.body),
        },
      },
    ];

    const maleFrames = fullArmorFrames(file.bitmap, false);
    const femaleFrames = fullArmorFrames(file.bitmap, true);
    const withPlayerFor = (list, isFemale) =>
      wantsPlayer && state.playerParts
        ? overlay(tintFrames(playerFrames(state.playerParts, isFemale), SKIN_TINT), list)
        : list;
    const playerMale = withPlayerFor(maleFrames, false);
    const playerFemale = withPlayerFor(femaleFrames, true);
    // the 20 frame animation next to the drop area follows the two switches
    const previewFrames = female ? playerFemale : playerMale;

    // the full armour outputs are the third tab, always complete
    const fullRows = [];
    /** @type {[string, () => any, string][]} */
    const pngRows = [
      ["FullArmor.png", () => maleFrames, "web.gifMale"],
      ["FullArmorFemale.png", () => femaleFrames, "web.gifFemale"],
      ["FullArmorPlayer.png", () => playerMale, "web.gifMalePlayer"],
      ["FullArmorPlayerFemale.png", () => playerFemale, "web.gifFemalePlayer"],
    ];
    for (const [name, frames, labelKey] of pngRows) {
      const bitmap = stackFrames(frames());
      fullRows.push(
        await blobRow(name, await pngBlob(bitmap), bitmap.width, bitmap.height, "web.sheetDesc.full", labelKey),
      );
    }
    /** @type {[string, () => any, string][]} */
    const gifRows = [
      ["FullArmor.gif", () => maleFrames, "web.gifMale"],
      ["FullArmorFemale.gif", () => femaleFrames, "web.gifFemale"],
      ["FullArmorPlayer.gif", () => playerMale, "web.gifMalePlayer"],
      ["FullArmorPlayerFemale.gif", () => playerFemale, "web.gifFemalePlayer"],
    ];
    for (const [name, frames, labelKey] of gifRows) {
      const shown = gifFrames(frames(), exportGif().size);
      const blob = gifBlob(shown, { order: gifFrameOrder(), delayMs: gifDelay(exportGif().speed) });
      fullRows.push(await blobRow(name, blob, shown[0].width, shown[0].height, "web.sheetDesc.gif", labelKey));
    }
    const fullNames = new Set(fullRows.map((row) => row.name));
    packTabs.push({
      id: "full",
      labelKey: "web.tab.packFull",
      table: fullRows,
      columns: fullRows.map((row) => ({ labelKey: row.labelKey, ...row })),
      pack: {
        name: `${sanitizeFilename(stem)}_FullArmor.zip`,
        labelKey: "web.packZip",
        // already encoded: zip those bytes as they are
        run: () => zipBlobAsync(sheetBlobs.filter((item) => fullNames.has(item.name))),
      },
    });

    const warnings = [];
    if (state.config.verify) warnings.push(...verifyRoundTrip(file.bitmap, sheets));

    if (run !== exportRun) return;
    showResult("export", [{ tabs: packTabs, warnings }]);
    setPreviewGif(previewFrames, exportGif().speed, exportGif().size);
    if (historyFile !== file) {
      historyFile = file;
      addHistory(stem, sheetBlobs, keepUrl(file.bitmap));
    }
  } catch (error) {
    if (run !== exportRun) return;
    console.error(error);
    say(String(error.message || error), "bad");
  }
}

/**
 * Round trip self check: rebuild a template from the generated sheets and
 * compare the regenerated sheets with the originals.  `tests/node/core.test.mjs`
 * asserts the same property against the frozen reference images.
 *
 * `sheets` maps output file names to bitmaps. It is empty unless the 1.4.4
 * target is on, and there is nothing to verify without those three sheets.
 */
function verifyRoundTrip(template, sheets) {
  // names come from `outputNames`, so match the prefix rather than the suffix
  const pick = (prefix) => {
    for (const [name, bitmap] of sheets) {
      if (name.startsWith(prefix)) return bitmap;
    }
    return null;
  };
  const body = pick("Armor/");
  const legs = pick("Armor_Legs_");
  const headSheet = pick("Armor_Head_");
  if (!body || !legs || !headSheet) return [];

  try {
    const rebuilt = reverseTemplate({ head: headSheet, body, legs }).template;
    const again = {
      head: generateHead(rebuilt),
      legs: generateLegs(rebuilt),
      body: generateBodyComposite(rebuilt, { glowRows: state.config.glow ? 4 : 0 }),
    };
    const problems = [];
    for (const [name, produced] of [["head", headSheet], ["legs", legs], ["body", body]]) {
      const difference = countDifferences(again[name], produced);
      if (difference > 0) problems.push(`${name}: ${difference} px`);
    }
    if (problems.length) {
      return [t("web.verifyMismatch", { detail: problems.join(", ") })];
    }
    return [];
  } catch (error) {
    return [t("web.verifyFailed", { error: error.message })];
  }
}
