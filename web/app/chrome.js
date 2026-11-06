/**
 * The page around the tools: the header, the language switch, the guide layer
 * and the offline cache.
 *
 * `applyI18n()` is the one function that knows every renderer by name: it
 * redraws the whole page in the new language.  That is why it lives here and not
 * in the renderers themselves — they must not depend on each other's order.
 */

import { $, $$, on, say } from "./dom.js";
import { setMessages, t } from "./i18n.js";
import { saveConfig, state } from "./state.js";
import { renderFiles, renderGuideToggle, renderTooltips } from "./template.js";
import { renderSlots } from "./sheets.js";
import { renderFolders } from "./folders.js";
import { renderHistory } from "./history.js";
import { renderPlayerInfo } from "./gifs.js";
import { renderReversePreviewOptions } from "./reverse.js";
import { showResult, syncResultHeights } from "./result.js";
import { decodeBitmap } from "../js/fs.js";

/** The release version shown in the header; one file, so the build has none. */
const VERSION_FILE = "data/version.json";

/** The wiki page that lists every armor ID, per interface language. */
const WIKI_ARMOR_IDS = {
  zh_CN: "https://terraria.wiki.gg/zh/wiki/Armor_IDs",
  en: "https://terraria.wiki.gg/wiki/Armor_IDs",
};

/** Re-render every bit of text after a language switch. */
export function applyI18n() {
  document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
  for (const el of $$("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of $$("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  // icons and unlabelled controls carry their name in `aria-label` only
  for (const el of $$("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset.i18nLabel));
  // the wiki exists in both languages: send the reader to his own
  const wiki = $("#wiki-link");
  if (wiki) wiki.href = WIKI_ARMOR_IDS[state.language] ?? WIKI_ARMOR_IDS.zh_CN;
  // the switch names the language it moves to, not the one it is in
  const language = $("#language");
  if (language) language.textContent = state.language === "en" ? "中" : "En";
  renderTooltips();
  renderGuideToggle();
  renderFiles();
  renderSlots();
  renderFolders();
  renderHistory();
  // the sentences of the players' info icons are dynamic, so they need a rerun
  renderPlayerInfo();
  renderReversePreviewOptions();
  renderAbout();
  // redraw the result cards: their captions and buttons are translated too
  for (const [panel, result] of Object.entries(state.results)) {
    if (result) showResult(panel, result);
  }
  syncResultHeights();
}

/* --------------------------------------------------------- long tasks -- */

/** Load the optional guide layer; missing or broken files are not an error. */
export async function loadGuideOverlay() {
  try {
    const response = await fetch("data/ArmorTemplate_overlay.png");
    if (!response.ok) return null;
    return await decodeBitmap(await response.blob());
  } catch {
    return null;
  }
}

/** Register the offline cache; a static host without HTTPS just skips it. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker
    .register("sw.js")
    .then(() => {
      // Mention it in the about line: the status bar belongs to the app.
      state.offlineReady = true;
      const about = $("#about");
      if (about) about.textContent = `${about.textContent} · ${t("web.offlineReady")}`;
    })
    .catch((error) => console.debug("offline cache unavailable", error));
}

export async function loadMessages(language) {
  const response = await fetch("data/i18n.json");
  const payload = await response.json();
  return payload.messages[language] ?? payload.messages.zh_CN;
}

/* ----------------------------------------------------------------- boot -- */

/** The footer line: the release and, when bundled, the vanilla texture pack. */
export function renderAbout() {
  const about = $("#about");
  if (!about) return;
  const vars = { version: state.version, vanilla: state.builtin?.version ?? "", count: state.builtin?.count ?? 0 };
  about.textContent = state.builtin ? t("web.aboutBuiltin", vars) : t("web.about", vars);
}

/** Show the release version from `data/version.json` in the header. */
export async function showAppVersion() {
  const badge = $("#app-version");
  if (!badge) return;
  try {
    const response = await fetch(VERSION_FILE);
    if (!response.ok) throw new Error(`cannot load ${VERSION_FILE}: ${response.status}`);
    const info = await response.json();
    state.release = info.version ?? "";
    badge.textContent = state.release ? `v${state.release}` : "";
    badge.title = `${info.name ?? "ArmorHelper"} ${state.release}`.trim();
  } catch (error) {
    // a missing version file must not stop the page
    console.error(error);
  }
}

/** Bind the controls this module owns. */
export function bindChrome() {
for (const tab of $$(".tab")) {
  tab.addEventListener("click", () => {
    for (const other of $$(".tab")) other.classList.toggle("active", other === tab);
    for (const panel of $$(".panel")) panel.classList.toggle("active", panel.id === `tab-${tab.dataset.tab}`);
  });
}

// one button, two languages: its label names the one it switches to
on("#language", "click", async () => {
  state.language = state.language === "en" ? "zh_CN" : "en";
  setMessages(await loadMessages(state.language));
  saveConfig();
  applyI18n();
  say(t("web.saved"));
});
}
