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
 *   js_reversed.rgba, js_preview.gif, js_head.png
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
import { contactSheet, fullArmorFrames, gifFrameOrder } from "../js/compose.js";
import { loadTextures, reverseTemplate, textureCandidates } from "../js/reverse.js";
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
