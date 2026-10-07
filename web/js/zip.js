/**
 * Minimal ZIP writer (stored entries, no compression).
 *
 * The sheets are PNGs, which are already compressed, so storing them costs
 * nothing and keeps this file short.  Paths keep their sub folders, so a
 * vanilla-named export unpacks straight into `Content/Images`.
 */

import { crc32 } from "./png.js";

const encoder = new TextEncoder();

function short(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

function long(value) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return encoder.encode(data);
  throw new Error("unsupported entry type");
}

function join(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

/**
 * Build a zip from `[{ name, data }]`.
 *
 * `name` may contain `/`; `data` is a Uint8Array, ArrayBuffer or string.
 */
export function createZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate =
    ((Math.max(0, now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = toBytes(entry.data);
    const crc = crc32(data);

    const header = new Uint8Array([
      ...long(0x04034b50),
      ...short(20), // version needed
      ...short(0x0800), // UTF-8 names
      ...short(0), // stored
      ...short(dosTime),
      ...short(dosDate),
      ...long(crc),
      ...long(data.length),
      ...long(data.length),
      ...short(name.length),
      ...short(0),
    ]);
    parts.push(header, name, data);

    central.push(
      join([
        new Uint8Array([
          ...long(0x02014b50),
          ...short(20), // version made by
          ...short(20), // version needed
          ...short(0x0800),
          ...short(0),
          ...short(dosTime),
          ...short(dosDate),
          ...long(crc),
          ...long(data.length),
          ...long(data.length),
          ...short(name.length),
          ...short(0),
          ...short(0),
          ...short(0),
          ...short(0),
          ...long(0),
          ...long(offset),
        ]),
        name,
      ]),
    );
    offset += header.length + name.length + data.length;
  }

  const centralBytes = join(central);
  parts.push(centralBytes);
  parts.push(
    new Uint8Array([
      ...long(0x06054b50),
      ...short(0),
      ...short(0),
      ...short(entries.length),
      ...short(entries.length),
      ...long(centralBytes.length),
      ...long(offset),
      ...short(0),
    ]),
  );

  return join(parts);
}

export function zipBlob(entries) {
  return new Blob([createZip(entries)], { type: "application/zip" });
}
