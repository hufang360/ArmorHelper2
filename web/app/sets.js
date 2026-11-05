/**
 * The armor set list on the reverse tab: search, then fill the three ID fields.
 *
 * A set with a missing part is still listed: it can be restored, only the
 * missing sheet has to come from somewhere else.
 */

import { $ } from "./dom.js";
import { state } from "./state.js";
import { allSets, searchSets, setLabel } from "../js/data.js";

export async function loadSetsIndex(query = "") {
  const found = query ? searchSets(query) : allSets();
  state.sets = found;
  const select = $("#set-select");
  select.innerHTML = "";
  for (const [index, item] of found.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${setLabel(item)}${item.head !== null && item.legs !== null ? "" : "  ⚠"}`;
    select.append(option);
  }
  if (found.length) pickSet(0);
}

export function pickSet(index) {
  const item = state.sets[index];
  if (!item) return;
  $("#rev-head").value = item.head ?? "";
  $("#rev-body").value = item.body ?? "";
  $("#rev-legs").value = item.legs ?? "";
}
