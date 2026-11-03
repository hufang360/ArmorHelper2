#!/usr/bin/env node
/**
 * Inspect a Terraria >= 1.4.4 armor body texture.
 *
 * Renders (or just measures) `Armor/Armor_<id>.png` the way the game samples it
 * and prints an ASCII preview, so a generated sheet can be compared against a
 * vanilla one.
 *
 *     node tools/inspect_armor.mjs path/to/Armor_190.png
 *     node tools/inspect_armor.mjs path/to/Armor_190.png --frames 0,1,5 --render out.png
 *
 * The cell tables come from `web/data/layout.json`: it is the single source of
 * truth now that the Python package is gone.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodePNG } from "./lib/png.mjs";
import { encodePNG } from "../web/js/png.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAYOUT = JSON.parse(readFileSync(join(ROOT, "web", "data", "layout.json"), "utf8"));

/** The game's textures are at the native 2x scale: 40x56 per cell. */
const FRAME_W = LAYOUT.frame.w * 2;
const FRAME_H = LAYOUT.frame.h * 2;

const toCells = (table) => new Map(Object.entries(table).map(([key, cell]) => [Number(key), cell]));
const BACK_ARM_CELL = toCells(LAYOUT.cells.backArm);
const FRONT_ARM_CELL = toCells(LAYOUT.cells.frontArm);
const TORSO_CELL = LAYOUT.cells.torso;
const TORSO_JUMP_CELL = LAYOUT.cells.torsoJump;

function createCanvas(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Blit `rect` of `source` onto `dest` at `offset`, alpha blended. */
function pasteRegion(dest, source, [x, y, width, height], [offsetX, offsetY]) {
  for (let row = 0; row < height; row += 1) {
    const sourceY = y + row;
    const destY = offsetY + row;
    if (sourceY < 0 || sourceY >= source.height || destY < 0 || destY >= dest.height) continue;
    for (let column = 0; column < width; column += 1) {
      const sourceX = x + column;
      const destX = offsetX + column;
      if (sourceX < 0 || sourceX >= source.width || destX < 0 || destX >= dest.width) continue;
      const from = (sourceY * source.width + sourceX) * 4;
      const to = (destY * dest.width + destX) * 4;
      const alpha = source.data[from + 3];
      if (alpha === 0) continue;
      if (alpha === 255) {
        dest.data[to] = source.data[from];
        dest.data[to + 1] = source.data[from + 1];
        dest.data[to + 2] = source.data[from + 2];
        dest.data[to + 3] = 255;
        continue;
      }
      // source over destination, straight alpha
      const sourceA = alpha / 255;
      const destA = dest.data[to + 3] / 255;
      const outA = sourceA + destA * (1 - sourceA);
      for (let channel = 0; channel < 3; channel += 1) {
        const value =
          (source.data[from + channel] * sourceA + dest.data[to + channel] * destA * (1 - sourceA)) / outA;
        dest.data[to + channel] = Math.round(value);
      }
      dest.data[to + 3] = Math.round(outA * 255);
    }
  }
}

/** Bounding box of the non-empty pixels of one cell, or null. */
function cellBbox(image, col, row) {
  let left = Infinity;
  let top = Infinity;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < FRAME_H; y += 1) {
    for (let x = 0; x < FRAME_W; x += 1) {
      const sourceX = col * FRAME_W + x;
      const sourceY = row * FRAME_H + y;
      if (sourceX >= image.width || sourceY >= image.height) continue;
      if (image.data[(sourceY * image.width + sourceX) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : [left, top, right - left + 1, bottom - top + 1];
}

function report(image) {
  const cols = Math.floor(image.width / FRAME_W);
  const rows = Math.floor(image.height / FRAME_H);
  console.log(`${image.width}x${image.height}  grid ${rows} rows x ${cols} columns of ${FRAME_W}x${FRAME_H}`);
  if (image.width % FRAME_W || image.height % FRAME_H) {
    console.log(`  warning: not an exact multiple of ${FRAME_W}x${FRAME_H} cells`);
  }
  for (let row = 0; row < rows; row += 1) {
    const parts = [];
    for (let col = 0; col < cols; col += 1) {
      const box = cellBbox(image, col, row);
      parts.push(box ? `c${col}:${box[2]}x${box[3]}` : `c${col}: -`);
    }
    console.log(`  row${row}: ${parts.join(" | ")}`);
  }
}

/** Compose frames exactly like `PlayerDrawSet.CreateCompositeData` does. */
function renderFrames(image, frames) {
  return frames.map((frame) => {
    const canvas = createCanvas(FRAME_W, FRAME_H);
    const back = BACK_ARM_CELL.get(frame);
    if (back) pasteRegion(canvas, image, [back[0] * FRAME_W, back[1] * FRAME_H, FRAME_W, FRAME_H], [0, 0]);
    const torso = frame === 5 ? TORSO_JUMP_CELL : TORSO_CELL;
    pasteRegion(canvas, image, [torso[0] * FRAME_W, torso[1] * FRAME_H, FRAME_W, FRAME_H], [0, 0]);
    const front = FRONT_ARM_CELL.get(frame);
    if (front) pasteRegion(canvas, image, [front[0] * FRAME_W, front[1] * FRAME_H, FRAME_W, FRAME_H], [0, 0]);
    return canvas;
  });
}

function showAscii(frames, labels, scale = 2) {
  const width = Math.floor(Math.max(...frames.map((frame) => frame.width)) / scale);
  const height = Math.floor(Math.max(...frames.map((frame) => frame.height)) / scale);
  frames.forEach((frame, index) => {
    console.log(`--- body frame ${labels[index]}`);
    for (let y = 0; y < height; y += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        let alpha = 0;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const px = x * scale + dx;
            const py = y * scale + dy;
            if (px >= frame.width || py >= frame.height) continue;
            alpha = Math.max(alpha, frame.data[(py * frame.width + px) * 4 + 3]);
          }
        }
        row += alpha > 16 ? "#" : ".";
      }
      if (row.replaceAll(".", "")) console.log(`${String(y * scale).padStart(3)} ${row}`);
    }
  });
}

function parseArgs(argv) {
  const args = { image: null, frames: "0,5", scale: 2, render: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      console.log('usage: node tools/inspect_armor.mjs <sheet.png> [--frames 0,5] [--scale 2] [--render out.png]');
      process.exit(0);
    }
    if (arg === "--frames") args.frames = argv[++index];
    else if (arg === "--scale") args.scale = Number(argv[++index]) || 2;
    else if (arg === "--render") args.render = resolve(argv[++index]);
    else if (!args.image) args.image = resolve(arg);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if (!args.image) throw new Error("missing <sheet.png>");
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const image = decodePNG(readFileSync(args.image));
  report(image);

  const labels = args.frames
    .split(",")
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map(Number);
  const composed = renderFrames(image, labels);
  showAscii(composed, labels, args.scale);

  if (args.render) {
    const sheet = createCanvas(FRAME_W, FRAME_H * composed.length);
    composed.forEach((frame, index) => pasteRegion(sheet, frame, [0, 0, FRAME_W, FRAME_H], [0, index * FRAME_H]));
    mkdirSync(dirname(args.render), { recursive: true });
    writeFileSync(args.render, await encodePNG(sheet));
    console.log(`wrote ${args.render}`);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
