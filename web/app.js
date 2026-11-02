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
import { countDifferences, cropRegion, stackFrames, upscale } from "./js/bitmap.js";
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
import { gifBlob } from "./js/gif.js";
import { pngBlob } from "./js/png.js";
import { zipBlob } from "./js/zip.js";
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
const PLAYER_PARTS = { torso: "Player_0_3.png", arm: "Player_0_7.png", legs: "Player_0_10.png" };
/** The same three textures ship with the site: phones have no game folder. */
const PLAYER_DIR = "data/player";
const REVERSE_SUBDIR = "ArmorTemplate";
/** Armor textures shipped with the site, so phones work without a game folder. */
const BUILTIN_DIR = "data/vanilla";
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
  overlay: null, // the guide layer drawn on top of templates in the preview
  templateBitmap: null, // the raw 128x80 template, for the hover popover
  playerParts: null,
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
  renderTargets();
  renderFiles();
  renderSlots();
  renderFolders();
  renderHistory();
  if (state.result) renderResult(state.result);
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
    verify: false,
    guide: true,
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
  state.language = state.config.language || "zh_CN";
}

function saveConfig() {
  state.config.language = state.language;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.config));
}

function isTargetOn(name) {
  const value = state.config.targets?.[name];
  return value === undefined ? state.defaults.includes(name) : !!value;
}

function asId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

/** The ids actually used for output names (body fills in the blanks). */
function effectiveIds() {
  const head = asId($("#set-head").value);
  const body = asId($("#set-body").value);
  const legs = asId($("#set-legs").value);
  return {
    head: head ?? body,
    body,
    legs: legs ?? body,
  };
}

function outputNames(stem) {
  const ids = effectiveIds();
  if (ids.body === null && ids.head === null && ids.legs === null) {
    return {
      head: `${stem}_Head.png`,
      legs: `${stem}_Legs.png`,
      body: `${stem}_Body.png`,
      bodyLegacy: `${stem}_BodyLegacy.png`,
      bodyLegacyFemale: `${stem}_BodyLegacyFemale.png`,
      arms: `${stem}_ArmsLegacy.png`,
    };
  }
  const bodyId = ids.body ?? ids.head ?? ids.legs;
  return {
    head: `Armor_Head_${ids.head ?? bodyId}.png`,
    legs: `Armor_Legs_${ids.legs ?? bodyId}.png`,
    body: `Armor/Armor_${bodyId}.png`,
    bodyLegacy: `Armor_Body_${bodyId}.png`,
    bodyLegacyFemale: `Female_Body_${bodyId}.png`,
    arms: `Armor_Arm_${bodyId}.png`,
  };
}

/* ------------------------------------------------------------------ ui -- */

function renderTargets() {
  const host = $("#targets");
  if (!host || !state.layout) return;
  host.innerHTML = "";
  for (const name of state.layout.targets.all) {
    const label = document.createElement("label");
    label.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = isTargetOn(name);
    box.addEventListener("change", () => {
      state.config.targets = { ...state.config.targets, [name]: box.checked };
      saveConfig();
    });
    const span = document.createElement("span");
    span.textContent = t(`target.${name}`);
    label.append(box, span);
    host.append(label);
  }
}

function renderFiles() {
  const list = $("#file-list");
  if (!list) return;
  list.innerHTML = "";
  state.files.forEach((file, index) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = file.name;
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = file.bitmap ? `${file.bitmap.width}×${file.bitmap.height}` : "";
    const remove = document.createElement("button");
    remove.textContent = "✕";
    remove.title = t("web.remove");
    remove.addEventListener("click", () => {
      state.files.splice(index, 1);
      renderFiles();
    });
    li.append(name, meta, remove);
    list.append(li);
  });
  $("#file-summary").textContent = state.files.length ? t("web.selected", { count: state.files.length }) : "";
}

/* --------------------------------------------------------- long tasks -- */

/** Let the browser repaint, so the progress text is actually visible. */
function nextFrame() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Begin a task with `total` steps: shows the progress bar and cancel button. */
function startJob(total) {
  state.job = { cancelled: false, done: 0, total };
  const bar = $("#job-bar");
  const cancel = $("#cancel-job");
  const long = total > 1;
  if (bar) {
    bar.hidden = !long;
    bar.max = Math.max(1, total);
    bar.value = 0;
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
  if (bar) bar.value = index;
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
    bar.value = 0;
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
  list.innerHTML = "";
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "muted small";
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

/** Per-frame delay chosen in the UI (fast / medium / slow). */
function gifDelay() {
  return GIF_SPEEDS[state.config.gifSpeed] ?? GIF_SPEEDS.fast;
}

/** The GIF scale chosen in the UI: 1, 2 or 4. */
function gifScale() {
  const value = Math.floor(Number(state.config.gifSize) || 1);
  return value > 1 ? value : 1;
}

/** Frames as they go into the GIF: nearest-neighbour scaled to the chosen size. */
function gifFrames(frames) {
  const factor = gifScale();
  return factor > 1 ? frames.map((frame) => upscale(frame, factor)) : frames;
}

/** Encode a GIF with the current speed, size and frame order. */
function makeGif(frames) {
  return gifBlob(gifFrames(frames), { order: gifFrameOrder(), delayMs: gifDelay() });
}

/* ------------------------------------------------------- preview sheets -- */

const SLOT_LABEL = { head: "web.slot.head", body: "web.slot.body", legs: "web.slot.legs" };

/**
 * What the slot shows for an uploaded sheet.
 *
 * The body grid (360x224) is readable as a whole, but a head/legs sheet is
 * 40x1120: scaled down it becomes a 3px sliver, so those show their first frame
 * at 2x instead.  The full size is still written next to the file name.
 */
function slotPreview(bitmap) {
  if (bitmap.height <= bitmap.width * 4) return bitmap;
  const cellH = Math.max(1, Math.round((bitmap.width * 28) / 20));
  const frame = cropRegion(bitmap, [0, 0, bitmap.width, Math.min(cellH, bitmap.height)]);
  return upscale(frame, 2);
}

/** Show what each of the three slots holds, and what is still missing. */
function renderSlots() {
  const missing = SHEET_ROLES.filter((role) => !state.sheetSlots[role]);
  for (const role of SHEET_ROLES) {
    const slot = $(`#sheet-${role}-slot`);
    const nameEl = $(`#sheet-${role}-name`);
    const clear = $(`#sheet-${role}-clear`);
    if (!slot || !nameEl || !clear) continue;
    const entry = state.sheetSlots[role];
    const thumb = $(`#sheet-${role}-thumb`);
    slot.closest(".slot")?.classList.toggle("is-filled", !!entry);
    if (thumb) {
      thumb.hidden = !entry;
      if (entry && thumb.getAttribute("src") !== (entry.url ?? "")) {
        // keep the data URL on the entry: re-rendering must not re-encode the sheet
        if (!entry.url) entry.url = keepUrl(slotPreview(entry.bitmap));
        thumb.src = entry.url;
      }
    }
    nameEl.textContent = entry
      ? `${entry.name}  ${entry.bitmap.width}×${entry.bitmap.height}`
      : t("web.slotDrop");
    clear.hidden = !entry;
  }

  const status = $("#sheet-status");
  if (status) {
    const lines = [];
    if (SHEET_ROLES.some((role) => state.sheetSlots[role])) {
      lines.push(
        SHEET_ROLES.map(
          (role) => `${t(SLOT_LABEL[role])} ${state.sheetSlots[role] ? "✓" : "—"}`,
        ).join("  ·  "),
      );
    }
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

    const pack = {
      Name: friendly,
      Author: "ArmorHelper",
      Description: t("web.packDescription"),
      Version: { major: 1, minor: 0 },
    };

    const entries = [
      { name: "pack.json", data: `${JSON.stringify(pack, null, 2)}\n` },
      { name: "Content/", data: new Uint8Array(0) },
      { name: "Content/Images/", data: new Uint8Array(0) },
      {
        name: `Content/Images/Armor_Head_${id}.png`,
        data: await pngBlob(state.sheetSlots.head.bitmap).then((blob) => blob.arrayBuffer()),
      },
      {
        name: `Content/Images/Armor_Legs_${id}.png`,
        data: await pngBlob(state.sheetSlots.legs.bitmap).then((blob) => blob.arrayBuffer()),
      },
      { name: "Content/Images/Armor/", data: new Uint8Array(0) },
      {
        name: `Content/Images/Armor/Armor_${id}.png`,
        data: await pngBlob(state.sheetSlots.body.bitmap).then((blob) => blob.arrayBuffer()),
      },
    ];

    const blob = zipBlob(entries);
    const url = URL.createObjectURL(blob);
    const result = {
      title: t("web.packTitle", { name: friendly }),
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

    const host = $("#gif-results");
    host.innerHTML = "";
    host.append(resultCard(result, host));
    addHistory(slug, [{ name: zipName }], keepUrl(slotPreview(state.sheetSlots.body.bitmap)));
    syncResultHeights();
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
    previews.push({ url: URL.createObjectURL(blob), caption: item.caption, alt: item.caption });
  }
  if (previewFrames.length) {
    previews.push({
      url: keepUrl(contactSheet(previewFrames)),
      caption: t("web.previewFrames"),
      alt: t("web.previewSheet"),
    });
  }

  return {
    title,
    files,
    previews,
    warnings,
    zip: { save: () => downloadBlob(zipBlob(blobs), `${sanitizeFilename(title)}.zip`) },
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
      { name: `${stem}_FullArmor.gif`, frames, caption: t("web.gifMale") },
      { name: `${stem}_FullArmorFemale.gif`, frames: femaleFrames, caption: t("web.gifFemale") },
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
          { name: `${stem}_FullArmorPlayer.gif`, frames: playerMale, caption: t("web.gifMalePlayer") },
          {
            name: `${stem}_FullArmorPlayerFemale.gif`,
            frames: playerFemale,
            caption: t("web.gifFemalePlayer"),
          },
        );
      }
    }

    const result = await packSheetGifs(stem, entries, gifs, warnings, frames);
    const host = $("#gif-results");
    host.innerHTML = "";
    host.append(resultCard(result, host));
    addHistory(stem, result.files, keepUrl(frames[0]));
    syncResultHeights();
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

  const needsPlayer = $("#opt-player")?.checked;
  $("#player-hint").hidden = !needsPlayer || !!images || !!state.playerParts;
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

function renderResult(result) {
  const host = $("#results");
  host.innerHTML = "";
  if (!result) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = t("web.empty");
    host.append(p);
    return;
  }
  host.append(resultCard(result));
}

/** One captioned preview: a checkerboard tile with the label underneath. */
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

function resultCard(result, host = $("#results")) {
  const card = document.createElement("div");
  card.className = "job";

  const heading = document.createElement("h3");
  heading.textContent = result.title;
  card.append(heading);

  const previews = document.createElement("div");
  previews.className = "previews";
  for (const item of result.previews ?? []) {
    previews.append(previewFigure(item.url, item.caption, item.alt));
  }
  if (previews.childElementCount) card.append(previews);

  const list = document.createElement("ul");
  list.className = "files";
  for (const file of result.files) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = file.url;
    link.download = file.name.split("/").pop();
    link.textContent = file.name;
    const meta = document.createElement("span");
    meta.className = "muted";
    const size = `${Math.round(file.size / 1024)} KB`;
    meta.textContent = file.width && file.height ? `${file.width}×${file.height} · ${size}` : size;
    li.append(link, meta);
    list.append(li);
  }
  if (result.files.length) card.append(list);

  const actions = document.createElement("div");
  actions.className = "actions";
  if (result.zip) {
    const zip = document.createElement("button");
    zip.className = "ghost";
    zip.textContent = t("web.zip");
    zip.addEventListener("click", () => zip.save());
    actions.append(zip);
  }
  if (result.save) {
    const save = document.createElement("button");
    save.className = "ghost";
    save.textContent = t("web.saveToOutput");
    save.disabled = !state.folders.output && !canUseFolders;
    save.addEventListener("click", () => save.save());
    actions.append(save);
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

function keepUrl(bitmap) {
  return bitmapToDataURL(bitmap);
}

/** The template as it should be shown: with the guide layer, when enabled. */
function withGuide(template) {
  return state.config.guide ? composeOverlay(template, state.overlay) : template;
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

/**
 * The hover/focus popover next to "download the drawing template": it shows the
 * very image the button hands out, guides included.  Loaded lazily, so the page
 * does not pay for it unless someone hovers.
 */
async function showTemplatePopover() {
  const figure = $("#template-popover");
  const image = $("#template-popover-img");
  if (!figure || !image) return;
  if (!image.getAttribute("src")) {
    try {
      if (!state.templateBitmap) {
        const response = await fetch("data/ArmorTemplate_v1.png");
        state.templateBitmap = await decodeBitmap(await response.blob());
      }
      image.src = keepUrl(magnify(withGuide(state.templateBitmap), 4));
    } catch (error) {
      console.error(error);
      return;
    }
  }
  figure.hidden = false;
}

function hideTemplatePopover() {
  const figure = $("#template-popover");
  if (figure) figure.hidden = true;
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

/** Download the drawing template (with the guide, so it can be drawn on). */
async function downloadTemplate() {
  try {
    const response = await fetch("data/ArmorTemplate_v1.png");
    const raw = await decodeBitmap(await response.blob());
    downloadBlob(await pngBlob(withGuide(raw)), "ArmorTemplate_v1.png");
  } catch (error) {
    say(String(error.message || error), "bad");
  }
}

/** Build a result object from a list of `{ name, bitmap }` plus previews. */
async function packResult(title, entries, frames, warnings = [], template = null) {
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
      url: keepUrl(magnify(withGuide(template), 4)),
      caption: t("web.previewTemplate"),
      alt: "ArmorTemplate",
    });
  }
  if (frames?.length) {
    previews.push({
      url: keepUrl(contactSheet(frames)),
      caption: t("web.previewFrames"),
      alt: t("web.previewSheet"),
    });
    const gif = makeGif(frames);
    blobs.push({ name: `${title}_preview.gif`, blob: gif, extra: true });
    previews.push({ url: URL.createObjectURL(gif), caption: t("web.previewGif"), alt: "GIF" });
  }

  const result = {
    title,
    files,
    previews,
    preview: previews[0]?.url ?? null,
    warnings,
    zip: {
      save: () =>
        downloadBlob(
          zipBlob(blobs.filter((item) => !item.extra).map((item) => ({ name: item.name, data: item.blob }))),
          `${sanitizeFilename(title)}.zip`,
        ),
    },
    save: {
      save: async () => {
        const folder = await ensureOutputFolder();
        if (!folder) return;
        let written = 0;
        for (const item of blobs) {
          await writeToFolder(folder, item.name, item.blob);
          written += 1;
        }
        say(t("web.savedTo", { count: written }));
      },
    },
  };
  return result;
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
  try {
    const [torso, arm, legs] = await Promise.all(
      Object.values(PLAYER_PARTS).map(async (name) => {
        const response = await fetch(`${PLAYER_DIR}/${name}`);
        if (!response.ok) throw new Error(name);
        return decodeBitmap(await response.blob());
      }),
    );
    return { torso, arm, legs };
  } catch {
    return null;
  }
}

/**
 * The player body used by "overlay player": the user's `Content/Images` when a
 * Chromium folder is available (they may have retextured it), otherwise the
 * copies shipped in `data/player/`.
 */
async function loadPlayerParts() {
  const images = state.folders.images;
  if (images && (await ensurePermission(images, "read"))) {
    try {
      const [torso, arm, legs] = await Promise.all(
        Object.values(PLAYER_PARTS).map(async (name) => decodeBitmap(await readFromFolder(images, name))),
      );
      return { torso, arm, legs };
    } catch {
      /* fall through to the bundled copies */
    }
  }
  return loadBundledPlayerParts();
}

/* --------------------------------------------------------------- export -- */

async function doExport() {
  if (!state.files.length) {
    say(t("web.drop"), "warn");
    return;
  }
  const templates = state.files.filter((file) => file.bitmap);
  if (!templates.length) {
    say(t("web.dropped", { name: state.files[0].name }), "warn");
    return;
  }

  $("#do-export").disabled = true;
  say(t("web.exporting"), "busy");
  startJob(templates.length);
  try {
    const female = $("#opt-female").checked;
    const wantsPlayer = $("#opt-player").checked;
    if (wantsPlayer && !state.playerParts) state.playerParts = await loadPlayerParts();

    const host = $("#results");
    host.innerHTML = "";

    for (const [step, file] of templates.entries()) {
      if (jobCancelled()) break;
      jobProgress(step, file.name);
      await nextFrame();
      const stem = file.name.replace(/\.[^.]+$/, "") || "template";
      const names = outputNames(stem);
      const entries = [];

      if (isTargetOn("head")) entries.push({ name: names.head, bitmap: generateHead(file.bitmap) });
      if (isTargetOn("legs")) entries.push({ name: names.legs, bitmap: generateLegs(file.bitmap) });
      if (isTargetOn("body")) {
        entries.push({
          name: names.body,
          bitmap: generateBodyComposite(file.bitmap, { glowRows: state.config.glow ? 4 : 0 }),
        });
      }
      if (isTargetOn("legacy")) {
        entries.push({ name: names.bodyLegacy, bitmap: generateBodyLegacy(file.bitmap, false) });
        entries.push({ name: names.bodyLegacyFemale, bitmap: generateBodyLegacy(file.bitmap, true) });
        entries.push({ name: names.arms, bitmap: generateArms(file.bitmap) });
      }

      const frames = fullArmorFrames(file.bitmap, female);
      const withPlayer = wantsPlayer && state.playerParts
        ? overlay(tintFrames(playerFrames(state.playerParts, female), SKIN_TINT), frames)
        : frames;

      if (isTargetOn("full")) entries.push({ name: `${stem}_FullArmor.png`, bitmap: stackFrames(frames) });
      if (isTargetOn("full-female")) {
        entries.push({ name: `${stem}_FullArmorFemale.png`, bitmap: stackFrames(fullArmorFrames(file.bitmap, true)) });
      }
      if (isTargetOn("full-player")) entries.push({ name: `${stem}_FullArmorPlayer.png`, bitmap: stackFrames(withPlayer) });
      if (isTargetOn("full-player-female")) {
        const femaleFrames = fullArmorFrames(file.bitmap, true);
        const framesWithPlayer = state.playerParts
          ? overlay(tintFrames(playerFrames(state.playerParts, true), SKIN_TINT), femaleFrames)
          : femaleFrames;
        entries.push({ name: `${stem}_FullArmorPlayerFemale.png`, bitmap: stackFrames(framesWithPlayer) });
      }

      const warnings = [];
      if (state.config.verify) warnings.push(...verifyRoundTrip(file.bitmap, entries));

      const result = await packResult(stem, entries, withPlayer, warnings, file.bitmap);
      host.append(resultCard(result));
      addHistory(stem, result.files, keepUrl(file.bitmap));
      syncResultHeights();
    }
    const job = endJob();
    if (job?.cancelled) say(t("web.cancelled", { done: job.done, total: job.total }), "warn");
    else say(t("status.done"));
  } catch (error) {
    endJob();
    console.error(error);
    say(String(error.message || error), "bad");
  } finally {
    $("#do-export").disabled = false;
  }
}

/**
 * Round trip self check: rebuild a template from the generated sheets and
 * compare the regenerated sheets with the originals.  This is the same
 * guarantee the Python test suite asserts.
 */
function verifyRoundTrip(template, entries) {
  const byName = new Map(entries.map((entry) => [entry.name, entry.bitmap]));
  const pick = (suffix) => {
    for (const [name, bitmap] of byName) {
      if (name.endsWith(suffix)) return bitmap;
    }
    return null;
  };
  const body = pick("_Body.png") ?? pick("Body.png");
  const legs = pick("_Legs.png") ?? pick("Legs.png");
  const headSheet = pick("_Head.png") ?? pick("Head.png");
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
    if (problems.length) return [`self check mismatch (${problems.join(", ")})`];
    return [];
  } catch (error) {
    return [`self check failed: ${error.message}`];
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
    if (state.builtin) {
      try {
        const response = await fetch(`${BUILTIN_DIR}/${path}`);
        if (response.ok) return await decodeBitmap(await response.blob());
      } catch {
        /* not bundled */
      }
    }
    return null;
  };
}

/** Read `data/vanilla/version.txt`; absent means nothing is bundled. */
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
    return info.count ? info : null;
  } catch {
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
    const result = await packResult(
      `ArmorTemplate_${label}_${body}`,
      entries,
      frames,
      warnings,
      template,
    );

    const host = $("#reverse-result");
    host.innerHTML = "";
    host.append(resultCard(result, host));
    say(t("reverse.done", { path: result.files[0].name }));
    syncResultHeights();
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
      title: t("web.rebuilt", { count: entries.length }),
      files: entries.slice(0, 400).map((entry, index) => ({
        name: entry.name,
        width: entry.bitmap.width,
        height: entry.bitmap.height,
        size: blobs[index].blob.size,
        url: URL.createObjectURL(blobs[index].blob),
      })),
      warnings: failed ? [`${failed} failed`] : [],
      zip: { save: () => downloadBlob(zipBlob(blobs), "ArmorTemplate.zip") },
      save: {
        save: async () => {
          const target = await ensureOutputFolder();
          if (!target) return;
          for (const item of blobs) await writeToFolder(target, item.name, item.blob);
          say(t("web.savedTo", { count: blobs.length }));
        },
      },
    };

    const host = $("#reverse-result");
    host.innerHTML = "";
    host.append(resultCard(result, host));
    addHistory(`${t("reverse.allTitle")} ×${entries.length}`, entries, keepUrl(entries[0].bitmap));
    syncResultHeights();
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

async function addFiles(fileList) {
  for (const file of fileList) {
    if (!/\.(png|bmp)$/i.test(file.name)) continue;
    try {
      const bitmap = await decodeBitmap(file);
      state.files.push({ name: file.name, bitmap });
    } catch (error) {
      console.error(error);
      say(t("web.dropped", { name: file.name }), "warn");
    }
  }
  renderFiles();
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
      for (const other of $$(".tab")) other.classList.toggle("is-active", other === tab);
      for (const panel of $$(".panel")) panel.classList.toggle("is-active", panel.id === `tab-${tab.dataset.tab}`);
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
  on("#clear-files", "click", () => {
    state.files = [];
    renderFiles();
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
  on("#gif-speed", "change", (event) => {
    state.config.gifSpeed = event.target.value;
    saveConfig();
  });
  on("#gif-size", "change", (event) => {
    state.config.gifSize = Number(event.target.value) || 1;
    saveConfig();
  });
  on("#clear-history", "click", clearHistory);
  on("#cancel-job", "click", cancelJob);

  const templateButton = $("#download-template");
  if (templateButton) {
    for (const type of ["mouseenter", "focus"]) templateButton.addEventListener(type, showTemplatePopover);
    for (const type of ["mouseleave", "blur"]) templateButton.addEventListener(type, hideTemplatePopover);
  }

  on("#do-export", "click", doExport);
  on("#download-template", "click", downloadTemplate);
  on("#opt-guide", "change", (event) => {
    state.config.guide = event.target.checked;
    saveConfig();
    $("#template-popover-img")?.removeAttribute("src");
    if (state.result) renderResult(state.result);
  });
  on("#opt-female", "change", (event) => {
    state.config.female = event.target.checked;
    saveConfig();
  });
  on("#opt-player", "change", (event) => {
    state.config.player = event.target.checked;
    saveConfig();
    renderFolders();
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
    });
  }
  on("#set-skin", "change", (event) => {
    state.config.skin = Number(event.target.value) || 0;
    saveConfig();
  });
  on("#set-glow", "change", (event) => {
    state.config.glow = event.target.checked;
    saveConfig();
  });
  on("#set-verify", "change", (event) => {
    state.config.verify = event.target.checked;
    saveConfig();
  });
  on("#save-settings", "click", () => {
    state.config.ids = {
      id_head: $("#set-head").value,
      id_body: $("#set-body").value,
      id_legs: $("#set-legs").value,
    };
    saveConfig();
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
    const [layout] = await Promise.all([loadLayout(), loadSets()]);
    state.layout = layout;
    state.version = layout.version;
    state.defaults = layout.targets.defaults;
    state.messages = await loadMessages(state.language);

    $("#language").value = state.language;
    $("#opt-female").checked = !!state.config.female;
    $("#opt-player").checked = !!state.config.player;
    $("#opt-guide").checked = state.config.guide !== false;
    $("#gif-player").checked = !!state.config.gifPlayer;
    $("#gif-speed").value = state.config.gifSpeed ?? "fast";
    $("#gif-size").value = String(state.config.gifSize ?? 1);
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
    $("#download-template").title = t("web.downloadTemplateHint");
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
