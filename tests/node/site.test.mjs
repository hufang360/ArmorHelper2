/**
 * The site itself, without a browser: the checked in data, the HTML↔JS wiring,
 * the service worker's cache list, the manifest, the bundled textures and the
 * Pages workflow.
 *
 * The interactive half (headless Chrome) lives in `tests/node/browser.test.mjs`
 * for now; everything here is plain file inspection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";

import { coreFingerprint } from "../../tools/lib/sw_fingerprint.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const WEB = join(ROOT, "web");

const read = (path) => readFileSync(path, "utf8");
const readJson = (path) => JSON.parse(read(path));
const LAYOUT = readJson(join(WEB, "data", "layout.json"));
const HTML = read(join(WEB, "index.html"));
const APP = read(join(WEB, "app.js"));
const APP_DIR = join(WEB, "app");
/** The UI layer: `app.js` plus the modules under `app/`. */
const UI = [APP, ...readdirSync(APP_DIR).map((name) => read(join(APP_DIR, name)))].join("\n");

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
  // no export targets are left: every output is always built
  assert.deepEqual(LAYOUT.targets.all, []);
  assert.deepEqual(LAYOUT.targets.defaults, []);
});

test("the front end files exist and are wired", () => {
  const ids = new Set([...HTML.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));

  const refs = new Set();
  for (const match of APP.matchAll(/\$\("#([\w-]+)"\)/g)) refs.add(match[1]);
  for (const match of APP.matchAll(/on\("#([\w-]+)"/g)) refs.add(match[1]);
  // `$("#sheet-${role}-thumb")` style lookups.  The page has all three slots,
  // but a loop may cover fewer of them: `for (const role of ["head", "legs"])`.
  const templated = [...APP.matchAll(/`#([\w-]+)-\$\{(?:role|kind)\}-([\w-]+)`/g)];
  for (const [statement, prefix, suffix] of templated) {
    const at = statement.index;
    // a loop may cover only some of the slots: `for (const role of ["head", "legs"])`
    const before = APP.slice(Math.max(0, at - 400), at);
    const loops = [...before.matchAll(/for \(const (?:role|kind) of \[([^\]]*)\]\)/g)];
    const roles = loops.length
      ? loops.at(-1)[1].split(",").map((part) => part.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      : ["head", "body", "legs"];
    for (const role of roles) refs.add(`${prefix}-${role}-${suffix}`);
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

  // No external requests: the page must work offline and on Pages.  A link
  // (an `href`, or a URL kept in a constant) is not a request, so only the
  // places that would fetch something are checked.
  const requestPatterns = [
    /src="https?:/,
    /\bfetch\(\s*["']https?:/,
    /\bimport\(\s*["']https?:/,
    /url\(\s*["']?https?:/,
    /@import\s+(?:url\()?["']?https?:/,
  ];
  for (const name of ["index.html", "style.css", "app.js"]) {
    const text = read(join(WEB, name));
    const found = requestPatterns.filter((pattern) => pattern.test(text)).map(String);
    assert.deepEqual(found, [], `${name} requests something external: ${found}`);
  }
});

test("the site has no absolute paths", () => {
  // GitHub Pages serves a project site from /<repo>/, and people also drop this
  // folder into a subdirectory of their own server: everything must be relative.
  const shipped = [
    "index.html",
    "app.js",
    "style.css",
    "sw.js",
    ...readdirSync(join(WEB, "js")).map((name) => `js/${name}`),
  ];
  for (const name of shipped) {
    const text = read(join(WEB, name));
    const absolute = [
      ...text.matchAll(/(?:src|href)="(\/[^/"][^"]*)"/g),
      ...text.matchAll(/(?:fetch|import)\(\s*"(\/[^/"][^"]*)"/g),
      ...text.matchAll(/"(\/(?:js|data|tests)\/[^"]*)"/g),
    ].map((match) => match[1]);
    assert.deepEqual(absolute, [], `${name} uses absolute paths: ${absolute}`);
  }

  const manifest = readJson(join(WEB, "manifest.webmanifest"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  for (const icon of manifest.icons) assert.ok(!icon.src.startsWith("/"), icon.src);

  // the precache list is relative to the worker (which sits in the site folder)
  const core = /const CORE = \[([\s\S]*?)\];/.exec(read(join(WEB, "sw.js")))[1];
  for (const [, entry] of core.matchAll(/"([^"]+)"/g)) {
    assert.ok(!entry.startsWith("/"), `sw.js CORE has an absolute entry: ${entry}`);
  }
});

test("every translation the app uses exists", () => {
  const messages = readJson(join(WEB, "data", "i18n.json")).messages;
  // the UI layer is app.js plus app/*.js: a key may be used in either
  const used = new Set([...UI.matchAll(/(?<![\w.$])t\("([\w.]+)"/g)].map((m) => m[1]));
  for (const role of ["head", "body", "legs"]) used.add(`web.slot.${role}`);
  assert.ok(used.size > 40, `${used.size} keys`);

  for (const language of ["zh_CN", "en"]) {
    const missing = [...used].filter((key) => !(key in messages[language]));
    assert.deepEqual(missing, [], `${language} has no text for ${missing}`);
  }
});

test("the release version is one number everywhere", () => {
  const root = readJson(join(ROOT, "package.json"));
  const web = readJson(join(WEB, "package.json"));
  const shown = readJson(join(WEB, "data", "version.json"));
  assert.match(shown.version, /^\d+\.\d+\.\d+$/);
  assert.equal(shown.name, "ArmorHelper");
  assert.equal(web.version, shown.version, "web/package.json drifted");
  assert.equal(root.version, shown.version, "package.json drifted");

  // the page shows it, and the worker caches the file it comes from
  assert.ok(HTML.includes('id="app-version"'), "the header has no version badge");
  assert.ok(APP.includes("data/version.json"), "the app never reads the version");
  assert.ok(read(join(WEB, "sw.js")).includes('"data/version.json"'), "not precached");
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
    "Player_0_0.png": [40, 1118],
    "Player_0_1.png": [40, 1118],
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
  assert.ok(info.includes("count=5"));
  assert.ok(info.includes("version="));
  // the page loads them by name and the service worker caches them
  assert.ok(UI.includes("data/player"), "nothing loads data/player");
  const worker = read(join(WEB, "sw.js"));
  for (const name of Object.keys(expected)) {
    assert.ok(worker.includes(`data/player/${name}`), name);
  }
});

test("the service worker precaches the whole app", () => {
  const script = read(join(WEB, "sw.js"));
  assert.ok(script.includes("skipWaiting") && script.includes("clients.claim"));

  // A stale cache fingerprint is the one failure no other test can see: the app
  // works for the developer and serves old bytes to everybody else.
  const stamp = /const FINGERPRINT = "([^"]+)";/.exec(script);
  assert.ok(stamp, "sw.js has no FINGERPRINT constant");
  assert.equal(
    stamp[1],
    coreFingerprint(WEB, script),
    "sw.js cache fingerprint is stale: run npm run sw:stamp",
  );

  const core = /const CORE = \[([\s\S]*?)\];/.exec(script);
  assert.ok(core, "sw.js has no CORE list");
  const files = [...core[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(files.includes("index.html") && files.includes("app.js"));

  for (const name of files) {
    if (name === "./") continue;
    assert.ok(existsSync(join(WEB, name)), `sw.js precaches a missing file: ${name}`);
  }

  // every module the app imports has to be precached, or an offline boot 404s.
  // Scan the imported graph, not just `app.js`: `app/*.js` import each other.
  const importers = ["app.js", ...files.filter((name) => name.startsWith("app/") || name.startsWith("js/"))];
  const modules = new Set(
    importers.flatMap((name) => {
      const directory = posix.dirname(name);
      return [...read(join(WEB, name)).matchAll(/from "\.\/([^"]+)"/g)].map((match) =>
        posix.normalize(posix.join(directory, match[1])),
      );
    }),
  );
  const uncached = [...modules].filter((module) => !files.includes(module));
  assert.deepEqual(uncached, [], `sw.js does not cache ${uncached}`);

  // ...and so has everything index.html pulls off disk, vendor CSS included
  const assets = new Set([
    ...[...HTML.matchAll(/<link[^>]+href="([^"]+)"/g)].map((match) => match[1]),
    ...[...HTML.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]),
  ]);
  assert.deepEqual(
    [...assets].filter((asset) => !files.includes(asset)),
    [],
    "index.html loads a file that sw.js does not cache",
  );

  // the bundled textures are big: they are cached on use, not on install
  assert.ok(script.includes("data/vanilla/"));
  assert.ok(!files.includes("data/vanilla/version.txt"));
  // every hit refreshes its own copy, so a missed `sw:stamp` heals on reload
  assert.ok(
    /if \(ours\(path\)\) fetch\(request\)/.test(script),
    "sw.js never refreshes a cache hit",
  );
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
  // `web/` must ship nothing that needs an interpreter.  Checking the extension
  // alone was not enough: a `python3 -m http.server` npm script sat in
  // `web/package.json` for months and nobody noticed.
  const code = [".js", ".mjs", ".json", ".html", ".webmanifest"];
  for (const path of walk(WEB)) {
    assert.notEqual(path.slice(path.lastIndexOf(".")), ".py", relative(WEB, path));
    if (!code.includes(path.slice(path.lastIndexOf(".")))) continue;
    const text = readFileSync(path, "utf8");
    assert.ok(!/\bpython3?\b/i.test(text), `${relative(WEB, path)} runs Python`);
    assert.ok(!/\w+\.py\b/.test(text), `${relative(WEB, path)} points at a .py file`);
  }
});

test("the Pages workflow publishes the web folder", () => {
  const workflow = read(join(ROOT, ".github", "workflows", "pages.yml"));
  assert.ok(workflow.includes("path: web"));
  // the tests must run before the site is published
  assert.ok(workflow.includes("npm test"));
  // and so must the two second-long guards, or a broken edit / stray markdown
  // only shows up after the slow suite has already gone red for other reasons
  assert.ok(workflow.includes("npm run check"), "the workflow skips npm run check");
  assert.ok(workflow.includes("npm run typecheck"), "the workflow skips npm run typecheck");
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
