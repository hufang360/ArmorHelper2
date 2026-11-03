/**
 * Browser plumbing for the end-to-end tests: serve `web/` the way a static host
 * would, drive headless Chrome, and read the zip the app produces.
 *
 * No dependencies: `node:http` for the server, `node:child_process` for Chrome.
 * The harness page (`harness.html`) loads the app in an iframe, drives it and
 * POSTs its findings back to `/__done`, so the test waits on a real HTTP signal
 * instead of sleeping.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serve `root` plus the harness routes.
 *
 * HTTP/1.1 keep-alive matters: the page pulls a dozen modules and the bundled
 * textures, and the HTTP/1.0 default makes Chrome reopen the socket each time
 * (that alone used to make one run in four hang for 40 seconds).
 */
export function serve(root, { harness = null, prefix = "/" } = {}) {
  const state = { paths: [], done: null, payload: null, waiters: [] };
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const harnessUrl = `${base}__harness.html`;
  const doneUrl = `${base}__done`;

  const server = createServer((request, response) => {
    state.paths.push(request.url);

    if (request.method === "POST" && request.url.startsWith(doneUrl)) {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        state.payload = Buffer.concat(chunks).toString("utf8");
        state.done = true;
        for (const waiter of state.waiters.splice(0)) waiter();
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ok");
      });
      return;
    }

    const url = new URL(request.url, "http://localhost");
    if (harness && url.pathname === harnessUrl) {
      const body = readFileSync(harness);
      response.writeHead(200, { "content-type": MIME[".html"], "content-length": body.length });
      response.end(body);
      return;
    }

    // Files live under `base`, so the same folder can be mounted anywhere —
    // this is how GitHub Pages serves it (/<repo>/…).
    if (!url.pathname.startsWith(base)) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    let relative = normalize(decodeURIComponent(url.pathname.slice(base.length))).replace(/^([/\\])+/, "");
    // `normalize("")` is "." — that is the folder itself, i.e. its index.html
    if (relative === "" || relative === "." || relative === "./") relative = "index.html";
    const path = join(root, relative);
    if (!path.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }

    let body;
    try {
      body = readFileSync(path);
    } catch {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    if (statSync(path).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[extname(path)] ?? "application/octet-stream",
      "content-length": body.length,
    });
    response.end(body);
  });

  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      done({
        base: `http://127.0.0.1:${port}`,
        state,
        waitForReport: (timeoutMs) =>
          new Promise((resolveReport, rejectReport) => {
            if (state.done) return resolveReport();
            const timer = setTimeout(() => {
              rejectReport(new Error(`the page never reported back; requests=${state.paths.join(", ")}`));
            }, timeoutMs);
            state.waiters.push(() => {
              clearTimeout(timer);
              resolveReport();
            });
          }),
        close: () => new Promise((stop) => server.close(stop)),
      });
    });
  });
}

export function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ];
  for (const candidate of candidates) {
    if (candidate.includes("/")) {
      try {
        statSync(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
    for (const directory of (process.env.PATH ?? "").split(":")) {
      const path = join(directory, candidate);
      try {
        statSync(path);
        return path;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/**
 * Open `url` in headless Chrome, wait for the harness to report, and close the
 * browser again — including every helper process it spawned.
 */
export async function openInBrowser(chrome, url, workdir, served) {
  const profile = join(workdir, "chrome-profile");
  const downloads = join(workdir, "downloads");
  mkdirSync(join(profile, "Default"), { recursive: true });
  mkdirSync(downloads, { recursive: true });
  // Downloads land in the test's temp folder instead of the user's ~/Downloads.
  writeFileSync(
    join(profile, "Default", "Preferences"),
    JSON.stringify({
      download: { default_directory: downloads, prompt_for_download: false },
      savefile: { default_directory: downloads },
    }),
  );

  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      `--user-data-dir=${profile}`,
      url,
    ],
    { stdio: "ignore", detached: true },
  );

  try {
    await served.waitForReport(120_000);
  } finally {
    try {
      process.kill(-child.pid, "SIGTERM"); // the whole process group
    } catch {
      child.kill("SIGTERM");
    }
    await new Promise((stopped) => {
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
        stopped();
      }, 30_000);
      child.on("exit", () => {
        clearTimeout(timer);
        stopped();
      });
    });
  }

  if (!served.state.payload) throw new Error("the page reported nothing");
  return JSON.parse(served.state.payload);
}

/**
 * Read a zip written by `web/js/zip.js` (stored entries only, no compression).
 * Returns `[{ name, data }]` so tests can inspect names and bytes.
 */
export function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const entries = [];
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const signature = readUInt32(bytes, offset);
    if (signature !== 0x04034b50) break; // only local file headers matter here

    const compression = readUInt16(bytes, offset + 8);
    if (compression !== 0) throw new Error("compressed zip entries are not supported");

    const size = readUInt32(bytes, offset + 18);
    const nameLength = readUInt16(bytes, offset + 26);
    const extraLength = readUInt16(bytes, offset + 28);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    entries.push({ name, data: bytes.subarray(start, start + size) });
    offset = start + size;
  }

  return entries;
}

function readUInt16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32(bytes, offset) {
  return (
    ((bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0)
  );
}
