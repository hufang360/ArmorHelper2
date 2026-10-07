/**
 * Shared data: the layout tables, the vanilla armor set table and the strings.
 *
 * Everything here is generated from the Python package by
 * `tools/export_web.py`, so the two versions cannot drift apart.  The layout is
 * injected rather than fetched so the core modules also run under Node (see
 * `web/tests/run.mjs`).
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

export async function loadSets(url = "data/armor_sets.json") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cannot load ${url}: ${response.status}`);
  const payload = await response.json();
  sets = payload.sets;
  return sets;
}

export function initSets(value) {
  sets = value;
  return sets;
}

/**
 * Terraria's official Simplified Chinese calls exactly one armor piece 护甲
 * (``MeteorSuit`` → 流星护甲) while the rest of the interface says 盔甲.  The
 * data keeps the name as the game ships it; this is applied for display.
 */
export function displayName(name) {
  return String(name || "").replaceAll("护甲", "盔甲");
}

export function setLabel(item) {
  const parts = [displayName(item.zh), item.name].filter(Boolean);
  return `${parts.join("  ")}  (${item.body})`;
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

/* ------------------------------------------------------------------ misc -- */

const UNSAFE = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|", "\r", "\n", "\t"]);

/** Make `name` safe to use as a file name on every platform. */
export function sanitizeFilename(name, fallback = "ArmorTemplate") {
  let out = "";
  for (const char of String(name)) out += UNSAFE.has(char) ? "_" : char;
  out = out.replace(/^[.\s]+|[.\s]+$/g, "");
  return out || fallback;
}
