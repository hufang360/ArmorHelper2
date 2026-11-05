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
import { state } from "./state.js";
import { upscale } from "../js/bitmap.js";
import { gifFrameOrder } from "../js/compose.js";
import { gifBlob } from "../js/gif.js";

/** Per-frame delay of the three GIF speeds offered in the UI. */
const GIF_SPEEDS = { fast: 100, medium: 500, slow: 1000 };

/* ------------------------------------------------------- full-body GIFs -- */

/** Per-frame delay of one page's GIF speed choice (fast / medium / slow). */
export function gifDelay(speed = state.config.gifSpeed) {
  return GIF_SPEEDS[speed] ?? GIF_SPEEDS.fast;
}

/** The GIF scale chosen in the UI: 1, 2 or 4. */
function gifScale(size = state.config.gifSize) {
  const value = Math.floor(Number(size) || 1);
  return value > 1 ? value : 1;
}

/** Frames as they go into the GIF: nearest-neighbour scaled to the chosen size. */
export function gifFrames(frames, size = state.config.gifSize) {
  const factor = gifScale(size);
  return factor > 1 ? frames.map((frame) => upscale(frame, factor)) : frames;
}

/** Encode a GIF with the current speed, size and frame order. */
export function makeGif(frames, speed = state.config.gifSpeed, size = state.config.gifSize) {
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
 * The 20 frame animation that sits next to the drop area.
 *
 * It is drawn on a canvas rather than shown as a GIF, because the transport
 * buttons have to stop it on one frame.  The order and the delay are the ones
 * the exported GIF uses, so the two run in step.
 */
const previewPlayer = { frames: [], order: [], delay: 100, step: 0, timer: null, run: 0 };

function drawPreviewFrame() {
  const canvas = $("#preview-gif");
  const frame = previewPlayer.frames[previewPlayer.order[previewPlayer.step]];
  if (!canvas || !frame) return;
  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(frame.width, frame.height);
  image.data.set(frame.data);
  context.putImageData(image, 0, 0);
  const count = $("#gif-count");
  if (count) count.textContent = `${previewPlayer.step + 1}/${previewPlayer.order.length}`;
  const play = $("#gif-play");
  if (play) play.setAttribute("aria-pressed", previewPlayer.timer ? "true" : "false");
  const icon = $("#gif-play-icon");
  if (icon) {
    icon.setAttribute(
      "d",
      previewPlayer.timer ? "M5 3.5h2.5v9H5zm3.5 0H11v9H8.5z" : "M5 3.5v9l7-4.5z",
    );
  }
}

/** Restart the loop from the current step, with the current delay. */
function schedulePreview() {
  clearTimeout(previewPlayer.timer);
  previewPlayer.timer = null;
  if (!previewPlayer.order.length) return;
  previewPlayer.timer = setTimeout(function tick() {
    previewPlayer.step = (previewPlayer.step + 1) % previewPlayer.order.length;
    drawPreviewFrame();
    previewPlayer.timer = setTimeout(tick, previewPlayer.delay);
  }, previewPlayer.delay);
  drawPreviewFrame();
}

/** True while the animation loop is running. */
export function previewPlaying() {
  return previewPlayer.timer !== null;
}

export function playPreview(on) {
  if (on === !!previewPlayer.timer) return;
  if (on) schedulePreview();
  else {
    clearTimeout(previewPlayer.timer);
    previewPlayer.timer = null;
    drawPreviewFrame();
  }
}

export function stepPreview(delta) {
  const total = previewPlayer.order.length;
  if (!total) return;
  playPreview(false);
  previewPlayer.step = (previewPlayer.step + delta + total) % total;
  drawPreviewFrame();
}

/** Show 20 frames of `frames` at the chosen size and speed; `null` clears it. */
export function setPreviewGif(frames, speed, size) {
  const canvas = $("#preview-gif");
  if (!canvas) return;
  clearTimeout(previewPlayer.timer);
  previewPlayer.timer = null;
  previewPlayer.frames = frames ? gifFrames(frames, size) : [];
  previewPlayer.order = frames ? gifFrameOrder() : [];
  previewPlayer.delay = gifDelay(speed);
  previewPlayer.step = 0;
  previewPlayer.run += 1;
  canvas.dataset.render = String(previewPlayer.run);
  canvas.hidden = !frames;
  // the box and its options only exist while there is an animation to show
  const box = canvas.closest(".preview-box");
  if (box) box.hidden = !frames;
  if (!frames) {
    const count = $("#gif-count");
    if (count) count.textContent = "0/0";
    return;
  }
  playPreview(true);
}

/** Bind the controls this module owns. */
export function bindPlayer() {
on("#gif-play", "click", () => playPreview(!previewPlaying()));
on("#gif-prev", "click", () => stepPreview(-1));
on("#gif-next", "click", () => stepPreview(1));
}
