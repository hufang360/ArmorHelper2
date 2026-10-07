/**
 * RGBA bitmap helpers.
 *
 * A bitmap is `{ width, height, data: Uint8ClampedArray }` with 4 bytes per
 * pixel.  The operations mirror `armorhelper/imaging.py` exactly, including the
 * "skip pixels with alpha <= 1" and "replace, do not blend" rules, so the
 * JavaScript output matches the Python output pixel for pixel.
 */

export function createBitmap(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneBitmap(bitmap) {
  return { width: bitmap.width, height: bitmap.height, data: new Uint8ClampedArray(bitmap.data) };
}

/** Crop `[x, y, w, h]` out of `bitmap` into a new bitmap. */
export function cropRegion(bitmap, [x, y, w, h]) {
  const out = createBitmap(w, h);
  for (let j = 0; j < h; j += 1) {
    const sy = y + j;
    if (sy < 0 || sy >= bitmap.height) continue;
    for (let i = 0; i < w; i += 1) {
      const sx = x + i;
      if (sx < 0 || sx >= bitmap.width) continue;
      const si = (sy * bitmap.width + sx) * 4;
      const di = (j * w + i) * 4;
      out.data[di] = bitmap.data[si];
      out.data[di + 1] = bitmap.data[si + 1];
      out.data[di + 2] = bitmap.data[si + 2];
      out.data[di + 3] = bitmap.data[si + 3];
    }
  }
  return out;
}

/**
 * Blit `rect` of `src` onto `dst` at `[dx, dy]`.
 *
 * Pixels whose alpha is <= `threshold` never write anything (they cannot erase
 * what is already there), and `ignore` lists source coordinates to skip — this
 * is ArmorHelper v1's `Copy` helper.
 */
export function copyRegion(dst, src, [x, y, w, h], [dx, dy], ignore = null, threshold = 1) {
  for (let j = 0; j < h; j += 1) {
    const sy = y + j;
    const ty = dy + j;
    if (sy < 0 || sy >= src.height || ty < 0 || ty >= dst.height) continue;
    for (let i = 0; i < w; i += 1) {
      const sx = x + i;
      const tx = dx + i;
      if (sx < 0 || sx >= src.width || tx < 0 || tx >= dst.width) continue;
      if (ignore && isIgnored(ignore, sx, sy)) continue;
      const si = (sy * src.width + sx) * 4;
      if (src.data[si + 3] <= threshold) continue;
      const di = (ty * dst.width + tx) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
}

/** Draw `layer` over `dst` at `[dx, dy]` (transparent pixels are skipped). */
export function pasteBitmap(dst, layer, dx = 0, dy = 0, ignore = null) {
  copyRegion(dst, layer, [0, 0, layer.width, layer.height], [dx, dy], ignore);
}

/** Overwrite `rect` with a solid colour (alpha included). */
export function fillRect(dst, [x, y, w, h], color) {
  for (let j = 0; j < h; j += 1) {
    const ty = y + j;
    if (ty < 0 || ty >= dst.height) continue;
    for (let i = 0; i < w; i += 1) {
      const tx = x + i;
      if (tx < 0 || tx >= dst.width) continue;
      const di = (ty * dst.width + tx) * 4;
      dst.data[di] = color[0];
      dst.data[di + 1] = color[1];
      dst.data[di + 2] = color[2];
      dst.data[di + 3] = color[3];
    }
  }
}

/** Nearest neighbour upscale (the original duplicated every pixel). */
export function upscale(bitmap, factor) {
  if (factor === 1) return cloneBitmap(bitmap);
  const out = createBitmap(bitmap.width * factor, bitmap.height * factor);
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const si = (y * bitmap.width + x) * 4;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const di = ((y * factor + sy) * out.width + (x * factor + sx)) * 4;
          out.data[di] = bitmap.data[si];
          out.data[di + 1] = bitmap.data[si + 1];
          out.data[di + 2] = bitmap.data[si + 2];
          out.data[di + 3] = bitmap.data[si + 3];
        }
      }
    }
  }
  return out;
}

/**
 * Undo a 2x nearest neighbour upscale.
 *
 * Pillow's `resize(..., NEAREST)` maps a destination pixel `d` to source pixel
 * `floor((d + 0.5) * 2)` = `2d + 1`; the same convention is used here so a
 * texture that is *not* made of uniform 2x2 blocks still decodes identically.
 */
export function downscale2(bitmap) {
  if (bitmap.width % 2 || bitmap.height % 2) {
    throw new Error(`${bitmap.width}x${bitmap.height} is not a 2x texture`);
  }
  const w = bitmap.width / 2;
  const h = bitmap.height / 2;
  const out = createBitmap(w, h);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(2 * y + 1, bitmap.height - 1);
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(2 * x + 1, bitmap.width - 1);
      const si = (sy * bitmap.width + sx) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = bitmap.data[si];
      out.data[di + 1] = bitmap.data[si + 1];
      out.data[di + 2] = bitmap.data[si + 2];
      out.data[di + 3] = bitmap.data[si + 3];
    }
  }
  return out;
}

/** Stack frames vertically into one sheet. */
export function stackFrames(frames, scale = 1) {
  const scaled = frames.map((frame) => upscale(frame, scale));
  const out = createBitmap(scaled[0].width, scaled[0].height * scaled.length);
  scaled.forEach((frame, index) => pasteBitmap(out, frame, 0, index * frame.height));
  return out;
}

/** Multiply the RGB of every pixel by `[r, g, b]` in 0..1 (keeps alpha). */
export function multiplyColor(bitmap, factor) {
  const out = cloneBitmap(bitmap);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = out.data[i] * factor[0];
    out.data[i + 1] = out.data[i + 1] * factor[1];
    out.data[i + 2] = out.data[i + 2] * factor[2];
  }
  return out;
}

function isIgnored(list, x, y) {
  for (const point of list) {
    if (point[0] === x && point[1] === y) return true;
  }
  return false;
}

/** Compare two bitmaps, returning the number of differing pixels. */
export function countDifferences(a, b) {
  if (a.width !== b.width || a.height !== b.height) return -1;
  let different = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2] ||
      a.data[i + 3] !== b.data[i + 3]
    ) {
      different += 1;
    }
  }
  return different;
}
