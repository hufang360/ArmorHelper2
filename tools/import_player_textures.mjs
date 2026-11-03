#!/usr/bin/env node
/**
 * Bundle the three player textures the web app needs for "overlay player".
 *
 * The preview features draw the player's body under the armor, which needs
 *
 *     Player_0_3.png    360 x 224    torso
 *     Player_0_7.png    360 x 224    arms
 *     Player_0_10.png    40 x 1120   legs
 *
 * Browsers can only read a game folder on Chromium, so the site ships a copy as
 * well: on a phone (or Firefox / Safari) the overlay then works with no folder.
 *
 * Usage:
 *
 *     node tools/import_player_textures.mjs "/path/to/Content/Images"
 */

import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, "..", "web", "data", "player");
const PARTS = ["Player_0_3.png", "Player_0_7.png", "Player_0_10.png"];

function parseArgs(argv) {
  const args = { source: null, output: DEFAULT_OUT, version: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      console.log('usage: node tools/import_player_textures.mjs "<Content/Images>" [-o OUT] [--version X]');
      process.exit(0);
    }
    if (arg === "-o" || arg === "--output") args.output = resolve(argv[++index]);
    else if (arg === "--version") args.version = argv[++index];
    else if (!args.source) args.source = resolve(arg);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if (!args.source) throw new Error("missing <Content/Images>");
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  mkdirSync(args.output, { recursive: true });

  let total = 0;
  for (const name of PARTS) {
    const from = join(args.source, name);
    let size;
    try {
      size = statSync(from).size;
    } catch {
      console.error(`missing ${from}`);
      return 1;
    }
    copyFileSync(from, join(args.output, name));
    total += size;
    console.log(`copied ${name}  (${size} bytes)`);
  }

  const version = args.version || "terraria";
  writeFileSync(
    join(args.output, "version.txt"),
    "# Player body textures bundled for the web preview\n" +
      `version=${version}\n` +
      `count=${PARTS.length}\n` +
      `bytes=${total}\n`,
    "utf8",
  );
  console.log(`wrote ${join(args.output, "version.txt")}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
