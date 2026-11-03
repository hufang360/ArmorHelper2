/**
 * Offline cache for the ArmorHelper web app.
 *
 * The site is pure static files, so a service worker is all it takes to make it
 * open with no network at all (the "offline / PWA" item in the requirements).
 * Everything the app needs to boot is precached; the bundled vanilla textures
 * (17 WebP atlas pages, ~290 KB) are cached on first use instead, so installing
 * the worker stays cheap on a phone.
 *
 * Bump `VERSION` whenever the files below change; the old cache is dropped on
 * activate.
 */

const VERSION = "2.2.2";
const CACHE = `armorhelper-${VERSION}`;

/** Everything needed to start the app; kept in sync by a test. */
const CORE = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.webmanifest",
  "data/icon.png",
  "data/layout.json",
  "data/armor_sets.json",
  "data/i18n.json",
  "data/ArmorTemplate_v1.png",
  "data/ArmorTemplate_overlay.png",
  "data/player/version.txt",
  "data/player/Player_0_3.png",
  "data/player/Player_0_7.png",
  "data/player/Player_0_10.png",
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

  // Cache first: an offline reload has to work, and the files are versioned.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) {
        // Refresh bundled textures in the background; they are the big files.
        if (path.startsWith(RUNTIME_PREFIX)) {
          fetch(request).then(remember).catch(() => {});
        }
        return hit;
      }
      return fetch(request)
        .then((response) => {
          if (path.startsWith(RUNTIME_PREFIX) || CORE.includes(path)) remember(response);
          return response;
        })
        .catch(async () => (await caches.match("index.html")) ?? Response.error());
    }),
  );
});
