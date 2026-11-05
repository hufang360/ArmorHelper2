/**
 * The two folders the app can be granted: where the sheets are written, and
 * where the game's own textures are read from.
 *
 * Only Chromium has the File System Access API.  The handles live in IndexedDB
 * because the permission does not survive a reload, so the caller asks again —
 * that is `ensureOutputFolder()`'s job.
 */

import { $, on, say } from "./dom.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import { canUseFolders, pickFolder } from "../js/fs.js";
import { dropHandle, ensurePermission, putHandle } from "../js/idb.js";

export const HANDLE_OUTPUT = "output";
export const HANDLE_IMAGES = "images";

function textureSourceLabel() {
  if (state.folders.images) return t("web.usingFolder", { name: state.folders.images.name });
  if (state.textures.size) return t("web.usingUploads", { count: state.textures.size });
  if (state.builtin) {
    return t("web.builtinTextures", {
      version: state.builtin.version,
      count: state.builtin.count,
    });
  }
  return canUseFolders ? t("web.needTextures") : t("web.noFolderSupport");
}

export function renderFolders() {
  const output = state.folders.output;
  const outputText = output ? t("web.outputName", { name: output.name }) : (canUseFolders ? "" : t("web.noFolderSupport"));
  const imagesText = textureSourceLabel();

  $("#output-status").textContent = outputText;
  $("#images-status").textContent = imagesText;
  $("#images-status-2").textContent = imagesText;

  // The player textures are bundled now, so the note lives in the info icon's
  // tooltip instead of a paragraph that has to be shown and hidden.
}

export async function ensureOutputFolder() {
  if (!state.folders.output) {
    if (!canUseFolders) {
      say(t("web.noFolderSupport"), "warn");
      return null;
    }
    const handle = await pickFolder("readwrite");
    if (!handle) return null;
    state.folders.output = handle;
    await putHandle(HANDLE_OUTPUT, handle);
    renderFolders();
  }
  if (!(await ensurePermission(state.folders.output, "readwrite"))) {
    say(t("web.needOutput"), "warn");
    return null;
  }
  return state.folders.output;
}

export async function pickImagesFolder() {
  if (!canUseFolders) {
    say(t("web.noFolderSupport"), "warn");
    return;
  }
  const handle = await pickFolder("read");
  if (!handle) return;
  state.folders.images = handle;
  await putHandle(HANDLE_IMAGES, handle);
  renderFolders();
}

/** Bind the controls this module owns. */
export function bindFolders() {
on("#pick-images", "click", pickImagesFolder);
on("#pick-images-2", "click", pickImagesFolder);
on("#pick-textures", "click", () => $("#texture-input")?.click());
on("#texture-input", "change", (event) => {
  for (const file of event.target.files) state.textures.set(file.name, file);
  event.target.value = "";
  renderFolders();
  say(t("web.selected", { count: state.textures.size }));
});

on("#pick-output", "click", async () => {
  const handle = await pickFolder("readwrite");
  if (!handle) return;
  state.folders.output = handle;
  await putHandle(HANDLE_OUTPUT, handle);
  renderFolders();
});
on("#clear-output", "click", async () => {
  state.folders.output = null;
  await dropHandle(HANDLE_OUTPUT);
  renderFolders();
});
on("#clear-images", "click", async () => {
  state.folders.images = null;
  await dropHandle(HANDLE_IMAGES);
  renderFolders();
});
}
