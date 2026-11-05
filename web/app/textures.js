/**
 * Where the vanilla armor textures and the player skin come from.
 *
 * Three sources, in the order `textureReader()` tries them: the game folder the
 * reader granted (Chromium only, so it may have retextured the art), files they
 * dropped in, and the packed atlas that ships with the site.  The reader is the
 * only place that knows that order, so the reverse conversion and the demo
 * cannot disagree about which texture they read.
 *
 * The player skin has the same shape: the game folder when granted, the
 * bundled copies otherwise.
 */

import { state } from "./state.js";
import { createAtlasReader } from "../js/atlas.js";
import { decodeBitmap, readFromFolder } from "../js/fs.js";
import { ensurePermission } from "../js/idb.js";

/** Part numbers of ``TextureAssets.Players[skin, n]``.
 *  The head and the eyes are the two the face area of a helmet shows. */
const PLAYER_PART_NUMBERS = { head: 0, eyes: 1, torso: 3, arm: 7, legs: 10 };

/** The texture names for one skin (`Player_<skin>_<part>.png`). */
function playerPartNames(skin) {
  const names = {};
  for (const [part, number] of Object.entries(PLAYER_PART_NUMBERS)) {
    names[part] = `Player_${skin}_${number}.png`;
  }
  return names;
}

/** The skin chosen in the settings; the bundled art only ships skin 0. */
export function currentSkin() {
  const skin = Math.floor(Number(state.config.skin) || 0);
  return skin >= 0 && skin <= 9 ? skin : 0;
}
/** The same three textures ship with the site: phones have no game folder. */
export const PLAYER_DIR = "data/player";
export const REVERSE_SUBDIR = "ArmorTemplate";
/** Armor textures shipped with the site, so phones work without a game folder. */
export const BUILTIN_DIR = "data/vanilla";
/** Page rects for `BUILTIN_DIR`; the pages themselves are WebP (see js/atlas.js). */
const BUILTIN_INDEX = "index.json";
/** Every player part for one skin, decoded by `read(name)` into a bitmap. */
async function loadPlayerSheets(skin, read) {
  const parts = {};
  const names = Object.entries(playerPartNames(skin));
  await Promise.all(
    names.map(async ([part, name]) => {
      parts[part] = await decodeBitmap(await read(name));
    }),
  );
  return parts;
}

/** The player textures bundled with the site (works on any browser, offline too). */
export async function loadBundledPlayerParts() {
  // only skin 0 is bundled; another skin falls back to it
  for (const skin of [currentSkin(), 0]) {
    try {
      const parts = await loadPlayerSheets(skin, async (name) => {
        const response = await fetch(`${PLAYER_DIR}/${name}`);
        if (!response.ok) throw new Error(name);
        return response.blob();
      });
      return { ...parts, skin };
    } catch {
      /* try the next skin */
    }
  }
  return null;
}

/**
 * The player body used by "overlay player": the user's `Content/Images` when a
 * Chromium folder is available (they may have retextured it), otherwise the
 * copies shipped in `data/player/`.
 */
export async function loadPlayerParts() {
  const images = state.folders.images;
  const skin = currentSkin();
  if (images && (await ensurePermission(images, "read"))) {
    try {
      const parts = await loadPlayerSheets(skin, (name) => readFromFolder(images, name));
      return { ...parts, skin };
    } catch {
      /* fall through to the bundled copies */
    }
  }
  return loadBundledPlayerParts();
}

/**
 * A reader for vanilla textures, in order of preference:
 *
 * 1. the `Content/Images` folder the user picked (Chromium only),
 * 2. files the user uploaded by hand,
 * 3. the textures bundled with the site — this is what makes the reverse
 *    conversion usable on a phone, where neither of the first two exists.
 */
export function textureReader() {
  const folder = state.folders.images;
  let permission = null;

  return async (path) => {
    if (folder) {
      if (permission === null) permission = await ensurePermission(folder, "read");
      if (permission) {
        try {
          return await decodeBitmap(await readFromFolder(folder, path));
        } catch {
          /* fall through to the next source */
        }
      }
    }
    const file = state.textures.get(path.split("/").pop());
    if (file) return decodeBitmap(file);
    if (state.atlas) {
      try {
        const bitmap = await state.atlas(path);
        if (bitmap) return bitmap;
      } catch (error) {
        console.error(error);
      }
    }
    return null;
  };
}

/** Read `data/vanilla/version.txt` and the atlas index; absent means nothing is bundled. */
export async function loadBuiltinInfo() {
  try {
    const response = await fetch(`${BUILTIN_DIR}/version.txt`);
    if (!response.ok) return null;
    const info = {};
    for (const line of (await response.text()).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, value] = trimmed.split("=", 2);
      info[key.trim()] = value.trim();
    }
    info.count = Number(info.count) || 0;
    if (!info.count) return null;

    // The textures live in a few WebP pages; `index.json` says which rect of
    // which page holds each game path.
    const indexResponse = await fetch(`${BUILTIN_DIR}/${BUILTIN_INDEX}`);
    if (!indexResponse.ok) return null;
    state.atlas = createAtlasReader({
      index: await indexResponse.json(),
      loadPage: async (file) => {
        const page = await fetch(`${BUILTIN_DIR}/${file}`);
        if (!page.ok) return null;
        return decodeBitmap(await page.blob());
      },
    });
    return info;
  } catch (error) {
    console.error(error);
    return null;
  }
}
