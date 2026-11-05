/**
 * The zips: a Terraria resource pack, the 1.3 layout, and the pack built from
 * the three sheets on the preview tab.
 *
 * Every zip is assembled in memory and handed to the browser as a Blob, so the
 * page needs no server.  A pack is the one output large enough that building it
 * on click instead of on every keystroke matters.
 */

import { $, say } from "./dom.js";
import { t } from "./i18n.js";
import { SHEET_ROLES, state } from "./state.js";
import { effectiveIds } from "./ids.js";
import { addHistory } from "./history.js";
import { keepUrl, withGuide } from "./result.js";
import { displayName, findSet, sanitizeFilename } from "../js/data.js";
import { TEMPLATE_PREVIEW_SCALE } from "../js/compose.js";
import { detectId as detectSheetId } from "../js/sheets.js";
import { downloadBlob } from "../js/fs.js";
import { upscale } from "../js/bitmap.js";
import { pngBlob } from "../js/png.js";
import { zipBlob, zipBlobAsync } from "../js/zip.js";

/**
 * A Terraria resource pack (`<name>-pack-pc.zip`), the layout the game reads:
 *
 *     pack.json
 *     Content/Images/Armor_Head_<id>.png
 *     Content/Images/Armor_Legs_<id>.png
 *     Content/Images/Armor/Armor_<id>.png
 *
 * `pack.json` carries the display name; the zip's own name is what the game
 * lists in `ResourcePacks/`, so it stays ASCII (`Armor_<id>`).
 */
export async function resourcePackBlob({ head, legs, body }, id, info = {}) {
  // an empty field means "use the default", so the inputs can stay blank
  const pack = {
    Name: (info.name ?? "").trim() || t("web.packDefaultName"),
    Author: (info.author ?? "").trim() || t("web.packDefaultAuthor"),
    Description: (info.description ?? "").trim() || t("web.packDescription"),
    Version: { major: 1, minor: 0 },
  };
  const png = async (bitmap) => (await pngBlob(bitmap)).arrayBuffer();

  const entries = [
    { name: "pack.json", data: `${JSON.stringify(pack, null, 2)}\n` },
    { name: "Content/", data: new Uint8Array(0) },
    { name: "Content/Images/", data: new Uint8Array(0) },
    { name: `Content/Images/Armor_Head_${id}.png`, data: await png(head) },
    { name: `Content/Images/Armor_Legs_${id}.png`, data: await png(legs) },
    { name: "Content/Images/Armor/", data: new Uint8Array(0) },
    { name: `Content/Images/Armor/Armor_${id}.png`, data: await png(body) },
  ];
  return zipBlob(entries);
}

/**
 * The same five sheets for Terraria 1.3, which had no resource packs.
 *
 * The zip keeps the game's folder layout so it can be unpacked next to
 * `Content/Images`, but it carries no `pack.json`: 1.3 never reads one.
 */
export async function legacyPackBlob({ head, legs, body, female, arms }, id) {
  const png = async (bitmap) => (await pngBlob(bitmap)).arrayBuffer();
  const entries = [
    { name: "Content/", data: new Uint8Array(0) },
    { name: "Content/Images/", data: new Uint8Array(0) },
    { name: `Content/Images/Armor_Head_${id}.png`, data: await png(head) },
    { name: `Content/Images/Armor_Legs_${id}.png`, data: await png(legs) },
    { name: `Content/Images/Armor_Body_${id}.png`, data: await png(body) },
    { name: `Content/Images/Female_Body_${id}.png`, data: await png(female) },
    { name: `Content/Images/Armor_Arm_${id}.png`, data: await png(arms) },
  ];
  return zipBlob(entries);
}

export async function doResourcePack() {
  const missing = SHEET_ROLES.filter((role) => !state.sheetSlots[role]);
  if (missing.length) {
    say(t("web.gifsNeed"), "warn");
    return;
  }

  $("#do-pack").disabled = true;
  say(t("web.working"), "busy");
  try {
    const ids = effectiveIds();
    const detected = detectSheetId(state.sheetSlots.body.name);
    const id = detected ?? ids.body ?? 0;
    const warnings = detected === null && ids.body === null ? [t("web.packNoId")] : [];

    const item = findSet(id);
    const friendly = (item && (displayName(item.zh) || item.name)) || `Armor_${id}`;
    const slug = `Armor_${id}`;
    const zipName = `${slug}-pack-pc.zip`;
    const bitmaps = {
      head: state.sheetSlots.head.bitmap,
      legs: state.sheetSlots.legs.bitmap,
      body: state.sheetSlots.body.bitmap,
    };

    // the three fields under the slots are the same ones the export page edits
    const blob = await resourcePackBlob(bitmaps, id, state.config.pack ?? {});
    // the pack page keeps no result card: the zip goes straight to the browser
    downloadBlob(blob, zipName);
    addHistory(slug, [{ name: zipName }], keepUrl(state.sheetSlots.body.bitmap));
    say(t("web.packDone", { name: zipName, size: Math.max(1, Math.round(blob.size / 1024)) }));
  } catch (error) {
    console.error(error);
    say(String(error.message || error), "bad");
  } finally {
    $("#do-pack").disabled = SHEET_ROLES.some((role) => !state.sheetSlots[role]);
  }
}

/** File name stem of the body sheet, used when it has no vanilla id. */
export function sheetStem(name) {
  const base = String(name ?? "Armor")
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "");
  return sanitizeFilename(base || "Armor");
}

/**
 * Result object for one reversed set: one template PNG per part combination,
 * their previews, the 20 frame sheet and the animation.
 *
 * `templates` is `[{ name, bitmap, caption }]` with the raw (guide-free)
 * bitmaps, so the guide switch can redraw both the previews and the downloads.
 * A single file gets a download button; several files get a zip.
 */
export async function packResult(title, templates, frames, warnings = []) {
  const guide = state.config.revGuide !== false;
  const files = [];
  const shown = [];
  const previews = [];
  for (const entry of templates) {
    const blob = await pngBlob(withGuide(entry.bitmap, guide));
    const file = {
      name: entry.name,
      width: entry.bitmap.width,
      height: entry.bitmap.height,
      size: blob.size,
      url: URL.createObjectURL(blob),
    };
    files.push(file);
    shown.push({ raw: entry.bitmap, file });
    previews.push({
      url: keepUrl(upscale(withGuide(entry.bitmap, guide), TEMPLATE_PREVIEW_SCALE)),
      captionKey: entry.caption ? undefined : "web.previewTemplate",
      caption: entry.caption,
      alt: "ArmorTemplate",
      // the drawing template, so a switch flip can redraw without reversing again
      template: entry.bitmap,
    });
  }
  return {
    bare: true,
    title,
    files,
    previews,
    warnings,
    // every template PNG, so a guide flip can replace the downloads too
    templates: shown,
    // the frames behind the animation, so a speed change can re-bake it
    frames,
    download: files.length === 1 ? { url: files[0].url, name: files[0].name } : null,
    zip:
      files.length > 1
        ? {
            save: async () => {
              const latest = [];
              for (const item of shown) {
                latest.push({
                  name: item.file.name,
                  blob: await pngBlob(withGuide(item.raw, state.config.revGuide !== false)),
                });
              }
              downloadBlob(await zipBlobAsync(latest), `${sanitizeFilename(title)}.zip`);
            },
          }
        : null,
  };
}
