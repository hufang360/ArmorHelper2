/**
 * The drop area: the one 128x80 drawing template the export tab works from.
 *
 * One file at a time — a second one replaces the first — because the whole
 * export is derived from it.  Anything that is not a 128x80 PNG or WebP is
 * refused with a status line: a clipped sheet is worse than no sheet.
 */

import { $, say } from "./dom.js";
import { t } from "./i18n.js";
import { SHEET_ROLES, state } from "./state.js";
import { clearResult, keepUrl, withGuide } from "./result.js";
import { scheduleExport } from "./export.js";
import { decodeBitmap, downloadBlob } from "../js/fs.js";
import { pngBlob } from "../js/png.js";

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

export function renderTooltips() {
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

export function renderFiles() {
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
export function renderGuideToggle() {
  const on_ = state.config.guide !== false;
  const button = $("#drop-guide");
  if (button) {
    button.setAttribute("aria-pressed", on_ ? "true" : "false");
    button.classList.toggle("is-on", on_);
  }
  renderFiles();
}

/**
 * Download what the drop area shows: the loaded template, with the guide merged
 * in when the switch is on, and the untouched file when it is off.
 */
export async function downloadTemplateFile() {
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
export async function loadDemo() {
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

const TEMPLATE_SIZE = { width: 128, height: 80 };

/**
 * Load the drawing template. The export tab handles one file at a time: a
 * second file replaces the first. Only png and webp are taken, and the size
 * must be the 128x80 the generator expects; anything else is refused with a
 * status line instead of producing a clipped sheet.
 */
export async function addFiles(fileList, { preGuided = false } = {}) {
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
export function clearFiles() {
  state.files = [];
  renderFiles();
  clearResult("export");
}
