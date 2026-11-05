/**
 * Shared data: the layout tables, the vanilla armor set table and the strings.
 *
 * The layout, the set table and the strings live in `web/data/*.json` and are
 * the only source.  The layout is injected rather than fetched so the core
 * modules also run under Node (see `web/tests/run.mjs`).
 */

let layout = null;

export function initLayout(value) {
  layout = value;
  return layout;
}

export function L() {
  if (!layout) throw new Error("layout data has not been loaded yet");
  return layout;
}

export async function loadLayout(url = "data/layout.json") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cannot load ${url}: ${response.status}`);
  return initLayout(await response.json());
}

/* ------------------------------------------------------------------ sets -- */

let sets = null;
let parts = {};
let extraNames = { head: {}, body: {}, legs: {} };
let extraSets = [];
let records = null;

export async function loadSets(url = "data/armor_sets.json", partsUrl = url.replace(/[^/]*$/, "armor_sets_extra.json")) {
  const [response, extra] = await Promise.all([fetch(url), fetch(partsUrl)]);
  if (!response.ok) throw new Error(`cannot load ${url}: ${response.status}`);
  if (!extra.ok) throw new Error(`cannot load ${partsUrl}: ${extra.status}`);
  const payload = await extra.json();
  sets = (await response.json()).sets;
  parts = payload.sets;
  extraNames = payload.names ?? extraNames;
  extraSets = payload.extraSets ?? extraSets;
  records = expand(sets, parts, extraSets);
  return sets;
}

/**
 * Every texture id of one set, primary id first.
 *
 * A set can own more than one sheet per slot: a robe has a skirt in the legs
 * table, a huntress jerkin has a male and a female variant plus an extension.
 * `armor_sets.json` carries only the primary id, so the rest comes from
 * `armor_sets_extra.json`.
 */
export function setParts(item) {
  const extra = parts[String(item.body)] ?? {};
  const one = (value) => (value === null || value === undefined ? [] : [value]);
  return {
    head: extra.head ?? one(item.head),
    body: one(item.body),
    legs: extra.legs ?? one(item.legs),
  };
}

export function initSets(value, extra = {}) {
  sets = value;
  parts = extra;
  records = expand(sets, parts, extraSets);
  return sets;
}


/** A curated name for a part id the generated table does not cover. */
export function extraPartName(part, id) {
  const entry = extraNames?.[part]?.[String(id)];
  return entry ? displayName(entry.zh) || entry.name || "" : "";
}

/** The ids the game swaps in for this body: skirt, extension, other sex. */
export function partIds(item) {
  return parts[String(item?.body)] ?? {};
}

/**
 * One record per part combination.
 *
 * A set can own several sheets per slot (male and female legs, a skirt next to
 * its pants).  The picker lists every combination as its own set, so choosing a
 * record reverses exactly one picture.
 */
function expand(list, patch, extras = []) {
  const out = [];
  for (const item of list) {
    const extra = patch[String(item.body)] ?? {};
    const heads = extra.head ?? (item.head === null ? [null] : [item.head]);
    const legs = extra.legs ?? (item.legs === null ? [null] : [item.legs]);
    for (const head of heads.length ? heads : [null]) {
      for (const leg of legs.length ? legs : [null]) out.push({ ...item, head, legs: leg });
    }
  }
  // pieces that belong to no body: a hat, say. They are listed on their own.
  for (const item of extras) out.push({ confidence: "none", ...item });
  return out;
}

/**
 * Terraria's official Simplified Chinese calls exactly one armor piece 护甲
 * (``MeteorSuit`` → 流星护甲) while the rest of the interface says 盔甲.  The
 * data keeps the name as the game ships it; this is applied for display.
 */
export function displayName(name) {
  return String(name || "").replaceAll("护甲", "盔甲");
}

/** The translated name and the English one, side by side. */
export function setName(item) {
  return [displayName(item.zh), item.name].filter(Boolean).join(" ");
}

/** `(26,4,4)`: the three ids of this record. */
export function setIds(item) {
  return `(${item.head ?? "-"},${item.body ?? "-"},${item.legs ?? "-"})`;
}

export function setLabel(item) {
  return `${setName(item)}${setIds(item)}`;
}

/** Columns a string takes in a monospace line; a CJK glyph is two. */
export function textCells(text) {
  let cells = 0;
  for (const character of String(text)) cells += character.codePointAt(0) > 0x2e7f ? 2 : 1;
  return cells;
}

export function matchesSet(item, needle) {
  const query = String(needle || "").trim().toLowerCase().replaceAll(" ", "");
  if (!query) return true;
  if (item.name.toLowerCase().includes(query)) return true;
  if (String(item.zh || "").toLowerCase().includes(query)) return true;
  if (displayName(item.zh).toLowerCase().includes(query)) return true;
  if (/^-?\d+$/.test(query)) {
    const wanted = Number(query);
    return wanted === item.body || wanted === item.head || wanted === item.legs;
  }
  return false;
}

export function searchSets(query) {
  return (sets || []).filter((item) => matchesSet(item, query));
}

export function findSet(body) {
  const rank = { "set-bonus": 0, name: 1, prefix: 2, none: 3 };
  const found = (sets || []).filter((item) => item.body === body);
  found.sort((a, b) => (rank[a.confidence] ?? 9) - (rank[b.confidence] ?? 9) || a.body - b.body);
  return found[0] ?? null;
}

export function allSets() {
  return sets || [];
}

/** The picker list: one entry per part combination. */
export function allRecords() {
  return records || [];
}

export function searchRecords(query) {
  return (records || []).filter((item) => matchesSet(item, query));
}

/* ------------------------------------------------------------------ misc -- */

const UNSAFE = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|", "\r", "\n", "\t"]);

/** Make `name` safe to use as a file name on every platform. */
export function sanitizeFilename(name, fallback = "ArmorTemplate") {
  let out = "";
  for (const char of String(name)) out += UNSAFE.has(char) ? "_" : char;
  out = out.replace(/^[.\s]+|[.\s]+$/g, "");
  return out || fallback;
}
