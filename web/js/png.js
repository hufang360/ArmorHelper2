/**
 * PNG encoding.
 *
 * The browser's `canvas.toBlob` would work, but a canvas stores colours
 * premultiplied by alpha, which can round-trip semi transparent pixels
 * differently.  Writing the PNG here keeps the bytes the generator produced
 * exactly, with no canvas in the way.
 *
 * `CompressionStream("deflate")` gives a zlib stream; if it is unavailable the
 * encoder falls back to stored (uncompressed) deflate blocks, which is always
 * valid PNG and still exact.
 */

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes, start = 0, end = bytes.length) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** zlib-compress with stored blocks (always available, no compression). */
function deflateStored(bytes) {
  const blocks = [];
  const maxBlock = 65535;
  for (let offset = 0; offset < bytes.length || offset === 0; offset += maxBlock) {
    const size = Math.min(maxBlock, bytes.length - offset);
    const last = offset + size >= bytes.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = last;
    header[1] = size & 0xff;
    header[2] = (size >> 8) & 0xff;
    header[3] = ~size & 0xff;
    header[4] = (~size >> 8) & 0xff;
    blocks.push(header, bytes.subarray(offset, offset + size));
    if (size === 0) break;
  }
  const payload = concat(blocks);
  const out = new Uint8Array(2 + payload.length + 4);
  out[0] = 0x78; // CMF: deflate, 32k window
  out[1] = 0x01; // FLG: no dictionary, fastest
  out.set(payload, 2);
  new DataView(out.buffer).setUint32(2 + payload.length, adler32(bytes));
  return out;
}

async function deflate(bytes) {
  if (typeof CompressionStream === "undefined") return deflateStored(bytes);
  try {
    const stream = new CompressionStream("deflate");
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buffer = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return deflateStored(bytes);
  }
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Encode an RGBA bitmap as an 8-bit RGBA PNG. */
export async function encodePNG(bitmap) {
  const { width, height, data } = bitmap;

  // scanlines with filter byte 0 (None)
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const source = y * width * 4;
    const target = y * (width * 4 + 1);
    raw[target] = 0;
    raw.set(data.subarray(source, source + width * 4), target + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
  return concat(parts);
}

/** Convenience wrapper returning a Blob. */
export async function pngBlob(bitmap) {
  return new Blob([await encodePNG(bitmap)], { type: "image/png" });
}
