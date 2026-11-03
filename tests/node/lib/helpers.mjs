/**
 * Helpers shared by the Node tests: paths, golden images, and the raw RGBA the
 * `web/tests/run.mjs` harness expects.
 *
 * The reference images in `web/tests/golden/` were produced by the Python
 * implementation before it was removed; `manifest.json` carries their sha256.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { decodePNG } from "../../../tools/lib/png.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const WEB = join(ROOT, "web");
export const GOLDEN = join(WEB, "tests", "golden");

export const read = (path) => readFileSync(path, "utf8");
export const readJson = (path) => JSON.parse(read(path));
export const png = (path) => decodePNG(readFileSync(path));
export const goldenImage = (name) => png(join(GOLDEN, `${name}.png`));

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/**
 * Wait for the Node harness: it reads `input.rgba` / `py_*.rgba` from a scratch
 * directory and dumps everything the core produced back into it.
 *
 * The inputs come from shipped files (the template, the frozen sheets, the
 * bundled player textures), so no Python is involved.
 */
export function runCoreHarness() {
  const workdir = mkdtempSync(join(tmpdir(), "armorhelper-core-"));

  const write = (name, image) => writeFileSync(join(workdir, name), image.data);

  write("input.rgba", png(join(WEB, "data", "ArmorTemplate_v1.png")));
  for (const role of ["head", "legs", "body"]) write(`py_${role}.rgba`, goldenImage(role));
  for (const [part, name] of [
    ["torso", "Player_0_3"],
    ["arm", "Player_0_7"],
    ["legs", "Player_0_10"],
  ]) {
    write(`py_player_${part}.rgba`, png(join(WEB, "data", "player", `${name}.png`)));
  }

  execFileSync(process.execPath, [join(WEB, "tests", "run.mjs"), workdir], { stdio: "pipe" });
  return workdir;
}

/** One raw RGBA dump from the harness, as a decoded image. */
export function produced(workdir, name, width, height) {
  const path = join(workdir, name);
  if (!existsSync(path)) throw new Error(`the harness did not write ${name}`);
  const data = new Uint8Array(readFileSync(path));
  const expected = width * height * 4;
  if (data.length !== expected) {
    throw new Error(`${name}: ${data.length} bytes, expected ${expected}`);
  }
  return { width, height, data };
}

/** Crop one 40x56 frame out of a 20 frame stack. */
export function frame(sheet, index) {
  const width = 40;
  const height = 56;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((index * height + y) * sheet.width) * 4;
    data.set(sheet.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, data };
}

/** Assert two RGBA images are identical, pointing at the first difference. */
export function assertSamePixels(actual, expected, label = "image") {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `${label}: ${actual.width}x${actual.height}, expected ${expected.width}x${expected.height}`,
    );
  }
  const a = actual.data;
  const b = expected.data;
  let differing = 0;
  let first = null;
  for (let index = 0; index < a.length; index += 4) {
    if (a[index] !== b[index] || a[index + 1] !== b[index + 1] || a[index + 2] !== b[index + 2] || a[index + 3] !== b[index + 3]) {
      differing += 1;
      if (first === null) {
        const pixel = index / 4;
        first = `(${pixel % actual.width},${Math.floor(pixel / actual.width)})`;
      }
    }
  }
  if (differing) {
    throw new Error(`${label}: ${differing} pixel(s) differ, first at ${first}`);
  }
}
