/**
 * Tiny IndexedDB helper for keeping File System Access handles across reloads.
 *
 * Handles cannot be stored in localStorage (they are not JSON), but they are
 * structured-cloneable, so IndexedDB happily keeps them.
 */

const DB_NAME = "armorhelper";
const STORE = "handles";

/** IndexedDB can be unavailable (private windows, headless); never hang on it. */
const TIMEOUT = 2000;

function withTimeout(promise, label) {
  let timer = null;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT);
  });
  return Promise.race([promise, guard]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

function open() {
  return withTimeout(
    new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB is blocked"));
    }),
    "indexedDB.open",
  );
}

export async function putHandle(key, handle) {
  try {
    const db = await open();
    await withTimeout(
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(handle, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      }),
      "indexedDB.put",
    );
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function getHandle(key) {
  try {
    const db = await open();
    const handle = await withTimeout(
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
      "indexedDB.get",
    );
    db.close();
    return handle ?? null;
  } catch {
    return null;
  }
}

export async function dropHandle(key) {
  try {
    const db = await open();
    await withTimeout(
      new Promise((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      }),
      "indexedDB.delete",
    );
    db.close();
  } catch {
    /* ignore */
  }
}

/**
 * Make sure we may still use `handle`.
 *
 * Browsers drop the permission when the page is reloaded, so it has to be
 * re-requested from a user gesture — which is why every button that writes or
 * reads calls this first.
 */
export async function ensurePermission(handle, mode = "read") {
  if (!handle) return false;
  const options = { mode };
  try {
    if ((await handle.queryPermission(options)) === "granted") return true;
    return (await handle.requestPermission(options)) === "granted";
  } catch {
    return false;
  }
}
