/**
 * The site itself, without a browser: the checked in data, the HTML↔JS wiring,
 * the service worker's cache list, the manifest, the bundled textures and the
 * Pages workflow.
 *
 * The interactive half (headless Chrome) lives in `tests/test_web_port.py` for
 * now; everything here is plain file inspection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const WEB = join(ROOT, "web");

const read = (path) => readFileSync(path, "utf8");
const readJson = (path) => JSON.parse(read(path));
const LAYOUT = readJson(join(WEB, "data", "layout.json"));
const HTML = read(join(WEB, "index.html"));
const APP = read(join(WEB, "app.js"));

/** Width/height from a PNG's IHDR, so icon checks need no image library. */
function pngSize(path) {
  const bytes = readFileSync(path);
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "not a PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("the layout data covers every frame", () => {
  assert.deepEqual(LAYOUT.frame, { w: 20, h: 28, count: 20 });
  assert.deepEqual(LAYOUT.templateSize, [128, 80]);
  assert.equal(Object.keys(LAYOUT.layers.frontArm).length, 20);
  assert.equal(Object.keys(LAYOUT.cells.frontArm).length, 20);
  assert.equal(Object.keys(LAYOUT.cells.backArm).length, 20);
  assert.equal(LAYOUT.legMapping.length, 10);
  assert.ok(LAYOUT.targets.all.includes("head"));
  assert.equal(LAYOUT.targets.all.length, 12);
});

test("the front end files exist and are wired", () => {
  const ids = new Set([...HTML.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));

  const refs = new Set();
  for (const match of APP.matchAll(/\$\("#([\w-]+)"\)/g)) refs.add(match[1]);
  for (const match of APP.matchAll(/on\("#([\w-]+)"/g)) refs.add(match[1]);
  // `$("#sheet-${role}-thumb")` style lookups
  const templated = [...APP.matchAll(/`#([\w-]+)-\$\{(?:role|kind)\}-([\w-]+)`/g)];
  for (const [, prefix, suffix] of templated) {
    for (const role of ["head", "body", "legs"]) refs.add(`${prefix}-${role}-${suffix}`);
  }
  for (const tab of ["export", "gifs", "reverse", "settings"]) refs.add(`tab-${tab}`);

  const missing = [...refs].filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `app.js references missing ids: ${missing}`);

  // every module the app imports has to exist
  for (const match of APP.matchAll(/from "([^"]+)"/g)) {
    assert.ok(existsSync(join(WEB, match[1])), match[1]);
  }

  // data-i18n keys must exist in both languages
  const messages = readJson(join(WEB, "data", "i18n.json")).messages;
  const keys = new Set([...HTML.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(keys.size > 0);
  for (const language of ["zh_CN", "en"]) {
    const missingKeys = [...keys].filter((key) => !(key in messages[language]));
    assert.deepEqual(missingKeys, [], `${language} is missing ${missingKeys}`);
  }

  // no external requests: the page must work offline / on Pages
  for (const name of ["index.html", "style.css", "app.js"]) {
    const text = read(join(WEB, name));
    assert.ok(!text.includes("https://"), name);
    assert.ok(!text.includes("http://"), name);
  }
});

test("every translation the app uses exists", () => {
  const messages = readJson(join(WEB, "data", "i18n.json")).messages;
  const used = new Set([...APP.matchAll(/(?<![\w.$])t\("([\w.]+)"/g)].map((m) => m[1]));
  for (const role of ["head", "body", "legs"]) used.add(`web.slot.${role}`);
  assert.ok(used.size > 40, `${used.size} keys`);

  for (const language of ["zh_CN", "en"]) {
    const missing = [...used].filter((key) => !(key in messages[language]));
    assert.deepEqual(missing, [], `${language} has no text for ${missing}`);
  }
});

test("the site icon is used", () => {
  const icon = join(WEB, "data", "icon.png");
  const [width, height] = pngSize(icon);
  assert.ok(width >= 32 && height >= 32, `${width}x${height}`);

  assert.ok(HTML.includes('<link rel="icon" type="image/png" href="data/icon.png">'));
  assert.ok(HTML.includes('rel="apple-touch-icon" href="data/icon.png"'));
  assert.ok(HTML.includes('<img src="data/icon.png"'));
  // the header logo must not be rendered as pixel art
  assert.ok(read(join(WEB, "style.css")).includes(".brand-icon"));
});

test("the player textures are bundled", () => {
  const expected = {
    "Player_0_3.png": [360, 224],
    "Player_0_7.png": [360, 224],
    "Player_0_10.png": [40, 1120],
  };
  for (const [name, size] of Object.entries(expected)) {
    const path = join(WEB, "data", "player", name);
    assert.ok(existsSync(path), `${name} is not bundled`);
    assert.deepEqual(pngSize(path), size, name);
  }
  const info = read(join(WEB, "data", "player", "version.txt"));
  assert.ok(info.includes("count=3"));
  assert.ok(info.includes("version="));
  // the page loads them by name and the service worker caches them
  assert.ok(APP.includes("data/player"));
  const worker = read(join(WEB, "sw.js"));
  for (const name of Object.keys(expected)) {
    assert.ok(worker.includes(`data/player/${name}`), name);
  }
});

test("the service worker precaches the whole app", () => {
  const script = read(join(WEB, "sw.js"));
  assert.match(script, /const VERSION = "[^"]+"/);
  assert.ok(script.includes("skipWaiting") && script.includes("clients.claim"));

  const core = /const CORE = \[([\s\S]*?)\];/.exec(script);
  assert.ok(core, "sw.js has no CORE list");
  const files = [...core[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(files.includes("index.html") && files.includes("app.js"));

  for (const name of files) {
    if (name === "./") continue;
    assert.ok(existsSync(join(WEB, name)), `sw.js precaches a missing file: ${name}`);
  }

  // every module the app imports has to be precached, or an offline boot 404s
  const modules = new Set([...APP.matchAll(/from "\.\/(js\/[^"]+)"/g)].map((m) => m[1]));
  const missing = [...modules].filter((module) => !files.includes(module));
  assert.deepEqual(missing, [], `sw.js does not cache ${missing}`);

  // the bundled textures are big: they are cached on use, not on install
  assert.ok(script.includes("data/vanilla/"));
  assert.ok(!files.includes("data/vanilla/version.txt"));
  // Pages serves the site from /<repo>/, so paths must be scope-relative
  assert.ok(script.includes("self.registration.scope"));
});

test("the service worker is registered and scoped to the site", () => {
  assert.ok(APP.includes('register("sw.js")'));
  assert.ok(APP.includes("serviceWorker"));
  assert.ok(HTML.includes('<link rel="manifest" href="manifest.webmanifest">'));
  assert.ok(HTML.includes('<meta name="theme-color"'));
});

test("the web manifest is a valid PWA manifest", () => {
  const manifest = readJson(join(WEB, "manifest.webmanifest"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.theme_color.startsWith("#"));
  assert.ok(manifest.icons.length > 0, "a PWA needs at least one icon");
  for (const icon of manifest.icons) {
    assert.ok(existsSync(join(WEB, icon.src)), icon.src);
    assert.ok(icon.sizes.includes("x"), icon.sizes);
  }
});

test("the web app holds no Python", () => {
  for (const path of walk(WEB)) {
    assert.notEqual(path.slice(path.lastIndexOf(".")), ".py", relative(WEB, path));
  }
});

test("the Pages workflow publishes the web folder", () => {
  const workflow = read(join(ROOT, ".github", "workflows", "pages.yml"));
  assert.ok(workflow.includes("path: web"));
  // the tests must run before the site is published
  assert.ok(workflow.includes("npm test"));
  assert.ok(existsSync(join(WEB, ".nojekyll")));
});

test("the bundled atlas is internally consistent", () => {
  const info = Object.fromEntries(
    read(join(WEB, "data", "vanilla", "version.txt"))
      .split("\n")
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const [key, value] = line.split("=", 2);
        return [key.trim(), value.trim()];
      }),
  );
  const index = readJson(join(WEB, "data", "vanilla", "index.json"));

  assert.equal(info.format, "webp-atlas");
  assert.equal(Number(info.max_page), 2048);
  assert.equal(index.maxPage, 2048);
  assert.equal(Number(info.count), Object.keys(index.sheets).length);
  assert.equal(index.pages.length, Number(info.pages));

  // every page file is there and inside the browser cap
  for (const page of index.pages) {
    const path = join(WEB, "data", "vanilla", page.file);
    assert.ok(existsSync(path), page.file);
    assert.ok(page.w <= 2048 && page.h <= 2048, `${page.file} ${page.w}x${page.h}`);
  }
});

/** Every file under `root`. */
function* walk(root) {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stats = statSync(path);
    if (stats.isDirectory()) yield* walk(path);
    else yield path;
  }
}
