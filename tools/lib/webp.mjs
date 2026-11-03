/**
 * Lossless WebP encode/decode for the tools and tests.
 *
 * Node has no image codec, and the site's packed atlas needs *lossless* WebP:
 * a lossy page would change pixels, and the bundle's content checksum would no
 * longer prove that the textures survived.  `@jsquash/webp` is libwebp compiled
 * to wasm, so it is a **development only** dependency — nothing it produces is
 * needed at runtime, and the shipped site stays dependency free.
 *
 * Both entry points need the wasm binary handed over explicitly: the package
 * loads it with `fetch()`, which cannot read `file:` URLs in Node.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import encodeWasm, { init as initEncode } from "@jsquash/webp/encode.js";
import decodeWasm, { init as initDecode } from "@jsquash/webp/decode.js";

let encoderReady = null;
let decoderReady = null;

const wasm = (specifier) => readFileSync(fileURLToPath(import.meta.resolve(specifier)));

/** Encode RGBA pixels as lossless WebP (`exact`: keep RGB under alpha 0). */
export async function encodeWebpLossless(image, { method = 6 } = {}) {
  encoderReady ??= initEncode({ wasmBinary: wasm("@jsquash/webp/codec/enc/webp_enc_simd.wasm") });
  await encoderReady;
  const buffer = await encodeWasm(
    { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height, colorSpace: "srgb" },
    { lossless: 1, exact: 1, quality: 100, method },
  );
  return new Uint8Array(buffer);
}

/** Decode a WebP file back to RGBA pixels. */
export async function decodeWebp(buffer) {
  decoderReady ??= initDecode({ wasmBinary: wasm("@jsquash/webp/codec/dec/webp_dec.wasm") });
  await decoderReady;
  const image = await decodeWasm(new Uint8Array(buffer));
  return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
}
