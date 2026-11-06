/**
 * The one mutable state object, plus the settings stored in localStorage.
 *
 * `app.js` orchestrates; the `app/` modules render.  They all read the same
 * object, so it lives here instead of being threaded through every call.  The
 * fields are documented where they are declared — add new ones there.
 *
 * Settings survive a reload; `defaultConfig()` is the whole shape, so a new key
 * needs no migration code.
 */

const SETTINGS_KEY = "armorhelper.settings";

/** The three sheet slots of the preview tab, in display order. */
export const SHEET_ROLES = ["head", "body", "legs"];

export const state = {
  language: "zh_CN",
  config: null,
  layout: null, // `data/layout.json`, set once at boot
  version: "",
  release: "",
  offlineReady: false, // the worker took over: offline reuse works from now on
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
};

function defaultConfig() {
  return {
    language: "zh_CN",
    ids: { id_head: "", id_body: "", id_legs: "" },
    glow: false,
    skin: 0,
    female: false,
    player: false,
    // the preview-sheets page owns its player: these four settings drive that
    // animation only, never the files the page hands out
    sheetFemale: false,
    sheetPlayer: false,
    sheetGifSpeed: "fast",
    sheetGifSize: 2,
    // the export page and the reverse page keep their own copies: no page
    // shares a GIF setting with another
    exportGifSpeed: "fast",
    revGifSpeed: "fast",
    // the template page's player: these three only change that animation
    revGifSize: 2,
    revFemale: false,
    revPlayer: false,
    // 2x shows the 40x56 art at a readable size; 1x stays one click away
    exportGifSize: 2,
    verify: false,
    guide: true,
    // the reverse page owns its own guide switch: the two pages never share one
    revGuide: true,
    // `pack.json` fields; empty means "use the default"
    pack: { name: "", author: "", description: "" },
    packTab: "144",
  };
}

/** Read the settings, filling anything the stored copy lacks. */
export function loadConfig() {
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
  return state.config;
}

export function saveConfig() {
  state.config.language = state.language;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.config));
}
