/**
 * The site has to work when it is *not* at the domain root.
 *
 * GitHub Pages serves a project site from `/<repo>/`, and people also drop this
 * folder into some subdirectory of their own server, so every asset has to be
 * requested relatively.  This test serves `web/` under a deep prefix and drives
 * the whole app there: boot, bundled atlas, reverse conversion and the service
 * worker registration (which must be scoped to the subdirectory, not to `/`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WEB } from "./lib/helpers.mjs";
import { findChrome, openInBrowser, serve } from "./lib/browser.mjs";

const chrome = findChrome();
const skip = chrome ? false : "no Chrome/Chromium available";
const PREFIX = "/some/deep/directory/";

test("the app works when it is served from a subdirectory", { skip }, async () => {
  const served = await serve(WEB, { harness: join(import.meta.dirname, "harness.html"), prefix: PREFIX });
  try {
    const payload = await openInBrowser(
      chrome,
      `${served.base}${PREFIX}__harness.html`,
      mkdtempSync(join(tmpdir(), "armorhelper-subpath-")),
      served,
    );

    assert.equal(payload.error, undefined, payload.error);
    // the page rebuilds its default set while booting, so the bar holds either
    assert.ok(
      payload.status.includes("就绪") || payload.status.includes("已还原"),
      payload.status,
    );
    assert.ok(payload.sets > 150, `${payload.sets} sets`);

    // the bundled atlas is fetched relatively: "data/vanilla/…", not "/data/…"
    assert.ok(payload.source.includes("内置"), payload.source);
    assert.ok(payload.source.includes("748"), payload.source);

    // a full rebuild, which needs the atlas pages *and* their index.json
    const reverse = payload.builtin;
    assert.equal(reverse.error, undefined, reverse.error);
    assert.deepEqual(reverse.files, ["ArmorTemplate_星尘板甲_190.png"]);
    // only the drawing template is an image: the animation is a player
    assert.equal(reverse.previews, 1);
    assert.equal(reverse.widths[0], 128 * 2);
    assert.equal(reverse.player.hidden, false);
    assert.deepEqual(reverse.player.canvas, [80, 112]);

    // the service worker is registered for the subdirectory, not for the root.
    // (`controlled` needs a reload after the first install, so it is only
    // reported, not asserted.)
    assert.equal(payload.serviceWorker.supported, true);
    assert.ok(payload.serviceWorker.scope.endsWith(PREFIX), payload.serviceWorker.scope);
    assert.ok(!payload.serviceWorker.scope.endsWith("//"), payload.serviceWorker.scope);

    // nothing may have escaped the prefix: every request stays inside it
    const outside = served.state.paths.filter((path) => !path.startsWith(PREFIX) && path !== "/favicon.ico");
    assert.deepEqual(outside, [], `requests outside ${PREFIX}: ${outside}`);
  } finally {
    await served.close();
  }
});
