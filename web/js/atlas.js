/**
 * Reader for the packed vanilla texture atlases.
 *
 * The 748 bundled armor textures do not ship as 748 files: the packer
 * (`tools/pack_vanilla_textures.mjs`) puts them into a handful of WebP pages plus
 * `index.json`, and this module turns a game path such as
 * `Armor_Head_1.png` back into the bitmap the rest of the app expects.
 *
 * Two details make the bundle small without making it lossy:
 *
 * - the pages hold the textures at **1x**, because every vanilla sheet is an
 *   exact 2x nearest-neighbour upscale of the 1x pixel art.  The original 2x
 *   bitmap is rebuilt by upscaling with `index.scale`, so callers never see the
 *   difference.
 * - the 120 pixels that break the 2x2 rule are listed in `index.strays` and are
 *   written back after the upscale, so the reconstruction is exact.
 *
 * A page is at most `ATLAS_MAX_PAGE` pixels per side.  `index.json` records the
 * cap in `maxPage`, and `validateIndex` rejects a bundle that breaks it: a
 * browser that cannot allocate the page would otherwise fail at draw time with
 * no useful message.
 */

import { cropRegion, upscale } from "./bitmap.js";

/** Largest page edge any browser decodes reliably (iOS Safari caps the area). */
export const ATLAS_MAX_PAGE = 2048;

/** How many bytes of decoded pages to keep around (each 1024x1024 page is 4 MB). */
export const DEFAULT_CACHE_BYTES = 24 * 1024 * 1024;

/**
 * The index key for a texture path.
 *
 * `Armor_Head_1.png` -> `Armor_Head_1`, `Armor/Armor_1.png` -> `Armor/Armor_1`.
 * The extension is dropped, the folder is kept, so the three sheet kinds can
 * never collide.
 */
export function sheetKey(path) {
  const text = String(path);
  const cut = text.lastIndexOf("/") + 1;
  const folder = text.slice(0, cut);
  const stem = text.slice(cut).replace(/\.[^.]+$/, "");
  return `${folder}${stem}`;
}

/** Throw a descriptive error when a bundle cannot be used. */
export function validateIndex(index) {
  const maxPage = Number(index?.maxPage ?? 0);
  if (!Number.isFinite(maxPage) || maxPage <= 0) {
    throw new Error("atlas index has no maxPage");
  }
  if (maxPage > ATLAS_MAX_PAGE) {
    throw new Error(`atlas index allows ${maxPage}px pages, over the ${ATLAS_MAX_PAGE}px cap`);
  }
  const pages = index.pages;
  if (!Array.isArray(pages) || !pages.length) throw new Error("atlas index has no pages");
  for (const page of pages) {
    if (!page?.file) throw new Error("atlas page without a file name");
    if (page.w > maxPage || page.h > maxPage) {
      throw new Error(`atlas page ${page.file} is ${page.w}x${page.h}, over the ${maxPage}px cap`);
    }
  }
  if (!index.sheets || typeof index.sheets !== "object") throw new Error("atlas index has no sheets");
  return index;
}

/** Write the index's exception pixels back onto an upscaled cell. */
function applyStrays(bitmap, strays) {
  if (!strays) return;
  for (const [x, y, r, g, b, a] of strays) {
    if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) continue;
    const index = (y * bitmap.width + x) * 4;
    bitmap.data[index] = r;
    bitmap.data[index + 1] = g;
    bitmap.data[index + 2] = b;
    bitmap.data[index + 3] = a;
  }
}

/** Rebuild one texture out of an already decoded page. */
export function reconstructFromPage(page, rect, strays, scale = 2) {
  const [x, y, w, h] = rect;
  const cell = cropRegion(page, [x, y, w, h]);
  const texture = scale === 1 ? cell : upscale(cell, scale);
  applyStrays(texture, strays);
  return texture;
}

/**
 * Build a texture reader over a packed atlas.
 *
 * `loadPage(file)` has to return a decoded bitmap for a page (or `null` when it
 * cannot be fetched).  Pages are cached, least recently used first to go, so
 * walking all 204 sets does not decode 17 pages over and over while a single
 * set still stays within a few megabytes.
 *
 * The returned reader maps a game path to a bitmap, or `null` when the bundle
 * does not contain it — the same contract as a missing file.
 *
 * @typedef {{ index: any, loadPage: (file: string) => Promise<any>, cacheBytes?: number }} AtlasOptions
 * @param {Partial<AtlasOptions>} [options]
 */
export function createAtlasReader({ index, loadPage, cacheBytes = DEFAULT_CACHE_BYTES } = {}) {
  validateIndex(index);

  /** page number -> decoded bitmap */
  const loaded = new Map();
  /** page number -> pending promise */
  const pending = new Map();
  let bytes = 0;

  function touch(number, page) {
    const size = page.width * page.height * 4;
    const previous = loaded.get(number);
    if (previous) bytes -= previous.width * previous.height * 4;
    loaded.delete(number);
    loaded.set(number, page);
    bytes += size;
    // Map keeps insertion order, so the first key is the least recently used.
    for (const [oldest, bitmap] of loaded) {
      if (bytes <= cacheBytes || loaded.size === 1) break;
      bytes -= bitmap.width * bitmap.height * 4;
      loaded.delete(oldest);
    }
  }

  async function pageFor(number) {
    const hit = loaded.get(number);
    if (hit) {
      touch(number, hit);
      return hit;
    }
    if (pending.has(number)) return pending.get(number);
    const meta = index.pages[number];
    if (!meta) return null;
    const request = Promise.resolve()
      .then(() => loadPage(meta.file))
      .then((bitmap) => {
        if (!bitmap) return null;
        touch(number, bitmap);
        return bitmap;
      })
      .finally(() => pending.delete(number));
    pending.set(number, request);
    return request;
  }

  const reader = async (path) => {
    const key = sheetKey(path);
    const sheet = index.sheets[key];
    if (!sheet) return null;
    const [number, x, y, w, h] = sheet;
    const page = await pageFor(number);
    if (!page) return null;
    if (x + w > page.width || y + h > page.height) {
      throw new Error(`atlas rect for ${key} does not fit ${index.pages[number].file}`);
    }
    return reconstructFromPage(page, [x, y, w, h], index.strays?.[key], index.scale ?? 2);
  };

  /** Number of pages currently held in memory (for tests and diagnostics). */
  reader.cachedPages = () => loaded.size;
  return reader;
}
