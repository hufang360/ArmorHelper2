/**
 * Everything that draws a result: the material pack card, the file lists and
 * the floating preview behind every link.
 *
 * A "result" is plain data (`{ titleKey, files, previews, tabs, zip, save }`),
 * never a DOM node, so a language switch can redraw it: `applyI18n()` calls
 * `showResult()` again with the remembered object.  Nothing here generates a
 * sheet, which is why a redraw is cheap.
 *
 * `result.js` renders; `app.js` decides what to render.  The one exception is
 * the ID column, which has to re-run the export: it calls the scheduler that
 * `app.js` installs with `setExportScheduler()`.
 */

import { $, $$, say } from "./dom.js";
import { t } from "./i18n.js";
import { saveConfig, state } from "./state.js";
import { armorName, effectiveIds } from "./ids.js";
import { setPreviewGif } from "./gifs.js";
import { bitmapToDataURL, canUseFolders, downloadBlob } from "../js/fs.js";
import { composeOverlay, magnify } from "../js/compose.js";

/** `app.js` installs its debounced export here; the ID column cannot import it. */
let scheduleExport = () => {};

export function setExportScheduler(callback) {
  scheduleExport = callback;
}

/**
 * Keep the results card as tall as the input card next to it while it is empty.
 * Once there are results the inline min-height is dropped, so the card grows
 * with its content instead of being pinned to whatever the inputs needed.
 */
export function syncResultHeights() {
  for (const card of $$(".results-card")) {
    const panel = card.closest(".panel");
    const left = panel?.querySelector(".stack > .card");
    if (!left) continue;
    const filled = !!card.querySelector(".job");
    card.style.minHeight = filled ? "" : `${Math.round(left.getBoundingClientRect().height)}px`;
  }
}

/** Re-measure on layout changes (file list grows, language switch, resize). */
export function watchResultHeights() {
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
export function showResult(panel, results) {
  const host = $(RESULT_HOSTS[panel]);
  if (!host) return;
  // a panel may show several cards: one per material pack, then the preview
  const list = Array.isArray(results) ? results : [results];
  state.results[panel] = list;
  host.innerHTML = "";
  for (const item of list) host.append(resultCard(item, host));
  if (panel === "gif") {
    const title = $("#gif-results-title");
    if (title) title.hidden = list.length === 0;
  }
  syncResultHeights();
}

/** Drop one panel's result and put the empty line back. */
export function clearResult(panel) {
  state.results[panel] = null;
  const host = $(RESULT_HOSTS[panel]);
  if (host) {
    host.innerHTML = "";
    // neither the export nor the preview-sheets card writes an empty line
    if (panel !== "export" && panel !== "gif") {
      const empty = document.createElement("p");
      empty.className = "text-body-secondary mb-0";
      empty.textContent = t("web.empty");
      host.append(empty);
    }
  }
  if (panel === "export") setPreviewGif(null);
  if (panel === "gif") {
    const title = $("#gif-results-title");
    if (title) title.hidden = true;
  }
  syncResultHeights();
}

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
  table.className = options.idColumn ? "sheet-table has-id" : "sheet-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const headings = ["web.table.file", "web.table.size"];
  if (options.idColumn) headings.push("web.table.id");
  headings.push("web.table.content");
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
    tr.append(nameCell, sizeCell);
    if (options.idColumn) tr.append(idCell(row.part));
    tr.append(descCell);
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

export function keepUrl(bitmap) {
  return bitmapToDataURL(bitmap);
}

/** The template as it should be shown: with the guide layer, when enabled. */
export function withGuide(template, enabled) {
  return enabled ? composeOverlay(template, state.overlay) : template;
}
