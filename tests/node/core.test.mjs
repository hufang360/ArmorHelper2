/**
 * The JavaScript core, pinned to the frozen reference images.
 *
 * `web/tests/golden/` was produced by the Python implementation before it was
 * removed; this file runs the core under Node (`web/tests/run.mjs`) and compares
 * its output with those images pixel for pixel.  Replacing the Python version
 * with the web version therefore did not drop the safety net: the numbers are
 * fixed, and any drift fails a test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  GOLDEN,
  assertSamePixels,
  frame,
  goldenImage,
  produced,
  readJson,
  runCoreHarness,
  sha256,
} from "./lib/helpers.mjs";

const manifest = readJson(join(GOLDEN, "manifest.json")).images;
const workdir = runCoreHarness();

const SHEETS = {
  "js_head.rgba": "head",
  "js_legs.rgba": "legs",
  "js_body.rgba": "body",
  "js_body_glow.rgba": "body-glow",
  "js_body_legacy.rgba": "body-legacy",
  "js_arms.rgba": "arms",
};

test("the golden manifest matches the files", () => {
  for (const [name, entry] of Object.entries(manifest)) {
    const path = join(GOLDEN, entry.file);
    assert.equal(sha256(readFileSync(path)), entry.sha256, `${name}: the golden image was modified`);
    const image = goldenImage(name);
    assert.deepEqual([image.width, image.height], entry.size, name);
  }
});

for (const [file, name] of Object.entries(SHEETS)) {
  test(`generated sheet matches the reference: ${name}`, () => {
    const expected = goldenImage(name);
    assertSamePixels(produced(workdir, file, expected.width, expected.height), expected, file);
  });
}

test("legacy female body matches the reference", () => {
  const expected = goldenImage("body-legacy-female");
  assertSamePixels(
    produced(workdir, "js_body_legacy_female.rgba", expected.width, expected.height),
    expected,
    "legacy female",
  );
});

for (let index = 0; index < 20; index += 1) {
  test(`composed frame ${index} matches the reference`, () => {
    assertSamePixels(produced(workdir, `js_frame${index}.rgba`, 40, 56), frame(goldenImage("frames-male"), index), `frame ${index}`);
  });
}

test("rebuilt template matches the reference", () => {
  const expected = goldenImage("template-rebuilt");
  assertSamePixels(produced(workdir, "js_reversed.rgba", 128, 80), expected, "reversed");
  const warnings = readJson(join(workdir, "js_reversed_warnings.json"));
  assert.deepEqual(warnings, []);
});

for (let index = 0; index < 20; index += 1) {
  test(`sheet frame ${index} matches the reference`, () => {
    assertSamePixels(produced(workdir, `js_sheet_frame${index}.rgba`, 40, 56), frame(goldenImage("sheets-frames-male"), index), `sheet frame ${index}`);
  });
  test(`sheet female frame ${index} matches the reference`, () => {
    assertSamePixels(produced(workdir, `js_sheet_female${index}.rgba`, 40, 56), frame(goldenImage("sheets-frames-female"), index), `sheet female ${index}`);
  });
}

test("the stacked sheet matches the reference", () => {
  const expected = goldenImage("sheets-frames-male");
  assertSamePixels(produced(workdir, "js_sheet_stacked.rgba", 40, 1120), expected, "stacked");
});

test("a short last frame is tolerated", () => {
  const image = produced(workdir, "js_sheet_short19.rgba", 40, 56);
  // the bottom two rows come out transparent when the source sheet is 2px short
  for (let y = 54; y < 56; y += 1) {
    for (let x = 0; x < 40; x += 1) {
      assert.equal(image.data[(y * 40 + x) * 4 + 3], 0, `(${x},${y}) should be transparent`);
    }
  }
});

for (let index = 0; index < 20; index += 1) {
  test(`player frame ${index} matches the reference`, () => {
    assertSamePixels(produced(workdir, `js_player_frame${index}.rgba`, 40, 56), frame(goldenImage("player-frames-male"), index), `player ${index}`);
    assertSamePixels(produced(workdir, `js_player_female${index}.rgba`, 40, 56), frame(goldenImage("player-frames-female"), index), `player female ${index}`);
  });
  test(`player overlay frame ${index} matches the reference`, () => {
    assertSamePixels(produced(workdir, `js_player_overlay${index}.rgba`, 40, 56), frame(goldenImage("frames-player-male"), index), `overlay ${index}`);
  });
}

test("the hand written PNG encoder round trips the reference sheet", async () => {
  const { decodePNG } = await import("../../tools/lib/png.mjs");
  const encoded = decodePNG(readFileSync(join(workdir, "js_head.png")));
  assertSamePixels(encoded, goldenImage("head"), "js_head.png");
});

test("every GIF frame decodes back to the frozen frame it came from", async () => {
  const { deltasOf } = await import("./lib/gif.mjs");
  const order = readJson(join(workdir, "js_gif.json")).order;
  const deltas = deltasOf(readFileSync(join(workdir, "js_preview.gif")));
  assert.equal(deltas.length, order.length, `${deltas.length} decoded frames, ${order.length} expected`);

  const frames = goldenImage("frames-male");
  deltas.forEach((delta, position) => {
    const expected = frame(frames, order[position]);
    assertSamePixels(delta, expected, `gif frame ${position} (source ${order[position]})`);
  });
});

test("the contact sheet is readable", () => {
  const bytes = readFileSync(join(workdir, "js_sheet.png"));
  assert.ok(bytes.length > 1000, `${bytes.length} bytes`);
  // PNG signature + a non-zero IHDR size, without pulling in a decoder
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
});
