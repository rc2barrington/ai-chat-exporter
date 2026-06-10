// File System Access API helpers.
//
// Browsers cannot open an arbitrary absolute path on their own, but once the
// user grants access to a folder we can persist the FileSystemDirectoryHandle
// in IndexedDB and re-open it on later visits with a single click (a quick
// permission confirm, no re-navigation). Collected files are shaped exactly
// like the drag-and-drop path: each File carries a `.relativePath` so the
// existing parsers/sidecar lookups work unchanged.

const DB_NAME = "ai-chat-exporter";
const STORE = "dir-handles";

export function isFsAccessSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbSet(key, value) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

// Returns a previously-remembered directory handle, or null.
export async function getSavedDirectory(id) {
  try {
    return await idbGet(id);
  } catch {
    return null;
  }
}

export async function rememberDirectory(id, handle) {
  try {
    await idbSet(id, handle);
  } catch {
    // IndexedDB unavailable (private mode, etc.) — we just lose the convenience.
  }
}

// Drop a remembered handle. Used when a saved handle turns out to be unusable
// (e.g. the folder was moved, or the browser refuses to enumerate it) so we
// don't silently reuse the dead handle on every later visit.
export async function forgetDirectory(id) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Nothing we can do if IndexedDB is unavailable.
  }
}

// Ensure we still have read permission for a saved handle. Chrome may downgrade
// a previously-granted permission to "prompt" across page loads; requestPermission
// re-grants it from within the click handler.
export async function verifyPermission(handle, mode = "read") {
  if (!handle || typeof handle.queryPermission !== "function") return true;
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

// Open the native directory picker. If a saved handle is passed as `startIn`,
// the picker opens already inside that folder. The chosen handle is remembered.
export async function pickDirectory(id, startInHandle) {
  const opts = { id, mode: "read" };
  if (startInHandle) opts.startIn = startInHandle;
  const handle = await window.showDirectoryPicker(opts);
  await rememberDirectory(id, handle);
  return handle;
}

// Recursively walk a directory handle, returning File objects whose
// `.relativePath` is "<rootName>/<...>/<file>" (mirrors the drag-drop shape).
// `shouldInclude(name, path)` filters which files are read.
export async function collectFiles(dirHandle, shouldInclude) {
  const out = [];

  async function walk(handle, prefix) {
    for await (const [name, entry] of handle.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === "file") {
        if (!shouldInclude || shouldInclude(name, path)) {
          const file = await entry.getFile();
          file.relativePath = path;
          out.push(file);
        }
      } else if (entry.kind === "directory") {
        await walk(entry, path);
      }
    }
  }

  await walk(dirHandle, dirHandle.name);
  return out;
}
