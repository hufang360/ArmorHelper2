/**
 * Thin DOM helpers shared by `app.js` and the `app/` modules.
 *
 * `on()` records a selector that the page does not provide instead of throwing,
 * so a half-updated `index.html` (an old cached copy, say) still boots and the
 * status bar can name the missing elements.  That list is why this module, not
 * `app.js`, owns it.
 */

export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const missingElements = [];

/** Bind a listener, tolerating a missing element instead of aborting boot. */
export function on(selector, event, handler) {
  const element = $(selector);
  if (!element) {
    missingElements.push(selector);
    return null;
  }
  element.addEventListener(event, handler);
  return element;
}

/** Selectors `on()` could not find, in the order the code asked for them. */
export function missing() {
  return missingElements;
}

/** Record a selector the page should have provided but did not. */
export function noteMissing(selector) {
  missingElements.push(selector);
}

/** Write one line into the status bar. */
export function say(message, kind = "ok") {
  const el = $("#status");
  el.textContent = message;
  el.className = kind;
}
