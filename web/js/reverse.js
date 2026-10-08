/**
 * Reverse conversion — the JavaScript twin of `armorhelper/reverse.py`.
 *
 * Rebuilds a 128x80 drawing template from the three Terraria armor textures.
 * Every step is the generator's tables walked backwards, which is why the
 * result can be fed straight back into `generate.js`.
 */

import { L } from "./data.js";
import { copyRegion, createBitmap, cropRegion, downscale2, pasteBitmap } from "./bitmap.js";
import { backArmLayer, frontArmLayer } from "./generate.js";

/** `[frame, x of the front foot, x of the back foot]`. */
const FOOT_PLACEMENTS = [
  [0, 5, 7],
  [11, 5, 7],
  [19, 7, 5],
];

/** Source pixels the generator deliberately skips on row 2 of both feet. */
const FOOT_MASKED_ROW = 2;
const FOOT_MASKED_COLUMNS = new Set([1, 7]);

function cell(sheet, [col, row]) {
  const { w, h } = L().frame;
  return cropRegion(sheet, [col * w, row * h, w, h]);
}

function rect(sheet, x, y, w, h) {
  return cropRegion(sheet, [x, y, w, h]);
}

function writeTemplate(template, region, dest) {
  pasteBitmap(template, region, dest[0], dest[1]);
}

/** Fold the two shoulder sprites into the torso, in the game's draw order. */
function mergeTorso(torso, backShoulder, frontShoulder) {
  const { w, h } = L().frame;
  const merged = createBitmap(w, h);
  pasteBitmap(merged, backShoulder);
  pasteBitmap(merged, torso);
  pasteBitmap(merged, frontShoulder);
  return merged;
}

function frontCovers(frontArt, column, row) {
  if (column < 0 || column > 8) return false;
  if (row === FOOT_MASKED_ROW && FOOT_MASKED_COLUMNS.has(column)) return false;
  const index = (row * frontArt.width + column) * 4;
  return frontArt.data[index + 3] > 1;
}

function reverseHead(template, head) {
  const sheet = downscale2(head);
  const { w, h } = L().frame;
  writeTemplate(template, rect(sheet, 0, 0, w, h), L().regions.head);
}

function reverseLegs(template, legs) {
  const layout = L();
  const regions = layout.regions;
  const { h } = layout.frame;
  const sheet = downscale2(legs);

  // The front foot is easy: body frame 6 carries an extra, complete copy.
  const frontArt = rect(sheet, 6, 6 * h + 19, 9, 9);
  writeTemplate(template, frontArt, regions.legFootFront);

  // The back foot is drawn underneath the front one.  Body frames 0 and 19
  // place the two feet on opposite sides, so combining them recovers every
  // pixel that is visible in at least one frame.
  const backArt = createBitmap(9, 9);
  for (const [frame, frontX, backX] of FOOT_PLACEMENTS) {
    const region = rect(sheet, backX, frame * h + 19, 9, 9);
    for (let row = 0; row < 9; row += 1) {
      for (let column = 0; column < 9; column += 1) {
        const index = (row * 9 + column) * 4;
        if (backArt.data[index + 3] > 1) continue;
        if (frontCovers(frontArt, backX + column - frontX, row)) continue;
        const source = (row * 9 + column) * 4;
        if (region.data[source + 3] > 1) {
          backArt.data[index] = region.data[source];
          backArt.data[index + 1] = region.data[source + 1];
          backArt.data[index + 2] = region.data[source + 2];
          backArt.data[index + 3] = region.data[source + 3];
        }
      }
    }
  }
  writeTemplate(template, backArt, regions.legFootBack);

  layout.legMapping.forEach((targets, index) => {
    const column = index >= 5 ? regions.legColumnRight : regions.legColumnLeft;
    const region = rect(sheet, 3, 19 + targets[0] * h, 16, 9);
    writeTemplate(template, region, [column[0], column[1] + (index % 5) * 10]);
  });
}

function reverseBody(template, body, warnings) {
  const layout = L();
  const regions = layout.regions;
  const { h } = layout.frame;
  if (body.height < h * 2 * layout.bodyComposite.rows) {
    throw new Error("body texture is too small for the 9x4 composite layout");
  }
  const sheet = downscale2(body);

  // --- torsos, with the shoulders folded in -----------------------------
  const pairs = [
    [regions.body, layout.cells.torso, layout.cells.backShoulder, layout.cells.frontShoulder],
    [
      regions.bodyJump,
      layout.cells.torsoJump,
      layout.cells.backShoulder,
      layout.cells.frontShoulder,
    ],
    [regions.female, [0, 2], [1, 3], [0, 3]],
    [regions.femaleJump, [1, 2], [1, 3], [0, 3]],
  ];
  for (const [source, torsoCell, backCell, frontCell] of pairs) {
    const merged = mergeTorso(cell(sheet, torsoCell), cell(sheet, backCell), cell(sheet, frontCell));
    writeTemplate(template, merged, source);
  }

  // --- front arm poses for body frames 0..4 ----------------------------
  for (let frame = 0; frame < 5; frame += 1) {
    const layer = frontArmLayer(frame);
    if (!layer) continue;
    const [region, offset] = layer;
    const source = cell(sheet, layout.cells.frontArm[String(frame)]);
    writeTemplate(
      template,
      rect(source, offset[0], offset[1], region[2], region[3]),
      [region[0], region[1]],
    );
  }

  // --- the "walk" front arm --------------------------------------------
  // Cells (3,1)..(6,1) all come from the same template rectangle with
  // different offsets; the frame 6 cell has offset 0 and covers it fully.
  const walk = frontArmLayer(6);
  if (walk) {
    const [region, offset] = walk;
    const source = cell(sheet, layout.cells.frontArm["6"]);
    writeTemplate(
      template,
      rect(source, offset[0], offset[1], region[2], region[3]),
      [region[0], region[1]],
    );
  }

  // --- the back arm -----------------------------------------------------
  const back = backArmLayer(0);
  if (back) {
    const [region, offset] = back.blits[0];
    const source = cell(sheet, layout.cells.backArm["0"]);
    writeTemplate(
      template,
      rect(source, offset[0], offset[1], region[2], region[3]),
      [region[0], region[1]],
    );
  }

  // --- the stray single pixel of body frames 15 and 16 ------------------
  for (const frame of [15, 16]) {
    const layer = backArmLayer(frame);
    if (!layer || !layer.stray) continue;
    const [region, offset] = layer.stray;
    const source = cell(sheet, layout.cells.backArm[String(frame)]);
    writeTemplate(
      template,
      rect(source, offset[0], offset[1], region[2], region[3]),
      [region[0], region[1]],
    );
  }

  if (sheet.height >= h * (layout.bodyComposite.rows + layout.bodyComposite.glowRows)) {
    warnings.push("texture has a glow mask; it is not reversed");
  }
}

/**
 * Rebuild a 128x80 template from up to three textures.
 *
 * `textures` is `{ head, body, legs }` where each value is a bitmap or null.
 */
export function reverseTemplate(textures = {}) {
  const layout = L();
  const template = createBitmap(layout.templateSize[0], layout.templateSize[1]);
  const warnings = [];

  if (textures.body) reverseBody(template, textures.body, warnings);
  else warnings.push("no body texture: the torso and the arms cannot be recovered");

  if (textures.head) reverseHead(template, textures.head);
  else warnings.push("no head texture: the head region is left empty");

  if (textures.legs) reverseLegs(template, textures.legs);
  else warnings.push("no legs texture: the legs region is left empty");

  return { template, warnings };
}

/**
 * The file names to try for each of the three textures, in order.
 *
 * The body lives in the `Armor/` sub folder, but a flat layout is accepted too
 * so an extracted texture pack that flattens everything still works.
 */
export function textureCandidates(body, head, legs) {
  const isSet = (value) => value !== null && value !== undefined && value !== "";
  return {
    head: isSet(head) ? [`Armor_Head_${head}.png`] : [],
    body: isSet(body) ? [`Armor/Armor_${body}.png`, `Armor_${body}.png`] : [],
    legs: isSet(legs) ? [`Armor_Legs_${legs}.png`] : [],
  };
}

/**
 * Load the three textures for a set.
 *
 * `readFile(path)` returns a bitmap or null/throws when the file is missing;
 * the caller decides where files come from (a folder handle, uploaded files,
 * ...), which also makes this testable outside a browser.
 *
 * Returns `{ textures, missing }` — `textures` is always keyed
 * `head` / `body` / `legs`.
 */
export async function loadTextures({ body = null, head = null, legs = null }, readFile) {
  const textures = { head: null, body: null, legs: null };
  const missing = [];

  for (const [kind, paths] of Object.entries(textureCandidates(body, head, legs))) {
    for (const path of paths) {
      try {
        const bitmap = await readFile(path);
        if (bitmap) {
          textures[kind] = bitmap;
          break;
        }
      } catch {
        /* try the next candidate */
      }
    }
    if (!textures[kind]) missing.push(kind);
  }
  return { textures, missing };
}
