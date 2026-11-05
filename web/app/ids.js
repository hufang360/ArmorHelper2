/**
 * Armor ids: the number in the settings fields and the vanilla name it maps to.
 *
 * The three parts of a set may use different ids, so every lookup takes a part.
 * An empty field falls back to the body id, then to 0 — that is what the file
 * names in a material pack use.  `data/armor_names.json` is optional: without
 * it the ID column simply has no names.
 */

import { $ } from "./dom.js";
import { displayName } from "../js/data.js";

export function asId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

let armorNames = null;

/** Per-slot armor names, for the ID column. A missing file is not an error. */
export async function loadArmorNames() {
  try {
    const response = await fetch("data/armor_names.json");
    if (!response.ok) return null;
    armorNames = (await response.json()).slots ?? null;
  } catch {
    armorNames = null;
  }
  return armorNames;
}

/** `head 11` -> `挖矿头盔`, or an empty string when the table has no entry. */
export function armorName(part, id) {
  const entry = armorNames?.[part]?.[String(id)];
  return entry ? displayName(entry.zh) || entry.name : "";
}

/** The ids used for output names: 0 when the field is empty. */
export function effectiveIds() {
  const body = asId($("#set-body")?.value) ?? 0;
  const head = asId($("#set-head")?.value) ?? body;
  const legs = asId($("#set-legs")?.value) ?? body;
  return { head, body, legs };
}

/** Original file names. They never follow the input file name. */
export function outputNames() {
  const ids = effectiveIds();
  return {
    head: `Armor_Head_${ids.head}.png`,
    legs: `Armor_Legs_${ids.legs}.png`,
    body: `Armor/Armor_${ids.body}.png`,
    bodyLegacy: `Armor_Body_${ids.body}.png`,
    bodyLegacyFemale: `Female_Body_${ids.body}.png`,
    arms: `Armor_Arm_${ids.body}.png`,
  };
}
