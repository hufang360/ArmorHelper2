/**
 * The reverse tab: vanilla sheets back to a 128x80 drawing template.
 *
 * One set at a time, or every complete set in one go with a progress bar and a
 * cancel button.  "Restore all" skips a set whose body sheet is missing instead
 * of failing the whole run.
 */

import { $, say } from "./dom.js";
import { t } from "./i18n.js";
import { REVERSE_SUBDIR, textureReader } from "./textures.js";
import { state } from "./state.js";
import { asId } from "./ids.js";
import { addHistory } from "./history.js";
import { keepUrl, showResult } from "./result.js";
import { packResult } from "./pack.js";
import { endJob, jobCancelled, jobProgress, nextFrame, startJob } from "./jobs.js";
import { ensureOutputFolder } from "./folders.js";
import { allSets, displayName, findSet, sanitizeFilename } from "../js/data.js";
import { downloadBlob, writeToFolder } from "../js/fs.js";
import { fullArmorFrames } from "../js/compose.js";
import { loadTextures, reverseTemplate } from "../js/reverse.js";
import { pngBlob } from "../js/png.js";
import { zipBlobAsync } from "../js/zip.js";

/* -------------------------------------------------------------- reverse -- */

export async function doReverse() {
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
    const { textures, missing } = await loadTextures(
      {
        body,
        head: asId($("#rev-head").value),
        legs: asId($("#rev-legs").value),
      },
      textureReader(),
    );
    const item = findSet(body);
    const label = sanitizeFilename((item && (displayName(item.zh) || item.name)) || `Armor${body}`);
    const { template, warnings } = reverseTemplate(textures);
    if (missing.length) warnings.push(...missing.map((kind) => `${kind}: texture not found`));

    const frames = fullArmorFrames(template, false);
    const entries = [{ name: `ArmorTemplate_${label}_${body}.png`, bitmap: template }];
    const result = await packResult(`ArmorTemplate_${label}_${body}`, entries, frames, warnings, { template });

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
    const jobs = allSets().filter(
      (item) => item.head !== null && item.legs !== null && item.body !== null,
    );
    const read = textureReader();
    startJob(jobs.length);
    for (const [step, item] of jobs.entries()) {
      if (jobCancelled()) break;
      jobProgress(step, displayName(item.zh) || item.name);
      await nextFrame();
      const { textures } = await loadTextures(
        { body: item.body, head: item.head, legs: item.legs },
        read,
      );
      if (!textures.body) continue;
      try {
        const { template } = reverseTemplate(textures);
        const label = sanitizeFilename(displayName(item.zh) || item.name);
        entries.push({ name: `${REVERSE_SUBDIR}/ArmorTemplate_${label}_${item.body}.png`, bitmap: template });
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

    const blobs = [];
    for (const entry of entries) blobs.push({ name: entry.name, blob: await pngBlob(entry.bitmap) });

    const result = {
      title: `${entries.length}`,
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
      zip: { save: async () => downloadBlob(await zipBlobAsync(blobs), "ArmorTemplate.zip") },
      save: {
        save: async () => {
          const target = await ensureOutputFolder();
          if (!target) return;
          for (const item of blobs) await writeToFolder(target, item.name, item.blob);
          say(t("web.savedTo", { count: blobs.length }));
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
