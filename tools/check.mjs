/**
 * Fast structural check of the front end: syntax, duplicated definitions, and
 * dead i18n wiring.
 *
 * This exists because a bad edit once spliced a file in the middle of a
 * function: the module then had no syntax error at the damaged line, only a
 * misleading one at the last `await`, and two extra copies of everything.
 * Running this after every edit turns a 20-minute hunt into a one-line answer.
 *
 * Runs in about a second: `npm run check`.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = join(ROOT, "web");
const files = readdirSync(WEB)
  .filter((name) => name.endsWith(".js"))
  .map((name) => join(WEB, name));

const problems = [];
const scratch = mkdtempSync(join(tmpdir(), "armorhelper-check-"));

try {
  for (const path of files) {
    const name = path.slice(WEB.length + 1);
    // `node --check` needs the module extension, and `web/` ships `.js`
    const copy = join(scratch, `${name.replace(/\.js$/, "")}.mjs`);
    copyFileSync(path, copy);
    const result = spawnSync(process.execPath, ["--check", copy], { encoding: "utf8" });
    if (result.status !== 0) {
      const first = (result.stderr || "").split("\n").find((line) => line.includes(".mjs:"));
      problems.push(`${name}: ${first?.trim() ?? "does not parse"}`);
    }

    // A function or top-level binding may only be declared once. A duplicated
    // block is what a bad splice looks like, and it is invisible otherwise.
    const source = readFileSync(path, "utf8");
    const seen = new Map();
    for (const match of source.matchAll(/^(?:export )?(?:async )?function (\w+)|^(?:const|let) (\w+) =/gm)) {
      const symbol = match[1] ?? match[2];
      seen.set(symbol, (seen.get(symbol) ?? 0) + 1);
    }
    for (const [symbol, count] of seen) {
      if (count > 1) problems.push(`${name}: "${symbol}" is declared ${count} times`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}


/**
 * Names a browser build provides. Everything else must be declared or imported:
 * a call to a function that was never defined is legal JavaScript and only fails
 * at run time, which is exactly how `exportGif()` slipped through once.
 */
const GLOBALS = new Set([
  // language
  "Object", "Array", "String", "Number", "Boolean", "Math", "JSON", "Date", "Promise",
  "Map", "Set", "WeakMap", "URL", "URLSearchParams", "Intl", "RegExp", "Error", "TypeError",
  "Symbol", "BigInt", "Proxy", "Reflect", "ArrayBuffer", "Uint8Array", "Uint16Array",
  "Uint32Array", "Int32Array", "Float32Array", "DataView", "TextDecoder", "TextEncoder",
  "Blob", "File", "FileReader", "FormData",
  // browser
  "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage",
  "fetch", "atob", "btoa", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask", "structuredClone",
  "createImageBitmap", "ImageBitmap", "ImageData", "Image", "OffscreenCanvas", "CanvasRenderingContext2D",
  "ResizeObserver", "IntersectionObserver", "MutationObserver", "DataTransfer", "MouseEvent",
  "KeyboardEvent", "Event", "CustomEvent", "ResizeObserverEntry", "DOMParser", "Response", "Request",
  "Headers", "confirm", "alert", "prompt", "getComputedStyle", "matchMedia", "parseInt",
  "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "console",
  "Uint8ClampedArray", "SVGElement", "HTMLElement", "Element", "Node", "HTMLCanvasElement",
  // keywords that look like calls
  "if", "for", "while", "switch", "catch", "return", "typeof", "function", "new", "await",
  "delete", "void", "in", "of", "do", "else", "try", "finally", "case", "throw", "yield", "async",
]);

/** Remove comments and string contents, so only code remains. */
function strip(text) {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (text.startsWith("//", index)) {
      const end = text.indexOf("\n", index);
      index = end < 0 ? text.length : end;
      continue;
    }
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? text.length : end + 2;
      out += " ";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      index += 1;
      while (index < text.length) {
        if (text[index] === "\\") index += 2;
        else if (text[index] === quote) { index += 1; break; }
        else index += 1;
      }
      out += '""';
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Every name this file can call without a prefix. */
function declaredNames(code) {
  const names = new Set();
  for (const match of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  // `const [a, b] = ...` and destructured imports
  for (const match of code.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(":").pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  // import { a, b as c } from "..."
  for (const match of code.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const match of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(match[1]);
  return names;
}

/** Bare calls like `foo(` — method calls and `new foo(` do not count. */
function calledNames(code) {
  const names = new Set();
  for (const match of code.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(/g)) names.add(match[1]);
  return names;
}

// A call to a name that is never declared is a run-time failure waiting to happen.
for (const path of files) {
  const name = path.slice(WEB.length + 1);
  const code = strip(readFileSync(path, "utf8"));
  const declared = declaredNames(code);
  for (const called of calledNames(code)) {
    if (declared.has(called) || GLOBALS.has(called)) continue;
    problems.push(`${name}: "${called}()" is called but never declared`);
  }
}

// Every `t("key")` and every `data-i18n="key"` has to exist in i18n.json.
const messages = JSON.parse(readFileSync(join(WEB, "data", "i18n.json"), "utf8")).messages;
const known = new Set(Object.keys(messages.zh_CN));
const sources = [
  ...files.map((path) => readFileSync(path, "utf8")),
  readFileSync(join(WEB, "index.html"), "utf8"),
];
for (const text of sources) {
  for (const match of text.matchAll(/(?<![\w.$])t\(\s*["']([\w.]+)["']/g)) {
    if (!known.has(match[1])) problems.push(`missing translation: ${match[1]}`);
  }
  for (const match of text.matchAll(/data-i18n(?:-placeholder)?="([\w.]+)"/g)) {
    if (!known.has(match[1])) problems.push(`missing translation: ${match[1]}`);
  }
}

if (problems.length) {
  console.error(problems.map((problem) => `bad  ${problem}`).join("\n"));
  process.exit(1);
}
console.log(`ok   ${files.length} scripts parse, no duplicates, every key resolves`);
