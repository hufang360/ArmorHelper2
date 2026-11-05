/**
 * ArmorHelper web front end.
 *
 * Everything happens in the browser: the sheets are generated, previewed and
 * encoded here, so the page works from any static host (GitHub Pages included)
 * with no server at all.  The core in `js/` is DOM-free and its pixels are
 * pinned to the frozen reference images in `web/tests/golden/`
 * (`tests/node/core.test.mjs`).
 */

import { allSets, loadLayout, loadSets } from "./js/data.js";
import { decodeBitmap, pickFolder } from "./js/fs.js";
import { dropHandle, getHandle, putHandle } from "./js/idb.js";
import { $, $$, missing, noteMissing, on, say } from "./app/dom.js";
import { setMessages, t } from "./app/i18n.js";
import { addSheetFiles, loadSheetDemo, renderSlots, scheduleGifs, setSlot } from "./app/sheets.js";
import { clearHistory, renderHistory } from "./app/history.js";
import { SHEET_ROLES, loadConfig, saveConfig, state } from "./app/state.js";
import { doResourcePack } from "./app/pack.js";
import { doReverse, doReverseAll } from "./app/reverse.js";
import { scheduleExport } from "./app/export.js";
import { loadBuiltinInfo, loadBundledPlayerParts } from "./app/textures.js";
import { loadArmorNames } from "./app/ids.js";
import { playPreview, previewPlaying, stepPreview } from "./app/gifs.js";
import {
  addFiles,
  clearFiles,
  downloadTemplateFile,
  loadDemo,
  renderFiles,
  renderGuideToggle,
  renderTooltips,
} from "./app/template.js";
import { loadSetsIndex, pickSet } from "./app/sets.js";
import { cancelJob } from "./app/jobs.js";
import { HANDLE_IMAGES, HANDLE_OUTPUT, pickImagesFolder, renderFolders } from "./app/folders.js";
import {
  setExportScheduler,
  showResult,
  syncResultHeights,
  watchResultHeights,
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


/* --------------------------------------------------------- long tasks -- */

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

/* ------------------------------------------------------------ listeners -- */

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
