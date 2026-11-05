/**
 * Frame composition and previews: 20 frames, GIF frame order, contact sheets.
 * The output is pinned by the frozen images in `web/tests/golden/`.
 */

import { L } from "./data.js";
import {
  createBitmap,
  fillRect,
  multiplyColor,
  pasteBitmap,
  upscale,
} from "./bitmap.js";
import { compositeBodyFrames, generateHead, generateLegs } from "./generate.js";

/** The tint ArmorHelper v1 used for the player skin in "Full Armor + Player". */
export const SKIN_TINT = [255 / 255, 150 / 255, 89 / 255];

/** How much the 128x80 drawing template is enlarged for its preview. */
export const TEMPLATE_PREVIEW_SCALE = 2;

/** 20 frames of the armor set, no player drawn. */
export function fullArmorFrames(template, female = false, scale = 2) {
  const layout = L();
  const frameW = layout.frame.w * scale;
  const frameH = layout.frame.h * scale;

  const head = generateHead(template, scale);
  const legs = generateLegs(template, scale);
  const body = compositeBodyFrames(template, female, scale);

  return body.map((frame, index) => {
    const canvas = createBitmap(frameW, frameH);
    // Legs behind, then the body (back arm, torso, front arm), then the head.
    const rect = [0, index * frameH, frameW, frameH];
    copyFrom(canvas, legs, rect);
    pasteBitmap(canvas, frame);
    copyFrom(canvas, head, rect);
    return canvas;
  });
}

function copyFrom(canvas, sheet, rect) {
  const [x, y, w, h] = rect;
  for (let j = 0; j < h; j += 1) {
    const sy = y + j;
    if (sy < 0 || sy >= sheet.height) continue;
    for (let i = 0; i < w; i += 1) {
      const sx = x + i;
      if (sx < 0 || sx >= sheet.width) continue;
      const si = (sy * sheet.width + sx) * 4;
      if (sheet.data[si + 3] <= 1) continue;
      const di = (j * canvas.width + i) * 4;
      canvas.data[di] = sheet.data[si];
      canvas.data[di + 1] = sheet.data[si + 1];
      canvas.data[di + 2] = sheet.data[si + 2];
      canvas.data[di + 3] = sheet.data[si + 3];
    }
  }
}

/** Draw `layers` over `frames` (same length, same size). */
export function overlay(frames, layers) {
  return frames.map((frame, index) => {
    const canvas = {
      width: frame.width,
      height: frame.height,
      data: new Uint8ClampedArray(frame.data),
    };
    pasteBitmap(canvas, layers[index]);
    return canvas;
  });
}

export function tintFrames(frames, tint = SKIN_TINT) {
  return frames.map((frame) => multiplyColor(frame, tint));
}

/**
 * Compose the player's own skin into 20 native frames.
 *
 * `parts` holds the native 40x56-cell textures
 * (`torso` = Player_0_3, `arm` = Player_0_7, `legs` = Player_0_10).  The two
 * optional parts `head` = Player_0_0 and `eyes` = Player_0_1 are drawn last.
 * They matter when the helmet leaves the face area transparent: without them
 * the helmet has a hole the background shows through.
 */
export function playerFrames(parts, female = false) {
  const layout = L();
  const frameW = layout.frame.w * 2;
  const frameH = layout.frame.h * 2;

  const cell = (sheet, [col, row]) =>
    cropCell(sheet, col * frameW, row * frameH, frameW, frameH);
  const long = (sheet, index) => cropCell(sheet, 0, index * frameH, frameW, frameH);

  const frames = [];
  for (let frame = 0; frame < layout.frame.count; frame += 1) {
    const canvas = createBitmap(frameW, frameH);
    pasteBitmap(canvas, long(parts.legs, frame));
    pasteBitmap(canvas, cell(parts.arm, cellOf(layout.cells.backArm, frame)));
    const torso =
      frame === 5
        ? female
          ? [1, 2]
          : layout.cells.torsoJump
        : female
          ? [0, 2]
          : layout.cells.torso;
    pasteBitmap(canvas, cell(parts.torso, torso));
    pasteBitmap(canvas, cell(parts.arm, cellOf(layout.cells.frontArm, frame)));
    // The head replaces nothing: it sits where the helmet's face opening is.
    if (parts.head) pasteBitmap(canvas, long(parts.head, frame));
    if (parts.eyes) pasteBitmap(canvas, long(parts.eyes, frame));
    frames.push(canvas);
  }
  return frames;
}

function cellOf(table, frame) {
  return table[String(frame)];
}

function cropCell(sheet, x, y, w, h) {
  const out = createBitmap(w, h);
  for (let j = 0; j < h; j += 1) {
    const sy = y + j;
    if (sy < 0 || sy >= sheet.height) continue;
    for (let i = 0; i < w; i += 1) {
      const sx = x + i;
      if (sx < 0 || sx >= sheet.width) continue;
      const si = (sy * sheet.width + sx) * 4;
      const di = (j * w + i) * 4;
      out.data[di] = sheet.data[si];
      out.data[di + 1] = sheet.data[si + 1];
      out.data[di + 2] = sheet.data[si + 2];
      out.data[di + 3] = sheet.data[si + 3];
    }
  }
  return out;
}

/** The frame sequence ArmorHelper v1 used for its GIFs. */
export function gifFrameOrder() {
  const order = [];
  for (let group = 0; group < 5; group += 1) {
    const pause = group === 2 || group === 4;
    const jump = group === 3;
    let start = 0;
    let stop = 20;
    if (jump) {
      start = 1;
      stop = 5;
    } else if (pause) {
      start = 6;
      stop = 10;
    }
    for (let index = start; index < stop; index += 1) order.push(pause ? 0 : index);
  }
  return order;
}

/** Lay frames out in a grid on a dark background — used for the previews. */
export function contactSheet(frames, scale = 3, columns = 10, gap = 2) {
  const rows = Math.ceil(frames.length / columns);
  const cellW = frames[0].width * scale;
  const cellH = frames[0].height * scale;
  const stepX = gap * scale;
  const out = createBitmap(
    columns * cellW + (columns + 1) * stepX,
    rows * cellH + (rows + 1) * stepX,
  );
  frames.forEach((frame, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = stepX + col * (cellW + stepX);
    const y = stepX + row * (cellH + stepX);
    fillRect(out, [x - 1, y - 1, cellW + 2, cellH + 2], [0, 0, 0, 60]);
    pasteBitmap(out, upscale(frame, scale), x, y);
  });
  return out;
}

/**
 * Draw the guide overlay on top of a template.
 *
 * Used for display and for the drawing base handed to the artist — never by the
 * generator, which only ever reads the raw template.  A missing or differently
 * sized overlay is ignored, so this is always safe to call.
 */
export function composeOverlay(template, overlay) {
  if (!overlay || overlay.width !== template.width || overlay.height !== template.height) {
    return template;
  }
  const out = createBitmap(template.width, template.height);
  out.data.set(template.data);
  pasteBitmap(out, overlay);
  return out;
}


