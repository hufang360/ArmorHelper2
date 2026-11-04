/**
 * What the Node harness (`web/tests/run.mjs`) reports about the parts of the core
 * that are not images: texture lookup, sheet classification, the atlas reader
 * and the zip writer.
 *
 * These used to be Python tests; they only need the JSON/PNG the harness dumps.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertSamePixels, goldenImage, produced, readJson, runCoreHarness } from "./lib/helpers.mjs";
import { readZip } from "./lib/browser.mjs";
import { decodePNG } from "../../tools/lib/png.mjs";

const workdir = runCoreHarness();
const json = (name) => readJson(join(workdir, name));

test("texture lookup maps vanilla files to slots", () => {
  // Regression test: the app once used the file name as the key, so "rebuild
  // this set" silently produced a template with only the torso in it.
  const lookup = json("js_texture_lookup.json");

  for (const layout of ["nested", "flat"]) {
    const entry = lookup[layout];
    assert.deepEqual(entry.missing, [], `${layout}: ${entry.missing}`);
    assert.equal(entry.head, 1120, `${layout}: head sheet not loaded`);
    assert.equal(entry.body, 360, `${layout}: body sheet not loaded`);
    assert.equal(entry.legs, 1120, `${layout}: legs sheet not loaded`);
  }

  // a body-only request must still report what is missing
  assert.deepEqual(lookup.bodyOnly.missing, ["head", "legs"]);
  assert.equal(lookup.bodyOnly.head, null);

  assert.deepEqual(lookup.candidates, {
    head: ["Armor_Head_189.png"],
    body: ["Armor/Armor_190.png", "Armor_190.png"],
    legs: ["Armor_Legs_130.png"],
  });
});

test("the atlas reader rebuilds the textures", () => {
  const meta = json("js_atlas.json");

  // the browser cap is part of the contract, on both sides of the wire
  assert.equal(meta.maxPage, 2048);
  assert.deepEqual(meta.keys, ["Armor_Head_1", "Armor/Armor_190"]);

  assertSamePixels(produced(workdir, "js_atlas_head.rgba", 40, 1120), goldenImage("head"), "atlas head");

  // one declared exception pixel: the 1x sheet is not a perfect 2x upscale there
  const legs = goldenImage("legs");
  const expected = {
    width: legs.width,
    height: legs.height,
    data: new Uint8Array(legs.data),
  };
  const [x, y, r, g, b, a] = meta.stray;
  const target = (y * expected.width + x) * 4;
  expected.data.set([r, g, b, a], target);
  assertSamePixels(produced(workdir, "js_atlas_legs.rgba", legs.width, legs.height), expected, "atlas legs");

  // both sheets came out of a single decoded page; unknown paths fall through
  assert.deepEqual(meta.pageLoads, ["page-0.webp"]);
  assert.equal(meta.cachedPages, 1);
  assert.equal(meta.unknown, null);

  // a bundle that breaks the 2048px cap is refused before anything is drawn
  assert.equal(meta.rejectsBigCap, true);
  assert.equal(meta.rejectsBigPage, true);
  assert.equal(meta.acceptsSharedPage, true);
});

test("sheet classification", () => {
  const lookup = json("js_sheet_classify.json");

  assert.deepEqual(lookup.roles, { head: 40, body: 360, legs: 40 });
  assert.deepEqual(lookup.ids, { head: 52, body: 32, legs: 31 });
  assert.deepEqual(lookup.names, {
    head: "Armor_Head_52.png",
    body: "Armor_32.png",
    legs: "Armor_Legs_31.png",
  });

  // the duplicate head, the duplicate body and the unclassifiable tall file
  assert.equal(lookup.warnings.length, 3);
  const keys = lookup.warnings.map((warning) => warning.key);
  assert.equal(keys.filter((key) => key === "web.sheetWarnDuplicate").length, 2, JSON.stringify(lookup.warnings));
  assert.equal(keys.filter((key) => key === "web.sheetWarnUnknown").length, 1, JSON.stringify(lookup.warnings));

  // without useful names the shapes decide, and the bigger tall file is the legs
  assert.deepEqual(lookup.sized.names, { head: "2.png", body: "1.png", legs: "3.png" });
  assert.deepEqual(lookup.sized.warnings, []);
  // one tall sheet alone cannot be split: the user is asked to place it
  assert.deepEqual(lookup.lonely.names, { head: null, body: null, legs: null });
  assert.deepEqual(
    lookup.lonely.warnings.map((warning) => warning.key),
    ["web.sheetWarnUnknown"],
  );

  const expected = {
    // the tool's own output, a vanilla legs sheet, the vanilla body grid and the
    // `Armor/` sub folder it lives in, a player skin (never armor) and a name
    // that says nothing
    "Armor_Head_52.png": ["head", 52],
    "Armor_Legs_31.png": ["legs", 31],
    "Armor_32.png": ["body", 32],
    "Armor/Armor_1.png": ["body", 1],
    "Player_0_3.png": [null, 3], // a player skin: no role, but the id parses
    "thing.png": [null, null],
  };
  assert.deepEqual(lookup.detect.map(([name]) => name), Object.keys(expected));
  for (const [name, role, ident] of lookup.detect) {
    assert.deepEqual([role, ident], expected[name], name);
  }
});

test("the contact sheet is a readable PNG", () => {
  const image = decodePNG(readFileSync(join(workdir, "js_sheet.png")));
  assert.equal(image.data.length, image.width * image.height * 4);
  assert.ok(image.width > 0 && image.height > 0);
});

test("the zip has the expected structure", () => {
  const entries = readZip(readFileSync(join(workdir, "js_bundle.zip")));
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["Armor_Head_189.png", "Armor/Armor_190.png", "notes.txt"],
  );

  const notes = entries.find((entry) => entry.name === "notes.txt");
  assert.equal(new TextDecoder().decode(notes.data), "hello 盔甲");

  const body = entries.find((entry) => entry.name === "Armor/Armor_190.png");
  const image = decodePNG(body.data);
  assert.deepEqual([image.width, image.height], [360, 224]);
});
