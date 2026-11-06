/**
 * GIF settings and the 20 frame player next to the drop area.
 *
 * The player is a canvas, not an <img> GIF: the transport buttons have to stop
 * it on one frame, and the exported GIF has to run in the same order and at the
 * same delay, so both read their timing from here.
 *
 * The two pages keep their own speed and size — see `exportGif()`.
 */

import { $, on } from "./dom.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import { stackFrames, upscale } from "../js/bitmap.js";
import { gifFrameOrder } from "../js/compose.js";
import { gifBlob } from "../js/gif.js";
import { pngBlob } from "../js/png.js";

/** Per-frame delay of the three GIF speeds offered in the UI. */
const GIF_SPEEDS = { fast: 100, medium: 500, slow: 1000 };

/* ------------------------------------------------------- full-body GIFs -- */

/** Per-frame delay of one page's GIF speed choice (fast / medium / slow). */
export function gifDelay(speed = "fast") {
  return GIF_SPEEDS[speed] ?? GIF_SPEEDS.fast;
}

/** The GIF scale chosen in the UI: 1, 2 or 4. */
function gifScale(size = 1) {
  const value = Math.floor(Number(size) || 1);
  return value > 1 ? value : 1;
}

/** Frames as they go into the GIF: nearest-neighbour scaled to the chosen size. */
export function gifFrames(frames, size = 1) {
  const factor = gifScale(size);
  return factor > 1 ? frames.map((frame) => upscale(frame, factor)) : frames;
}

/** Encode a GIF with the current speed, size and frame order. */
export function makeGif(frames, speed = "fast", size = 1) {
  return gifBlob(gifFrames(frames, size), { order: gifFrameOrder(), delayMs: gifDelay(speed) });
}

/**
 * The export page owns its GIF settings.
 *
 * The speed and size selects live on the preview-sheets tab, which the user
 * cannot see from here, so sharing them would look like a bug.
 */
export const exportGif = () => ({
  speed: state.config.exportGifSpeed ?? "fast",
  size: state.config.exportGifSize ?? 2,
});

/**
 * The 20 frame animations, one per page.
 *
 * They are drawn on a canvas rather than shown as a GIF, because the transport
 * buttons have to stop them on one frame.  The order and the delay are the ones
 * an exported GIF uses, so the two run in step.  The export page and the
 * preview-sheets page each own one, and neither touches the other's settings.
 */
const PLAYER_IDS = {
  export: {
    canvas: "#preview-gif",
    play: "#gif-play",
    icon: "#gif-play-icon",
    prev: "#gif-prev",
    next: "#gif-next",
    count: "#gif-count",
    link: "#export-preview-file",
    info: "#export-preview-info",
  },
  reverse: {
    canvas: "#rev-preview-gif",
    play: "#rev-gif-play",
    icon: "#rev-gif-play-icon",
    prev: "#rev-gif-prev",
    next: "#rev-gif-next",
    count: "#rev-gif-count",
    link: "#rev-preview-file",
    info: "#rev-preview-info",
  },
  sheet: {
    canvas: "#sheet-preview-gif",
    play: "#sheet-gif-play",
    icon: "#sheet-gif-play-icon",
    prev: "#sheet-gif-prev",
    next: "#sheet-gif-next",
    count: "#sheet-gif-count",
    link: "#sheet-preview-file",
    info: "#sheet-preview-info",
  },
};

/** One player: the frame list, the step it is on, and its timer. */
function makePlayer(ids) {
  const player = { frames: [], order: [], delay: 100, step: 0, timer: null, run: 0 };

  const draw = () => {
    const canvas = $(ids.canvas);
    const frame = player.frames[player.order[player.step]];
    if (!canvas || !frame) return;
    if (canvas.width !== frame.width) canvas.width = frame.width;
    if (canvas.height !== frame.height) canvas.height = frame.height;
    const context = canvas.getContext("2d");
    const image = context.createImageData(frame.width, frame.height);
    image.data.set(frame.data);
    context.putImageData(image, 0, 0);
    const count = $(ids.count);
    if (count) count.textContent = `${player.step + 1}/${player.order.length}`;
    const play = $(ids.play);
    if (play) play.setAttribute("aria-pressed", player.timer ? "true" : "false");
    const icon = $(ids.icon);
    if (icon) {
      icon.setAttribute("d", player.timer ? "M5 3.5h2.5v9H5zm3.5 0H11v9H8.5z" : "M5 3.5v9l7-4.5z");
    }
  };

  /** Restart the loop from the current step, with the current delay. */
  const schedule = () => {
    clearTimeout(player.timer);
    player.timer = null;
    if (!player.order.length) return;
    player.timer = setTimeout(function tick() {
      player.step = (player.step + 1) % player.order.length;
      draw();
      player.timer = setTimeout(tick, player.delay);
    }, player.delay);
    draw();
  };

  const playing = () => player.timer !== null;

  const play = (on) => {
    if (on === playing()) return;
    if (on) {
      schedule();
      return;
    }
    clearTimeout(player.timer);
    player.timer = null;
    draw();
  };

  const step = (delta) => {
    const total = player.order.length;
    if (!total) return;
    play(false);
    player.step = (player.step + delta + total) % total;
    draw();
  };

  /** Show 20 frames of `frames` at the chosen size and speed; `null` clears it. */
  const set = (frames, speed, size) => {
    const canvas = $(ids.canvas);
    if (!canvas) return;
    clearTimeout(player.timer);
    player.timer = null;
    player.frames = frames ? gifFrames(frames, size) : [];
    player.order = frames ? gifFrameOrder() : [];
    player.delay = gifDelay(speed);
    player.step = 0;
    player.run += 1;
    canvas.dataset.render = String(player.run);
    canvas.hidden = !frames;
    // the box and its options only exist while there is an animation to show
    const box = canvas.closest(".preview-box");
    if (box) box.hidden = !frames;
    if (!frames) {
      const count = $(ids.count);
      if (count) count.textContent = "0/0";
      return;
    }
    play(true);
  };

  const bind = () => {
    on(ids.play, "click", () => play(!playing()));
    on(ids.prev, "click", () => step(-1));
    on(ids.next, "click", () => step(1));
  };

  return { set, bind };
}

const players = {
  export: makePlayer(PLAYER_IDS.export),
  reverse: makePlayer(PLAYER_IDS.reverse),
  sheet: makePlayer(PLAYER_IDS.sheet),
};

/** Show the export page's animation; `null` clears it. */
export function setPreviewGif(frames, speed, size) {
  players.export.set(frames, speed, size);
}

/** Show the template page's animation; `null` clears it. */
export function setReversePreview(frames, speed, size) {
  players.reverse.set(frames, speed, size);
}

/** Show the preview-sheets page's animation; `null` clears it. */
export function setSheetPreview(frames, speed, size) {
  players.sheet.set(frames, speed, size);
}

/**
 * Say what the PNG under a player holds, in the reader's language.
 *
 * Both pages show the same sentence, so it is written for every info icon at
 * once; a language switch only has to call this again.
 */
export function renderPlayerInfo() {
  const text = t("web.playerFileInfo", {
    desc: t("web.sheetDesc.full"),
    count: gifFrameOrder().length,
  });
  for (const ids of Object.values(PLAYER_IDS)) {
    const info = ids.info ? $(ids.info) : null;
    if (!info) continue;
    info.dataset.tooltip = text;
    info.setAttribute("aria-label", text);
  }
}

/** The PNG each link was given, and the run that wrote it. */
const playerFiles = new Map();
/** Counts every call, so the newest one wins even when two run at once. */
let playerFileRun = 0;

/**
 * Point the link under a player at the PNG of the frames on screen.
 *
 * The file is encoded here: the page hands out what the animation shows, and
 * the name says which variant it is.  A slower, earlier call is dropped.
 */
export async function showPlayerFile(page, name, frames) {
  const ids = PLAYER_IDS[page];
  const link = ids?.link ? $(ids.link) : null;
  if (!link) return;
  const run = (playerFileRun += 1);
  const url = URL.createObjectURL(await pngBlob(stackFrames(frames)));
  // a slower, earlier call must not replace the newer picture
  if (run !== playerFileRun) {
    URL.revokeObjectURL(url);
    return;
  }
  const previous = playerFiles.get(page)?.url;
  if (previous) URL.revokeObjectURL(previous);
  playerFiles.set(page, { run, url });
  link.href = url;
  link.download = name;
  link.textContent = name;
  link.hidden = false;
}

/** Bind the transport buttons of both players. */
export function bindPlayer() {
  players.export.bind();
  players.reverse.bind();
  players.sheet.bind();
}
