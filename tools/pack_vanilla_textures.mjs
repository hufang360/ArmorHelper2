#!/usr/bin/env node
/**
 * Pack the vanilla armor textures into WebP atlases for the web app.
 *
 * Mobile browsers have no File System Access API, so a phone user cannot point
 * the web app at their game folder — and picking 748 files by hand is not an
 * option either.  The textures therefore ship with the site, but not as 748
 * files: they are packed into a handful of pages plus an index, which is what
 * `web/js/atlas.js` reads.
 *
 * Three things make the packed bundle ~6x smaller than the PNGs it replaces, and
 * none of them is "cut away the empty space" (that is worth a few percent only,
 * because PNG/WebP already store transparent runs for free):
 *
 * 1. **Lossless WebP** instead of PNG — 1.10 MB -> 0.29 MB on its own.
 * 2. **1x storage.**  Every vanilla texture is an exact 2x nearest-neighbour
 *    upscale of a 1x pixel-art image (see `docs/贴图裁切说明.md`), so only the
 *    1x image is stored and `web/js/atlas.js` upscales it again on load.  The
 *    few pixels that break the 2x2 rule (22 files, ~120 pixels) are recorded in
 *    `index.json` as exceptions, so the reconstruction is exact.
 * 3. **Packing by slot** (head / legs / body) instead of by armor set.  Sheets
 *    of the same slot have the same shape and tile perfectly, and — unlike armor
 *    sets — every texture belongs to exactly one slot.
 *
 * Usage:
 *
 *     node tools/pack_vanilla_textures.mjs "/path/to/Content/Images" --version 1.4.5.8
 *
 * The result is reproducible: re-running it against the same folder produces the
 * same pages, index and content checksum, which is what
 * `tests/node/bundle.test.mjs` checks (it can also rebuild a bundle from the
 * source folder when `ARMORHELPER_VANILLA_SOURCE` is set).
 *
 * WebP encoding goes through `@jsquash/webp` (libwebp as wasm).  That is a
 * development-only dependency: the shipped site decodes WebP natively.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodePNG } from "./lib/png.mjs";
import { decodeWebp, encodeWebpLossless } from "./lib/webp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_OUT = join(ROOT, "web", "data", "vanilla");

/** Hard cap for one packed page, in pixels per side. */
export const MAX_PAGE = 2048;
/** Default page edge. Must fit the tallest sheet (560 at 1x). */
export const DEFAULT_PAGE_SIZE = 1024;
/** The stored textures are this much smaller than the game's own sheets. */
export const SCALE = 2;

export const INDEX_NAME = "index.json";
export const VERSION_NAME = "version.txt";
export const FORMAT = "webp-atlas";

const PATTERNS = [
  [/^Armor_Head_\d+\.png$/, ""],
  [/^Armor_Legs_\d+\.png$/, ""],
  [/^Armor_\d+\.png$/, "Armor"],
];

/* ----------------------------------------------------------------- import -- */

/** Every armor PNG in `source` as `[path, relativeDestination]`. */
export function collect(source) {
  const found = [];
  for (const [pattern, sub] of PATTERNS) {
    const folder = sub ? join(source, sub) : source;
    if (!existsSync(folder) || !statSync(folder).isDirectory()) continue;
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isFile() && pattern.test(name)) {
        found.push([path, sub ? `${sub}/${name}` : name]);
      }
    }
  }
  return found;
}

/** `head` / `legs` / `body` for a bundle-relative texture path. */
export function kindOf(relative) {
  if (relative.startsWith("Armor_Head")) return "head";
  if (relative.startsWith("Armor_Legs")) return "legs";
  return "body";
}

/** The lookup key used by the index: the path without its extension. */
export const sheetKey = (relative) => relative.slice(0, relative.lastIndexOf("."));

/**
 * Halve a 2x texture by keeping the top-left pixel of every 2x2 block.
 *
 * Sampling the top-left (rather than the bottom-right) keeps the number of stray
 * pixels minimal: a lone odd pixel only costs itself, not three neighbours.
 */
export function sampleOneX(image) {
  const width = image.width / SCALE;
  const height = image.height / SCALE;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * SCALE * image.width + x * SCALE) * 4;
      data.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Pixels of the 2x texture that a nearest upscale of `small` loses. */
export function findStrays(image, small) {
  const strays = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const target = (y * image.width + x) * 4;
      const source = (Math.floor(y / SCALE) * small.width + Math.floor(x / SCALE)) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        if (image.data[target + channel] !== small.data[source + channel]) {
          strays.push([x, y, ...image.data.subarray(target, target + 4)]);
          break;
        }
      }
    }
  }
  return strays;
}

/* -------------------------------------------------------------------- pack -- */

/** Shelf-pack `(key, kind, image)` items into pages of `pageSize` square. */
export function pack(items, pageSize) {
  const pages = [];
  let page = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const [key, , image] of items) {
    if (image.width > pageSize || image.height > pageSize) {
      throw new Error(`${key} is ${image.width}x${image.height}, larger than the ${pageSize}px page`);
    }
    if (x + image.width > pageSize) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    if (y + image.height > pageSize) {
      pages.push(page);
      page = [];
      x = 0;
      y = 0;
      rowHeight = 0;
    }
    page.push([key, image, x, y]);
    x += image.width;
    rowHeight = Math.max(rowHeight, image.height);
  }
  if (page.length) pages.push(page);
  return pages;
}

/** Sort object keys the way Python's `json.dumps(sort_keys=True)` does. */
function sortedObject(entries) {
  const out = {};
  for (const key of [...entries.keys()].sort()) out[key] = entries.get(key);
  return out;
}

export async function build(source, out, version, pageSize = DEFAULT_PAGE_SIZE) {
  if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error(`${source} is not a folder`);
  if (pageSize > MAX_PAGE) throw new Error(`page size ${pageSize} exceeds the ${MAX_PAGE}px browser cap`);
  if (pageSize < 560) throw new Error(`page size ${pageSize} cannot hold a 20x560 head sheet`);

  const entries = collect(source);
  if (!entries.length) throw new Error(`no armor PNGs found in ${source}`);

  const byKind = { head: [], legs: [], body: [] };
  const counts = { head: 0, legs: 0, body: 0 };
  const strays = new Map();
  const content = createHash("sha256");

  // sorted by key: the order `bundleChecksum` hashes in, so the content
  // checksum does not depend on how the pages are laid out
  const ordered = [...entries].sort((a, b) => (sheetKey(a[1]) < sheetKey(b[1]) ? -1 : 1));
  for (const [path, relative] of ordered) {
    const image = decodePNG(readFileSync(path));
    if (image.width % SCALE || image.height % SCALE) {
      throw new Error(`${relative} is ${image.width}x${image.height}, not a ${SCALE}x texture`);
    }
    const key = sheetKey(relative);
    const kind = kindOf(relative);
    const small = sampleOneX(image);
    const found = findStrays(image, small);
    if (found.length) strays.set(key, found);
    byKind[kind].push([key, kind, small]);
    counts[kind] += 1;
    content.update(Buffer.from(`${key} ${image.width}x${image.height}\n`, "utf8"));
    content.update(image.data);
  }

  if (existsSync(out)) {
    for (const name of readdirSync(out).sort()) {
      const path = join(out, name);
      if (statSync(path).isFile()) unlinkSync(path);
      else throw new Error(`${out} contains a folder (${name})`);
    }
  }
  mkdirSync(out, { recursive: true });

  const pagesMeta = [];
  const sheets = new Map();
  for (const kind of ["head", "legs", "body"]) {
    const pages = pack(byKind[kind], pageSize);
    for (const [number, page] of pages.entries()) {
      const width = Math.max(...page.map(([, image, x]) => x + image.width));
      const height = Math.max(...page.map(([, image, , y]) => y + image.height));
      const canvas = { width, height, data: new Uint8Array(width * height * 4) };
      for (const [, image, x, y] of page) {
        for (let row = 0; row < image.height; row += 1) {
          const from = row * image.width * 4;
          const to = ((y + row) * width + x) * 4;
          canvas.data.set(image.data.subarray(from, from + image.width * 4), to);
        }
      }
      const name = `${kind}-${number}.webp`;
      writeFileSync(join(out, name), await encodeWebpLossless(canvas));
      pagesMeta.push({ file: name, w: width, h: height });
      for (const [key, image, x, y] of page) {
        sheets.set(key, [pagesMeta.length - 1, x, y, image.width, image.height]);
      }
    }
  }

  const index = {
    format: FORMAT,
    maxPage: MAX_PAGE,
    pageSize,
    pages: pagesMeta.map((page) => ({ file: page.file, h: page.h, w: page.w })),
    scale: SCALE,
    sheets: sortedObject(sheets),
    strays: sortedObject(strays),
    version,
  };
  writeFileSync(join(out, INDEX_NAME), `${JSON.stringify(index)}\n`, "utf8");

  for (const page of pagesMeta) {
    if (page.w > MAX_PAGE || page.h > MAX_PAGE) {
      throw new Error(`${page.file} is ${page.w}x${page.h}, over the ${MAX_PAGE}px cap`);
    }
  }

  const total = bundleBytes(out);
  const info = {
    game: `Terraria ${version}`,
    version,
    source: basename(source),
    format: FORMAT,
    scale: String(SCALE),
    page_size: String(pageSize),
    max_page: String(MAX_PAGE),
    count: String(entries.length),
    head: String(counts.head),
    legs: String(counts.legs),
    body: String(counts.body),
    pages: String(pagesMeta.length),
    strays: String([...strays.values()].reduce((sum, found) => sum + found.length, 0)),
    total_bytes: String(total),
    checksum: content.digest("hex").slice(0, 16),
  };
  writeFileSync(
    join(out, VERSION_NAME),
    "# ArmorHelper bundled vanilla armor textures\n" +
      "# packed from an extracted Content/Images folder by tools/pack_vanilla_textures.mjs\n" +
      "# total_bytes counts the pages and index.json, not this file\n" +
      Object.entries(info)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    "utf8",
  );
  return info;
}

/* ------------------------------------------------------------------ verify -- */

/** Parse `version.txt`. */
export function readVersion(out = DEFAULT_OUT) {
  const path = join(out, VERSION_NAME);
  if (!existsSync(path)) return {};
  const result = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return result;
}

export const readIndex = (out = DEFAULT_OUT) => JSON.parse(readFileSync(join(out, INDEX_NAME), "utf8"));

/** Rebuild one 2x texture from its page (the Node twin of `atlas.js`). */
export async function reconstruct(index, key, pages = new Map(), base = DEFAULT_OUT) {
  const [number, x, y, width, height] = index.sheets[key];
  let page = pages.get(number);
  if (!page) {
    page = await decodeWebp(readFileSync(join(base, index.pages[number].file)));
    pages.set(number, page);
  }

  const scale = index.scale ?? SCALE;
  const texture = { width: width * scale, height: height * scale, data: new Uint8Array(width * scale * height * scale * 4) };
  for (let row = 0; row < texture.height; row += 1) {
    for (let column = 0; column < texture.width; column += 1) {
      const source = ((y + Math.floor(row / scale)) * page.width + (x + Math.floor(column / scale))) * 4;
      const target = (row * texture.width + column) * 4;
      texture.data.set(page.data.subarray(source, source + 4), target);
    }
  }

  for (const [sx, sy, r, g, b, a] of index.strays?.[key] ?? []) {
    texture.data.set([r, g, b, a], (sy * texture.width + sx) * 4);
  }
  return texture;
}

/**
 * The content checksum of a packed bundle: rebuild every texture from the pages
 * and hash it in game order, so the result is independent of the image codec.
 */
export async function bundleChecksum(out = DEFAULT_OUT) {
  const index = readIndex(out);
  const pages = new Map();
  const digest = createHash("sha256");
  for (const key of Object.keys(index.sheets).sort()) {
    const texture = await reconstruct(index, key, pages, out);
    digest.update(Buffer.from(`${key} ${texture.width}x${texture.height}\n`, "utf8"));
    digest.update(texture.data);
  }
  return digest.digest("hex").slice(0, 16);
}

/** Bytes the app actually downloads: the pages plus `index.json`. */
export function bundleBytes(out = DEFAULT_OUT) {
  return readdirSync(out)
    .filter((name) => name !== VERSION_NAME)
    .map((name) => join(out, name))
    .filter((path) => statSync(path).isFile())
    .reduce((sum, path) => sum + statSync(path).size, 0);
}

/* --------------------------------------------------------------------- cli -- */

function parseArgs(argv) {
  const args = { source: null, version: "unknown", pageSize: DEFAULT_PAGE_SIZE, output: DEFAULT_OUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      console.log(
        'usage: node tools/pack_vanilla_textures.mjs "<Content/Images>" [--version X] [--page-size N] [-o OUT]',
      );
      process.exit(0);
    }
    if (arg === "--version") args.version = argv[++index];
    else if (arg === "--page-size") args.pageSize = Number(argv[++index]) || DEFAULT_PAGE_SIZE;
    else if (arg === "-o" || arg === "--output") args.output = resolve(argv[++index]);
    else if (!args.source) args.source = resolve(arg);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if (!args.source) throw new Error("missing <Content/Images>");
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const info = await build(args.source, args.output, args.version, args.pageSize);

  const checksum = await bundleChecksum(args.output);
  if (checksum !== info.checksum) {
    throw new Error(`the packed bundle does not reproduce the source (${checksum} != ${info.checksum})`);
  }

  console.log(`wrote ${args.output}`);
  for (const [key, value] of Object.entries(info)) console.log(`  ${key}=${value}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)).catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }));
}
