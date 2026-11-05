#!/usr/bin/env node
/**
 * Rewrite the service worker's cache fingerprint.
 *
 * Run it after changing any file under `web/` that the worker precaches.  The
 * fingerprint is sha256 over those files, so a stale one means installed clients
 * keep the old bytes.  `tests/node/site.test.mjs` fails until this has run.
 *
 *     npm run sw:stamp
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { coreFingerprint } from "./lib/sw_fingerprint.mjs";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..", "web");
const path = join(WEB, "sw.js");
const source = readFileSync(path, "utf8");
const fingerprint = coreFingerprint(WEB, source);

const pattern = /const FINGERPRINT = "[^"]*";/;
if (!pattern.test(source)) throw new Error("sw.js has no FINGERPRINT constant");

const updated = source.replace(pattern, `const FINGERPRINT = "${fingerprint}";`);
writeFileSync(path, updated);
console.log(`sw.js 指纹 ${fingerprint}`);
