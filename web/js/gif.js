/**
 * GIF89a encoding.
 *
 * Pixel art has so few colours that an exact palette is almost always possible
 * (up to 255 plus one transparent index), which looks better than a quantised
 * palette.  Larger inputs fall back to a coarse 5-bit-per-channel palette.
 */

/** One palette slot is reserved for transparency, so 255 real colours. */
const MAX_COLORS = 255;

/** Coarse 5-bit-per-channel palette, used only for >255 colour inputs. */
function quantize(frames) {
  const counts = new Map();
  for (const frame of frames) {
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 0) continue;
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_COLORS);
  const table = new Uint8Array(sorted.length * 3);
  const lookup = new Map();
  sorted.forEach(([key], index) => {
    table[index * 3] = ((key >> 10) & 31) << 3;
    table[index * 3 + 1] = ((key >> 5) & 31) << 3;
    table[index * 3 + 2] = (key & 31) << 3;
    lookup.set(key, index);
  });
  const transparent = sorted.length;
  return finalise(table, transparent, (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    return lookup.get(key) ?? 0;
  });
}

/** Exact palette first: pixel art rarely exceeds 255 colours. */
function buildPalette(frames) {
  const seen = new Map();
  for (const frame of frames) {
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 0) continue;
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    if (seen.size > MAX_COLORS) return null;
  }
  const table = new Uint8Array(seen.size * 3);
  const lookup = new Map();
  let index = 0;
  for (const key of seen.keys()) {
    table[index * 3] = (key >> 16) & 0xff;
    table[index * 3 + 1] = (key >> 8) & 0xff;
    table[index * 3 + 2] = key & 0xff;
    lookup.set(key, index);
    index += 1;
  }
  return finalise(table, seen.size, (r, g, b) => lookup.get((r << 16) | (g << 8) | b) ?? 0);
}

/** Pad the table to a power of two and wrap `lookup` with the alpha rule. */
function finalise(table, transparent, lookup) {
  let bits = 1;
  while (1 << (bits + 1) < transparent + 1) bits += 1;
  bits = Math.min(7, bits);
  const size = 1 << (bits + 1);
  const padded = new Uint8Array(size * 3);
  padded.set(table.subarray(0, Math.min(table.length, padded.length)));
  return {
    table: padded,
    bits,
    transparent,
    indexFor: (r, g, b, a) => (a <= 0 ? transparent : lookup(r, g, b)),
  };
}

/* ------------------------------------------------------------------ LZW -- */

function lzwEncode(indices, minCodeSize) {
  const out = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const bytes = [];

  const emit = (code, size) => {
    bitBuffer |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dict = new Map();

  emit(clearCode, codeSize);
  if (indices.length === 0) {
    emit(eoiCode, codeSize);
  } else {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i += 1) {
      const pixel = indices[i];
      const key = (prefix << 8) | pixel;
      const found = dict.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      emit(prefix, codeSize);
      if (nextCode >= 4096) {
        emit(clearCode, codeSize);
        dict = new Map();
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
      } else {
        if (nextCode === 1 << codeSize) codeSize += 1;
        dict.set(key, nextCode);
        nextCode += 1;
      }
      prefix = pixel;
    }
    emit(prefix, codeSize);
    emit(eoiCode, codeSize);
  }

  if (bitCount > 0) bytes.push(bitBuffer & 0xff);
  return bytes;
}

function blocks(bytes) {
  const out = [];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const size = Math.min(255, bytes.length - offset);
    out.push(size, ...bytes.slice(offset, offset + size));
  }
  out.push(0);
  return out;
}

function short(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

/* ------------------------------------------------------------------ API -- */

/**
 * Encode an animated GIF.
 *
 * `frames` is an array of RGBA bitmaps (all the same size), `delayMs` the frame
 * duration and `order` an optional index sequence (the tool's GIF plays the
 * walk cycle twice, then a pause and a short jump).
 */
export function encodeGIF(frames, { delayMs = 66, order = null, loop = 0 } = {}) {
  if (!frames.length) throw new Error("no frames to encode");
  const sequence = (order ?? frames.map((_, index) => index)).map((index) => frames[index]);
  const width = frames[0].width;
  const height = frames[0].height;

  const palette = buildPalette(sequence) ?? quantize(sequence);
  const { bits, table, transparent } = palette;

  const head = [];
  head.push(...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  head.push(...short(width), ...short(height));
  head.push(0b10000000 | ((bits) << 4) | bits); // global table, colour res, size
  head.push(transparent, 0); // background index, aspect ratio
  head.push(...table);

  // Netscape looping extension
  head.push(0x21, 0xff, 0x0b);
  head.push(...[...("NETSCAPE2.0")].map((c) => c.charCodeAt(0)));
  head.push(0x03, 0x01, ...short(loop), 0x00);

  const body = [];
  const minCodeSize = Math.max(2, bits + 1);
  for (const frame of sequence) {
    const indices = new Uint8Array(width * height);
    for (let pixel = 0; pixel < indices.length; pixel += 1) {
      const i = pixel * 4;
      indices[pixel] = palette.indexFor(frame.data[i], frame.data[i + 1], frame.data[i + 2], frame.data[i + 3]);
    }

    // Graphic control extension: dispose to background, one transparent index
    const delay = Math.max(1, Math.round(delayMs / 10));
    body.push(0x21, 0xf9, 0x04, 0b00001001, ...short(delay), transparent, 0x00);
    // Image descriptor
    body.push(0x2c, ...short(0), ...short(0), ...short(width), ...short(height), 0x00);
    body.push(minCodeSize, ...blocks(lzwEncode(indices, minCodeSize)));
  }
  body.push(0x3b);

  return new Uint8Array([...head, ...body]);
}

export function gifBlob(frames, options) {
  return new Blob([encodeGIF(frames, options)], { type: "image/gif" });
}
