/**
 * Documentation honesty checks.
 *
 * The crop table in `docs/贴图裁切说明.md` is what people copy coordinates from,
 * so it is parsed back and compared against `web/data/layout.json` — the only
 * place the layout lives now.  The rest keeps the prose consistent (word choice,
 * links, the README language) and the string file free of dead entries.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..", "..");
export const WEB = join(ROOT, "web");

const LAYOUT = JSON.parse(readFileSync(join(WEB, "data", "layout.json"), "utf8"));
const DOC = join(ROOT, "docs", "贴图裁切说明.md");
const REQUIREMENTS = join(ROOT, "docs", "需求文档.md");
const WEB_REQUIREMENTS = join(ROOT, "docs", "Web版需求文档.md");
const README = join(ROOT, "README.md");
const DOCS_INDEX = join(ROOT, "docs", "README.md");
const WEB_README = join(WEB, "README.md");
const AGENTS = join(ROOT, "AGENTS.md");

const read = (path) => readFileSync(path, "utf8");
const CELL_W = LAYOUT.frame.w * 2; // 40
const CELL_H = LAYOUT.frame.h * 2; // 56

const ROW_RE =
  /^\| `(\d+),(\d+)` \| `(\d+),(\d+)` \| `(\d+),(\d+)` \| (.+?) \| (.+?) \| (.+?) \| (\d+) \|$/;

const rows = () =>
  read(DOC)
    .split("\n")
    .map((line) => ROW_RE.exec(line))
    .filter(Boolean);

const asCells = (table) => new Map(Object.entries(table).map(([key, cell]) => [Number(key), cell]));

test("the crop table is linked from the other docs", () => {
  assert.ok(read(DOCS_INDEX).includes("贴图裁切说明.md"));
  assert.ok(read(REQUIREMENTS).includes("贴图裁切说明.md"));
});

test("the crop table covers the whole 9x4 grid", () => {
  const matched = rows();
  assert.equal(matched.length, LAYOUT.bodyComposite.cols * LAYOUT.bodyComposite.rows);
  assert.equal(matched.length, 36);

  const seen = new Set();
  for (const match of matched) {
    const [col, row, left, upper, right, lower] = match.slice(1, 7).map(Number);
    const key = `${col},${row}`;
    assert.ok(!seen.has(key), `(${key}) listed twice`);
    seen.add(key);
    assert.deepEqual([left, upper], [col * CELL_W, row * CELL_H], `(${key}) left/upper`);
    assert.deepEqual([right, lower], [col * CELL_W + CELL_W, row * CELL_H + CELL_H], `(${key}) right/lower`);
  }
});

test("the crop table agrees with the layout tables", () => {
  const documented = new Map(rows().map((match) => [`${match[1]},${match[2]}`, match[7]]));
  assert.equal(documented.size, 36);

  for (const [frame, cell] of asCells(LAYOUT.cells.frontArm)) {
    assert.ok(documented.has(cell.join(",")), `front arm cell ${cell} missing from the doc`);
    assert.ok(documented.get(cell.join(",")).includes("前臂"), `cell ${cell} should be a front arm`);
  }
  for (const [frame, cell] of asCells(LAYOUT.cells.backArm)) {
    if (frame === 3 || frame === 4 || frame === 5) continue; // the game never draws those
    assert.ok(documented.get(cell.join(","))?.includes("后臂"), `cell ${cell} should be a back arm`);
  }

  const expected = [
    [LAYOUT.cells.torso, "男性躯干"],
    [LAYOUT.cells.torsoJump, "男性躯干"],
    [[0, 2], "女性躯干"],
    [[1, 2], "女性躯干"],
    [LAYOUT.cells.frontShoulder, "男性前肩"],
    [LAYOUT.cells.backShoulder, "男性后肩"],
    [[0, 3], "女性前肩"],
    [[1, 3], "女性后肩"],
    [[LAYOUT.cells.compositeFrontArmCol, 0], "前臂"],
    [[LAYOUT.cells.compositeBackArmCol, 0], "后臂"],
  ];
  for (const [cell, label] of expected) {
    const text = documented.get(cell.join(","));
    assert.ok(text?.includes(label), `cell ${cell}: ${JSON.stringify(text)} lacks ${label}`);
  }
});

test("the crop doc points at the reverse feature and the inspector", () => {
  const text = read(DOC);
  assert.ok(text.includes("反向还原") || text.includes("reverse"));
  assert.ok(text.includes("tools/inspect_armor.mjs"));
});

test("every translation is used", () => {
  const messages = JSON.parse(readFileSync(join(WEB, "data", "i18n.json"), "utf8")).messages;
  const js = [...walk(WEB, [".js"])].map((path) => read(path)).join("");
  const html = [...walk(WEB, [".html"])].map((path) => read(path)).join("");

  const used = new Set();
  for (const match of js.matchAll(/(?<![\w.$])t\(\s*["']([\w.]+)["']/g)) used.add(match[1]);
  for (const match of js.matchAll(/"((?:web|target|role|details|group|status|reverse)\.[\w.]+)"/g)) {
    used.add(match[1]);
  }
  for (const match of html.matchAll(/data-i18n(?:-placeholder)?="([\w.]+)"/g)) used.add(match[1]);
  for (const name of LAYOUT.targets.all) used.add(`target.${name}`); // t(`target.${name}`)
  for (const role of ["head", "body", "legs"]) {
    used.add(`role.${role}`);
    used.add(`web.slot.${role}`);
  }

  const dead = Object.keys(messages.zh_CN).filter((key) => !used.has(key));
  assert.deepEqual(dead, [], `unused translations: ${dead}`);
  assert.deepEqual(Object.keys(messages.zh_CN).sort(), Object.keys(messages.en).sort());
});

test("the UI and the docs say 盔甲, not the other spelling", () => {
  const banned = "护" + "甲"; // split so this file does not match itself
  for (const path of [README, DOC, REQUIREMENTS, WEB_REQUIREMENTS, WEB_README, AGENTS]) {
    assert.ok(!read(path).includes(banned), relative(ROOT, path));
  }
});

test("every markdown link resolves", () => {
  for (const path of walk(ROOT, [".md"])) {
    if (path.includes(".git/") || path.includes("node_modules")) continue;
    const text = read(path);
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|#|mailto:)/.test(target)) continue;
      const resolved = resolve(path, "..", target);
      assert.ok(exists(resolved), `${relative(ROOT, path)} -> ${target}`);
    }
  }
});

test("the README keeps its shape", () => {
  const text = read(README);
  const han = [...text].filter((char) => char >= "\u4e00" && char <= "\u9fff").length;
  assert.ok(han > 300, `README looks untranslated (${han} Chinese characters)`);
  assert.ok(text.includes("hufang360.github.io/ArmorHelper2"), "missing the site link");

  // 只允许固定章节，且顺序不变
  const lines = text.split("\n");
  const allowed = ["## ArmorHelper 原版", "## 快速开始", "## 部署", "## 致谢", "## 许可"];
  const headings = lines.filter((line) => line.startsWith("## "));
  assert.deepEqual(headings, allowed.filter((heading) => headings.includes(heading)));

  // 代码块必须有语言（ASCII 图用 text）；标题级只在围栏外数
  let fenced = false;
  const outside = [];
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (!fenced) assert.match(line, /^```\w+/);
      fenced = !fenced;
      continue;
    }
    if (!fenced) outside.push(line);
  }
  assert.ok(!fenced, "unclosed code fence");
  assert.equal(outside.filter((line) => line.startsWith("# ")).length, 1);

  // 酸制格式：行尾、空行、卤符、列表符号
  assert.ok(!/[ \t]+$/m.test(text), "trailing whitespace");
  assert.ok(!/\n{3,}/.test(text), "consecutive blank lines");
  assert.ok(!text.includes("\t"), "tab character");
  assert.ok(!/^[-+] /m.test(text), "unordered list should use *");

  // 不用裸 URL
  const prose = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/<https?:\/\/[^>]*>/g, "")
    .replace(/\]\([^)]*\)/g, "]");
  assert.ok(!/https?:\/\//.test(prose), "bare URL in prose");
});

test("the docs index lists every document", () => {
  const index = read(DOCS_INDEX);
  for (const name of readdirSync(join(ROOT, "docs"))) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    assert.ok(index.includes(`(${name})`), `docs/README.md does not list ${name}`);
  }
});

test("nothing points at the old reference folder name", () => {
  const old = "ArmorHelper" + "_v1/";
  for (const path of walk(ROOT, [".md", ".js", ".mjs", ".json", ".html", ".yml", ".toml"])) {
    if (path.includes(".git/") || path.includes("web/data/vanilla")) continue;
    assert.ok(!read(path).includes(old), `${relative(ROOT, path)} still points at ${old}`);
  }
});

test("the web requirements are linked and complete", () => {
  const text = read(WEB_REQUIREMENTS);
  assert.ok(read(REQUIREMENTS).includes("Web版需求文档.md"));
  assert.ok(read(DOCS_INDEX).includes("Web版需求文档.md"));
  // every requirement family has an id and a row in the acceptance table
  for (const prefix of ["WG-", "WFR-", "WUI-", "WNFR-", "WC-", "WL-"]) {
    assert.ok(text.includes(prefix), prefix);
  }
  // pure static, deployed to Pages, no server API
  assert.ok(text.includes("GitHub Pages"));
  assert.ok(text.includes("pages.yml") || text.includes("GitHub Actions"));
  assert.ok(text.includes("npm start") || text.includes("http.server"));
  assert.ok(text.includes("File System Access"));
  assert.ok(!text.includes("/api/"));
  assert.ok(!text.includes("armorhelper web"));
});

/** Every file under `root` with one of `extensions`. */
function* walk(root, extensions) {
  for (const name of readdirSync(root)) {
    if (name === ".git" || name === "node_modules" || name === ".venv" || name === "__pycache__") continue;
    const path = join(root, name);
    const stats = statSync(path);
    if (stats.isDirectory()) yield* walk(path, extensions);
    else if (extensions.includes(path.slice(path.lastIndexOf(".")))) yield path;
  }
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
