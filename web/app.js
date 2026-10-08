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
const HANDLE_OUTPUT = "output";
const HANDLE_IMAGES = "images";
const PLAYER_PARTS = { torso: "Player_0_3.png", arm: "Player_0_7.png", legs: "Player_0_10.png" };
const REVERSE_SUBDIR = "ArmorTemplate";
/** Armor textures shipped with the site, so phones work without a game folder. */
const BUILTIN_DIR = "data/vanilla";

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
  builtin: null, // {version, count, ...} when data/vanilla is bundled
  overlay: null, // the guide layer drawn on top of templates in the preview
  playerParts: null,
  version: "",
};

/* ---------------------------------------------------------------- i18n -- */

function t(key, vars) {
  let text = state.messages[key] ?? key;
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value);
  return text;
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
  renderFolders();
  if (state.result) renderResult(state.result);
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
    remove.title = "remove";
    remove.addEventListener("click", () => {
      state.files.splice(index, 1);
      renderFiles();
    });
    li.append(name, meta, remove);
    list.append(li);
  });
  $("#file-summary").textContent = state.files.length ? t("web.selected", { count: state.files.length }) : "";
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
    meta.textContent = `${file.width}×${file.height} · ${Math.round(file.size / 1024)} KB`;
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
    const gif = gifBlob(frames, { order: gifFrameOrder() });
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

/** Load the three player textures from the chosen folder, if possible. */
async function loadPlayerParts() {
  const images = state.folders.images;
  if (!images) return null;
  if (!(await ensurePermission(images, "read"))) return null;
  try {
    const [torso, arm, legs] = await Promise.all(
      Object.values(PLAYER_PARTS).map(async (name) => decodeBitmap(await readFromFolder(images, name))),
    );
    return { torso, arm, legs };
  } catch {
    return null;
  }
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
  try {
    const female = $("#opt-female").checked;
    const wantsPlayer = $("#opt-player").checked;
    if (wantsPlayer && !state.playerParts) state.playerParts = await loadPlayerParts();

    const host = $("#results");
    host.innerHTML = "";

    for (const file of templates) {
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
    }
    say(t("status.done"));
  } catch (error) {
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
  const folder = canUseFolders ? await ensureOutputFolder() : null;
  $("#do-reverse-all").disabled = true;
  say(t("web.working"), "busy");

  try {
    const entries = [];
    let failed = 0;
    const jobs = allSets().filter(
      (item) => item.head !== null && item.legs !== null && item.body !== null,
    );
    const read = textureReader();
    for (const item of jobs) {
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

    if (!entries.length) {
      say(t("reverse.allNone", { dir: "" }), "warn");
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
          const target = folder ?? (await ensureOutputFolder());
          if (!target) return;
          for (const item of blobs) await writeToFolder(target, item.name, item.blob);
          say(t("web.savedTo", { count: blobs.length }));
        },
      },
    };

    const host = $("#reverse-result");
    host.innerHTML = "";
    host.append(resultCard(result, host));
    say(t("reverse.allDone", { count: entries.length, dir: REVERSE_SUBDIR }));
  } catch (error) {
    console.error(error);
    say(String(error.message || error), "bad");
  } finally {
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
    addFiles(input.files);
    input.value = "";
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

  on("#do-export", "click", doExport);
  on("#download-template", "click", downloadTemplate);
  on("#opt-guide", "change", (event) => {
    state.config.guide = event.target.checked;
    saveConfig();
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
    $("#set-head").value = state.config.ids.id_head ?? "";
    $("#set-body").value = state.config.ids.id_body ?? "";
    $("#set-legs").value = state.config.ids.id_legs ?? "";
    $("#set-skin").value = state.config.skin ?? 0;
    $("#set-glow").checked = !!state.config.glow;
    $("#set-verify").checked = !!state.config.verify;
    // restore previously used folders (permission is re-requested on demand)
    state.overlay = await loadGuideOverlay();
    state.builtin = await loadBuiltinInfo();
    state.folders.output = await getHandle(HANDLE_OUTPUT);
    state.folders.images = await getHandle(HANDLE_IMAGES);

    const builtin = state.builtin
      ? ` · 内置原版贴图 ${state.builtin.version}（${state.builtin.count} 张）`
      : "";
    $("#about").textContent = `ArmorHelper ${state.version} · 纯前端，无服务端${builtin}`;
    $("#download-template").title = t("web.downloadTemplateHint");

    applyI18n();
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
