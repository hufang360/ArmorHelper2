/**
 * ArmorHelper web front end.
 *
 * Everything happens in the browser: the sheets are generated, previewed and
 * encoded here, so the page works from any static host (GitHub Pages included)
 * with no server at all.  The core in `js/` is DOM-free and its pixels are
 * pinned to the frozen reference images in `web/tests/golden/`
 * (`tests/node/core.test.mjs`).
 */

import {
  allSets,
  displayName,
  findSet,
  loadLayout,
  loadSets,
  sanitizeFilename,
  searchSets,
  setLabel,
} from "./js/data.js";
import { countDifferences, stackFrames } from "./js/bitmap.js";
import {
  generateArms,
  generateBodyComposite,
  generateBodyLegacy,
  generateHead,
  generateLegs,
} from "./js/generate.js";
import {
  SKIN_TINT,
  contactSheet,
  fullArmorFrames,
  composeOverlay,
  gifFrameOrder,
  magnify,
  overlay,
  playerFrames,
  tintFrames,
} from "./js/compose.js";
import { loadTextures, reverseTemplate } from "./js/reverse.js";
import { gifBlob } from "./js/gif.js";
import { pngBlob } from "./js/png.js";
import { zipBlobAsync } from "./js/zip.js";
import {
  decodeBitmap,
  downloadBlob,
  pickFolder,
  writeToFolder,
} from "./js/fs.js";
import { dropHandle, getHandle, putHandle } from "./js/idb.js";
import { $, $$, missing, noteMissing, on, say } from "./app/dom.js";
import { setMessages, t } from "./app/i18n.js";
import { addSheetFiles, loadSheetDemo, renderSlots, scheduleGifs, setSlot } from "./app/sheets.js";
import { addHistory, clearHistory, renderHistory } from "./app/history.js";
import { SHEET_ROLES, loadConfig, saveConfig, state } from "./app/state.js";
import { doResourcePack, legacyPackBlob, resourcePackBlob } from "./app/pack.js";
import {
  REVERSE_SUBDIR,
  currentSkin,
  loadBuiltinInfo,
  loadBundledPlayerParts,
  loadPlayerParts,
  textureReader,
} from "./app/textures.js";
import { asId, effectiveIds, loadArmorNames, outputNames } from "./app/ids.js";
import { exportGif, gifDelay, gifFrames, makeGif, playPreview, previewPlaying, setPreviewGif, stepPreview } from "./app/gifs.js";
import { cancelJob, endJob, jobCancelled, jobProgress, startJob } from "./app/jobs.js";
import {
  HANDLE_IMAGES,
  HANDLE_OUTPUT,
  ensureOutputFolder,
  pickImagesFolder,
  renderFolders,
} from "./app/folders.js";
import {
  clearResult,
  keepUrl,
  setExportScheduler,
  showResult,
  syncResultHeights,
  watchResultHeights,
  withGuide,
} from "./app/result.js";

/** The release version shown in the header; one file, so the build has none. */
const VERSION_FILE = "data/version.json";
/* ---------------------------------------------------------------- i18n -- */

/** The wiki page that lists every armor ID, per interface language. */
const WIKI_ARMOR_IDS = {
  zh_CN: "https://terraria.wiki.gg/zh/wiki/Armor_IDs",
  en: "https://terraria.wiki.gg/wiki/Armor_IDs",
};

/** Re-render every bit of text after a language switch. */
function applyI18n() {
  document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
  for (const el of $$("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of $$("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  // icons and unlabelled controls carry their name in `aria-label` only
  for (const el of $$("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset.i18nLabel));
  // the wiki exists in both languages: send the reader to his own
  const wiki = $("#wiki-link");
  if (wiki) wiki.href = WIKI_ARMOR_IDS[state.language] ?? WIKI_ARMOR_IDS.zh_CN;
  renderTooltips();
  renderGuideToggle();
  renderFiles();
  renderSlots();
  renderFolders();
  renderHistory();
  renderAbout();
  // redraw the result cards: their captions and buttons are translated too
  for (const [panel, result] of Object.entries(state.results)) {
    if (result) showResult(panel, result);
  }
  syncResultHeights();
}


/* ------------------------------------------------------------------ ui -- */

/** Show the loaded template in the drop area, or the hint when there is none. */
/**
 * Tooltips of the drop area icons and the info bubble.
 *
 * They are plain text in a `data-tooltip` attribute, shown by CSS: the bundled
 * Bootstrap is CSS only, so there is no `Tooltip` component. A `title` would
 * pop up the browser's own bubble, which cannot be styled or translated.
 */
const TOOLTIPS = [
  ["#drop-guide", "web.guideTooltip"],
  ["#drop-download", "web.downloadTooltip"],
  ["#drop-clear", "web.clearTooltip"],
  ["#history-toggle", "web.historyTitle"],
  ["#load-demo", "web.demoTooltip"],
  ["#load-sheets-demo", "web.demoSheetsTooltip"],
  ["#wiki-link", "web.wikiHint"],
  ["#repo-link", "web.repoHint"],
  ["#player-info", "web.playerHint"],
  ["#gif-player-info", "web.gifPlayerHint"],
  ...["head", "legs"].map((role) => [`#sheet-${role}-swap`, "web.swapHeadLegs"]),
  ["#gif-play", "web.gifPlay"],
  ["#gif-prev", "web.gifPrev"],
  ["#gif-next", "web.gifNext"],
  ...SHEET_ROLES.map((role) => [`#sheet-${role}-clear`, "web.remove"]),
];

function renderTooltips() {
  for (const [selector, key] of TOOLTIPS) {
    const el = $(selector);
    if (!el) continue;
    el.dataset.tooltip = t(key);
    // the icon buttons have no text of their own to name them
    if (!el.textContent.trim()) el.setAttribute("aria-label", t(key));
  }
}

/**
 * What the drop area shows and the download hands out: the template, with the
 * guide overlay when the switch is on and the file does not carry it already.
 */
function shownTemplate(file) {
  return file.preGuided ? file.bitmap : withGuide(file.bitmap, state.config.guide !== false);
}

function renderFiles() {
  const file = state.files[0];
  const preview = $("#template-preview");
  const hint = $("#drop-hint");
  const download = $("#drop-download");
  if (preview) {
    preview.hidden = !file;
    if (file) {
      // the template itself stands in for the hint, so the area shows what the
      // export will use
      preview.src = keepUrl(shownTemplate(file));
    } else {
      preview.removeAttribute("src");
    }
  }
  if (download) download.disabled = !file;
  // the guide overlay only makes sense on a template that has none yet
  const guide = $("#drop-guide");
  if (guide) guide.disabled = !file || !!file.preGuided;
  const clear = $("#drop-clear");
  if (clear) clear.disabled = !file;
  // the demo would replace what is already loaded
  const demo = $("#load-demo");
  if (demo) demo.disabled = !!file;
  // the upload button is the main action only while there is nothing loaded
  const upload = $("#upload-file");
  if (upload) {
    upload.classList.toggle("btn-primary", !file);
    upload.classList.toggle("btn-secondary", !!file);
  }
  if (hint) hint.hidden = !!file;
  $("#drop")?.classList.toggle("is-filled", !!file);
}

/**
 * The guide switch exists twice: in the preview options and on the drop area.
 * Both show the same state, so either one can flip it.
 */
function renderGuideToggle() {
  const on_ = state.config.guide !== false;
  const button = $("#drop-guide");
  if (button) {
    button.setAttribute("aria-pressed", on_ ? "true" : "false");
    button.classList.toggle("is-on", on_);
  }
  renderFiles();
}

/* --------------------------------------------------------- long tasks -- */

/** Let the browser repaint, so the progress text is actually visible. */
function nextFrame() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Bootstrap progress is a div pair: the wrapper has the id, the inner div has the width. */
/** Load the optional guide layer; missing or broken files are not an error. */
async function loadGuideOverlay() {
  try {
    const response = await fetch("data/ArmorTemplate_overlay.png");
    if (!response.ok) return null;
    return await decodeBitmap(await response.blob());
  } catch {
    return null;
  }
}

/** Register the offline cache; a static host without HTTPS just skips it. */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker
    .register("sw.js")
    .then(() => {
      // Mention it in the about line: the status bar belongs to the app.
      state.offlineReady = true;
      const about = $("#about");
      if (about) about.textContent = `${about.textContent} · ${t("web.offlineReady")}`;
    })
    .catch((error) => console.debug("offline cache unavailable", error));
}

/**
 * Download what the drop area shows: the loaded template, with the guide merged
 * in when the switch is on, and the untouched file when it is off.
 */
async function downloadTemplateFile() {
  const file = state.files[0];
  if (!file) return;
  const stem = file.name.replace(/\.[^.]+$/, "") || "template";
  try {
    downloadBlob(await pngBlob(shownTemplate(file)), `${stem}.png`);
  } catch (error) {
    console.error(error);
    say(String(error.message || error), "bad");
  }
}

/** Load the bundled drawing template as a sample, through the normal path. */
async function loadDemo() {
  try {
    const response = await fetch("data/ArmorTemplate_v1.png");
    if (!response.ok) throw new Error(`cannot load data/ArmorTemplate_v1.png: ${response.status}`);
    const blob = await response.blob();
    await addFiles([new File([blob], "ArmorTemplate_v1.png", { type: "image/png" })], { preGuided: true });
  } catch (error) {
    console.error(error);
    say(String(error.message || error), "bad");
  }
}

/** Build a result object from a list of `{ name, bitmap }` plus previews. */
/**
 * Result object for the reverse tab: the template PNG, its 4x preview with the
 * guide, the 20 frame sheet and the animation.
 */
async function packResult(title, entries, frames, warnings = [], options = {}) {
  const { template = null } = options;
  const files = [];
  const blobs = [];
  for (const entry of entries) {
    const blob = await pngBlob(entry.bitmap);
    blobs.push({ name: entry.name, blob });
    files.push({
      name: entry.name,
      width: entry.bitmap.width,
      height: entry.bitmap.height,
      size: blob.size,
      url: URL.createObjectURL(blob),
    });
  }

  const previews = [];
  if (template) {
    previews.push({
      url: keepUrl(magnify(withGuide(template, state.config.revGuide !== false), 4)),
      captionKey: "web.previewTemplate",
      alt: "ArmorTemplate",
      // the drawing template, so a switch flip can redraw without reversing again
      template,
    });
  }
  if (frames?.length) {
    previews.push({ url: keepUrl(contactSheet(frames)), captionKey: "web.previewFrames" });
    const gif = makeGif(frames);
    // the preview animation is not an output: it is neither zipped nor written
    blobs.push({ name: `${title}_preview.gif`, blob: gif, extra: true });
    previews.push({ url: URL.createObjectURL(gif), captionKey: "web.previewGif", alt: "GIF" });
  }

  return {
    title,
    files,
    previews,
    warnings,
    zip: {
      save: async () =>
        downloadBlob(
          await zipBlobAsync(blobs.filter((item) => !item.extra)),
          `${sanitizeFilename(title)}.zip`,
        ),
    },
    save: {
      save: async () => {
        const folder = await ensureOutputFolder();
        if (!folder) return;
        let written = 0;
        for (const item of blobs) {
          if (item.extra) continue; // the preview animation stays in the page
          await writeToFolder(folder, item.name, item.blob);
          written += 1;
        }
        say(t("web.savedTo", { count: written }));
      },
    },
  };
}

/* --------------------------------------------------------------- export -- */

/** A newer change must not be overwritten by a slower, older run. */
let exportRun = 0;
let exportTimer = null;
/** The template whose result is already in the history. */
let historyFile = null;

/** Rebuild the export results. Called by a new template and by every option. */
function scheduleExport(delay = 120) {
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

/* -------------------------------------------------------------- reverse -- */

async function doReverse() {
  const body = asId($("#rev-body").value);
  if (body === null) {
    say(t("reverse.badBody"), "warn");
    return;
  }
  if (!state.folders.images && !state.textures.size && !state.builtin) {
    say(t("web.needTextures"), "warn");
    return;
  }

  say(t("web.working"), "busy");
  try {
    const { textures, missing } = await loadTextures(
      {
        body,
        head: asId($("#rev-head").value),
        legs: asId($("#rev-legs").value),
      },
      textureReader(),
    );
    const item = findSet(body);
    const label = sanitizeFilename((item && (displayName(item.zh) || item.name)) || `Armor${body}`);
    const { template, warnings } = reverseTemplate(textures);
    if (missing.length) warnings.push(...missing.map((kind) => `${kind}: texture not found`));

    const frames = fullArmorFrames(template, false);
    const entries = [{ name: `ArmorTemplate_${label}_${body}.png`, bitmap: template }];
    const result = await packResult(`ArmorTemplate_${label}_${body}`, entries, frames, warnings, { template });

    showResult("reverse", result);
    say(t("reverse.done", { path: result.files[0].name }));
  } catch (error) {
    console.error(error);
    say(String(error.message || error), "bad");
  }
}

async function doReverseAll() {
  if (!state.folders.images && !state.textures.size && !state.builtin) {
    say(t("web.needTextures"), "warn");
    return;
  }
  // The folder is only asked for when the results are actually written, so the
  // batch does not open a picker before it produces anything.
  $("#do-reverse-all").disabled = true;
  say(t("web.working"), "busy");

  try {
    const entries = [];
    let failed = 0;
    const jobs = allSets().filter(
      (item) => item.head !== null && item.legs !== null && item.body !== null,
    );
    const read = textureReader();
    startJob(jobs.length);
    for (const [step, item] of jobs.entries()) {
      if (jobCancelled()) break;
      jobProgress(step, displayName(item.zh) || item.name);
      await nextFrame();
      const { textures } = await loadTextures(
        { body: item.body, head: item.head, legs: item.legs },
        read,
      );
      if (!textures.body) continue;
      try {
        const { template } = reverseTemplate(textures);
        const label = sanitizeFilename(displayName(item.zh) || item.name);
        entries.push({ name: `${REVERSE_SUBDIR}/ArmorTemplate_${label}_${item.body}.png`, bitmap: template });
      } catch (error) {
        console.error(item.name, error);
        failed += 1;
      }
    }
    const job = endJob();

    if (!entries.length) {
      say(job?.cancelled ? t("web.cancelled", { done: job.done, total: job.total }) : t("reverse.allNone", { dir: "" }), "warn");
      return;
    }

    const blobs = [];
    for (const entry of entries) blobs.push({ name: entry.name, blob: await pngBlob(entry.bitmap) });

    const result = {
      title: `${entries.length}`,
      titleKey: "web.rebuilt",
      titleVars: { count: entries.length },
      files: entries.slice(0, 400).map((entry, index) => ({
        name: entry.name,
        width: entry.bitmap.width,
        height: entry.bitmap.height,
        size: blobs[index].blob.size,
        url: URL.createObjectURL(blobs[index].blob),
      })),
      warnings: failed ? [t("reverse.allFailed", { count: failed })] : [],
      zip: { save: async () => downloadBlob(await zipBlobAsync(blobs), "ArmorTemplate.zip") },
      save: {
        save: async () => {
          const target = await ensureOutputFolder();
          if (!target) return;
          for (const item of blobs) await writeToFolder(target, item.name, item.blob);
          say(t("web.savedTo", { count: blobs.length }));
        },
      },
    };

    showResult("reverse", result);
    addHistory(`${t("reverse.allTitle")} ×${entries.length}`, entries, keepUrl(entries[0].bitmap));
    if (job?.cancelled) say(t("web.cancelled", { done: job.done, total: job.total }), "warn");
    else say(t("reverse.allDone", { count: entries.length, dir: REVERSE_SUBDIR }));
  } catch (error) {
    endJob();
    console.error(error);
    say(String(error.message || error), "bad");
  } finally {
    endJob();
    $("#do-reverse-all").disabled = false;
  }
}

/* ------------------------------------------------------------ listeners -- */

const TEMPLATE_SIZE = { width: 128, height: 80 };

/**
 * Load the drawing template. The export tab handles one file at a time: a
 * second file replaces the first. Only png and webp are taken, and the size
 * must be the 128x80 the generator expects; anything else is refused with a
 * status line instead of producing a clipped sheet.
 */
async function addFiles(fileList, { preGuided = false } = {}) {
  const files = [...fileList];
  const file = files.filter((item) => /\.(png|webp)$/i.test(item.name)).pop();
  if (!file) {
    if (files.length) say(t("web.wrongFormat", { name: files[0].name }), "warn");
    return;
  }
  let bitmap;
  try {
    bitmap = await decodeBitmap(file);
  } catch (error) {
    console.error(error);
    say(t("web.dropped", { name: file.name }), "warn");
    return;
  }
  if (bitmap.width !== TEMPLATE_SIZE.width || bitmap.height !== TEMPLATE_SIZE.height) {
    say(t("web.wrongSize", { name: file.name, width: bitmap.width, height: bitmap.height }), "warn");
    return;
  }
  if (state.files.length) clearResult("export");
  state.files = [{ name: file.name, bitmap, preGuided }];
  renderFiles();
  scheduleExport(0);
}

/** Forget the selected template, and the result that belonged to it. */
function clearFiles() {
  state.files = [];
  renderFiles();
  clearResult("export");
}

async function loadSetsIndex(query = "") {
  const found = query ? searchSets(query) : allSets();
  state.sets = found;
  const select = $("#set-select");
  select.innerHTML = "";
  for (const [index, item] of found.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${setLabel(item)}${item.head !== null && item.legs !== null ? "" : "  ⚠"}`;
    select.append(option);
  }
  if (found.length) pickSet(0);
}

function pickSet(index) {
  const item = state.sets[index];
  if (!item) return;
  $("#rev-head").value = item.head ?? "";
  $("#rev-body").value = item.body ?? "";
  $("#rev-legs").value = item.legs ?? "";
}

function wire() {
  for (const tab of $$(".tab")) {
    tab.addEventListener("click", () => {
      for (const other of $$(".tab")) other.classList.toggle("active", other === tab);
      for (const panel of $$(".panel")) panel.classList.toggle("active", panel.id === `tab-${tab.dataset.tab}`);
    });
  }

  on("#language", "change", async (event) => {
    state.language = event.target.value;
    setMessages(await loadMessages(state.language));
    saveConfig();
    applyI18n();
    say(t("web.saved"));
  });

  const drop = $("#drop");
  const input = $("#file-input");
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") input.click();
  });
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    addFiles(files);
  });
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("is-over");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    drop.addEventListener(type, () => drop.classList.remove("is-over"));
  }
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  });
  on("#upload-file", "click", () => $("#file-input")?.click());
  on("#load-demo", "click", () => void loadDemo());
  on("#drop-guide", "click", (event) => {
    // the icons sit inside the drop zone, which opens the file picker on click
    event.stopPropagation();
    state.config.guide = !(state.config.guide !== false);
    saveConfig();
    renderGuideToggle();
    scheduleExport();
  });
  on("#drop-download", "click", (event) => {
    event.stopPropagation();
    void downloadTemplateFile();
  });
  on("#drop-clear", "click", (event) => {
    event.stopPropagation();
    clearFiles();
  });

  // one drop zone / picker per sheet slot: the user says what each file is,
  // and dropping several files at once still sorts them by name.
  for (const role of SHEET_ROLES) {
    const slot = $(`#sheet-${role}-slot`);
    const input = $(`#sheet-${role}-input`);
    if (!slot || !input) {
      noteMissing(`#sheet-${role}-slot`);
      continue;
    }
    slot.addEventListener("click", () => input.click());
    slot.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => {
      const files = [...input.files];
      input.value = "";
      addSheetFiles(files, role);
    });
    for (const type of ["dragenter", "dragover"]) {
      slot.addEventListener(type, (event) => {
        event.preventDefault();
        slot.classList.add("is-over");
      });
    }
    for (const type of ["dragleave", "drop"]) {
      slot.addEventListener(type, () => slot.classList.remove("is-over"));
    }
    slot.addEventListener("drop", (event) => {
      event.preventDefault();
      addSheetFiles(event.dataTransfer.files, role);
    });
    on(`#sheet-${role}-clear`, "click", () => setSlot(role, null));
  }
  on("#upload-sheets", "click", () => $("#sheet-bulk-input")?.click());
  on("#load-sheets-demo", "click", () => void loadSheetDemo());
  on("#sheet-bulk-input", "change", (event) => {
    const files = [...event.target.files];
    // the same file may be picked again after a swap or a clear
    event.target.value = "";
    if (files.length) void addSheetFiles(files);
  });
  // the head and the legs have the same shape: this trades their places
  for (const role of ["head", "legs"]) {
    on(`#sheet-${role}-swap`, "click", (event) => {
      event.stopPropagation();
      const other = role === "head" ? "legs" : "head";
      const mine = state.sheetSlots[role];
      state.sheetSlots[role] = state.sheetSlots[other];
      state.sheetSlots[other] = mine;
      renderSlots();
    });
  }
  on("#do-pack", "click", doResourcePack);
  on("#gif-player", "change", (event) => {
    state.config.gifPlayer = event.target.checked;
    saveConfig();
    scheduleGifs();
  });
  on("#export-gif-speed", "change", (event) => {
    state.config.exportGifSpeed = event.target.value;
    saveConfig();
    scheduleExport();
  });
  on("#export-gif-size", "change", (event) => {
    state.config.exportGifSize = Number(event.target.value) || 1;
    saveConfig();
    scheduleExport();
  });
  on("#gif-play", "click", () => playPreview(!previewPlaying()));
  on("#gif-prev", "click", () => stepPreview(-1));
  on("#gif-next", "click", () => stepPreview(1));
  on("#gif-speed", "change", (event) => {
    state.config.gifSpeed = event.target.value;
    saveConfig();
    scheduleExport();
    scheduleGifs();
  });
  on("#gif-size", "change", (event) => {
    state.config.gifSize = Number(event.target.value) || 1;
    saveConfig();
    scheduleExport();
    scheduleGifs();
  });
  on("#clear-history", "click", clearHistory);
  on("#cancel-job", "click", cancelJob);

  // The history moved out of the page and behind an icon button, so it opens on
  // click and closes on a click outside or Escape.
  const historyToggle = $("#history-toggle");
  const historyPop = $("#history-pop");
  if (historyToggle && historyPop) {
    const closeHistory = () => {
      historyPop.hidden = true;
      historyToggle.setAttribute("aria-expanded", "false");
    };
    historyToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = historyPop.hidden;
      historyPop.hidden = !open;
      historyToggle.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (event) => {
      if (historyPop.hidden) return;
      if (historyPop.contains(event.target) || historyToggle.contains(event.target)) return;
      closeHistory();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || historyPop.hidden) return;
      closeHistory();
      historyToggle.focus();
    });
  }

  on("#rev-guide", "change", (event) => {
    state.config.revGuide = event.target.checked;
    saveConfig();
    // the preview is baked in the result, so rebuild the card from what it holds
    if (state.results.reverse) showResult("reverse", state.results.reverse);
  });
  on("#opt-female", "change", (event) => {
    state.config.female = event.target.checked;
    saveConfig();
    scheduleExport();
  });
  on("#opt-player", "change", (event) => {
    state.config.player = event.target.checked;
    saveConfig();
    renderFolders();
    scheduleExport();
  });

  let timer = null;
  on("#set-search", "input", (event) => {
    clearTimeout(timer);
    const value = event.target.value;
    timer = setTimeout(() => loadSetsIndex(value), 140);
  });
  on("#set-select", "change", (event) => pickSet(Number(event.target.value)));
  on("#do-reverse", "click", doReverse);
  on("#do-reverse-all", "click", doReverseAll);

  on("#pick-images", "click", pickImagesFolder);
  on("#pick-images-2", "click", pickImagesFolder);
  on("#pick-textures", "click", () => $("#texture-input")?.click());
  on("#texture-input", "change", (event) => {
    for (const file of event.target.files) state.textures.set(file.name, file);
    event.target.value = "";
    renderFolders();
    say(t("web.selected", { count: state.textures.size }));
  });

  on("#pick-output", "click", async () => {
    const handle = await pickFolder("readwrite");
    if (!handle) return;
    state.folders.output = handle;
    await putHandle(HANDLE_OUTPUT, handle);
    renderFolders();
  });
  on("#clear-output", "click", async () => {
    state.folders.output = null;
    await dropHandle(HANDLE_OUTPUT);
    renderFolders();
  });
  on("#clear-images", "click", async () => {
    state.folders.images = null;
    await dropHandle(HANDLE_IMAGES);
    renderFolders();
  });

  for (const [selector, key] of [
    ["#set-head", "id_head"],
    ["#set-body", "id_body"],
    ["#set-legs", "id_legs"],
  ]) {
    on(selector, "input", () => {
      state.config.ids = { ...state.config.ids, [key]: $(selector).value };
      saveConfig();
      scheduleExport();
    });
  }
  on("#set-skin", "change", (event) => {
    state.config.skin = Number(event.target.value) || 0;
    saveConfig();
    scheduleExport();
  });
  on("#set-glow", "change", (event) => {
    state.config.glow = event.target.checked;
    saveConfig();
    scheduleExport();
  });
  on("#set-verify", "change", (event) => {
    state.config.verify = event.target.checked;
    saveConfig();
    scheduleExport();
  });
  on("#save-settings", "click", () => {
    state.config.ids = {
      id_head: $("#set-head").value,
      id_body: $("#set-body").value,
      id_legs: $("#set-legs").value,
    };
    saveConfig();
    scheduleExport();
    say(t("web.saved"));
  });
}

async function loadMessages(language) {
  const response = await fetch("data/i18n.json");
  const payload = await response.json();
  return payload.messages[language] ?? payload.messages.zh_CN;
}

/* ----------------------------------------------------------------- boot -- */

/** The footer line: the release and, when bundled, the vanilla texture pack. */
function renderAbout() {
  const about = $("#about");
  if (!about) return;
  const vars = { version: state.version, vanilla: state.builtin?.version ?? "", count: state.builtin?.count ?? 0 };
  about.textContent = state.builtin ? t("web.aboutBuiltin", vars) : t("web.about", vars);
}

/** Show the release version from `data/version.json` in the header. */
async function showAppVersion() {
  const badge = $("#app-version");
  if (!badge) return;
  try {
    const response = await fetch(VERSION_FILE);
    if (!response.ok) throw new Error(`cannot load ${VERSION_FILE}: ${response.status}`);
    const info = await response.json();
    state.release = info.version ?? "";
    badge.textContent = state.release ? `v${state.release}` : "";
    badge.title = `${info.name ?? "ArmorHelper"} ${state.release}`.trim();
  } catch (error) {
    // a missing version file must not stop the page
    console.error(error);
  }
}

async function main() {
  try {
    // the ID column of a result card re-runs the export through this hook
    setExportScheduler(scheduleExport);
    wire();
    loadConfig();
    const [layout] = await Promise.all([loadLayout(), loadSets(), loadArmorNames()]);
    state.layout = layout;
    state.version = layout.version;
    state.defaults = layout.targets.defaults;
    setMessages(await loadMessages(state.language));
    await showAppVersion();

    $("#language").value = state.language;
    $("#opt-female").checked = !!state.config.female;
    $("#opt-player").checked = !!state.config.player;
    $("#rev-guide").checked = state.config.revGuide !== false;
    $("#gif-player").checked = !!state.config.gifPlayer;
    $("#gif-speed").value = state.config.gifSpeed ?? "fast";
    $("#gif-size").value = String(state.config.gifSize ?? 1);
    $("#export-gif-speed").value = state.config.exportGifSpeed ?? "fast";
    $("#export-gif-size").value = String(state.config.exportGifSize ?? 2);
    $("#set-head").value = state.config.ids.id_head ?? "";
    $("#set-body").value = state.config.ids.id_body ?? "";
    $("#set-legs").value = state.config.ids.id_legs ?? "";
    $("#set-skin").value = state.config.skin ?? 0;
    $("#set-glow").checked = !!state.config.glow;
    $("#set-verify").checked = !!state.config.verify;
    // restore previously used folders (permission is re-requested on demand)
    state.overlay = await loadGuideOverlay();
    state.builtin = await loadBuiltinInfo();
    state.playerParts = await loadBundledPlayerParts();
    state.folders.output = await getHandle(HANDLE_OUTPUT);
    state.folders.images = await getHandle(HANDLE_IMAGES);

    renderAbout();
    $("#do-pack").title = t("web.packHint");

    applyI18n();
    watchResultHeights();
    await loadSetsIndex("");

    // An empty set list used to fail silently; say it out loud instead.
    if (!allSets().length) {
      say(t("web.noSets"), "bad");
      return;
    }
    if (missing().length) {
      say(t("web.stalePage", { selectors: [...new Set(missing())].join(", ") }), "warn");
      return;
    }
    say(t("web.connected"));
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    say(String(error && error.message ? error.message : error), "bad");
  }
}

// Anything that escapes still has to be visible: the page has no console.
window.addEventListener("error", (event) => say(String(event.message), "bad"));
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  say(String(reason && reason.message ? reason.message : reason), "bad");
});

// Top level await: the `load` event then waits for the app to boot, which also
// makes headless `--dump-dom` runs deterministic.
await main();
