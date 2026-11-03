/**
 * ArmorHelper web front end.
 *
 * Everything happens in the browser: the sheets are generated, previewed and
 * encoded here, so the page works from any static host (GitHub Pages included)
 * with no server at all.  The core in `js/` is a port of the Python package and
 * is byte-for-byte equivalent to it (`web/tests/run.mjs` + `tests/test_web_port.py`).
 */

import {
  allSets,
  displayName,
  findSet,
  initLayout,
  initSets,
  loadLayout,
  loadSets,
  sanitizeFilename,
  searchSets,
  setLabel,
} from "./js/data.js";
import { countDifferences, stackFrames, upscale } from "./js/bitmap.js";
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
import { classifySheets, composeFrames, detectId as detectSheetId, validateSheet } from "./js/sheets.js";
import { createAtlasReader } from "./js/atlas.js";
import { gifBlob } from "./js/gif.js";
import { pngBlob } from "./js/png.js";
import { zipBlob, zipBlobAsync } from "./js/zip.js";
import {
  bitmapToDataURL,
  canUseFolders,
  decodeBitmap,
  downloadBlob,
  pickFolder,
  readFromFolder,
  writeToFolder,
} from "./js/fs.js";
import { ensurePermission, getHandle, putHandle, dropHandle } from "./js/idb.js";

const SETTINGS_KEY = "armorhelper.settings";
const HISTORY_KEY = "armorhelper.history";
const HISTORY_LIMIT = 20;
const HANDLE_OUTPUT = "output";
const HANDLE_IMAGES = "images";
/** Part numbers of ``TextureAssets.Players[skin, n]``, like the Python version. */
const PLAYER_PART_NUMBERS = { torso: 3, arm: 7, legs: 10 };

/** The three texture names for one skin (`Player_<skin>_<part>.png`). */
function playerPartNames(skin) {
  const names = {};
  for (const [part, number] of Object.entries(PLAYER_PART_NUMBERS)) {
    names[part] = `Player_${skin}_${number}.png`;
  }
  return names;
}

/** The skin chosen in the settings; the bundled art only ships skin 0. */
function currentSkin() {
  const skin = Math.floor(Number(state.config.skin) || 0);
  return skin >= 0 && skin <= 9 ? skin : 0;
}
/** The same three textures ship with the site: phones have no game folder. */
const PLAYER_DIR = "data/player";
const REVERSE_SUBDIR = "ArmorTemplate";
/** Armor textures shipped with the site, so phones work without a game folder. */
const BUILTIN_DIR = "data/vanilla";
/** Page rects for `BUILTIN_DIR`; the pages themselves are WebP (see js/atlas.js). */
const BUILTIN_INDEX = "index.json";
/** Per-frame delay of the three GIF speeds offered in the UI. */
const GIF_SPEEDS = { fast: 100, medium: 500, slow: 1000 };
/** The three sheet slots of the preview tab, in display order. */
const SHEET_ROLES = ["head", "body", "legs"];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** Elements the page failed to provide — reported in the status bar. */
const missingElements = [];

/** Bind a listener, tolerating a missing element instead of aborting boot. */
function on(selector, event, handler) {
  const element = $(selector);
  if (!element) {
    missingElements.push(selector);
    return null;
  }
  element.addEventListener(event, handler);
  return element;
}

const state = {
  messages: {},
  language: "zh_CN",
  config: null,
  files: [],
  sets: [],
  result: null,
  folders: { output: null, images: null },
  textures: new Map(), // name -> File, for browsers without folder access
  sheetSlots: { head: null, body: null, legs: null }, // {name, bitmap} per slot
  sheetIssues: [], // warnings from the last upload, as {key, vars}
  builtin: null, // {version, count, ...} when data/vanilla is bundled
  atlas: null, // texture reader over data/vanilla's packed pages
  overlay: null, // the guide layer drawn on top of templates in the preview
  playerParts: null,
  results: { export: null, gif: null, reverse: null }, // last result per panel
  job: null, // {cancelled, done, total} while a long task runs
  version: "",
};

/* ---------------------------------------------------------------- i18n -- */

function t(key, vars) {
  let text = state.messages[key] ?? key;
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value);
  return text;
}

/** Render a core warning `{ key, vars }` in the current language. */
function warnText(warning) {
  if (typeof warning === "string") return warning;
  const vars = { ...(warning.vars ?? {}) };
  if (vars.role) vars.role = t(`web.slot.${vars.role}`);
  return t(warning.key, vars);
}

function say(message, kind = "ok") {
  const el = $("#status");
  el.textContent = message;
  el.className = kind;
}

function applyI18n() {
  document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
  for (const el of $$("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of $$("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  renderTooltips();
  renderGuideToggle();
  renderFiles();
  renderSlots();
  renderFolders();
  renderHistory();
  // redraw the result cards: their captions and buttons are translated too
  for (const [panel, result] of Object.entries(state.results)) {
    if (result) showResult(panel, result);
  }
  syncResultHeights();
}

/* ------------------------------------------------------------ settings -- */

function defaultConfig() {
  return {
    language: "zh_CN",
    targets: {},
    ids: { id_head: "", id_body: "", id_legs: "" },
    glow: false,
    skin: 0,
    female: false,
    player: false,
    gifPlayer: false,
    gifSpeed: "fast",
    gifSize: 1,
    // the export page keeps its own copy: the two pages never share these
    exportGifSpeed: "fast",
    exportGifSize: 1,
    verify: false,
    guide: true,
    // the reverse page owns its own guide switch: the two pages never share one
    revGuide: true,
    // `pack.json` fields; empty means "use the default"
    pack: { name: "", author: "", description: "" },
    packTab: "144",
  };
}

function loadConfig() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    stored = {};
  }
  state.config = { ...defaultConfig(), ...stored };
  state.config.ids = { ...defaultConfig().ids, ...(stored.ids || {}) };
  state.config.pack = { ...defaultConfig().pack, ...(stored.pack || {}) };
  state.language = state.config.language || "zh_CN";
}

function saveConfig() {
  state.config.language = state.language;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.config));
}

function asId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

let armorNames = null;

/** Per-slot armor names, for the ID column. A missing file is not an error. */
async function loadArmorNames() {
  try {
    const response = await fetch("data/armor_names.json");
    if (!response.ok) return null;
    armorNames = (await response.json()).slots ?? null;
  } catch {
    armorNames = null;
  }
  return armorNames;
}

/** `head 11` -> `挖矿头盔`, or an empty string when the table has no entry. */
function armorName(part, id) {
  const entry = armorNames?.[part]?.[String(id)];
  return entry ? displayName(entry.zh) || entry.name : "";
}

/** The ids used for output names: 0 when the field is empty. */
function effectiveIds() {
  const body = asId($("#set-body")?.value) ?? 0;
  const head = asId($("#set-head")?.value) ?? body;
  const legs = asId($("#set-legs")?.value) ?? body;
  return { head, body, legs };
}

/** Original file names. They never follow the input file name. */
function outputNames() {
  const ids = effectiveIds();
  return {
    head: `Armor_Head_${ids.head}.png`,
    legs: `Armor_Legs_${ids.legs}.png`,
    body: `Armor/Armor_${ids.body}.png`,
    bodyLegacy: `Armor_Body_${ids.body}.png`,
    bodyLegacyFemale: `Female_Body_${ids.body}.png`,
    arms: `Armor_Arm_${ids.body}.png`,
  };
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
  ["#player-info", "web.playerHint"],
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
function setProgress(bar, done, total) {
  const percent = Math.round((done / Math.max(1, total)) * 100);
  const fill = bar.firstElementChild;
  if (fill) fill.style.width = `${percent}%`;
  bar.setAttribute("aria-valuenow", String(percent));
}

/** Begin a task with `total` steps: shows the progress bar and cancel button. */
function startJob(total) {
  state.job = { cancelled: false, done: 0, total };
  const bar = $("#job-bar");
  const cancel = $("#cancel-job");
  const long = total > 1;
  if (bar) {
    bar.hidden = !long;
    setProgress(bar, 0, total);
  }
  if (cancel) {
    cancel.hidden = !long;
    cancel.disabled = false;
  }
}

/** Say what step we are on; `index` is 0-based. */
function jobProgress(index, name) {
  if (!state.job) return;
  state.job.done = index;
  const bar = $("#job-bar");
  if (bar) setProgress(bar, index, state.job.total);
  say(
    t("web.progress", {
      index: Math.min(index + 1, state.job.total),
      total: state.job.total,
      name,
    }),
    "busy",
  );
}

/** True once the user pressed cancel: the loop stops at its next step. */
function jobCancelled() {
  return !!state.job?.cancelled;
}

/** Hide the bar, reset the buttons and hand back the finished job. */
function endJob() {
  const job = state.job;
  state.job = null;
  const bar = $("#job-bar");
  const cancel = $("#cancel-job");
  if (bar) {
    bar.hidden = true;
    setProgress(bar, 0, job?.total ?? 1);
  }
  if (cancel) cancel.hidden = true;
  return job;
}

function cancelJob() {
  if (!state.job) return;
  state.job.cancelled = true;
  const cancel = $("#cancel-job");
  if (cancel) cancel.disabled = true;
  say(t("web.cancelling"), "warn");
}

/* --------------------------------------------------------------- history -- */

function loadHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(stored) ? stored.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
  } catch {
    /* The history is a nicety; never fail an export because of the quota. */
  }
}

/** Remember one export: when, what, how many files, plus a small thumbnail. */
function addHistory(title, files, thumbnail) {
  const entries = loadHistory();
  entries.unshift({ at: Date.now(), title, files: files.length, thumb: thumbnail ?? null });
  saveHistory(entries);
  renderHistory();
}

function formatTime(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderHistory() {
  const list = $("#history-list");
  if (!list) return;
  const entries = loadHistory();
  // nothing recorded yet: the button would open an empty panel
  const toggle = $("#history-toggle");
  if (toggle) toggle.disabled = entries.length === 0;
  list.innerHTML = "";
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "text-body-secondary small";
    li.textContent = t("web.historyEmpty");
    list.append(li);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    if (entry.thumb) {
      const img = document.createElement("img");
      img.src = entry.thumb;
      img.alt = "";
      img.className = "pixel";
      li.append(img);
    }
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = formatTime(entry.at);
    const what = document.createElement("span");
    what.className = "what";
    what.textContent = entry.title;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = t("web.historyEntry", { count: entry.files });
    li.append(when, what, count);
    list.append(li);
  }
}

function clearHistory() {
  saveHistory([]);
  renderHistory();
  say(t("web.historyCleared"));
}

/* ------------------------------------------------------- full-body GIFs -- */

/** Per-frame delay of one page's GIF speed choice (fast / medium / slow). */
function gifDelay(speed = state.config.gifSpeed) {
  return GIF_SPEEDS[speed] ?? GIF_SPEEDS.fast;
}

/** The GIF scale chosen in the UI: 1, 2 or 4. */
function gifScale(size = state.config.gifSize) {
  const value = Math.floor(Number(size) || 1);
  return value > 1 ? value : 1;
}

/** Frames as they go into the GIF: nearest-neighbour scaled to the chosen size. */
function gifFrames(frames, size = state.config.gifSize) {
  const factor = gifScale(size);
  return factor > 1 ? frames.map((frame) => upscale(frame, factor)) : frames;
}

/** Encode a GIF with the current speed, size and frame order. */
function makeGif(frames, speed = state.config.gifSpeed, size = state.config.gifSize) {
  return gifBlob(gifFrames(frames, size), { order: gifFrameOrder(), delayMs: gifDelay(speed) });
}

/**
 * The export page owns its GIF settings.
 *
 * The speed and size selects live on the preview-sheets tab, which the user
 * cannot see from here, so sharing them would look like a bug.
 */
const exportGif = () => ({
  speed: state.config.exportGifSpeed ?? "fast",
  size: state.config.exportGifSize ?? 1,
});

/* ------------------------------------------------------- preview sheets -- */

const SLOT_LABEL = { head: "web.slot.head", body: "web.slot.body", legs: "web.slot.legs" };
const SLOT_HINT = { head: "web.slot.headDrop", body: "web.slot.bodyDrop", legs: "web.slot.legsDrop" };

/** Show what each of the three slots holds, and what is still missing. */
function renderSlots() {
  const missing = SHEET_ROLES.filter((role) => !state.sheetSlots[role]);
  for (const role of SHEET_ROLES) {
    const slot = $(`#sheet-${role}-slot`);
    const hint = $(`#sheet-${role}-hint`);
    const info = $(`#sheet-${role}-name`);
    const clear = $(`#sheet-${role}-clear`);
    if (!slot || !hint || !info || !clear) continue;
    const entry = state.sheetSlots[role];
    const thumb = $(`#sheet-${role}-thumb`);
    slot.closest(".slot")?.classList.toggle("is-filled", !!entry);
    if (thumb) {
      thumb.hidden = !entry;
      if (entry && thumb.getAttribute("src") !== (entry.url ?? "")) {
        // keep the data URL on the entry: re-rendering must not re-encode the sheet
        if (!entry.url) entry.url = keepUrl(entry.bitmap);
        thumb.src = entry.url;
      }
    }
    // the hint fills the box while it is empty; a filled box shows the sheet only
    hint.hidden = !!entry;
    if (!entry) hint.textContent = t(SLOT_HINT[role]);
    info.hidden = !entry;
    if (entry) info.textContent = `${entry.name} · ${entry.bitmap.width}×${entry.bitmap.height}`;
    clear.hidden = !entry;
  }

  const status = $("#sheet-status");
  if (status) {
    // a filled slot shows its own tick, so only the gaps and the warnings go here
    const lines = [];
    if (missing.length) {
      lines.push(
        t("web.gifsMissing", { roles: missing.map((role) => t(SLOT_LABEL[role])).join(" / ") }),
      );
    }
    if (state.sheetIssues?.length) lines.push(...state.sheetIssues.map(warnText));
    status.textContent = lines.join("\n");
  }
  for (const selector of ["#do-gifs", "#do-pack"]) {
    const button = $(selector);
    if (button) button.disabled = missing.length > 0;
  }
}

/** Put one decoded file in a slot, validating it against that role. */
function setSlot(role, entry, issues = []) {
  if (entry) {
    try {
      validateSheet(role, entry.bitmap);
      state.sheetSlots[role] = entry;
    } catch (error) {
      issues.push({
        key: error.key ?? "web.sheetWarnBadRatio",
        vars: { name: entry.name, ...(error.vars ?? {}) },
      });
    }
  } else {
    state.sheetSlots[role] = null;
  }
  state.sheetIssues = issues;
  renderSlots();
}

/**
 * Files dropped on a slot: one file fills that slot, several are sorted by
 * name/dimensions (which is what makes "any order" uploads work).
 */
async function addSheetFiles(fileList, role = null) {
  const items = [];
  for (const file of fileList) {
    if (!/\.(png|bmp)$/i.test(file.name)) continue;
    try {
      items.push({ name: file.name, bitmap: await decodeBitmap(file) });
    } catch (error) {
      console.error(error);
      say(t("web.dropped", { name: file.name }), "warn");
    }
  }
  if (!items.length) return;

  if (role && items.length === 1) {
    setSlot(role, items[0]);
    return;
  }

  const classified = classifySheets(items);
  const issues = [...classified.warnings];
  for (const kind of SHEET_ROLES) {
    if (!classified[kind]) continue;
    if (state.sheetSlots[kind]) {
      issues.push({ key: "web.sheetWarnDuplicate", vars: { role: kind, name: classified.names[kind] } });
      continue;
    }
    state.sheetSlots[kind] = { name: classified.names[kind], bitmap: classified[kind] };
  }
  state.sheetIssues = issues;
  renderSlots();
}

/**
 * A Terraria resource pack (`<name>-pack-pc.zip`), the layout the game reads:
 *
 *     pack.json
 *     Content/Images/Armor_Head_<id>.png
 *     Content/Images/Armor_Legs_<id>.png
 *     Content/Images/Armor/Armor_<id>.png
 *
 * `pack.json` carries the display name; the zip's own name is what the game
 * lists in `ResourcePacks/`, so it stays ASCII (`Armor_<id>`).
 */
async function resourcePackBlob({ head, legs, body }, id, info = {}) {
  // an empty field means "use the default", so the inputs can stay blank
  const pack = {
    Name: (info.name ?? "").trim() || t("web.packDefaultName"),
    Author: (info.author ?? "").trim() || t("web.packDefaultAuthor"),
    Description: (info.description ?? "").trim() || t("web.packDescription"),
    Version: { major: 1, minor: 0 },
  };
  const png = async (bitmap) => (await pngBlob(bitmap)).arrayBuffer();

  const entries = [
    { name: "pack.json", data: `${JSON.stringify(pack, null, 2)}\n` },
    { name: "Content/", data: new Uint8Array(0) },
    { name: "Content/Images/", data: new Uint8Array(0) },
    { name: `Content/Images/Armor_Head_${id}.png`, data: await png(head) },
    { name: `Content/Images/Armor_Legs_${id}.png`, data: await png(legs) },
    { name: "Content/Images/Armor/", data: new Uint8Array(0) },
    { name: `Content/Images/Armor/Armor_${id}.png`, data: await png(body) },
  ];
  return zipBlob(entries);
}

/**
 * The same five sheets for Terraria 1.3, which had no resource packs.
 *
 * The zip keeps the game's folder layout so it can be unpacked next to
 * `Content/Images`, but it carries no `pack.json`: 1.3 never reads one.
 */
async function legacyPackBlob({ head, legs, body, female, arms }, id) {
  const png = async (bitmap) => (await pngBlob(bitmap)).arrayBuffer();
  const entries = [
    { name: "Content/", data: new Uint8Array(0) },
    { name: "Content/Images/", data: new Uint8Array(0) },
    { name: `Content/Images/Armor_Head_${id}.png`, data: await png(head) },
    { name: `Content/Images/Armor_Legs_${id}.png`, data: await png(legs) },
    { name: `Content/Images/Armor_Body_${id}.png`, data: await png(body) },
    { name: `Content/Images/Female_Body_${id}.png`, data: await png(female) },
    { name: `Content/Images/Armor_Arm_${id}.png`, data: await png(arms) },
  ];
  return zipBlob(entries);
}

async function doResourcePack() {
  const missing = SHEET_ROLES.filter((role) => !state.sheetSlots[role]);
  if (missing.length) {
    say(t("web.gifsNeed"), "warn");
    return;
  }

  $("#do-pack").disabled = true;
  say(t("web.working"), "busy");
  try {
    const ids = effectiveIds();
    const detected = detectSheetId(state.sheetSlots.body.name);
    const id = detected ?? ids.body ?? 0;
    const warnings = detected === null && ids.body === null ? [t("web.packNoId")] : [];

    const item = findSet(id);
    const friendly = (item && (displayName(item.zh) || item.name)) || `Armor_${id}`;
    const slug = `Armor_${id}`;
    const zipName = `${slug}-pack-pc.zip`;
    const bitmaps = {
      head: state.sheetSlots.head.bitmap,
      legs: state.sheetSlots.legs.bitmap,
      body: state.sheetSlots.body.bitmap,
    };

    const blob = await resourcePackBlob(bitmaps, id);
    const url = URL.createObjectURL(blob);
    const result = {
      title: friendly,
      titleKey: "web.packTitle",
      titleVars: { name: friendly },
      previews: [],
      files: [{ name: zipName, size: blob.size, url }],
      warnings,
      zip: { save: () => downloadBlob(blob, zipName) },
      save: {
        save: async () => {
          const folder = await ensureOutputFolder();
          if (!folder) return;
          await writeToFolder(folder, zipName, blob);
          say(t("web.savedTo", { count: 1 }));
        },
      },
    };

    showResult("gif", result);
    addHistory(slug, [{ name: zipName }], keepUrl(state.sheetSlots.body.bitmap));
    say(t("web.packDone", { name: zipName, size: Math.max(1, Math.round(blob.size / 1024)) }));
  } catch (error) {
    console.error(error);
    say(String(error.message || error), "bad");
  } finally {
    $("#do-pack").disabled = SHEET_ROLES.some((role) => !state.sheetSlots[role]);
  }
}

/** File name stem of the body sheet, used when it has no vanilla id. */
function sheetStem(name) {
  const base = String(name ?? "Armor")
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "");
  return sanitizeFilename(base || "Armor");
}

/** Build a result object with the 20 frame PNGs plus the animated GIFs. */
async function packSheetGifs(title, entries, gifs, warnings = [], previewFrames = []) {
  const blobs = [];
  const files = [];

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
  for (const item of gifs) {
    const shown = gifFrames(item.frames);
    const blob = gifBlob(shown, { order: gifFrameOrder(), delayMs: gifDelay() });
    blobs.push({ name: item.name, blob });
    files.push({
      name: item.name,
      width: shown[0].width,
      height: shown[0].height,
      size: blob.size,
      url: URL.createObjectURL(blob),
    });
    previews.push({ url: URL.createObjectURL(blob), captionKey: item.captionKey });
  }
  if (previewFrames.length) {
    previews.push({
      url: keepUrl(contactSheet(previewFrames)),
      captionKey: "web.previewFrames",
    });
  }

  return {
    title,
    files,
    previews,
    warnings,
    zip: {
      save: async () => downloadBlob(await zipBlobAsync(blobs), `${sanitizeFilename(title)}.zip`),
    },
    save: {
      save: async () => {
        const folder = await ensureOutputFolder();
        if (!folder) return;
        for (const item of blobs) await writeToFolder(folder, item.name, item.blob);
        say(t("web.savedTo", { count: blobs.length }));
      },
    },
  };
}

async function doGifs() {
  const missing = SHEET_ROLES.filter((role) => !state.sheetSlots[role]);
  if (missing.length) {
    say(t("web.gifsNeed"), "warn");
    return;
  }

  $("#do-gifs").disabled = true;
  say(t("web.working"), "busy");
  try {
    const input = {
      head: state.sheetSlots.head.bitmap,
      body: state.sheetSlots.body.bitmap,
      legs: state.sheetSlots.legs.bitmap,
    };
    const frames = composeFrames(input);
    const femaleFrames = composeFrames({ ...input, female: true });
    const bodyId = detectSheetId(state.sheetSlots.body.name);
    const stem = bodyId !== null ? `Armor_${bodyId}` : sheetStem(state.sheetSlots.body.name);
    const warnings = (state.sheetIssues ?? []).map(warnText);

    const entries = [
      { name: `${stem}_FullArmor.png`, bitmap: stackFrames(frames) },
      { name: `${stem}_FullArmorFemale.png`, bitmap: stackFrames(femaleFrames) },
    ];
    const gifs = [
      { name: `${stem}_FullArmor.gif`, frames, captionKey: "web.gifMale" },
      { name: `${stem}_FullArmorFemale.gif`, frames: femaleFrames, captionKey: "web.gifFemale" },
    ];

    if ($("#gif-player").checked) {
      const parts = await loadPlayerParts();
      if (!parts) {
        warnings.push(t("web.gifPlayerHint"));
      } else {
        // Player art is always native 2x, so upscale 1x sheets first.
        const factor = frames[0].width === 40 ? 1 : 40 / frames[0].width;
        const withPlayer = (list, isFemale) => {
          const armor = factor === 1 ? list : list.map((frame) => upscale(frame, factor));
          return overlay(tintFrames(playerFrames(parts, isFemale), SKIN_TINT), armor);
        };
        const playerMale = withPlayer(frames, false);
        const playerFemale = withPlayer(femaleFrames, true);
        entries.push(
          { name: `${stem}_FullArmorPlayer.png`, bitmap: stackFrames(playerMale) },
          { name: `${stem}_FullArmorPlayerFemale.png`, bitmap: stackFrames(playerFemale) },
        );
        gifs.push(
          { name: `${stem}_FullArmorPlayer.gif`, frames: playerMale, captionKey: "web.gifMalePlayer" },
          {
            name: `${stem}_FullArmorPlayerFemale.gif`,
            frames: playerFemale,
            captionKey: "web.gifFemalePlayer",
          },
        );
      }
    }

    const result = await packSheetGifs(stem, entries, gifs, warnings, frames);
    showResult("gif", result);
    addHistory(stem, result.files, keepUrl(frames[0]));
    say(t("web.gifsDone", { count: gifs.length }));
  } catch (error) {
    console.error(error);
    say(String(error.message || error), "bad");
  } finally {
    $("#do-gifs").disabled = SHEET_ROLES.some((role) => !state.sheetSlots[role]);
  }
}

/** Which vanilla textures the reverse conversion will use, in words. */
function textureSourceLabel() {
  if (state.folders.images) return t("web.usingFolder", { name: state.folders.images.name });
  if (state.textures.size) return t("web.usingUploads", { count: state.textures.size });
  if (state.builtin) {
    return t("web.builtinTextures", {
      version: state.builtin.version,
      count: state.builtin.count,
    });
  }
  return canUseFolders ? t("web.needTextures") : t("web.noFolderSupport");
}

function renderFolders() {
  const output = state.folders.output;
  const outputText = output ? t("web.outputName", { name: output.name }) : (canUseFolders ? "" : t("web.noFolderSupport"));
  const imagesText = textureSourceLabel();

  $("#output-status").textContent = outputText;
  $("#images-status").textContent = imagesText;
  $("#images-status-2").textContent = imagesText;

  // The player textures are bundled now, so the note lives in the info icon's
  // tooltip instead of a paragraph that has to be shown and hidden.
}

/**
 * Keep the results card as tall as the input card next to it while it is empty.
 * Once there are results the inline min-height is dropped, so the card grows
 * with its content instead of being pinned to whatever the inputs needed.
 */
function syncResultHeights() {
  for (const card of $$(".results-card")) {
    const panel = card.closest(".panel");
    const left = panel?.querySelector(".stack > .card");
    if (!left) continue;
    const filled = !!card.querySelector(".job");
    card.style.minHeight = filled ? "" : `${Math.round(left.getBoundingClientRect().height)}px`;
  }
}

/** Re-measure on layout changes (file list grows, language switch, resize). */
function watchResultHeights() {
  syncResultHeights();
  window.addEventListener("resize", syncResultHeights);
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => syncResultHeights());
  for (const card of $$(".results-card")) {
    const left = card.closest(".panel")?.querySelector(".stack > .card");
    if (left) observer.observe(left);
  }
}

/** Where each panel shows its result. */
const RESULT_HOSTS = { export: "#results", gif: "#gif-results", reverse: "#reverse-result" };

/** Show `result` in one panel's result area and remember it for redraws. */
function showResult(panel, results) {
  const host = $(RESULT_HOSTS[panel]);
  if (!host) return;
  // a panel may show several cards: one per material pack, then the preview
  const list = Array.isArray(results) ? results : [results];
  state.results[panel] = list;
  host.innerHTML = "";
  for (const item of list) host.append(resultCard(item, host));
  syncResultHeights();
}

/** Drop one panel's result and put the empty line back. */
function clearResult(panel) {
  state.results[panel] = null;
  const host = $(RESULT_HOSTS[panel]);
  if (host) {
    host.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "text-body-secondary mb-0";
    empty.textContent = t("web.empty");
    host.append(empty);
  }
  if (panel === "export") setPreviewGif(null);
  syncResultHeights();
}

/**
 * The export zip button sits in the input card's action row, not in the result
 * card, so it keeps a reference to the current result instead of being redrawn
 * with it.
 */
/** The 20 frame animation that sits next to the drop area. */
function setPreviewGif(url) {
  const image = $("#preview-gif");
  if (!image) return;
  image.hidden = !url;
  if (url) image.src = url;
  else image.removeAttribute("src");
}

/** One captioned preview: a checkerboard tile with the label underneath. */
/** The caption of a preview: `captionKey` is translated now, `caption` is literal. */
function previewCaption(item) {
  if (!item) return "";
  return item.captionKey ? t(item.captionKey, item.captionVars) : (item.caption ?? "");
}

function previewFigure(url, caption, alt) {
  const figure = document.createElement("figure");
  figure.className = "preview";
  const img = document.createElement("img");
  img.src = url;
  img.alt = alt ?? caption;
  img.className = "pixel";
  figure.append(img);
  if (caption) {
    const label = document.createElement("figcaption");
    label.textContent = caption;
    figure.append(label);
  }
  return figure;
}

/**
 * The "make resource pack" button of a material pack card.
 *
 * The zip is built on click: most visits never press it, and a resource pack
 * is the one output large enough to notice.
 */
function packButton(pack) {
  const button = document.createElement("button");
  button.className = "btn btn-sm btn-primary";
  button.textContent = t(pack.labelKey);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      downloadBlob(await pack.run(), pack.name);
    } catch (error) {
      console.error(error);
      say(String(error.message || error), "bad");
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

/**
 * Reveal the scrollbar of `element` only while it moves.
 *
 * The thumb is transparent at rest, so a long sheet list does not sit behind a
 * permanent grey bar; hover still shows it (see `.thin-scroll` in style.css).
 */
function thinScroll(element) {
  let timer = null;
  element.addEventListener(
    "scroll",
    () => {
      element.classList.add("is-scrolling");
      clearTimeout(timer);
      timer = setTimeout(() => element.classList.remove("is-scrolling"), 700);
    },
    { passive: true },
  );
  return element;
}

/** The `pack.json` fields: empty means the default is used. */
const PACK_FIELDS = [
  ["name", "web.packName", "is-short"],
  ["author", "web.packAuthor", "is-short"],
  ["description", "web.packDescription", "is-long"],
];

function packInfoInputs() {
  const group = document.createElement("div");
  group.className = "input-group input-group-sm pack-info";
  for (const [field, key, size] of PACK_FIELDS) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = `form-control ${size}`;
    input.placeholder = t(key);
    input.setAttribute("aria-label", t(key));
    input.value = state.config.pack?.[field] ?? "";
    input.addEventListener("input", () => {
      state.config.pack = { ...(state.config.pack ?? {}), [field]: input.value };
      saveConfig();
    });
    group.append(input);
  }
  return group;
}

/**
 * The result block: the era tabs, then the actions and the content of the
 * active one.
 *
 * It is not a card any more: the results sit directly under the input card, so
 * there is no title and no frame around them.
 */
function packCardBody(tabs) {
  const wrap = document.createElement("div");
  wrap.className = "pack";
  const active = tabs.find((tab) => tab.id === state.config.packTab) ?? tabs[0];

  if (tabs.length > 1) {
    const nav = document.createElement("div");
    nav.className = "nav nav-underline pack-tabs";
    for (const tab of tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `nav-link${tab.id === active.id ? " active" : ""}`;
      button.textContent = t(tab.labelKey);
      button.addEventListener("click", () => {
        state.config.packTab = tab.id;
        saveConfig();
        // the card is cheap to rebuild: no sheet is generated again
        showResult("export", state.results.export);
      });
      nav.append(button);
    }
    wrap.append(nav);
  }

  // the export actions belong to the tab whose files they hand out
  const bar = document.createElement("div");
  bar.className = "pack-actions";
  if (active.pack) {
    bar.append(packButton(active.pack));
    if (active.pack.fields) bar.append(packInfoInputs());
  }
  wrap.append(bar);

  const body = thinScroll(document.createElement("div"));
  body.className = "sheet-body thin-scroll";
  if (active.hint) {
    const hint = document.createElement("p");
    hint.className = "text-body-secondary small mb-0";
    hint.textContent = t(active.hint);
    body.append(hint);
  } else {
    body.append(
      sheetTable(active.table, { idColumn: active.idColumn }),
      sheetColumns(active.columns),
    );
  }
  wrap.append(body);
  return wrap;
}

/** Name, size and purpose of every file in a material pack. */
function sheetTable(rows = [], options = {}) {
  const table = document.createElement("table");
  table.className = "sheet-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const headings = ["web.table.file", "web.table.size", "web.table.content"];
  if (options.idColumn) headings.push("web.table.id");
  for (const key of headings) {
    const cell = document.createElement("th");
    cell.textContent = t(key);
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = row.url;
    link.download = row.name.split("/").pop();
    link.textContent = row.name;
    for (const type of ["mouseenter", "focus"]) link.addEventListener(type, () => showFilePreview(row.url, link));
    for (const type of ["mouseleave", "blur"]) link.addEventListener(type, hideFilePreview);
    nameCell.append(link);

    const sizeCell = document.createElement("td");
    sizeCell.textContent = `${row.width}×${row.height}`;
    const descCell = document.createElement("td");
    descCell.textContent = t(row.descKey);
    tr.append(nameCell, sizeCell, descCell);
    if (options.idColumn) tr.append(idCell(row.part));
    body.append(tr);
  }
  table.append(body);
  return table;
}

/** Which settings field feeds one part of the sheet set. */
const PART_ID = { head: "#set-head", body: "#set-body", legs: "#set-legs" };

/**
 * The ID cell of one table row: the number, plus the vanilla name it maps to.
 *
 * The three parts of a set can use different ids, so each row owns its own
 * input. Editing it writes the settings field and redraws, which renames every
 * file in the tab.
 */
function idCell(part) {
  const cell = document.createElement("td");
  cell.className = "id-cell";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = "999";
  input.className = "form-control form-control-sm sheet-id";
  input.value = String(effectiveIds()[part]);
  input.setAttribute("aria-label", t("web.table.id"));
  input.dataset.part = part;

  const name = document.createElement("span");
  name.className = "id-name";
  name.textContent = armorName(part, input.value);

  input.addEventListener("input", () => {
    name.textContent = armorName(part, input.value);
  });
  input.addEventListener("change", () => {
    const field = $(PART_ID[part]);
    if (field) field.value = input.value;
    saveConfig();
    scheduleExport();
  });

  cell.append(input, name);
  return cell;
}

/** The sheets themselves, one column per file, scrolled vertically. */
function sheetColumns(columns) {
  const strip = document.createElement("div");
  strip.className = "sheet-cols";
  for (const column of columns ?? []) {
    const figure = document.createElement("figure");
    figure.className = "sheet-col";
    const label = document.createElement("figcaption");
    label.textContent = t(column.labelKey);
    // hovering the caption names the file: the label alone does not say which
    label.dataset.tooltip = column.name ?? "";
    label.classList.add("tip-left");
    const img = document.createElement("img");
    img.src = column.url;
    img.alt = t(column.labelKey);
    img.className = "pixel";
    // every sheet is drawn at its own pixel size, so the three parts keep their
    // real proportions instead of each filling its column
    img.width = column.width;
    img.height = column.height;
    figure.append(label, img);
    strip.append(figure);
  }
  return strip;
}

function resultCard(result, host = $("#results")) {
  // the export result is a bare block; the other panels keep their card look
  const bare = !!result.tabs?.length;
  const card = document.createElement("div");
  card.className = bare ? "result-block" : "job";

  if (!bare) {
    const heading = document.createElement("h3");
    heading.textContent = result.titleKey
      ? `${t(result.titleKey, result.titleVars)}${result.titleSuffix ?? ""}`
      : result.title;
    card.append(heading);
  }

  const previews = document.createElement("div");
  previews.className = "previews";
  for (const item of result.previews ?? []) {
    // a template preview is drawn now, so this page's guide switch applies at once
    if (item.template) {
      previews.append(
        previewFigure(
          keepUrl(magnify(withGuide(item.template, state.config.revGuide !== false), 4)),
          previewCaption(item),
          item.alt,
        ),
      );
      continue;
    }
    previews.append(previewFigure(item.url, previewCaption(item), item.alt));
  }
  if (previews.childElementCount) card.append(previews);

  // the 材质包 card: actions, the era tabs, then the active tab's content
  if (result.tabs?.length) card.append(packCardBody(result.tabs));

  const list = thinScroll(document.createElement("ul"));
  list.className = "files thin-scroll";
  for (const file of result.files ?? []) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = file.url;
    link.download = file.name.split("/").pop();
    link.textContent = file.name;
    if (file.width && file.height) {
      const meta = document.createElement("span");
      meta.className = "text-body-secondary";
      meta.textContent = `${file.width}×${file.height}px`;
      li.append(link, meta);
      // the file's own pixels, shown while the link is hovered
      for (const type of ["mouseenter", "focus"]) link.addEventListener(type, () => showFilePreview(file.url, link));
      for (const type of ["mouseleave", "blur"]) link.addEventListener(type, hideFilePreview);
    } else {
      li.append(link);
    }
    list.append(li);
  }
  if (result.files?.length) card.append(list);

  const actions = document.createElement("div");
  actions.className = "actions";
  // NB: the locals must not be called `zip` / `save` — that would shadow
  // `result.zip` / `result.save` and make the click handler call the <button>.
  if (result.zip && result.zipInCard !== false) {
    const zipButton = document.createElement("button");
    zipButton.className = "btn btn-sm btn-secondary";
    zipButton.textContent = t("web.zip");
    zipButton.addEventListener("click", () => result.zip.save());
    actions.append(zipButton);
  }
  if (result.save) {
    const saveButton = document.createElement("button");
    saveButton.className = "btn btn-sm btn-secondary";
    saveButton.textContent = t("web.saveToOutput");
    saveButton.disabled = !state.folders.output && !canUseFolders;
    saveButton.addEventListener("click", () => result.save.save());
    actions.append(saveButton);
  }
  if (actions.childElementCount) card.append(actions);

  for (const warning of result.warnings ?? []) {
    const p = document.createElement("p");
    p.className = "warn";
    p.textContent = warning;
    card.append(p);
  }
  return card;
}

/* -------------------------------------------------------------- helpers -- */

/**
 * One floating preview reused by every result link.
 *
 * It is created on demand and kept out of the HTML, so this module never looks
 * it up by id (the site test treats those lookups as required page elements).
 */
let filePreview = null;

function previewBox() {
  if (filePreview) return filePreview;
  const box = document.createElement("div");
  box.className = "file-preview";
  box.hidden = true;
  const img = document.createElement("img");
  img.className = "pixel";
  img.alt = "";
  box.append(img);
  document.body.append(box);
  filePreview = box;
  return box;
}

/** Show `url` next to `anchor`, kept inside the viewport. */
function showFilePreview(url, anchor) {
  const box = previewBox();
  const img = box.firstElementChild;
  if (img.getAttribute("src") !== url) img.src = url;
  box.hidden = false;
  // measure after the image has a size, or the box is placed for a 0x0 box
  const place = () => {
    const rect = anchor.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    const gap = 8;
    const left = rect.right + gap + size.width > window.innerWidth
      ? Math.max(gap, rect.left - size.width - gap)
      : rect.right + gap;
    const top = Math.max(gap, Math.min(rect.top, window.innerHeight - size.height - gap));
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  };
  if (img.complete) place();
  else img.addEventListener("load", place, { once: true });
}

function hideFilePreview() {
  if (filePreview) filePreview.hidden = true;
}

function keepUrl(bitmap) {
  return bitmapToDataURL(bitmap);
}

/** The template as it should be shown: with the guide layer, when enabled. */
function withGuide(template, enabled) {
  return enabled ? composeOverlay(template, state.overlay) : template;
}

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

async function ensureOutputFolder() {
  if (!state.folders.output) {
    if (!canUseFolders) {
      say(t("web.noFolderSupport"), "warn");
      return null;
    }
    const handle = await pickFolder("readwrite");
    if (!handle) return null;
    state.folders.output = handle;
    await putHandle(HANDLE_OUTPUT, handle);
    renderFolders();
  }
  if (!(await ensurePermission(state.folders.output, "readwrite"))) {
    say(t("web.needOutput"), "warn");
    return null;
  }
  return state.folders.output;
}

/** The player textures bundled with the site (works on any browser, offline too). */
async function loadBundledPlayerParts() {
  // only skin 0 is bundled; another skin falls back to it
  for (const skin of [currentSkin(), 0]) {
    try {
      const [torso, arm, legs] = await Promise.all(
        Object.values(playerPartNames(skin)).map(async (name) => {
          const response = await fetch(`${PLAYER_DIR}/${name}`);
          if (!response.ok) throw new Error(name);
          return decodeBitmap(await response.blob());
        }),
      );
      return { torso, arm, legs, skin };
    } catch {
      /* try the next skin */
    }
  }
  return null;
}

/**
 * The player body used by "overlay player": the user's `Content/Images` when a
 * Chromium folder is available (they may have retextured it), otherwise the
 * copies shipped in `data/player/`.
 */
async function loadPlayerParts() {
  const images = state.folders.images;
  const skin = currentSkin();
  if (images && (await ensurePermission(images, "read"))) {
    try {
      const [torso, arm, legs] = await Promise.all(
        Object.values(playerPartNames(skin)).map(async (name) =>
          decodeBitmap(await readFromFolder(images, name)),
        ),
      );
      return { torso, arm, legs, skin };
    } catch {
      /* fall through to the bundled copies */
    }
  }
  return loadBundledPlayerParts();
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
    for (const [name, frames, labelKey] of [
      ["FullArmor.png", () => maleFrames, "web.gifMale"],
      ["FullArmorFemale.png", () => femaleFrames, "web.gifFemale"],
      ["FullArmorPlayer.png", () => playerMale, "web.gifMalePlayer"],
      ["FullArmorPlayerFemale.png", () => playerFemale, "web.gifFemalePlayer"],
    ]) {
      const bitmap = stackFrames(frames());
      fullRows.push(
        await blobRow(name, await pngBlob(bitmap), bitmap.width, bitmap.height, "web.sheetDesc.full", labelKey),
      );
    }
    for (const [name, frames, labelKey] of [
      ["FullArmor.gif", () => maleFrames, "web.gifMale"],
      ["FullArmorFemale.gif", () => femaleFrames, "web.gifFemale"],
      ["FullArmorPlayer.gif", () => playerMale, "web.gifMalePlayer"],
      ["FullArmorPlayerFemale.gif", () => playerFemale, "web.gifFemalePlayer"],
    ]) {
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
    setPreviewGif(URL.createObjectURL(makeGif(previewFrames, exportGif().speed, exportGif().size)));
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
 * compare the regenerated sheets with the originals.  This is the same
 * guarantee the Python test suite asserts.
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

/**
 * A reader for vanilla textures, in order of preference:
 *
 * 1. the `Content/Images` folder the user picked (Chromium only),
 * 2. files the user uploaded by hand,
 * 3. the textures bundled with the site — this is what makes the reverse
 *    conversion usable on a phone, where neither of the first two exists.
 */
function textureReader() {
  const folder = state.folders.images;
  let permission = null;

  return async (path) => {
    if (folder) {
      if (permission === null) permission = await ensurePermission(folder, "read");
      if (permission) {
        try {
          return await decodeBitmap(await readFromFolder(folder, path));
        } catch {
          /* fall through to the next source */
        }
      }
    }
    const file = state.textures.get(path.split("/").pop());
    if (file) return decodeBitmap(file);
    if (state.atlas) {
      try {
        const bitmap = await state.atlas(path);
        if (bitmap) return bitmap;
      } catch (error) {
        console.error(error);
      }
    }
    return null;
  };
}

/** Read `data/vanilla/version.txt` and the atlas index; absent means nothing is bundled. */
async function loadBuiltinInfo() {
  try {
    const response = await fetch(`${BUILTIN_DIR}/version.txt`);
    if (!response.ok) return null;
    const info = {};
    for (const line of (await response.text()).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, value] = trimmed.split("=", 2);
      info[key.trim()] = value.trim();
    }
    info.count = Number(info.count) || 0;
    if (!info.count) return null;

    // The textures live in a few WebP pages; `index.json` says which rect of
    // which page holds each game path.
    const indexResponse = await fetch(`${BUILTIN_DIR}/${BUILTIN_INDEX}`);
    if (!indexResponse.ok) return null;
    state.atlas = createAtlasReader({
      index: await indexResponse.json(),
      loadPage: async (file) => {
        const page = await fetch(`${BUILTIN_DIR}/${file}`);
        if (!page.ok) return null;
        return decodeBitmap(await page.blob());
      },
    });
    return info;
  } catch (error) {
    console.error(error);
    return null;
  }
}

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

async function pickImagesFolder() {
  if (!canUseFolders) {
    say(t("web.noFolderSupport"), "warn");
    return;
  }
  const handle = await pickFolder("read");
  if (!handle) return;
  state.folders.images = handle;
  await putHandle(HANDLE_IMAGES, handle);
  renderFolders();
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
    state.messages = (await loadMessages(state.language));
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
      missingElements.push(`#sheet-${role}-slot`);
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
  on("#clear-sheets", "click", () => {
    state.sheetSlots = { head: null, body: null, legs: null };
    state.sheetIssues = [];
    renderSlots();
  });
  on("#do-gifs", "click", doGifs);
  on("#do-pack", "click", doResourcePack);
  on("#gif-player", "change", (event) => {
    state.config.gifPlayer = event.target.checked;
    saveConfig();
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
  on("#gif-speed", "change", (event) => {
    state.config.gifSpeed = event.target.value;
    saveConfig();
    scheduleExport();
  });
  on("#gif-size", "change", (event) => {
    state.config.gifSize = Number(event.target.value) || 1;
    saveConfig();
    scheduleExport();
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

async function main() {
  try {
    wire();
    loadConfig();
    const [layout] = await Promise.all([loadLayout(), loadSets(), loadArmorNames()]);
    state.layout = layout;
    state.version = layout.version;
    state.defaults = layout.targets.defaults;
    state.messages = await loadMessages(state.language);

    $("#language").value = state.language;
    $("#opt-female").checked = !!state.config.female;
    $("#opt-player").checked = !!state.config.player;
    $("#rev-guide").checked = state.config.revGuide !== false;
    $("#gif-player").checked = !!state.config.gifPlayer;
    $("#gif-speed").value = state.config.gifSpeed ?? "fast";
    $("#gif-size").value = String(state.config.gifSize ?? 1);
    $("#export-gif-speed").value = state.config.exportGifSpeed ?? "fast";
    $("#export-gif-size").value = String(state.config.exportGifSize ?? 1);
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

    const builtin = state.builtin
      ? ` · 内置原版贴图 ${state.builtin.version}（${state.builtin.count} 张）`
      : "";
    $("#about").textContent = `ArmorHelper ${state.version} · 纯前端，无服务端${builtin}`;
    $("#do-pack").title = t("web.packHint");

    applyI18n();
    watchResultHeights();
    await loadSetsIndex("");

    // An empty set list used to fail silently; say it out loud instead.
    if (!allSets().length) {
      say(t("web.noSets"), "bad");
      return;
    }
    if (missingElements.length) {
      say(t("web.stalePage", { selectors: [...new Set(missingElements)].join(", ") }), "warn");
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
