/**
 * The reverse tab: vanilla sheets back to a 128x80 drawing template.
 *
 * One set at a time, or every complete set in one go with a progress bar and a
 * cancel button.  "Restore all" skips a set whose body sheet is missing instead
 * of failing the whole run.
 */

import { $, on, say } from "./dom.js";
import { t, warnText } from "./i18n.js";
import { REVERSE_SUBDIR, textureReader } from "./textures.js";
import { saveConfig, state } from "./state.js";
import { armorName, asId } from "./ids.js";
import { loadSetsIndex, pickSet, renderRevNames } from "./sets.js";
import { addHistory } from "./history.js";
import { keepUrl, rebakeTemplate, refreshGif, showResult, withGuide } from "./result.js";
import { packResult } from "./pack.js";
import { endJob, jobCancelled, jobProgress, nextFrame, startJob } from "./jobs.js";
import { allSets, displayName, findSet, partIds, sanitizeFilename, setParts } from "../js/data.js";
import { downloadBlob } from "../js/fs.js";
import { fullArmorFrames } from "../js/compose.js";
import { loadTextures, reverseTemplate } from "../js/reverse.js";
import { pngBlob } from "../js/png.js";
import { zipBlobAsync } from "../js/zip.js";

/* -------------------------------------------------------------- reverse -- */





/** Bumped by every rebuild so a slower, older run cannot overwrite a newer one. */
let reverseRun = 0;

/** The last set applied from the list, to fold one click's `change` and `click` into one run. */
let lastApplied = { key: "", at: 0 };

export async function doReverse() {
  const run = (reverseRun += 1);
  const body = asId($("#rev-body").value);
  if (body === null) {
    say(t("reverse.badBody"), "warn");
    return;
  }
  if (!state.folders.images && !state.textures.size && !state.builtin) {
    say(t("web.needTextures"), "warn");
    return;
  }

  say(t("web.working"), "busy");
  try {
    const item = findSet(body);
    // the typed ids win; an empty field falls back to what the set table knows
    const parts = item ? setParts(item) : { head: [], body: [body], legs: [] };
    // a typed id is tried first, then the rest of that slot's sheets
    const wanted = (value, list) => {
      const typed = asId(value);
      return typed === null ? list : [typed, ...list.filter((id) => id !== typed)];
    };
    const slots = {
      body: [body],
      head: wanted($("#rev-head").value, parts.head),
      legs: wanted($("#rev-legs").value, parts.legs),
    };
    // one sheet per slot: a slot with several ids uses the first one that exists,
    // the sheets are never mixed
    const { textures, missing } = await loadTextures(slots, textureReader());
    if (run !== reverseRun) return;

    const label = sanitizeFilename((item && (displayName(item.zh) || item.name)) || `Armor${body}`);
    // a set with several sheets per slot needs the variant in the file name:
    // ArmorTemplate_雨衣_52_女性延展.png
    const variant = (part, id) => {
      const list = item ? (partIds(item)[part] ?? []) : [];
      if (list.length < 2 || id === list[0] || id === null) return "";
      const name = armorName(part, id);
      return /（(.+)）/.exec(name)?.[1] ?? name;
    };
    const variantName = [
      variant("head", asId($("#rev-head").value)),
      variant("legs", asId($("#rev-legs").value)),
    ]
      .filter(Boolean)
      .join("_");
    const base = `ArmorTemplate_${label}_${body}${variantName ? `_${sanitizeFilename(variantName)}` : ""}`;
    let { template, warnings } = reverseTemplate(textures);
    // one message per slot, so the cause stays readable: an id was asked for and
    // the sheet is missing, or there was no id at all and the region stays empty
    const emptyKey = { head: "reverse.warnNoHead", body: "reverse.warnNoBody", legs: "reverse.warnNoLegs" };
    for (const [part, key] of Object.entries(emptyKey)) {
      if (slots[part]?.length) warnings = warnings.filter((warning) => warning.key !== key);
    }
    for (const kind of missing) {
      if (slots[kind]?.length) warnings.push({ key: "reverse.warnMissing", vars: { role: kind } });
    }

    const frames = fullArmorFrames(template, false);
    const outputs = [{ name: `${base}.png`, bitmap: template, caption: "" }];
    const result = await packResult(base, outputs, frames, [...new Set(warnings.map(warnText))]);

    showResult("reverse", result);
    say(t("reverse.done", { path: result.files[0].name }));
  } catch (error) {
    console.error(error);
    say(String(error.message || error), "bad");
  }
}

export async function doReverseAll() {
  if (!state.folders.images && !state.textures.size && !state.builtin) {
    say(t("web.needTextures"), "warn");
    return;
  }
  // The folder is only asked for when the results are actually written, so the
  // batch does not open a picker before it produces anything.
  $("#do-reverse-all").disabled = true;
  say(t("web.working"), "busy");

  try {
    const entries = [];
    let failed = 0;
    const jobs = allSets().filter((item) => {
      const parts = setParts(item);
      return parts.head.length && parts.legs.length && parts.body.length;
    });
    const read = textureReader();
    startJob(jobs.length);
    for (const [step, item] of jobs.entries()) {
      if (jobCancelled()) break;
      jobProgress(step, displayName(item.zh) || item.name);
      await nextFrame();
      const { textures } = await loadTextures(setParts(item), read);
      if (!textures.body) continue;
      try {
        const { template } = reverseTemplate(textures);
        const label = sanitizeFilename(displayName(item.zh) || item.name);
        // the raw template is kept: the zip bakes the guide at click time
        entries.push({
          name: `${REVERSE_SUBDIR}/ArmorTemplate_${label}_${item.body}.png`,
          bitmap: template,
        });
      } catch (error) {
        console.error(item.name, error);
        failed += 1;
      }
    }
    const job = endJob();

    if (!entries.length) {
      say(job?.cancelled ? t("web.cancelled", { done: job.done, total: job.total }) : t("reverse.allNone", { dir: "" }), "warn");
      return;
    }

    const guide = state.config.revGuide !== false;
    const blobs = [];
    for (const entry of entries) {
      blobs.push({ name: entry.name, blob: await pngBlob(withGuide(entry.bitmap, guide)) });
    }

    const result = {
      bare: true,
      titleKey: "web.rebuilt",
      titleVars: { count: entries.length },
      files: entries.slice(0, 400).map((entry, index) => ({
        name: entry.name,
        width: entry.bitmap.width,
        height: entry.bitmap.height,
        size: blobs[index].blob.size,
        url: URL.createObjectURL(blobs[index].blob),
      })),
      warnings: failed ? [t("reverse.allFailed", { count: failed })] : [],
      // a batch is the only case with a zip; it bakes the guide when clicked
      zip: {
        save: async () => {
          const latest = [];
          for (const entry of entries) {
            latest.push({
              name: entry.name,
              blob: await pngBlob(withGuide(entry.bitmap, state.config.revGuide !== false)),
            });
          }
          downloadBlob(await zipBlobAsync(latest), "ArmorTemplate.zip");
        },
      },
    };

    showResult("reverse", result);
    addHistory(`${t("reverse.allTitle")} ×${entries.length}`, entries, keepUrl(entries[0].bitmap));
    if (job?.cancelled) say(t("web.cancelled", { done: job.done, total: job.total }), "warn");
    else say(t("reverse.allDone", { count: entries.length, dir: REVERSE_SUBDIR }));
  } catch (error) {
    endJob();
    console.error(error);
    say(String(error.message || error), "bad");
  } finally {
    endJob();
    $("#do-reverse-all").disabled = false;
  }
}

/**
 * Show a picture as soon as the page opens.
 *
 * `app.js` calls this once the atlas and the set list are in place, so the page
 * never shows an empty preview next to a filled id row.
 */
export async function reverseOnBoot() {
  if (asId($("#rev-body").value) === null) return;
  if (!state.builtin && !state.folders.images && !state.textures.size) return;
  await doReverse();
}

/** Bind the controls this module owns. */
export function bindReverse() {
on("#rev-guide", "change", async (event) => {
  state.config.revGuide = event.target.checked;
  saveConfig();
  // the preview is redrawn from the raw template, and the download has to be
  // re-encoded: both are rebuilt from what the panel already holds
  const shown = state.results.reverse;
  if (!shown) return;
  await Promise.all(shown.map((result) => rebakeTemplate(result)));
  showResult("reverse", shown);
});
let timer = null;
on("#set-search", "input", (event) => {
  clearTimeout(timer);
  const value = event.target.value;
  timer = setTimeout(() => loadSetsIndex(value), 140);
});
on("#set-select", "change", (event) => applySet(event.target));
on("#set-select", "click", (event) => applySet(event.target));
// typing an id is enough: the three fields rebuild the set on change
for (const field of ["#rev-head", "#rev-body", "#rev-legs"]) {
  on(field, "change", () => {
    renderRevNames();
    doReverse();
  });
}
on("#rev-gif-speed", "change", (event) => {
  state.config.revGifSpeed = event.target.value;
  saveConfig();
  // the speed only changes the preview animation, not the template
  const shown = state.results.reverse;
  if (!shown) return;
  for (const result of shown) refreshGif(result);
  showResult("reverse", shown);
});
on("#do-reverse-all", "click", doReverseAll);
}

/**
 * Pick a set from the list and rebuild it at once.
 *
 * One click on an option fires `change` and `click`, and clicking the option
 * that is already selected fires only `click`: the repeat guard folds the first
 * case into one run and keeps the second case working.
 */
function applySet(select) {
  const index = Number(select.value);
  if (!state.sets[index]) return;
  pickSet(index);
  const now = Date.now();
  if (lastApplied.key === String(index) && now - lastApplied.at < 400) return;
  lastApplied = { key: String(index), at: now };
  doReverse();
}
