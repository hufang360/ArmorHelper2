/**
 * Minimal PNG decoder (8-bit, non-interlaced) — enough for everything the site
 * ships: the frozen reference images, the template, the player textures and the
 * PNGs the app writes itself.
 *
 * Node has zlib but no image decoder, and pulling a dependency for this would
 * break the "no dependencies" rule the project keeps elsewhere.  Only the five
 * scanline filters are involved, so it really is this short.
 *
 *     import { decodePNG } from "../lib/png.mjs";
 *     const { width, height, data } = decodePNG(readFileSync("sheet.png"));
 *
 * `data` is straight RGBA (4 bytes per pixel, no premultiplication), which is
 * exactly what the web core uses everywhere.
 */

import { inflateSync } from "node:zlib";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channel count per PNG colour type. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePNG(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (let index = 0; index < SIGNATURE.length; index += 1) {
    if (bytes[index] !== SIGNATURE[index]) throw new Error("not a PNG");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette = null;
  const idat = [];

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUInt32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    const chunk = bytes.subarray(start, start + length);

    if (type === "IHDR") {
      width = readUInt32(chunk, 0);
      height = readUInt32(chunk, 4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === "PLTE") {
      palette = chunk;
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset = start + length + 4; // skip CRC
  }

  if (!width || !height) throw new Error("PNG without IHDR");
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNGs are not supported");
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error("palette PNG without PLTE");

  const raw = inflateSync(concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  unfilter(raw, pixels, width, height, channels, stride);

  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const source = index * channels;
    const target = index * 4;
    if (colorType === 6) {
      data[target] = pixels[source];
      data[target + 1] = pixels[source + 1];
      data[target + 2] = pixels[source + 2];
      data[target + 3] = pixels[source + 3];
    } else if (colorType === 2) {
      data[target] = pixels[source];
      data[target + 1] = pixels[source + 1];
      data[target + 2] = pixels[source + 2];
      data[target + 3] = 255;
    } else if (colorType === 0) {
      data[target] = pixels[source];
      data[target + 1] = pixels[source];
      data[target + 2] = pixels[source];
      data[target + 3] = 255;
    } else if (colorType === 4) {
      data[target] = pixels[source];
      data[target + 1] = pixels[source];
      data[target + 2] = pixels[source];
      data[target + 3] = pixels[source + 1];
    } else {
      const entry = pixels[source] * 3;
      data[target] = palette[entry];
      data[target + 1] = palette[entry + 1];
      data[target + 2] = palette[entry + 2];
      data[target + 3] = 255;
    }
  }

  return { width, height, data };
}

function readUInt32(bytes, offset) {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
}

/** Undo the five per-scanline filters in place (PNG spec §9). */
function unfilter(raw, out, width, height, channels, stride) {
  const bpp = channels; // bytes per pixel at bit depth 8
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const rowStart = y * stride;
    const priorStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[position + x];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[priorStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[priorStart + x - bpp] : 0;
      let restored;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) restored = value + paeth(left, up, upLeft);
      else throw new Error(`unknown PNG filter ${filter}`);
      out[rowStart + x] = restored & 0xff;
    }
    position += stride;
  }
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const distLeft = Math.abs(estimate - left);
  const distUp = Math.abs(estimate - up);
  const distUpLeft = Math.abs(estimate - upLeft);
  if (distLeft <= distUp && distLeft <= distUpLeft) return left;
  if (distUp <= distUpLeft) return up;
  return upLeft;
}
