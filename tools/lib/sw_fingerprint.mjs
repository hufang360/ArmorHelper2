/**
 * Content fingerprint of the files the service worker precaches.
 *
 * A hand-kept cache version rots silently: change `app.js`, forget the bump, and
 * every installed client keeps the old file until the user clears the cache.  So
 * the cache name is derived from the bytes instead.  `npm run sw:stamp` writes
 * it; `tests/node/site.test.mjs` recomputes it, so a forgotten stamp fails in
 * the second-long check instead of in a bug report.
 *
 * The file list comes from the worker's own `CORE` array, so the fingerprint
 * cannot disagree with what is actually cached.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The `CORE` entries, in the order `sw.js` lists them. */
export function coreEntries(source) {
  const match = /const CORE = \[([\s\S]*?)\];/.exec(source);
  if (!match) throw new Error("sw.js has no CORE list");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

/**
 * Twelve hex characters of sha256 over the precached files.
 *
 * Names are part of the digest, so a rename changes it too.  `"./"` is the
 * directory itself, which serves `index.html` and is not a file to hash.
 */
export function coreFingerprint(webDir, source = readFileSync(join(webDir, "sw.js"), "utf8")) {
  const hash = createHash("sha256");
  for (const name of coreEntries(source)) {
    if (name === "./") continue;
    hash.update(name).update("\0").update(readFileSync(join(webDir, name)));
  }
  return hash.digest("hex").slice(0, 12);
}
