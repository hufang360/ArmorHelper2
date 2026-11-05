/**
 * The "preview sheets" tab: three slots, and the 20 frame result that follows
 * each change with no button of its own.
 *
 * A slot holds `{ name, bitmap }` and nothing else, so every repaint is cheap.
 * Redraws are debounced (`scheduleGifs`) because a drop can fill three slots.
 */

import { $, say } from "./dom.js";
import { t, warnText } from "./i18n.js";
import { SHEET_ROLES, state } from "./state.js";
import { clearResult, keepUrl, showResult } from "./result.js";
import { packSheetGifs, sheetStem } from "./pack.js";
import { loadPlayerParts, textureReader } from "./textures.js";
import { addHistory } from "./history.js";
import { stackFrames, upscale } from "../js/bitmap.js";
import { SKIN_TINT, overlay, playerFrames, tintFrames } from "../js/compose.js";
import { loadTextures } from "../js/reverse.js";
import { classifySheets, composeFrames, detectId as detectSheetId, validateSheet } from "../js/sheets.js";
import { decodeBitmap } from "../js/fs.js";

/* ------------------------------------------------------- preview sheets -- */

const SLOT_LABEL = { head: "web.slot.head", body: "web.slot.body", legs: "web.slot.legs" };
const SLOT_HINT = { head: "web.slot.headDrop", body: "web.slot.bodyDrop", legs: "web.slot.legsDrop" };

/** Show what each of the three slots holds, and what is still missing. */
export function renderSlots() {
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
    if (entry) {
      // name on one line, size on the next: a slot is 180px wide
      info.textContent = `${entry.name}\n${entry.bitmap.width}×${entry.bitmap.height}`;
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

/** A change must not be overwritten by a slower, earlier run. */
let gifsRun = 0;
let gifsTimer = null;
/** The sheets already written to the history; speed and size changes keep it. */
let gifsHistoryKey = null;

/**
 * Redraw the preview-sheets card.
 *
 * There is no button: the three sheets plus the two selects are the whole
 * input, so the card redraws whenever any of them changes.  History is only
 * written for a new set of sheets, or moving a select would fill it up.
 */
async function renderGifs() {
  const missing = SHEET_ROLES.filter((role) => !state.sheetSlots[role]);
  if (missing.length) {
    clearResult("gif");
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
    if (run !== gifsRun) return;
    showResult("gif", result);
    const key = SHEET_ROLES.map((role) => state.sheetSlots[role].name).join("|");
    if (gifsHistoryKey !== key) {
      gifsHistoryKey = key;
      addHistory(stem, result.files, keepUrl(frames[0]));
    }
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
