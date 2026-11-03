#!/usr/bin/env node
/**
 * Static file server for the site — the same job `python3 -m http.server` used
 * to do, so the toolchain has no Python left in it.
 *
 *     node tools/serve.mjs            # http://127.0.0.1:8000/
 *     node tools/serve.mjs web 3000
 */

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const [rootArg = "web", portArg = "8000"] = process.argv.slice(2);
const root = resolve(fileURLToPath(import.meta.url), "..", "..", rootArg);
const port = Number(portArg) || 8000;

const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  let relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  // `normalize("")` is "." — that is the folder itself, i.e. its index.html
  if (relative === "" || relative === "." || relative === "./") relative = "index.html";
  const path = join(root, relative);

  if (!path.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }

  let stats;
  try {
    stats = statSync(path);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
    return;
  }
  if (stats.isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
    return;
  }

  response.writeHead(200, {
    "content-type": MIME[extname(path)] ?? "application/octet-stream",
    "content-length": stats.size,
    // development server: never serve a stale module while editing
    "cache-control": "no-store",
  });
  createReadStream(path).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}/`);
});
