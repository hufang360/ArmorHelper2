/**
 * Offline cache for the ArmorHelper web app.
 *
 * The site is pure static files, so a service worker is all it takes to make it
 * open with no network at all (the "offline / PWA" item in the requirements).
 * Everything the app needs to boot is precached; the bundled vanilla textures
 * (17 WebP atlas pages, ~290 KB) are cached on first use instead, so installing
 * the worker stays cheap on a phone.
 *
 * The cache name carries a fingerprint of the precached bytes, so a changed file
 * is never served from a stale cache.  `npm run sw:stamp` rewrites it; a test
 * fails when the stamp is out of date.  The old cache is dropped on activate.
 */

const FINGERPRINT = "745fc1dc88bc";
const CACHE = `armorhelper-${FINGERPRINT}`;

/** Everything needed to start the app; kept in sync by a test. */
const CORE = [
  "./",
  "index.html",
  "style.css",
  "vendor/bootstrap.min.css",
  "app.js",
  "app/chrome.js",
  "app/dom.js",
  "app/export.js",
  "app/folders.js",
  "app/gifs.js",
  "app/history.js",
  "app/i18n.js",
  "app/ids.js",
  "app/jobs.js",
  "app/pack.js",
  "app/result.js",
  "app/reverse.js",
  "app/sets.js",
  "app/sheets.js",
  "app/state.js",
  "app/template.js",
  "app/textures.js",
  "manifest.webmanifest",
  "data/armor_sets.json",
  "data/armor_sets_extra.json",
  "data/ArmorTemplate_overlay.png",
  "data/ArmorTemplate_v1.png",
  "data/i18n.json",
  "data/icon.png",
  "data/layout.json",
  "data/player/Player_0_0.png",
  "data/player/Player_0_1.png",
  "data/player/Player_0_10.png",
  "data/player/Player_0_3.png",
  "data/player/Player_0_7.png",
  "data/player/version.txt",
  "data/version.json",
  "js/atlas.js",
  "js/bitmap.js",
  "js/compose.js",
  "js/data.js",
  "js/fs.js",
  "js/generate.js",
  "js/gif.js",
  "js/idb.js",
  "js/png.js",
  "js/reverse.js",
  "js/sheets.js",
  "js/zip.js",
];

/** Bundled textures, fetched on demand and then kept. */
const RUNTIME_PREFIX = "data/vanilla/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Path relative to the worker's scope: GitHub Pages serves the site from a
  // sub folder (/<repo>/), so a hard-coded "/web/" prefix would never match.
  const scope = new URL(self.registration.scope).pathname;
  const path = (url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : url.pathname)
    .replace(/^\//, "");

  // `event.waitUntil` can only be called while the event is being dispatched,
  // so the cache refreshes below are plain floating promises.
  const remember = (response) => {
    if (!response.ok) return;
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  };

  // Cache first: an offline reload has to work, and the bytes are fingerprinted.
  // A hit is also refreshed in the background, so a deploy that forgot
  // `npm run sw:stamp` heals on the next load instead of sticking until the
  // reader clears the cache.  Offline that fetch fails and the hit stands.
  const ours = (name) => name.startsWith(RUNTIME_PREFIX) || CORE.includes(name) || name === "";

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) {
        if (ours(path)) fetch(request).then(remember).catch(() => {});
        return hit;
      }
      return fetch(request)
        .then((response) => {
          if (ours(path)) remember(response);
          return response;
        })
        .catch(async () => (await caches.match("index.html")) ?? Response.error());
    }),
  );
});
