/**
 * Render the vanilla armor set table as one markdown table.
 *
 * Inputs: `web/data/armor_sets.json` (the set list), `web/data/armor_names.json`
 * (per-slot names), `web/data/armor_sets_extra.json` (the part ids and names
 * the generated tables cannot carry: skirt textures, extension textures and
 * male/female variants) and `web/data/vanilla/index.json` (texture rects).
 * Output: `docs/盔甲套数据.md`.
 *
 * The atlas keeps every texture at 1x, so the reported size is the rect times
 * `index.scale`: that is the pixel size of the PNG in `Content/Images`.
 *
 * Usage: node tools/export_sets_table.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "web", "data");
const OUT = join(ROOT, "docs", "盔甲套数据.md");

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

const sets = read(join(DATA, "armor_sets.json")).sets;
const names = read(join(DATA, "armor_names.json")).slots;
const extra = read(join(DATA, "armor_sets_extra.json"));
const index = read(join(DATA, "vanilla", "index.json"));

const scale = index.scale ?? 1;

/** Same lookup order as `textureCandidates` in `web/js/reverse.js`. */
const CANDIDATES = {
  head: (id) => [`Armor_Head_${id}`],
  body: (id) => [`Armor/Armor_${id}`, `Armor_${id}`],
  legs: (id) => [`Armor_Legs_${id}`],
};

/** Same rewrite as `displayName` in `web/js/data.js`. */
const display = (text) => String(text || "").replaceAll("护甲", "盔甲");

const cell = (text) => String(text).replaceAll("|", "\\|");
const DASH = "—";
const JOIN = "、";

function idsOf(kind, set) {
  const patched = extra.sets[String(set.body)]?.[kind];
  if (patched) return patched;
  const single = set[kind];
  return single === null || single === undefined ? [] : [single];
}

function sizeOf(kind, id) {
  for (const key of CANDIDATES[kind](id)) {
    const rect = index.sheets[key];
    if (rect) return `${rect[3] * scale}×${rect[4] * scale}`;
  }
  return DASH;
}

function nameOf(kind, id) {
  const curated = extra.names[kind]?.[String(id)];
  const entry = curated ?? names[kind]?.[String(id)];
  if (!entry) return "";
  const zh = display(entry.zh);
  const en = entry.name ?? "";
  return [zh, en].filter(Boolean).join(" ");
}

const setName = (set) => [display(extra.sets[String(set.body)]?.zh ?? set.zh), set.name].filter(Boolean).join(" ");

/** `a、b、c` for several ids, `—` for none. */
const list = (values, render) => (values.length ? values.map(render).join(JOIN) : DASH);

function row(set) {
  const heads = idsOf("head", set);
  const bodies = idsOf("body", set);
  const legs = idsOf("legs", set);
  return [
    setName(set),
    list(heads, String),
    list(heads, (id) => nameOf("head", id)),
    list(bodies, String),
    list(bodies, (id) => nameOf("body", id)),
    list(legs, String),
    list(legs, (id) => nameOf("legs", id)),
    list(heads, (id) => sizeOf("head", id)),
    list(bodies, (id) => sizeOf("body", id)),
    list(legs, (id) => sizeOf("legs", id)),
  ].map(cell);
}

const header = [
  "套装名称",
  "头部盔甲ID",
  "头部盔甲名称",
  "身体盔甲ID",
  "身体盔甲名称",
  "腿部盔甲ID",
  "腿部盔甲名称",
  "头部图片尺寸",
  "身体图片尺寸",
  "腿部图片尺寸",
];

/** `0、3–7、9` — the ids with no texture in the bundle. */
function compress(ids) {
  const runs = [];
  for (const id of ids) {
    const last = runs.at(-1);
    if (last && id === last[1] + 1) last[1] = id;
    else runs.push([id, id]);
  }
  return runs.map(([from, to]) => (from === to ? String(from) : `${from}–${to}`)).join(JOIN);
}

/** The atlas key prefix of one slot, e.g. `Armor_Head_`. */
const PREFIX = { head: "Armor_Head_", body: "Armor/Armor_", legs: "Armor_Legs_" };

function gaps(kind) {
  const prefix = PREFIX[kind];
  const have = new Set(
    Object.keys(index.sheets)
      .filter((key) => key.startsWith(prefix))
      .map((key) => Number(key.slice(prefix.length)))
      .filter((id) => Number.isInteger(id)),
  );
  const highest = Math.max(...have);
  return Array.from({ length: highest + 1 }, (_, id) => id).filter((id) => !have.has(id));
}

const emptyRows = [["head", "头部"], ["body", "身体"], ["legs", "腿部"]].map(([kind, label]) => {
  const missing = gaps(kind);
  return `| ${label} | ${missing.length} | ${compress(missing)} |`;
});

const lines = [
  "# 原版盔甲套数据",
  "",
  `共 ${sets.length + (extra.extraSets?.length ?? 0)} 套。`,
  "本表由 `node tools/export_sets_table.mjs` 生成，请勿手改。",
  "数据来源：`web/data/armor_sets.json`、`web/data/armor_names.json`、`web/data/armor_sets_extra.json`、`web/data/vanilla/index.json`。",
  "套装名与部件名按界面写法，与「盔甲模板」页一致。",
  "一个部位有多张贴图时，ID、名称与尺寸三列按同一顺序用 `、` 并列。下摆、延展与男女款式是原版按身体与腿部自动换用的贴图。",
  "尺寸列写原版 PNG 的像素宽×高。图集按 1× 打包，本表已乘回 2×。",
  "`—` 表示该项不存在：该套没有这个部位，或原版没有这张贴图。",
  "",
  "## 盔甲套",
  "",
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...sets.map((set) => `| ${row(set).join(" | ")} |`),
  // pieces that belong to no body, listed as their own set
  ...(extra.extraSets ?? []).map((item) => `| ${row(item).join(" | ")} |`),
  "",
  "## 空 ID",
  "",
  "下表是原版没有贴图的部位 ID。ID 0 有名称，游戏用玩家默认外观代替贴图。",
  "",
  "| 部位 | 张数 | 空 ID |",
  "| --- | --- | --- |",
  ...emptyRows,
  "",
];

writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`wrote ${OUT} (${sets.length} sets)`);
