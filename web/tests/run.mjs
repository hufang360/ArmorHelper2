/**
 * Node harness for the equivalence tests.
 *
 * Runs the web core (no DOM needed) over a raw RGBA template and dumps its
 * output as raw RGBA so the Python test suite can compare it with the Python
 * implementation pixel for pixel.
 *
 *     node web/tests/run.mjs <workdir>
 *
 * The Python side (`tests/test_web_port.py`) prepares the work directory:
 *   input.rgba                 128x80 template
 *   py_head.rgba               40x1120, for the reverse test
 *   py_legs.rgba               40x1120, for the reverse test
 *   py_body.rgba               360x224, for the reverse test
 *
 * and then checks everything this script writes:
 *   js_head.rgba, js_legs.rgba, js_body.rgba, js_body_glow.rgba,
 *   js_arms.rgba, js_body_legacy.rgba, js_frame0.rgba .. js_frame19.rgba,
 *   js_reversed.rgba, js_preview.gif, js_head.png,
 *   js_sheet_frame0..19.rgba, js_sheet_female0..19.rgba, js_sheet_stacked.rgba,
 *   js_sheet_short19.rgba, js_sheet_classify.json,
 *   js_atlas_head.rgba, js_atlas_legs.rgba, js_atlas.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { initLayout, initSets } from "../js/data.js";
import { createBitmap, cropRegion } from "../js/bitmap.js";
import {
  compositeBodyFrames,
  generateArms,
  generateBodyComposite,
  generateBodyLegacy,
  generateHead,
  generateLegs,
} from "../js/generate.js";
import { composeOverlay, contactSheet, fullArmorFrames, gifFrameOrder, magnify } from "../js/compose.js";
import { loadTextures, reverseTemplate, textureCandidates } from "../js/reverse.js";
import { ATLAS_MAX_PAGE, createAtlasReader, sheetKey, validateIndex } from "../js/atlas.js";
import { encodeGIF } from "../js/gif.js";
import { encodePNG } from "../js/png.js";
import { createZip } from "../js/zip.js";

const here = dirname(fileURLToPath(import.meta.url));
const workdir = process.argv[2];
if (!workdir) {
  console.error("usage: node web/tests/run.mjs <workdir>");
  process.exit(2);
}

const layout = JSON.parse(readFileSync(join(here, "..", "data", "layout.json"), "utf8"));
const sets = JSON.parse(readFileSync(join(here, "..", "data", "armor_sets.json"), "utf8"));
initLayout(layout);
initSets(sets.sets);

function readBitmap(name, width, height) {
  const data = readFileSync(join(workdir, name));
  return { width, height, data: new Uint8ClampedArray(data) };
}

function writeBitmap(name, bitmap) {
  writeFileSync(join(workdir, name), Buffer.from(bitmap.data.buffer, bitmap.data.byteOffset, bitmap.data.length));
}

const template = readBitmap("input.rgba", layout.templateSize[0], layout.templateSize[1]);

/* ---- sheets ---------------------------------------------------------- */
writeBitmap("js_head.rgba", generateHead(template));
writeBitmap("js_legs.rgba", generateLegs(template));
writeBitmap("js_arms.rgba", generateArms(template));
writeBitmap("js_body_legacy.rgba", generateBodyLegacy(template, false));
writeBitmap("js_body.rgba", generateBodyComposite(template));
writeBitmap("js_body_glow.rgba", generateBodyComposite(template, { glowRows: 4 }));

/* ---- composed frames ------------------------------------------------- */
fullArmorFrames(template, false).forEach((frame, index) => {
  writeBitmap(`js_frame${index}.rgba`, frame);
});

/* ---- reverse --------------------------------------------------------- */
const textures = {
  head: readBitmap("py_head.rgba", layout.frame.w * 2, layout.frame.h * 2 * layout.frame.count),
  legs: readBitmap("py_legs.rgba", layout.frame.w * 2, layout.frame.h * 2 * layout.frame.count),
  body: readBitmap("py_body.rgba", layout.frame.w * 2 * layout.bodyComposite.cols, layout.frame.h * 2 * layout.bodyComposite.rows),
};
const reversed = reverseTemplate(textures);
writeBitmap("js_reversed.rgba", reversed.template);
writeFileSync(join(workdir, "js_reversed_warnings.json"), JSON.stringify(reversed.warnings));

/* ---- texture lookup -------------------------------------------------- */
// Guards the bug where the app mapped the vanilla file names onto the wrong
// keys and silently reversed the body only.
const tiny = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
const library = {
  "Armor_Head_189.png": tiny(40, 1120),
  "Armor/Armor_190.png": tiny(360, 224),
  "Armor_Legs_130.png": tiny(40, 1120),
};
const flatLibrary = {
  "Armor_Head_189.png": tiny(40, 1120),
  "Armor_190.png": tiny(360, 224),
  "Armor_Legs_130.png": tiny(40, 1120),
};

const nested = await loadTextures({ body: 190, head: 189, legs: 130 }, async (path) =>
  library[path] ?? null,
);
const flat = await loadTextures({ body: 190, head: 189, legs: 130 }, async (path) =>
  flatLibrary[path] ?? null,
);
const bodyOnly = await loadTextures({ body: 190 }, async (path) => library[path] ?? null);

writeFileSync(
  join(workdir, "js_texture_lookup.json"),
  JSON.stringify({
    nested: {
      head: nested.textures.head?.height ?? null,
      body: nested.textures.body?.width ?? null,
      legs: nested.textures.legs?.height ?? null,
      missing: nested.missing,
    },
    flat: {
      head: flat.textures.head?.height ?? null,
      body: flat.textures.body?.width ?? null,
      legs: flat.textures.legs?.height ?? null,
      missing: flat.missing,
    },
    bodyOnly: {
      head: bodyOnly.textures.head,
      legs: bodyOnly.textures.legs,
      missing: bodyOnly.missing,
    },
    candidates: textureCandidates(190, 189, 130),
  }),
);

/* ---- packed texture atlas -------------------------------------------- */
// The vanilla bundle ships as a few WebP pages plus `index.json`.  This checks
// the reader end to end: a fake page holding the two test sheets at 1x has to
// come back as the original 2x bitmaps, with the recorded exception pixels put
// back and every page decoded exactly once.
const downscaleEven = (bitmap) => {
  const out = createBitmap(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2));
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const si = (y * 2 * bitmap.width + x * 2) * 4;
      const di = (y * out.width + x) * 4;
      for (let k = 0; k < 4; k += 1) out.data[di + k] = bitmap.data[si + k];
    }
  }
  return out;
};

const headCell = downscaleEven(textures.head);
const legsCell = downscaleEven(textures.legs);
const atlasPage = createBitmap(headCell.width + legsCell.width + 8, Math.max(headCell.height, legsCell.height) + 10);
const blit = (bitmap, ox, oy) => {
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const si = (y * bitmap.width + x) * 4;
      const di = ((oy + y) * atlasPage.width + ox + x) * 4;
      for (let k = 0; k < 4; k += 1) atlasPage.data[di + k] = bitmap.data[si + k];
    }
  }
};
blit(headCell, 3, 5);
blit(legsCell, headCell.width + 6, 5);

// one deliberately broken pixel, restored from the index
const STRAY = [1, 2, 9, 8, 7, 255];
const index = {
  version: "test",
  format: "webp-atlas",
  scale: 2,
  pageSize: ATLAS_MAX_PAGE,
  maxPage: ATLAS_MAX_PAGE,
  pages: [{ file: "page-0.webp", w: atlasPage.width, h: atlasPage.height }],
  sheets: {
    Armor_Head_1: [0, 3, 5, headCell.width, headCell.height],
    Armor_Legs_1: [0, headCell.width + 6, 5, legsCell.width, legsCell.height],
  },
  strays: { Armor_Legs_1: [STRAY] },
};

const pageLoads = [];
const atlas = createAtlasReader({
  index,
  loadPage: async (file) => {
    pageLoads.push(file);
    return file === "page-0.webp" ? atlasPage : null;
  },
});

const atlasHead = await atlas("Armor_Head_1.png");
const atlasLegs = await atlas("Armor_Legs_1.png");
const atlasUnknown = await atlas("Armor_Head_9999.png");
writeBitmap("js_atlas_head.rgba", atlasHead);
writeBitmap("js_atlas_legs.rgba", atlasLegs);

// a bundle that ignores the browser cap must be refused, not half decoded
const rejects = (candidate) => {
  try {
    validateIndex(candidate);
    return false;
  } catch {
    return true;
  }
};
writeFileSync(
  join(workdir, "js_atlas.json"),
  JSON.stringify({
    maxPage: ATLAS_MAX_PAGE,
    keys: [sheetKey("Armor_Head_1.png"), sheetKey("Armor/Armor_190.png")],
    pageLoads,
    cachedPages: atlas.cachedPages(),
    unknown: atlasUnknown,
    stray: STRAY,
    headSize: [atlasHead.width, atlasHead.height],
    legsSize: [atlasLegs.width, atlasLegs.height],
    rejectsBigCap: rejects({ ...index, maxPage: ATLAS_MAX_PAGE * 2 }),
    rejectsBigPage: rejects({
      ...index,
      pages: [{ file: "page-0.webp", w: ATLAS_MAX_PAGE + 1, h: 10 }],
    }),
    acceptsSharedPage: rejects(index) === false,
  }),
);

/* ---- full-body frames straight from the three sheets ------------------ */
// The same input textures used for the reverse test are composed directly,
// which is the "sheets -> GIF" feature. Python compares every frame.
import {
  classifySheets,
  composeFrames,
  detectId as detectSheetId,
  detectRole as detectSheetRole,
  stackFrames as stackSheet,
} from "../js/sheets.js";

const sheetInput = {
  head: readBitmap("py_head.rgba", layout.frame.w * 2, layout.frame.h * 2 * layout.frame.count),
  legs: readBitmap("py_legs.rgba", layout.frame.w * 2, layout.frame.h * 2 * layout.frame.count),
  body: readBitmap(
    "py_body.rgba",
    layout.frame.w * 2 * layout.bodyComposite.cols,
    layout.frame.h * 2 * layout.bodyComposite.rows,
  ),
};

const sheetFrames = composeFrames(sheetInput);
sheetFrames.forEach((frame, index) => writeBitmap(`js_sheet_frame${index}.rgba`, frame));
writeBitmap("js_sheet_stacked.rgba", stackSheet(sheetFrames));

const sheetFemaleFrames = composeFrames({ ...sheetInput, female: true });
sheetFemaleFrames.forEach((frame, index) => writeBitmap(`js_sheet_female${index}.rgba`, frame));

// A few vanilla head sheets are 40x1118; the last frame has to come out with a
// transparent bottom row. Both implementations must tolerate it the same way.
const shortHead = cropRegion(sheetInput.head, [0, 0, sheetInput.head.width, 1118]);
const shortFrames = composeFrames({ ...sheetInput, head: shortHead });
writeBitmap("js_sheet_short19.rgba", shortFrames[19]);

// Role detection and duplicate handling, including the dimension fallback.
const blank = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
const classified = classifySheets([
  { name: "Armor_32.png", bitmap: blank(360, 224) },
  { name: "Armor_Head_52.png", bitmap: blank(40, 1120) },
  { name: "Armor_Legs_31.png", bitmap: blank(40, 1120) },
  { name: "mystery.png", bitmap: blank(360, 224) },
  { name: "unknown_tall.png", bitmap: blank(40, 1120) },
  { name: "Armor_Head_99.png", bitmap: blank(40, 1120) },
]);
writeFileSync(
  join(workdir, "js_sheet_classify.json"),
  JSON.stringify({
    roles: Object.fromEntries(
      ["head", "body", "legs"].map((role) => [role, classified[role] ? classified[role].width : null]),
    ),
    ids: classified.ids,
    names: classified.names,
    warnings: classified.warnings,
    detect: [
      "Armor_Head_52.png",
      "Armor_Legs_31.png",
      "Armor_32.png",
      "Armor/Armor_1.png",
      "Player_0_3.png",
      "thing.png",
    ].map((name) => [name, detectSheetRole(name), detectSheetId(name)]),
  }),
);

/* ---- guide overlay --------------------------------------------------- */
// The overlay is composited for display only; generation must be unaffected.
const { decodeBitmap } = await import("../js/fs.js");
const overlay = null; // filled below when the Python side supplies the pixels
{
  const { readFileSync: read } = await import("node:fs");
  const overlayPath = join(workdir, "overlay.rgba");
  let layer = null;
  try {
    layer = {
      width: layout.templateSize[0],
      height: layout.templateSize[1],
      data: new Uint8ClampedArray(read(overlayPath)),
    };
  } catch {
    layer = null;
  }
  const composed = layer ? composeOverlay(template, layer) : template;
  let gained = 0;
  for (let i = 3; i < composed.data.length; i += 4) {
    if (composed.data[i] > 1 && template.data[i] <= 1) gained += 1;
  }
  writeFileSync(
    join(workdir, "js_overlay.json"),
    JSON.stringify({
      hasOverlay: !!layer,
      gainedPixels: gained,
      unchanged: Buffer.from(composed.data).equals(Buffer.from(template.data)),
      magnified: magnify(composed, 4).width,
    }),
  );
}

/* ---- codecs ---------------------------------------------------------- */
const frames = fullArmorFrames(template, false);
writeFileSync(join(workdir, "js_preview.gif"), Buffer.from(encodeGIF(frames, { order: gifFrameOrder() })));
writeFileSync(join(workdir, "js_head.png"), Buffer.from(await encodePNG(generateHead(template))));
writeFileSync(join(workdir, "js_sheet.png"), Buffer.from(await encodePNG(contactSheet(frames))));
writeFileSync(join(workdir, "js_first_frame.rgba"), Buffer.from(frames[0].data.buffer));

// zip with a nested path, so the Python side can check the structure
writeFileSync(
  join(workdir, "js_bundle.zip"),
  Buffer.from(
    createZip([
      { name: "Armor_Head_189.png", data: await encodePNG(generateHead(template)) },
      { name: "Armor/Armor_190.png", data: await encodePNG(generateBodyComposite(template)) },
      { name: "notes.txt", data: "hello 盔甲" },
    ]),
  ),
);

/* a tiny sanity value the Python side can assert on */
writeFileSync(
  join(workdir, "js_summary.json"),
  JSON.stringify({
    layoutVersion: layout.version,
    compositionFrames: compositeBodyFrames(template).length,
    legsCrop: cropRegion(template, layout.regions.legFootFront).width,
    canvas: createBitmap(2, 2).data.length,
  }),
);

console.log("web core: ok");
