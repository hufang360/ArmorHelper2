/**
 * Sheet generation — the JavaScript twin of `armorhelper/generate.py`.
 *
 * Every function works at 1x (one template pixel = one output pixel) and scales
 * up at the very end, exactly like the Python version, so the results are
 * identical.  `scale` is 1 for the intermediate data and 2 for the real sheets.
 */

import { L } from "./data.js";
import {
  copyRegion,
  createBitmap,
  cropRegion,
  fillRect,
  pasteBitmap,
  upscale,
} from "./bitmap.js";

/* --------------------------------------------------------------- layers -- */

/** `[rect, offset, ignore]` for the front arm of `frame`. */
export function frontArmLayer(frame) {
  return L().layers.frontArm[String(frame)] ?? null;
}

/** `{ blits, stray }` for the back arm of `frame`. */
export function backArmLayer(frame) {
  return L().layers.backArm[String(frame)] ?? null;
}

export function torsoRect(female, frame) {
  const regions = L().regions;
  if (female) return frame === 5 ? regions.femaleJump : regions.female;
  return frame === 5 ? regions.bodyJump : regions.body;
}

/* --------------------------------------------------------------- legacy -- */

function legacyBodyFrames(template, female) {
  const layout = L();
  const { w: cellW, h: cellH } = layout.frame;
  const frames = [];

  for (let frame = 0; frame < layout.frame.count; frame += 1) {
    const canvas = createBitmap(cellW, cellH);
    const bob = layout.offsets.bodyHead[frame];

    const back = backArmLayer(frame);
    if (back) {
      const layer = createBitmap(cellW, cellH);
      for (const [rect, offset] of back.blits) {
        copyRegion(layer, template, rect, offset);
      }
      // ArmorHelper v1 clipped the back arm before compositing the torso.
      fillRect(layer, [8, 21, 6, 1], [0, 0, 0, 0]);
      fillRect(layer, [0, 0, 13, cellH], [0, 0, 0, 0]);
      copyRegion(canvas, layer, [0, 0, cellW, cellH], [0, bob]);
      if (back.stray) copyRegion(canvas, template, back.stray[0], back.stray[1]);
    }

    const torso = torsoRect(female, frame);
    let ignore = null;
    if (!female && (frame === 1 || frame >= 6)) {
      ignore = [
        [37, torso[1] + 16],
        [37, torso[1] + 17],
      ];
    }
    copyRegion(canvas, template, torso, [0, bob], ignore);

    const front = frontArmLayer(frame);
    if (front) copyRegion(canvas, template, front[0], [front[1][0], front[1][1] + bob], front[2]);

    frames.push(canvas);
  }
  return frames;
}

/** Frames exactly as the game composites them in 1.4.4+ (no clipping). */
export function compositeBodyFrames(template, female = false, scale = 2) {
  const layout = L();
  const { w: cellW, h: cellH } = layout.frame;
  const frames = [];

  for (let frame = 0; frame < layout.frame.count; frame += 1) {
    const canvas = createBitmap(cellW, cellH);
    const bob = layout.offsets.bodyHead[frame];

    const back = backArmLayer(frame);
    if (back) {
      for (const [rect, offset] of back.blits) {
        copyRegion(canvas, template, rect, [offset[0], offset[1] + bob]);
      }
      if (back.stray) copyRegion(canvas, template, back.stray[0], back.stray[1]);
    }

    copyRegion(canvas, template, torsoRect(female, frame), [0, bob]);

    const front = frontArmLayer(frame);
    if (front) copyRegion(canvas, template, front[0], [front[1][0], front[1][1] + bob], front[2]);

    frames.push(upscale(canvas, scale));
  }
  return frames;
}

/* ---------------------------------------------------------------- sheets -- */

export function generateHead(template, scale = 2) {
  const layout = L();
  const { w, h, count } = layout.frame;
  const sheet = createBitmap(w, h * count);
  for (let frame = 0; frame < count; frame += 1) {
    copyRegion(sheet, template, layout.regions.head, [0, frame * h + layout.offsets.bodyHead[frame]]);
  }
  return upscale(sheet, scale);
}

export function generateLegs(template, scale = 2) {
  const layout = L();
  const regions = layout.regions;
  const { w, h } = layout.frame;
  const sheet = createBitmap(w, h * layout.frame.count);

  // Frames 0..4, 11 and 19: the front and the back half of the leg.
  for (let k = 0; k < 7; k += 1) {
    const frame = k < 5 ? k : k === 5 ? 11 : 19;
    const baseY = frame * h + 19;
    for (let side = 0; side < 2; side += 1) {
      const foot = side === 1 ? regions.legFootFront : regions.legFootBack;
      const onLeft = k !== 6 ? side === 1 : side === 0;
      const x = onLeft ? 5 : 7;
      const ignore = [
        [foot[0] + 1, 21],
        [foot[0] + 7, 21],
      ];
      copyRegion(sheet, template, foot, [x, baseY], ignore);
    }
  }

  // Two extra foot pieces, on body frames 6 and 12.
  copyRegion(sheet, template, regions.legFootFront, [6, 6 * h + 19]);
  copyRegion(sheet, template, regions.legFootFront, [6, 12 * h + 19]);

  // The main leg pieces.
  layout.legMapping.forEach((targets, index) => {
    const column = index >= 5 ? regions.legColumnRight : regions.legColumnLeft;
    const rect = [column[0], column[1] + (index % 5) * 10, regions.legPiece[0], regions.legPiece[1]];
    for (const frame of targets) {
      copyRegion(sheet, template, rect, [3, frame * h + 19]);
    }
  });

  return upscale(sheet, scale);
}

export function generateArms(template, scale = 2) {
  const layout = L();
  const { w, h, count } = layout.frame;
  const sheet = createBitmap(w, h * count);
  for (let frame = 0; frame < count; frame += 1) {
    const layer = frontArmLayer(frame);
    if (!layer) continue;
    const [rect, offset, ignore] = layer;
    copyRegion(
      sheet,
      template,
      rect,
      [offset[0], frame * h + offset[1] + layout.offsets.bodyHead[frame]],
      ignore,
    );
  }
  return upscale(sheet, scale);
}

export function generateBodyLegacy(template, female = false, scale = 2) {
  const frames = legacyBodyFrames(template, female);
  const sheet = createBitmap(frames[0].width, frames[0].height * frames.length);
  frames.forEach((frame, index) => pasteBitmap(sheet, frame, 0, index * frame.height));
  return upscale(sheet, scale);
}

/* ------------------------------------------------------------ composite -- */

function cellOrigin(cell) {
  const { w, h } = L().frame;
  return [cell[0] * w, cell[1] * h];
}

export function generateBodyComposite(template, options = {}) {
  const { glowRows = 0, fillCompositeArms = true, scale = 2 } = options;
  const layout = L();
  const regions = layout.regions;
  const { w, h } = layout.frame;
  const rows = layout.bodyComposite.rows + glowRows;

  if (glowRows !== 0 && glowRows !== layout.bodyComposite.glowRows) {
    throw new Error("glowRows must be 0 or 4");
  }

  const sheet = createBitmap(w * layout.bodyComposite.cols, h * rows);

  // --- torso, with the shoulders folded in?  No: the torso goes in as is,
  // the shoulder cells are left empty on purpose (see the README).
  copyRegion(sheet, template, regions.body, cellOrigin(layout.cells.torso));
  copyRegion(sheet, template, regions.bodyJump, cellOrigin(layout.cells.torsoJump));
  copyRegion(sheet, template, regions.female, cellOrigin([0, 2]));
  copyRegion(sheet, template, regions.femaleJump, cellOrigin([1, 2]));

  // --- walking front arms
  for (const [key, frame] of Object.entries(layout.cells.frontArmOwner)) {
    const cell = key.split(",").map(Number);
    const layer = frontArmLayer(frame);
    if (!layer) continue;
    const [rect, offset, ignore] = layer;
    const origin = cellOrigin(cell);
    copyRegion(sheet, template, rect, [origin[0] + offset[0], origin[1] + offset[1]], ignore);
  }

  // --- walking back arms
  for (const [key, frame] of Object.entries(layout.cells.backArmOwner)) {
    const cell = key.split(",").map(Number);
    const layer = backArmLayer(frame);
    if (!layer) continue;
    const origin = cellOrigin(cell);
    for (const [rect, offset] of layer.blits) {
      copyRegion(sheet, template, rect, [origin[0] + offset[0], origin[1] + offset[1]]);
    }
    if (layer.stray) {
      copyRegion(sheet, template, layer.stray[0], [
        origin[0] + layer.stray[1][0],
        origin[1] + layer.stray[1][1],
      ]);
    }
  }

  // --- arms used while swinging an item
  if (fillCompositeArms) {
    const front = frontArmLayer(0);
    const back = backArmLayer(0);
    for (let row = 0; row < layout.bodyComposite.rows; row += 1) {
      if (front) {
        const origin = cellOrigin([layout.cells.compositeFrontArmCol, row]);
        copyRegion(sheet, template, front[0], [
          origin[0] + front[1][0],
          origin[1] + front[1][1],
        ], front[2]);
      }
      if (back) {
        const origin = cellOrigin([layout.cells.compositeBackArmCol, row]);
        for (const [rect, offset] of back.blits) {
          copyRegion(sheet, template, rect, [origin[0] + offset[0], origin[1] + offset[1]]);
        }
        if (back.stray) {
          copyRegion(sheet, template, back.stray[0], [
            origin[0] + back.stray[1][0],
            origin[1] + back.stray[1][1],
          ]);
        }
      }
    }
  }

  // --- glow mask: rows 0..3 copied into rows 4..7
  if (glowRows) {
    for (let row = 0; row < layout.bodyComposite.rows; row += 1) {
      const strip = cropRegion(sheet, [0, row * h, sheet.width, h]);
      copyRegion(sheet, strip, [0, 0, strip.width, strip.height], [0, (row + layout.bodyComposite.rows) * h]);
    }
  }

  return upscale(sheet, scale);
}
