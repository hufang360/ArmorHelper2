/**
 * ArmorHelper web front end: the composition root.
 *
 * This file has no business logic.  It binds each control to the module that
 * owns it, then boots.  Adding a feature means adding a `bind…()` in that
 * module and one line here.
 *
 * The work itself lives in `app/` (DOM side) and `js/` (DOM-free core, pinned
 * pixel for pixel by `tests/node/core.test.mjs`).  Everything runs in the
 * browser, so the page works from any static host with no server at all.
 */

import { allSets, loadLayout, loadSets } from "./js/data.js";
import { getHandle } from "./js/idb.js";
import { $, missing, say } from "./app/dom.js";
import { setMessages, t } from "./app/i18n.js";
import { bindSheets } from "./app/sheets.js";
import { bindHistory } from "./app/history.js";
import { loadConfig, state } from "./app/state.js";
import { bindReverse, reverseOnBoot } from "./app/reverse.js";
import { bindExportOptions, scheduleExport } from "./app/export.js";
import { loadBuiltinInfo, loadBundledPlayerParts } from "./app/textures.js";
import { loadArmorNames } from "./app/ids.js";
import { bindPlayer } from "./app/gifs.js";
import { bindTemplate } from "./app/template.js";
import {
  applyI18n,
  bindChrome,
  loadGuideOverlay,
  loadMessages,
  registerServiceWorker,
  renderAbout,
  showAppVersion,
} from "./app/chrome.js";
import { loadSetsIndex } from "./app/sets.js";
import { bindCancel } from "./app/jobs.js";
import { HANDLE_IMAGES, HANDLE_OUTPUT, bindFolders } from "./app/folders.js";
import { setExportScheduler, watchResultHeights } from "./app/result.js";

/* ------------------------------------------------------------ listeners -- */

/** Bind every control on the page, in the order the tabs appear. */
function wire() {
  bindChrome();
  bindTemplate();
  bindSheets();
  bindExportOptions();
  bindPlayer();
  bindReverse();
  bindFolders();
  bindHistory();
  bindCancel();
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
    setMessages(await loadMessages(state.language));
    await showAppVersion();

    $("#opt-female").checked = !!state.config.female;
    $("#opt-player").checked = !!state.config.player;
    $("#rev-guide").checked = state.config.revGuide !== false;
    $("#rev-gif-speed").value = state.config.revGifSpeed ?? "fast";
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
    // the atlas is loaded: draw the default set instead of an empty preview.
    // Not awaited, so the page is usable while the first template renders.
    reverseOnBoot();
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
