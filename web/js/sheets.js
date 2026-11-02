/**
 * Full-body previews straight from the finished armor sheets — the JavaScript
 * twin of `armorhelper/sheets.py`.
 *
 * Instead of expanding a drawing template, this samples the three textures the
 * game ships (head, composite body, legs) the way
 * `PlayerDrawSet.CreateCompositeData` does and composes the 20 body frames.
 * The result is what the game actually draws, so it works for vanilla armor as
 * well as for modded / remixed texture packs, without the (lossy) reverse step.
 */

import { L } from "./data.js";
import { createBitmap, cropRegion, pasteBitmap, upscale } from "./bitmap.js";

export const SHEET_ROLES = ["head", "body", "legs"];

const HEAD_HINTS = ["head", "helm", "hat"];
const LEGS_HINTS = ["leg", "greave", "boot"];
const BODY_HINTS = ["body", "armor", "torso", "breastplate", "chest"];

/** Guess which sheet `name` is from its file name (null when it says nothing). */
export function detectRole(name) {
  const stem = fileStem(name).toLowerCase();
  if (stem.startsWith("player_")) return null; // player skin, not armor
  if (HEAD_HINTS.some((hint) => stem.includes(hint))) return "head";
  if (LEGS_HINTS.some((hint) => stem.includes(hint))) return "legs";
  if (BODY_HINTS.some((hint) => stem.includes(hint))) return "body";
  return null;
}

/** The trailing `_<number>` of a vanilla texture name, if any. */
export function detectId(name) {
  const match = /_(\d+)$/.exec(fileStem(name));
  return match ? Number(match[1]) : null;
}

function fileStem(path) {
  const base = String(path).split("/").pop() ?? "";
  return base.replace(/\.[^.]+$/, "");
}

/** Validate a sheet and return its `[cell width, cell height]`. */
function cellSize(role, image) {
  const layout = L();
  let cellW;
  let rows;
  if (role === "body") {
    if (image.width % layout.bodyComposite.cols) {
      throw new Error(
        `${role} sheet: ${image.width}x${image.height} is not ${layout.bodyComposite.cols} columns wide`,
      );
    }
    cellW = image.width / layout.bodyComposite.cols;
    rows = layout.bodyComposite.rows;
  } else {
    cellW = image.width;
    rows = layout.frame.count;
  }
  const cellH = Math.round((cellW * layout.frame.h) / layout.frame.w);
  if (cellW <= 0 || cellH <= 0 || Math.abs(cellH - (cellW * layout.frame.h) / layout.frame.w) > 1e-6) {
    throw new Error(
      `${role} sheet: ${image.width}x${image.height} does not have the ${layout.frame.w}x${layout.frame.h} frame aspect ratio`,
    );
  }
  if (image.height < cellH * rows) {
    // A few vanilla head sheets are 40x1118: the last frame is 2px short (the
    // engine samples transparent pixels there).  Tolerate only that.
    const minimum = cellH * (role === "body" ? rows : rows - 1);
    if (image.height < minimum) {
      throw new Error(
        `${role} sheet: ${image.width}x${image.height} is too small, expected ${image.width}x${cellH * rows} (or at least ${minimum} with a short last frame)`,
      );
    }
  }
  return [cellW, cellH];
}

/**
 * Bring sheets of mixed scale (1x, 2x, ...) onto the largest cell size.
 *
 * Returns `{ head, body, legs, cellW, cellH }`; missing roles stay `null`.
 */
export function normalizeSheets({ head = null, body = null, legs = null } = {}) {
  const layout = L();
  const present = { head, body, legs };
  const sizes = {};
  for (const role of SHEET_ROLES) {
    if (!present[role]) continue;
    const [cellW, cellH] = cellSize(role, present[role]);
    if ((cellW * layout.frame.h) % layout.frame.w) {
      throw new Error(
        `${role} sheet: ${cellW}x${cellH} cells are not a whole-number multiple of the ${layout.frame.w}x${layout.frame.h} frame`,
      );
    }
    sizes[role] = [cellW, cellH];
  }
  const roles = Object.keys(sizes);
  if (!roles.length) return { head: null, body: null, legs: null, cellW: 0, cellH: 0 };

  const cellW = Math.max(...roles.map((role) => sizes[role][0]), layout.frame.w * 2);
  const cellH = Math.round((cellW * layout.frame.h) / layout.frame.w);
  const out = { head: null, body: null, legs: null, cellW, cellH };
  for (const role of roles) {
    const [width] = sizes[role];
    if (cellW % width) {
      throw new Error(
        `${role} sheet is ${width}px per cell, which does not divide the ${cellW}px of the largest sheet`,
      );
    }
    const factor = cellW / width;
    out[role] = factor === 1 ? present[role] : upscale(present[role], factor);
  }
  return out;
}

function cropCell(sheet, col, row, cellW, cellH) {
  return cropRegion(sheet, [col * cellW, row * cellH, cellW, cellH]);
}

function stackFrame(sheet, index, cellW, cellH) {
  return cropRegion(sheet, [0, index * cellH, cellW, cellH]);
}

/**
 * Compose 20 full-body frames from the three armor sheets.
 *
 * Every frame is 40x56 for the usual 2x textures.  Sheets may be omitted;
 * whatever is missing is simply not drawn.  Draw order is the game's: legs,
 * back shoulder, back arm, torso, front shoulder, front arm, head.
 */
export function composeFrames({ head = null, body = null, legs = null, female = false } = {}) {
  const layout = L();
  const sheets = normalizeSheets({ head, body, legs });
  if (!sheets.cellW) throw new Error("no sheets to compose");

  const { cellW, cellH } = sheets;
  const [torsoCell, torsoJumpCell] = female
    ? [layout.cells.torsoFemale, layout.cells.torsoFemaleJump]
    : [layout.cells.torso, layout.cells.torsoJump];
  const [frontShoulder, backShoulder] = female
    ? [layout.cells.frontShoulderFemale, layout.cells.backShoulderFemale]
    : [layout.cells.frontShoulder, layout.cells.backShoulder];

  const frames = [];
  for (let index = 0; index < layout.frame.count; index += 1) {
    const canvas = createBitmap(cellW, cellH);

    if (sheets.legs) pasteBitmap(canvas, stackFrame(sheets.legs, index, cellW, cellH));

    if (sheets.body) {
      const sheet = sheets.body;
      pasteBitmap(canvas, cropCell(sheet, backShoulder[0], backShoulder[1], cellW, cellH));
      const backArm = layout.cells.backArm[String(index)];
      pasteBitmap(canvas, cropCell(sheet, backArm[0], backArm[1], cellW, cellH));
      const torso = index === 5 ? torsoJumpCell : torsoCell;
      pasteBitmap(canvas, cropCell(sheet, torso[0], torso[1], cellW, cellH));
      pasteBitmap(canvas, cropCell(sheet, frontShoulder[0], frontShoulder[1], cellW, cellH));
      const frontArm = layout.cells.frontArm[String(index)];
      pasteBitmap(canvas, cropCell(sheet, frontArm[0], frontArm[1], cellW, cellH));
    }

    if (sheets.head) pasteBitmap(canvas, stackFrame(sheets.head, index, cellW, cellH));

    frames.push(canvas);
  }
  return frames;
}

/** Stack frames vertically, the layout used by the head/legs sheets. */
export function stackFrames(frames) {
  if (!frames.length) throw new Error("no frames to stack");
  const { width, height } = frames[0];
  const sheet = createBitmap(width, height * frames.length);
  frames.forEach((frame, index) => pasteBitmap(sheet, frame, 0, index * height));
  return sheet;
}

/**
 * Split uploaded files into the three slots, guessing each role from its name.
 *
 * `items` is `[{ name, bitmap }]`.  Returns the slots plus `warnings` for
 * duplicates and files that could not be classified.
 */
export function classifySheets(items) {
  const slots = { head: null, body: null, legs: null };
  const ids = { head: null, body: null, legs: null };
  const names = { head: null, body: null, legs: null };
  const warnings = [];

  for (const item of items) {
    let role = detectRole(item.name);
    if (role === null) {
      // Fall back to the dimensions: the body grid is wide, head/legs are tall.
      if (item.bitmap.width > item.bitmap.height) role = "body";
    }
    if (role === null) {
      warnings.push(`cannot tell what ${item.name} is (head, body or legs?)`);
      continue;
    }
    if (slots[role]) {
      warnings.push(`more than one ${role} sheet: keeping ${names[role]}, ignoring ${item.name}`);
      continue;
    }
    try {
      cellSize(role, item.bitmap);
    } catch (error) {
      warnings.push(error.message);
      continue;
    }
    slots[role] = item.bitmap;
    ids[role] = detectId(item.name);
    names[role] = item.name;
  }

  return { ...slots, ids, names, warnings };
}
