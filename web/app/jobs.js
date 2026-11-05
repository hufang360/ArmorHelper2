/**
 * The progress bar, the cancel button and the job state behind them.
 *
 * A long job (thousands of sheets) calls `startJob()` once, `jobProgress()` per
 * step and `endJob()` in a `finally`.  `jobCancelled()` is what the loops poll:
 * cancelling never interrupts a step in flight, it only stops the next one.
 */

import { $, on, say } from "./dom.js";
import { t } from "./i18n.js";
import { state } from "./state.js";

function setProgress(bar, done, total) {
  const percent = Math.round((done / Math.max(1, total)) * 100);
  const fill = bar.firstElementChild;
  if (fill) fill.style.width = `${percent}%`;
  bar.setAttribute("aria-valuenow", String(percent));
}

/** Begin a task with `total` steps: shows the progress bar and cancel button. */
export function startJob(total) {
  state.job = { cancelled: false, done: 0, total };
  const bar = $("#job-bar");
  const cancel = $("#cancel-job");
  const long = total > 1;
  if (bar) {
    bar.hidden = !long;
    setProgress(bar, 0, total);
  }
  if (cancel) {
    cancel.hidden = !long;
    cancel.disabled = false;
  }
}

/** Say what step we are on; `index` is 0-based. */
export function jobProgress(index, name) {
  if (!state.job) return;
  state.job.done = index;
  const bar = $("#job-bar");
  if (bar) setProgress(bar, index, state.job.total);
  say(
    t("web.progress", {
      index: Math.min(index + 1, state.job.total),
      total: state.job.total,
      name,
    }),
    "busy",
  );
}

/** True once the user pressed cancel: the loop stops at its next step. */
export function jobCancelled() {
  return !!state.job?.cancelled;
}

/** Hide the bar, reset the buttons and hand back the finished job. */
export function endJob() {
  const job = state.job;
  state.job = null;
  const bar = $("#job-bar");
  const cancel = $("#cancel-job");
  if (bar) {
    bar.hidden = true;
    setProgress(bar, 0, job?.total ?? 1);
  }
  if (cancel) cancel.hidden = true;
  return job;
}

export function cancelJob() {
  if (!state.job) return;
  state.job.cancelled = true;
  const cancel = $("#cancel-job");
  if (cancel) cancel.disabled = true;
  say(t("web.cancelling"), "warn");
}

/** Let the browser repaint, so the progress text is actually visible. */
export function nextFrame() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Bind the cancel button. The bar and the text are driven by the job itself. */
export function bindCancel() {
  on("#cancel-job", "click", cancelJob);
}
