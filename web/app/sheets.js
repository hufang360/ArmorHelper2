/**
 * The "preview sheets" tab: three slots, and the 20 frame result that follows
 * each change with no button of its own.
 *
 * A slot holds `{ name, bitmap }` and nothing else, so every repaint is cheap.
 * Redraws are debounced (`scheduleGifs`) because a drop can fill three slots.
 */

import { $, noteMissing, on, say } from "./dom.js";
import { t, warnText } from "./i18n.js";
import { SHEET_ROLES, saveConfig, state } from "./state.js";
import { bindFilePreview, bindPackField, keepUrl } from "./result.js";
import { doResourcePack } from "./pack.js";
import { loadPlayerParts, textureReader } from "./textures.js";
import { setSheetPreview } from "./gifs.js";
import { stackFrames, upscale } from "../js/bitmap.js";
import { SKIN_TINT, gifFrameOrder, overlay, playerFrames, tintFrames } from "../js/compose.js";
import { loadTextures } from "../js/reverse.js";
import { classifySheets, composeFrames, validateSheet } from "../js/sheets.js";
import { decodeBitmap } from "../js/fs.js";
import { pngBlob } from "../js/png.js";

/* ------------------------------------------------------- preview sheets -- */

const SLOT_LABEL = { head: "web.slot.head", body: "web.slot.body", legs: "web.slot.legs" };
const SLOT_HINT = { head: "web.slot.headDrop", body: "web.slot.bodyDrop", legs: "web.slot.legsDrop" };

/**
 * The three `pack.json` fields under the slots.
 *
 * The export page edits the same three values, so `show` only toggles the row
 * and the values come from the settings.  A field keeps what the user is typing:
 * only an input that is not focused is overwritten.
 */
const PACK_FIELDS = [
  ["name", "#sheet-pack-name"],
  ["author", "#sheet-pack-author"],
  ["description", "#sheet-pack-desc"],
];

export function renderPackInfo(show) {
  const group = $("#sheet-pack-info");
  if (group) group.hidden = !show;
  for (const [field, selector] of PACK_FIELDS) {
    const input = $(selector);
    if (input && document.activeElement !== input) input.value = state.config.pack?.[field] ?? "";
  }
}

/**
 * The four controls of the animation above the result.
 *
 * They drive that player only; the speed and size of the files stay on the
 * left.  The values live in the settings, so the controls show what is stored.
 */
export function renderSheetPreviewOptions() {
  const female = $("#sheet-opt-female");
  if (female) female.checked = !!state.config.sheetFemale;
  const player = $("#sheet-opt-player");
  if (player) player.checked = !!state.config.sheetPlayer;
  const speed = $("#sheet-preview-speed");
  if (speed) speed.value = state.config.sheetGifSpeed ?? "fast";
  const size = $("#sheet-preview-size");
  if (size) size.value = String(state.config.sheetGifSize ?? 2);
  // the icon names what the link holds, including the animation's frame count
  const info = $("#sheet-preview-info");
  if (info) {
    const text = t("web.sheetPreviewInfo", {
      desc: t("web.sheetDesc.full"),
      count: gifFrameOrder().length,
    });
    info.dataset.tooltip = text;
    info.setAttribute("aria-label", text);
  }
}

/** Show what each of the three slots holds, and what is still missing. */
export function renderSlots() {
  const missing = SHEET_ROLES.filter((role) => !state.sheetSlots[role]);
  for (const role of SHEET_ROLES) {
    const slot = $(`#sheet-${role}-slot`);
    const hint = $(`#sheet-${role}-hint`);
    const info = $(`#sheet-${role}-info`);
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
    if (entry) {
      // the name on one line and the size on the next: the box is too narrow
      // for both, so they live in the info icon's tooltip
      info.dataset.tooltip = `${entry.name}\n${entry.bitmap.width}×${entry.bitmap.height}`;
      info.setAttribute("aria-label", t("web.slotInfo"));
    }
    clear.hidden = !entry;
  }

  // the head and the legs have the same shape, so they can be swapped
  for (const role of ["head", "legs"]) {
    const swap = $(`#sheet-${role}-swap`);
    if (!swap) continue;
    swap.hidden = !state.sheetSlots[role] || !state.sheetSlots[role === "head" ? "legs" : "head"];
  }

  const status = $("#sheet-status");
  if (status) {
    // a filled slot shows its own tick, so only the warnings go here
    status.textContent = (state.sheetIssues ?? []).map(warnText).join("\n");
  }
  const pack = $("#do-pack");
  if (pack) {
    // the button only exists once there is a pack to make
    pack.hidden = missing.length > 0;
    pack.disabled = missing.length > 0;
  }
  renderPackInfo(missing.length === 0);
  renderSheetPreviewOptions();
  // uploading is the main action until the three sheets are in
  const upload = $("#upload-sheets");
  if (upload) {
    upload.classList.toggle("btn-primary", missing.length > 0);
    upload.classList.toggle("btn-secondary", missing.length === 0);
  }
  // the card redraws itself, so every slot change is also a redraw
  scheduleGifs();
}

/** Put one decoded file in a slot, validating it against that role. */
export function setSlot(role, entry, issues = []) {
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
 * Fill the three slots from a bundled armor set.
 *
 * The gold set is read out of the vanilla atlas on demand, so the demo needs no
 * extra images of its own: the three sheets are generated from the same
 * textures the reverse conversion uses.
 */
const SHEET_DEMO_IDS = { head: 26, body: 4, legs: 4 };

export async function loadSheetDemo() {
  say(t("web.working"), "busy");
  try {
    const { textures, missing } = await loadTextures(SHEET_DEMO_IDS, textureReader());
    if (missing.length) {
      say(t("web.needTextures"), "warn");
      return;
    }
    state.sheetIssues = [];
    for (const role of SHEET_ROLES) {
      const number = SHEET_DEMO_IDS[role];
      const name = role === "body" ? `Armor_${number}.png` : `Armor_${role === "head" ? "Head" : "Legs"}_${number}.png`;
      setSlot(role, { name, bitmap: textures[role] });
    }
    say(t("web.demoLoaded", { name: t("web.demoGold") }));
  } catch (error) {
    console.error(error);
    say(String(error.message || error), "bad");
  }
}

/**
 * Files dropped on a slot: one file fills that slot, several are sorted by
 * name/dimensions (which is what makes "any order" uploads work).
 */
export async function addSheetFiles(fileList, role = null) {
  const items = [];
  for (const file of fileList) {
    if (!/\.(png|bmp)$/i.test(file.name)) continue;
    try {
      items.push({ name: file.name, bitmap: await decodeBitmap(file), size: file.size });
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
 * The download link under the player.
 *
 * It hands out the PNG of the animation that is on screen, so its name follows
 * the two switches above it.  The picture is encoded here instead of taken from
 * the result table: those two switches never add files to that table.
 */
let previewFileUrl = null;

async function renderPreviewFile(name, frames, run) {
  const link = $("#sheet-preview-file");
  if (!link) return;
  const url = URL.createObjectURL(await pngBlob(stackFrames(frames)));
  // a slower, earlier run must not replace the newer picture
  if (run !== gifsRun) {
    URL.revokeObjectURL(url);
    return;
  }
  if (previewFileUrl) URL.revokeObjectURL(previewFileUrl);
  previewFileUrl = url;
  link.href = url;
  link.download = name;
  link.textContent = name;
  link.hidden = false;
}

/** A change must not be overwritten by a slower, earlier run. */
let gifsRun = 0;
let gifsTimer = null;

/**
 * Redraw the preview-sheets card.
 *
 * There is no button: the three sheets and the four controls of the player are
 * the whole input, so the card redraws whenever any of them changes.
 */
async function renderGifs() {
  const missing = SHEET_ROLES.filter((role) => !state.sheetSlots[role]);
  if (missing.length) {
    setSheetPreview(null);
    return;
  }
  const run = ++gifsRun;
  try {
    const input = {
      head: state.sheetSlots.head.bitmap,
      body: state.sheetSlots.body.bitmap,
      legs: state.sheetSlots.legs.bitmap,
    };
    const frames = composeFrames(input);
    const femaleFrames = composeFrames({ ...input, female: true });
    const female = !!state.config.sheetFemale;
    const wantsPlayer = !!state.config.sheetPlayer;
    let shown = female ? femaleFrames : frames;
    if (wantsPlayer) {
      const parts = await loadPlayerParts();
      if (parts) {
        // Player art is always native 2x, so upscale 1x sheets first.
        const factor = frames[0].width === 40 ? 1 : 40 / frames[0].width;
        const armor = factor === 1 ? shown : shown.map((frame) => upscale(frame, factor));
        shown = overlay(tintFrames(playerFrames(parts, female), SKIN_TINT), armor);
      } else {
        say(t("web.gifPlayerHint"), "warn");
      }
    }
    setSheetPreview(shown, state.config.sheetGifSpeed, state.config.sheetGifSize);
    // the link under the player hands out the PNG of what is being shown
    const variant = female ? (wantsPlayer ? "PlayerFemale" : "Female") : (wantsPlayer ? "Player" : "");
    renderPreviewFile(`FullArmor${variant}.png`, shown, run).catch((error) => console.error(error));
  } catch (error) {
    if (run !== gifsRun) return;
    console.error(error);
    say(String(error.message || error), "bad");
  }
}

/** Redraw the preview-sheets card after a short pause. */
export function scheduleGifs(delay = 120) {
  clearTimeout(gifsTimer);
  gifsTimer = setTimeout(() => void renderGifs(), delay);
}

/** Bind the controls this module owns. */
export function bindSheets() {
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
// the link is re-pointed on every redraw, so its hover listener only binds once
const previewFile = $("#sheet-preview-file");
if (previewFile) bindFilePreview(previewFile);
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
    // one click, not a burst: redraw at once so the card cannot lag behind
    scheduleGifs(0);
  });
}
for (const [field, selector] of PACK_FIELDS) {
  const input = $(selector);
  if (input) bindPackField(input, field);
}
// the export page edits the same values: refresh the row when this tab opens
on('[data-tab="gifs"]', "click", () => renderPackInfo(!$("#do-pack")?.hidden));
on("#do-pack", "click", doResourcePack);
// the player owns the four settings of the animation on the right
on("#sheet-opt-female", "change", (event) => {
  state.config.sheetFemale = event.target.checked;
  saveConfig();
  scheduleGifs(0);
});
on("#sheet-opt-player", "change", (event) => {
  state.config.sheetPlayer = event.target.checked;
  saveConfig();
  scheduleGifs(0);
});
on("#sheet-preview-speed", "change", (event) => {
  state.config.sheetGifSpeed = event.target.value;
  saveConfig();
  scheduleGifs(0);
});
on("#sheet-preview-size", "change", (event) => {
  state.config.sheetGifSize = Number(event.target.value) || 2;
  saveConfig();
  scheduleGifs(0);
});
}
