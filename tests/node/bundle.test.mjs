/**
 * The packed vanilla textures that make the web app work on a phone.
 *
 * The bundle lives in `web/data/vanilla` and is produced by
 * `tools/pack_vanilla_textures.mjs`: a few WebP pages plus `index.json` instead
 * of 748 loose PNGs.  These tests keep it honest — the metadata in `version.txt`
 * has to match the files on disk, every page has to fit in the browser cap, the
 * pages have to reproduce the recorded content checksum, and (when the original
 * extracted folder is available) the packer has to rebuild the bundle from it.
 *
 * The 2048px page cap is a hard requirement, not a preference: a browser cannot
 * decode a bigger page, so it is asserted here, recorded in `version.txt`
 * (`max_page`) and `index.json` (`maxPage`), and enforced by the packer and by
 * `web/js/atlas.js`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT, WEB, read, readJson } from "./lib/helpers.mjs";
import { encodePNG } from "../../web/js/png.js";
import { decodePNG } from "../../tools/lib/png.mjs";
import { decodeWebp } from "../../tools/lib/webp.mjs";
import {
  DEFAULT_OUT,
  FORMAT,
  INDEX_NAME,
  MAX_PAGE,
  SCALE,
  VERSION_NAME,
  bundleBytes,
  bundleChecksum,
  collect,
  readIndex,
  readVersion,
  reconstruct,
  sampleOneX,
} from "../../tools/pack_vanilla_textures.mjs";

const BUNDLE = DEFAULT_OUT;
const SOURCE_ENV = "ARMORHELPER_VANILLA_SOURCE";

const REQUIRED_KEYS = [
  "game",
  "version",
  "format",
  "scale",
  "page_size",
  "max_page",
  "count",
  "head",
  "legs",
  "body",
  "pages",
  "strays",
  "total_bytes",
  "checksum",
];

const info = readVersion(BUNDLE);
const index = readIndex(BUNDLE);
const pageCache = new Map();

test("the bundle has a version file", () => {
  assert.ok(Object.keys(info).length > 0, "web/data/vanilla/version.txt is missing");
  for (const key of REQUIRED_KEYS) assert.ok(key in info, `version.txt is missing ${key}`);
  assert.ok(info.game.startsWith("Terraria "), info.game);
  assert.match(info.version, /^\d+(\.\d+)*$/);
  assert.equal(info.format, FORMAT);
  assert.equal(Number(info.scale), SCALE);
  assert.ok(Number(info.count) > 0);
});

test("the bundle holds only the packed files", () => {
  const files = readdirSync(BUNDLE).filter((name) => statSync(join(BUNDLE, name)).isFile()).sort();
  assert.ok(files.includes(VERSION_NAME) && files.includes(INDEX_NAME), files.join(","));
  const unexpected = files.filter((name) => !name.endsWith(".webp") && name !== VERSION_NAME && name !== INDEX_NAME);
  assert.deepEqual(unexpected, [], `unexpected files in the bundle: ${unexpected}`);
  assert.ok(!files.some((name) => name.endsWith(".png")), "the bundle still contains loose PNGs");
});

test("the version counts match the index", () => {
  assert.equal(index.pages.length, Number(info.pages));
  assert.equal(Object.keys(index.sheets).length, Number(info.count));

  const byKind = { head: 0, legs: 0, body: 0 };
  for (const key of Object.keys(index.sheets)) {
    if (key.startsWith("Armor_Head")) byKind.head += 1;
    else if (key.startsWith("Armor_Legs")) byKind.legs += 1;
    else if (key.startsWith("Armor/Armor_")) byKind.body += 1;
    else assert.fail(`unexpected texture key in the index: ${key}`);
  }
  for (const [kind, count] of Object.entries(byKind)) assert.equal(Number(info[kind]), count, kind);
  assert.equal(byKind.head + byKind.legs + byKind.body, Number(info.count));
});

test("every page fits the 2048 cap", () => {
  assert.equal(Number(info.max_page), 2048);
  assert.equal(Number(index.maxPage), 2048);
  assert.equal(MAX_PAGE, 2048);

  for (const page of index.pages) {
    assert.ok(page.w <= MAX_PAGE && page.h <= MAX_PAGE, JSON.stringify(page));
    assert.ok(page.w > 0 && page.h > 0, JSON.stringify(page));
  }
  assert.equal(Number(index.pageSize), Number(info.page_size));
  assert.ok(Number(index.pageSize) <= MAX_PAGE);
});

test("the JavaScript reader knows the same cap", () => {
  const script = read(join(WEB, "js", "atlas.js"));
  const match = /export const ATLAS_MAX_PAGE = (\d+);/.exec(script);
  assert.ok(match, "web/js/atlas.js must publish ATLAS_MAX_PAGE");
  assert.equal(Number(match[1]), MAX_PAGE);
  assert.ok(script.includes("maxPage"), "the reader has to validate the index's own cap");
});

test("the pages are WebP files of the recorded size", async () => {
  for (const page of index.pages) {
    const path = join(BUNDLE, page.file);
    assert.ok(statSync(path).size > 0, page.file);
    const bytes = readFileSync(path);
    // RIFF....WEBP
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF", page.file);
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP", page.file);
    const image = await decodeWebp(bytes);
    assert.deepEqual([image.width, image.height], [page.w, page.h], page.file);
  }
});

test("every sheet rect is inside its page", () => {
  for (const [key, [number, x, y, width, height]] of Object.entries(index.sheets)) {
    const page = index.pages[number];
    assert.ok(x >= 0 && y >= 0, key);
    assert.ok(width > 0 && height > 0, key);
    assert.ok(x + width <= page.w && y + height <= page.h, key);
    // 1x sheets are half the game texture; both halves have to be whole
    assert.ok(width * index.scale >= 20 && height * index.scale >= 20, key);
  }
});

test("stray pixels are inside their texture and really differ", async () => {
  const scale = index.scale;
  for (const [key, strays] of Object.entries(index.strays)) {
    const [, , , width, height] = index.sheets[key];
    const texture = await reconstruct(index, key, pageCache, BUNDLE);
    assert.deepEqual([texture.width, texture.height], [width * scale, height * scale], key);
    for (const [x, y, r, g, b, a] of strays) {
      assert.ok(x >= 0 && x < texture.width && y >= 0 && y < texture.height, `${key} ${x},${y}`);
      const at = (y * texture.width + x) * 4;
      assert.deepEqual([...texture.data.subarray(at, at + 4)], [r, g, b, a], `${key} ${x},${y}`);
    }
  }
  assert.equal(
    Number(info.strays),
    Object.values(index.strays).reduce((sum, strays) => sum + strays.length, 0),
  );
});

test("the pages reproduce the recorded content checksum", async () => {
  assert.equal(await bundleChecksum(BUNDLE), info.checksum);
});

test("total_bytes matches", () => {
  assert.equal(bundleBytes(BUNDLE), Number(info.total_bytes));
});

test("the bundled textures are valid images", async () => {
  for (const [key, size] of [
    ["Armor_Head_1", [40, 1120]],
    ["Armor_Legs_1", [40, 1120]],
    ["Armor/Armor_1", [360, 224]],
    ["Armor_Head_189", [40, 1120]],
    ["Armor/Armor_190", [360, 448]], // a 9x8 glow body sheet
  ]) {
    const texture = await reconstruct(index, key, pageCache, BUNDLE);
    assert.deepEqual([texture.width, texture.height], size, key);
  }
});

test("the bundle covers the known sets", () => {
  const table = readJson(join(WEB, "data", "armor_sets.json"));
  const complete = table.sets.filter((item) => item.head !== null && item.legs !== null && item.body !== null);
  const usable = complete.filter(
    (item) =>
      `Armor_Head_${item.head}` in index.sheets &&
      `Armor_Legs_${item.legs}` in index.sheets &&
      `Armor/Armor_${item.body}` in index.sheets,
  );
  assert.ok(usable.length >= 140, `only ${usable.length} of ${complete.length} sets are bundled`);
});

test("the packer refuses a page over the cap", async () => {
  const source = mkdtempSync(join(tmpdir(), "armorhelper-pack-"));
  mkdirSync(source, { recursive: true });
  const blank = { width: 40, height: 1120, data: new Uint8Array(40 * 1120 * 4) };
  writeFileSync(join(source, "Armor_Head_1.png"), await encodePNG(blank));

  let failed = null;
  try {
    execFileSync(
      process.execPath,
      [
        join(ROOT, "tools", "pack_vanilla_textures.mjs"),
        source,
        "--version",
        "test",
        "--page-size",
        String(MAX_PAGE * 2),
        "-o",
        join(source, "out"),
      ],
      { stdio: "pipe", encoding: "utf8" },
    );
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, "the packer should fail");
  assert.ok(String(failed.stderr).includes(String(MAX_PAGE)), String(failed.stderr));
});

test("1x sampling is a nearest-neighbour halving", () => {
  const sheet = { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) };
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      sheet.data.set([x * 10, y * 10, 0, 255], (y * 4 + x) * 4);
    }
  }
  const half = sampleOneX(sheet);
  assert.deepEqual([half.width, half.height], [2, 2]);
  assert.deepEqual([...half.data.subarray(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...(half.data.subarray((1 * 2 + 1) * 4, (1 * 2 + 1) * 4 + 4))], [20, 20, 0, 255]);
});

test("the packer is reproducible", async () => {
  const source = process.env[SOURCE_ENV];
  if (!source || !statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
    return; // set ARMORHELPER_VANILLA_SOURCE to check this
  }

  const out = mkdtempSync(join(tmpdir(), "armorhelper-repack-"));
  execFileSync(
    process.execPath,
    [join(ROOT, "tools", "pack_vanilla_textures.mjs"), source, "--version", info.version, "-o", out],
    { stdio: "pipe", timeout: 900_000 },
  );

  const fresh = readVersion(out);
  for (const key of ["count", "head", "legs", "body", "pages", "strays", "checksum", "format", "scale", "max_page"]) {
    assert.equal(fresh[key], info[key], key);
  }

  // The pages have to rebuild the source textures pixel for pixel, so compare
  // every sheet with the PNG the game shipped.
  const freshIndex = readIndex(out);
  const pages = new Map();
  for (const [path, relative] of collect(source)) {
    const key = relative.slice(0, relative.lastIndexOf("."));
    const expected = decodePNG(readFileSync(path));
    const produced = await reconstruct(freshIndex, key, pages, out);
    assert.deepEqual([produced.width, produced.height], [expected.width, expected.height], key);
    assert.ok(Buffer.compare(Buffer.from(produced.data), Buffer.from(expected.data)) === 0, key);
  }
});

test("collect finds every armor png", () => {
  const source = mkdtempSync(join(tmpdir(), "armorhelper-collect-"));
  mkdirSync(join(source, "Armor"), { recursive: true });
  for (const name of ["Armor_Head_7.png", "Armor_Legs_7.png", "Armor_7.png"]) {
    writeFileSync(join(source, name), "x");
  }
  writeFileSync(join(source, "Armor", "Armor_9.png"), "x");
  // decoys
  for (const name of ["Player_0_3.png", "Armor_Head_x.png", "NPC_Head_1.png"]) {
    writeFileSync(join(source, name), "x");
  }
  writeFileSync(join(source, "Armor", "Armor_9_bak.png"), "x");

  assert.deepEqual(
    collect(source).map(([, relative]) => relative).sort(),
    ["Armor/Armor_9.png", "Armor_Head_7.png", "Armor_Legs_7.png"],
  );
});

test("the web app reads the bundle from the right place", () => {
  const script = read(join(WEB, "app.js"));
  assert.ok(script.includes('const BUILTIN_DIR = "data/vanilla"'));
  assert.ok(script.includes("${BUILTIN_DIR}/version.txt"));
  assert.ok(script.includes("${BUILTIN_DIR}/${BUILTIN_INDEX}"));
  assert.ok(script.includes("createAtlasReader"));

  // ... and it is the last resort, after the folder and the uploads
  const start = script.indexOf("function textureReader()");
  const reader = script.slice(start, start + 1600);
  assert.ok(reader.indexOf("readFromFolder") < reader.indexOf("state.textures.get"));
  assert.ok(reader.indexOf("state.textures.get") < reader.indexOf("state.atlas"));
});

test("the bundle is not gitignored", () => {
  let ignored = true;
  try {
    execFileSync("git", ["check-ignore", "-q", join(BUNDLE, INDEX_NAME)], { cwd: ROOT });
  } catch {
    ignored = false;
  }
  assert.equal(ignored, false, "the bundled textures must be committed");
});

test("the index is compact enough to ship", () => {
  const size = statSync(join(BUNDLE, INDEX_NAME)).size;
  assert.ok(size < 64 * 1024, `index.json grew to ${size} bytes`);
  assert.equal(readJson(join(BUNDLE, INDEX_NAME)).version, info.version);
});
