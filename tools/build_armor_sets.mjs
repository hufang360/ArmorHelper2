#!/usr/bin/env node
/**
 * Generate `web/data/armor_sets.json` from a Terraria source tree.
 *
 * The head / body / legs armor ids of one set are not stored as data in the
 * game, so they are derived from two sources:
 *
 * 1. `Terraria.DataStructures/ArmorSetBonuses.cs` — sets that grant a bonus are
 *    listed by *item* id.  Those are authoritative.
 * 2. Constant **names** in `Terraria.ID/ArmorIDs.cs`.  Vanilla names follow a
 *    strict `<Set>Helmet / <Set>Breastplate / <Set>Greaves` convention, so the
 *    set name is recovered by stripping the slot suffix.
 *
 * Usage:
 *
 *     node tools/build_armor_sets.mjs /path/to/tr-code-1458
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = resolve(here, "..", "web", "data", "armor_sets.json");
const DEFAULT_NAMES_OUTPUT = resolve(here, "..", "web", "data", "armor_names.json");

const HEAD_SUFFIXES = [
  "Headgear", "Headphones", "Earmuffs", "Bandana", "Goggles", "Helmet", "Crown",
  "Horns", "Tiara", "Beard", "Visor", "Mask", "Hood", "Helm", "Wig", "Hat",
  "Cap", "Bow", "Veil", "Head", "Band", "Face",
];
const BODY_SUFFIXES = [
  "Breastplate", "Chestplate", "Chainmail", "Scalemail", "Sweater", "Jacket",
  "Clothier", "Trousers", "Tunic", "Shirt", "Robe", "Dress", "Armor", "Coat",
  "Vest", "Mail", "Suit", "Plate", "Body", "Wrap", "Cloak", "Cape", "Blouse", "Gi",
];
const LEG_SUFFIXES = [
  "Pantaloons", "Leggings", "Trousers", "Greaves", "Shorts", "Skirt", "Boots",
  "Pants", "Legs", "Heels", "Tail",
];

/** Read a source file with the newlines normalised (the C# tree is CRLF). */
const read = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");

/** The three armor slot tables from `ArmorIDs.cs`. */
export function parseArmorIds(source) {
  const text = read(join(source, "Terraria.ID", "ArmorIDs.cs"));
  const result = {};
  for (const [cls, next, key] of [
    ["Head", "Body", "head"],
    ["Body", "Legs", "body"],
    ["Legs", "HandOn", "legs"],
  ]) {
    const start = text.indexOf(`public class ${cls}\n`);
    const stop = text.indexOf(`public class ${next}\n`, start);
    const segment = text.slice(start, stop);
    result[key] = {};
    for (const match of segment.matchAll(/public const int (\w+) = (\d+);/g)) {
      result[key][match[1]] = Number(match[2]);
    }
  }
  return result;
}

/** `ItemID` constant name -> item id. */
export function parseItemIds(source) {
  const text = read(join(source, "Terraria.ID", "ItemID.cs"));
  const result = new Map();
  for (const match of text.matchAll(/public const short (\w+) = (\d+);/g)) {
    result.set(Number(match[2]), match[1]);
  }
  return result;
}

/**
 * `itemID -> { headSlot, bodySlot, legSlot }` from `Item.cs`.
 *
 * Defaults are split over `SetDefaults1..5` in 1.4.4+, so all of them are
 * scanned; the slot assignments sit at the top of each `case` block.
 */
export function parseItemSlots(source) {
  const text = read(join(source, "Terraria", "Item.cs"));
  const bounds = [
    ...[...text.matchAll(/\n\t(?:public|private|internal|protected) void (SetDefaults\w*)\(int [a-zA-Z]+\)/g)]
      .map((match) => match.index),
    text.length,
  ];

  const slots = new Map();
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const segment = text.slice(bounds[index], bounds[index + 1]);
    const labels = [...segment.matchAll(/\n\t+case (\d+):/g)].map((match) => [match.index, Number(match[1])]);
    labels.forEach(([start, itemId], position) => {
      const stop = position + 1 < labels.length ? labels[position + 1][0] : segment.length;
      const chunk = segment.slice(start, stop);
      const found = {};
      for (const key of ["headSlot", "bodySlot", "legSlot"]) {
        const match = new RegExp(`\\b${key} = (\\d+);`).exec(chunk);
        if (match) found[key] = Number(match[1]);
      }
      if (Object.keys(found).length) {
        slots.set(itemId, { ...(slots.get(itemId) ?? {}), ...found });
      }
    });
  }
  return slots;
}

/** `ItemID` constant name -> translated item name (zh-Hans by default). */
export function parseLocalization(path) {
  let data;
  try {
    data = JSON.parse(read(path));
  } catch {
    return {};
  }
  const names = data?.ItemName;
  return names && typeof names === "object" ? names : {};
}

/** The authoritative `Add(Benefits.…, "name", id, id, id)` groups. */
export function parseSetBonuses(source) {
  const text = read(join(source, "Terraria.DataStructures", "ArmorSetBonuses.cs"));
  const groups = [];
  for (const match of text.matchAll(/Add\(\s*Benefits\.\w+,\s*"[^"]+",\s*([\d,\s]+)\)/g)) {
    const ids = match[1].replaceAll(" ", "").split(",").filter(Boolean).map(Number);
    if (ids.length) groups.push(ids);
  }
  return groups;
}

function stripSuffix(name, suffixes) {
  for (const suffix of suffixes) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, -suffix.length);
    }
  }
  return name;
}

function commonPrefix(a, b) {
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) break;
    count += 1;
  }
  return count;
}

/** Best effort: exact stem first, then the longest shared name prefix. */
function guessSlot(bodyName, table, suffixes) {
  const stem = stripSuffix(bodyName, BODY_SUFFIXES);
  const exact = [...table.keys()].filter((name) => stripSuffix(name, suffixes) === stem);
  if (exact.length) {
    exact.sort((a, b) => a.length - b.length);
    return [table.get(exact[0]), exact[0], "name"];
  }
  let best = null;
  for (const [name, value] of table) {
    const length = commonPrefix(bodyName, name);
    if (length < 4) continue;
    if (bodyName.length > length && !isUpper(bodyName[length])) continue;
    const score = [length, -name.length];
    if (best === null || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
      best = { score, value, name };
    }
  }
  if (best) return [best.value, best.name, "prefix"];
  return [null, null, null];
}

/** Python's `str.isupper()` for a single ASCII character. */
const isUpper = (character) => character.toUpperCase() === character && character.toLowerCase() !== character;

export function build(source, { localization = null } = {}) {
  const armor = parseArmorIds(source);
  const itemNames = parseItemIds(source);
  const toMap = (table) => new Map(Object.entries(table));
  const heads = toMap(armor.head);
  const bodies = toMap(armor.body);
  const legTable = toMap(armor.legs);
  const bodyNames = new Map([...bodies].map(([name, value]) => [value, name]));

  const translated = parseLocalization(
    localization ?? join(source, "Terraria.Localization.Content.zh-Hans.Items.json"),
  );
  const itemToBody = new Map();
  for (const [itemId, entry] of parseItemSlots(source)) {
    if (entry.bodySlot !== undefined) itemToBody.set(entry.bodySlot, itemId);
  }

  const localized = (bodyId) => {
    const itemId = itemToBody.get(bodyId);
    let name = itemId !== undefined ? itemNames.get(itemId) : undefined;
    if (name === undefined) name = bodyNames.get(bodyId);
    return name ? (translated[name] ?? "") : "";
  };

  const byName = new Map();
  for (const [key, table] of [["head", heads], ["body", bodies], ["legs", legTable]]) {
    for (const [name, value] of table) {
      const entry = byName.get(name) ?? {};
      entry[key] = value;
      byName.set(name, entry);
    }
  }

  // --- 1. authoritative set-bonus groups ---------------------------------
  const sets = new Map();
  for (const group of parseSetBonuses(source)) {
    const triple = {};
    for (const itemId of group) {
      const name = itemNames.get(itemId);
      if (!name) continue;
      const entry = byName.get(name);
      if (entry) Object.assign(triple, entry);
    }
    const bodyId = triple.body;
    if (bodyId === undefined) continue;
    sets.set(bodyId, {
      body: bodyId,
      head: triple.head ?? null,
      legs: triple.legs ?? null,
      name: bodyNames.get(bodyId) ?? String(bodyId),
      zh: localized(bodyId),
      confidence: "set-bonus",
    });
  }

  // --- 2. name based matching for everything else ------------------------
  for (const [bodyName, bodyId] of bodies) {
    if (sets.has(bodyId)) continue;
    const [headId, , headHow] = guessSlot(bodyName, heads, HEAD_SUFFIXES);
    let [legId, legName, legHow] = guessSlot(bodyName, legTable, LEG_SUFFIXES);
    if (legName === bodyName) {
      // A dress-style body can be its own "legs" texture; that is not a useful
      // guess for the template, which has separate regions.
      legId = null;
      legHow = null;
    }
    let confidence = (headHow ?? legHow) === "name" ? "name" : "prefix";
    if (headId === null && legId === null) confidence = "none";
    sets.set(bodyId, {
      body: bodyId,
      head: headId,
      legs: legId,
      name: bodyName,
      zh: localized(bodyId),
      confidence,
    });
  }

  const ordered = [...sets.keys()].sort((a, b) => a - b).map((key) => sets.get(key));
  return {
    source: "Terraria (rowid 1.4.5.x) — derived from ArmorIDs.cs + ArmorSetBonuses.cs",
    generated: localDate(),
    count: ordered.length,
    sets: ordered,
  };
}

/**
 * `slot id -> { name, zh }` for the head, body and legs armor slots.
 *
 * The set table only carries the body item name, so per-slot names come from
 * the items themselves: `Item.cs` maps item id -> slot id, `ItemID.cs` gives the
 * constant name, and the localization file gives the translated one. When
 * several items share a slot, the lowest item id wins, so the result is stable.
 */
export function slotNames(source, itemNames, translated) {
  const chosen = { head: new Map(), body: new Map(), legs: new Map() };
  const fields = [["head", "headSlot"], ["body", "bodySlot"], ["legs", "legSlot"]];
  for (const [itemId, entry] of parseItemSlots(source)) {
    const constant = itemNames.get(itemId);
    for (const [key, field] of fields) {
      const slot = entry[field];
      if (slot === undefined) continue;
      const current = chosen[key].get(slot);
      if (current !== undefined && current.item < itemId) continue;
      chosen[key].set(slot, { item: itemId, constant });
    }
  }

  const result = { head: {}, body: {}, legs: {} };
  for (const [key, table] of Object.entries(chosen)) {
    for (const slot of [...table.keys()].sort((a, b) => a - b)) {
      const { constant } = table.get(slot);
      const name = constant ?? "";
      result[key][slot] = { name, zh: translated[name] ?? "" };
    }
  }
  return result;
}

/** The per-slot name table, written next to the set table. */
export function buildNames(source, { localization = null } = {}) {
  const itemNames = parseItemIds(source);
  const translated = parseLocalization(
    localization ?? join(source, "Terraria.Localization.Content.zh-Hans.Items.json"),
  );
  return {
    source: "Terraria (rowid 1.4.5.x) — Item.cs slots + ItemID.cs names",
    generated: localDate(),
    slots: slotNames(source, itemNames, translated),
  };
}

/** `date.today()` in local time, as `YYYY-MM-DD`. */
function localDate() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseArgs(argv) {
  const args = { source: null, localization: null, output: DEFAULT_OUTPUT, names: DEFAULT_NAMES_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      console.log(
      "usage: node tools/build_armor_sets.mjs <source-tree> [-o OUTPUT] [--names OUTPUT] [--localization FILE]",
    );
      process.exit(0);
    }
    if (arg === "-o" || arg === "--output") args.output = resolve(argv[++index]);
    else if (arg === "--names") args.names = resolve(argv[++index]);
    else if (arg === "--localization") args.localization = resolve(argv[++index]);
    else if (!args.source) args.source = resolve(arg);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if (!args.source) throw new Error("missing <source-tree>");
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const data = build(args.source, { localization: args.localization });
  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, `${JSON.stringify(data, null, 1)}\n`, "utf8");

  const names = buildNames(args.source, { localization: args.localization });
  writeFileSync(args.names, `${JSON.stringify(names, null, 1)}\n`, "utf8");

  const complete = data.sets.filter((set) => set.head !== null && set.legs !== null).length;
  const translated = data.sets.filter((set) => set.zh).length;
  const confidence = {};
  for (const set of data.sets) confidence[set.confidence] = (confidence[set.confidence] ?? 0) + 1;
  console.log(`wrote ${args.output}`);
  const slots = names.slots;
  console.log(`  names: ${Object.keys(slots.head).length} head, ${Object.keys(slots.body).length} body, ${Object.keys(slots.legs).length} legs -> ${args.names}`);
  console.log(`  ${data.count} body armors, ${complete} with both a head and a legs guess`);
  console.log(`  ${translated} with a localized name`);
  console.log(`  confidence: ${JSON.stringify(confidence)}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
