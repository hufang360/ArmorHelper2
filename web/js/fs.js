/**
 * Browser plumbing: decoding uploads, saving downloads and the optional
 * File System Access API support (Chromium lets a page read and write a real
 * folder the user picked, which is how the web version can drop sheets
 * straight into the game's Content/Images).
 */

import { createBitmap } from "./bitmap.js";

/** Decode a Blob/File into an RGBA bitmap without any colour management. */
export async function decodeBitmap(blob) {
  let source;
  if (typeof createImageBitmap === "function") {
    source = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  } else {
    source = await decodeViaImage(blob);
  }
  // `close()` zeroes width/height, so remember them first.
  const width = source.width;
  const height = source.height;
  if (!width || !height) throw new Error("could not decode the image");

  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0);
  if (source.close) source.close();
  const image = context.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8ClampedArray(image.data) };
}

function decodeViaImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    image.src = url;
  });
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Render a bitmap into a canvas so it can be shown in the page. */
export function bitmapToCanvas(bitmap) {
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  const image = context.createImageData(bitmap.width, bitmap.height);
  image.data.set(bitmap.data);
  context.putImageData(image, 0, 0);
  if (canvas.convertToBlob) {
    // OffscreenCanvas cannot be inserted into the DOM, so hand back a data URL.
    return canvas;
  }
  return canvas;
}

export function bitmapToDataURL(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(bitmap.width, bitmap.height);
  image.data.set(bitmap.data);
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------- File System Access API -- */

export const canUseFolders = typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function pickFolder(id = "read") {
  if (!canUseFolders) return null;
  try {
    return await window.showDirectoryPicker({ id, mode: id === "readwrite" ? "readwrite" : "read" });
  } catch {
    return null; // the user cancelled
  }
}

/** Read `path` (a `/` separated relative path) from a directory handle. */
export async function readFromFolder(root, path) {
  const parts = path.split("/").filter(Boolean);
  let handle = root;
  for (const part of parts.slice(0, -1)) {
    handle = await handle.getDirectoryHandle(part, { create: false });
  }
  const file = await handle.getFileHandle(parts.at(-1), { create: false });
  return file.getFile();
}

export async function existsInFolder(root, path) {
  try {
    await readFromFolder(root, path);
    return true;
  } catch {
    return false;
  }
}

/** Write `blob` to `path` inside `root`, creating sub folders as needed. */
export async function writeToFolder(root, path, blob) {
  const parts = path.split("/").filter(Boolean);
  let handle = root;
  for (const part of parts.slice(0, -1)) {
    handle = await handle.getDirectoryHandle(part, { create: true });
  }
  const file = await handle.getFileHandle(parts.at(-1), { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
}

/* ------------------------------------------------------------ storage ---- */

export function loadJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export { createBitmap };
