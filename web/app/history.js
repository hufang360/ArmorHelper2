/**
 * The "recent exports" list, kept in localStorage.
 *
 * An entry is `{ at, title, files, thumb }`: a timestamp, what was exported, how
 * many files, and a small data URL.  The list is a convenience, so every storage
 * failure is swallowed — a full quota must never fail an export.
 *
 * Nothing shows the list any more: the icon button in the drop area is gone, so
 * the entries are only written.  Keeping them costs a few hundred bytes and
 * leaves the data in place if the panel comes back.
 */

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
}
