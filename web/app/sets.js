/**
 * The armor set list on the reverse tab: search, then fill the three ID fields.
 *
 * A set with a missing part is still listed: it can be restored, only the
 * missing sheet has to come from somewhere else.
 */

import { $ } from "./dom.js";
import { state } from "./state.js";
import { armorName, asId } from "./ids.js";
import { allRecords, displayName, findSet, searchRecords, setIds, setName, setParts, textCells } from "../js/data.js";

/** The set the page opens on: a full set, so the preview is never empty. */
const DEFAULT_SET = "CopperChainmail";

export async function loadSetsIndex(query = "") {
  const found = query ? searchRecords(query) : allRecords();
  state.sets = found;
  const select = $("#set-select");
  select.innerHTML = "";
  // the ids and the warning sit at the right edge: pad the names to one width,
  // then join, and let the monospace font line the columns up
  const rows = found.map((item) => {
    const parts = setParts(item);
    // a record carries one id per slot; the warning stays when a slot has none
    const complete = parts.head.length && parts.legs.length;
    return { name: setName(item), rest: `${setIds(item)}${complete ? "" : "  ⚠"}` };
  });
  const width = Math.max(0, ...rows.map((row) => textCells(row.name)));
  for (const [index, row] of rows.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${row.name}${" ".repeat(width - textCells(row.name) + 2)}${row.rest}`;
    select.append(option);
  }
  // open on a set with a full outfit, not on the bare 便装 it would otherwise land
  const start = Math.max(0, found.findIndex((item) => item.name === DEFAULT_SET));
  if (found.length) pickSet(start);
}

export function pickSet(index) {
  const item = state.sets[index];
  if (!item) return;
  $("#rev-head").value = item.head ?? "";
  $("#rev-body").value = item.body ?? "";
  $("#rev-legs").value = item.legs ?? "";
  renderRevNames();
}

/** The set name over the preview, and each part's name under its own id field. */
export function renderRevNames() {
  const item = findSet(asId($("#rev-body").value));
  const title = $("#rev-set-name");
  if (title) title.textContent = item ? displayName(item.zh) || item.name : "";
  for (const part of ["head", "body", "legs"]) {
    const line = $(`#rev-${part}-name`);
    if (line) line.textContent = armorName(part, asId($(`#rev-${part}`).value));
  }
}
