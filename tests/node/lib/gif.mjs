/**
 * A small GIF89a reader for the tests.
 *
 * `web/js/gif.js` writes an exact-palette GIF with one transparent index, a
 * global colour table, no interlacing, and every frame disposes to background
 * and redraws the whole canvas — so decoding it back needs no compositing.
 *
 * `deltasOf(buffer)` returns one full-canvas RGBA image per frame.  This keeps
 * the GIF assertions alive now that Python (and Pillow) are only used by the
 * atlas packer.
 */

const HEADER = "GIF89a";

export function deltasOf(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== HEADER) throw new Error(`not a GIF89a (${signature})`);

  const width = readUInt16(bytes, 6);
  const height = readUInt16(bytes, 8);
  const flags = bytes[10];
  let offset = 13;
  let palette = null;

  if (flags & 0x80) {
    const entries = 1 << ((flags & 0x07) + 1);
    palette = bytes.subarray(offset, offset + entries * 3);
    offset += entries * 3;
  }

  const frames = [];
  let transparent = null;

  while (offset < bytes.length) {
    const block = bytes[offset];

    if (block === 0x3b) break; // trailer

    if (block === 0x21) {
      // extension: graphic control carries the transparent index
      const label = bytes[offset + 1];
      const payload = readSubBlocks(bytes, offset + 2);
      if (label === 0xf9 && payload.bytes.length >= 4) transparent = payload.bytes[3];
      offset = payload.next;
      continue;
    }

    if (block !== 0x2c) throw new Error(`unexpected block 0x${block.toString(16)} at ${offset}`);

    const left = readUInt16(bytes, offset + 1);
    const top = readUInt16(bytes, offset + 3);
    const frameWidth = readUInt16(bytes, offset + 5);
    const frameHeight = readUInt16(bytes, offset + 7);
    const frameFlags = bytes[offset + 9];
    offset += 10;

    if (frameFlags & 0x40) throw new Error("interlaced GIF frames are not supported");
    if (frameFlags & 0x80) {
      const entries = 1 << ((frameFlags & 0x07) + 1);
      palette = bytes.subarray(offset, offset + entries * 3);
      offset += entries * 3;
    }
    if (!palette) throw new Error("GIF without a colour table");

    const minCodeSize = bytes[offset];
    offset += 1;
    const data = readSubBlocks(bytes, offset);
    offset = data.next;

    const indices = lzwDecode(data.bytes, minCodeSize, frameWidth * frameHeight);
    const canvas = new Uint8Array(width * height * 4);
    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        const index = indices[y * frameWidth + x];
        if (index === transparent) continue; // stays transparent
        const target = ((top + y) * width + (left + x)) * 4;
        canvas[target] = palette[index * 3];
        canvas[target + 1] = palette[index * 3 + 1];
        canvas[target + 2] = palette[index * 3 + 2];
        canvas[target + 3] = 255;
      }
    }
    frames.push({ width, height, data: canvas });
    transparent = null;
  }

  return frames;
}

function readUInt16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

/** Walk a chain of data sub-blocks, returning the payload and the next offset. */
function readSubBlocks(bytes, offset) {
  const parts = [];
  while (offset < bytes.length) {
    const size = bytes[offset];
    offset += 1;
    if (size === 0) break;
    parts.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return { bytes: out, next: offset };
}

/** GIF's variable-width LZW decoder (LSB-first bit order). */
function lzwDecode(data, minCodeSize, pixelCount) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let dictionary = [];
  let codeSize = minCodeSize + 1;
  const reset = () => {
    dictionary = [];
    for (let index = 0; index < clearCode; index += 1) dictionary.push([index]);
    dictionary.push(null, null); // clear + EOI placeholders
    codeSize = minCodeSize + 1;
  };
  reset();

  const out = new Uint8Array(pixelCount);
  let written = 0;
  let bitPosition = 0;
  let previous = null;

  const readCode = () => {
    let value = 0;
    for (let bit = 0; bit < codeSize; bit += 1) {
      const byte = bitPosition >> 3;
      if (byte >= data.length) return -1;
      const bitValue = (data[byte] >> (bitPosition & 7)) & 1;
      value |= bitValue << bit;
      bitPosition += 1;
    }
    return value;
  };

  while (written < pixelCount) {
    const code = readCode();
    if (code < 0) break; // truncated stream: keep what we have

    if (code === clearCode) {
      reset();
      previous = null;
      continue;
    }
    if (code === eoiCode) break;

    let entry;
    if (code < dictionary.length && dictionary[code]) {
      entry = dictionary[code];
    } else if (code === dictionary.length && previous) {
      entry = [...previous, previous[0]];
    } else {
      throw new Error(`bad LZW code ${code} (dictionary ${dictionary.length})`);
    }

    for (const value of entry) {
      if (written >= pixelCount) break;
      out[written] = value;
      written += 1;
    }

    if (previous) {
      dictionary.push([...previous, entry[0]]);
      if (dictionary.length === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previous = entry;
  }

  return out;
}
