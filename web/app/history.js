/**
 * The "recent exports" list, kept in localStorage.
 *
 * An entry is `{ at, title, files, thumb }`: a timestamp, what was exported, how
 * many files, and a small data URL.  The list is a convenience, so every storage
 * failure is swallowed — a full quota must never fail an export.
 */

import { $, say } from "./dom.js";
import { t } from "./i18n.js";

const HISTORY_KEY = "armorhelper.history";
const HISTORY_LIMIT = 20;

function loadHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(stored) ? stored.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
  } catch {
    /* The history is a nicety; never fail an export because of the quota. */
  }
}

/** Remember one export: when, what, how many files, plus a small thumbnail. */
export function addHistory(title, files, thumbnail) {
  const entries = loadHistory();
  entries.unshift({ at: Date.now(), title, files: files.length, thumb: thumbnail ?? null });
  saveHistory(entries);
  renderHistory();
}

function formatTime(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function renderHistory() {
  const list = $("#history-list");
  if (!list) return;
  const entries = loadHistory();
  // nothing recorded yet: the button would open an empty panel
  const toggle = $("#history-toggle");
  if (toggle) toggle.disabled = entries.length === 0;
  list.innerHTML = "";
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "text-body-secondary small";
    li.textContent = t("web.historyEmpty");
    list.append(li);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    if (entry.thumb) {
      const img = document.createElement("img");
      img.src = entry.thumb;
      img.alt = "";
      img.className = "pixel";
      li.append(img);
    }
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = formatTime(entry.at);
    const what = document.createElement("span");
    what.className = "what";
    what.textContent = entry.title;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = t("web.historyEntry", { count: entry.files });
    li.append(when, what, count);
    list.append(li);
  }
}

export function clearHistory() {
  saveHistory([]);
  renderHistory();
  say(t("web.historyCleared"));
}
