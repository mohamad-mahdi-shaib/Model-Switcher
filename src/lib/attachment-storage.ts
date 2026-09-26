"use client";

/**
 * IndexedDB-backed storage for attachment RAW BYTES only -- never
 * localStorage (see `AttachmentMeta`'s own comment in `chat.ts` for why:
 * base64 image/PDF data would make localStorage's own capacity trivial to
 * exhaust). Metadata (name/mimeType/kind/size) lives on the message itself,
 * in the existing localStorage-backed conversation schema; only the bytes
 * live here, keyed by that same attachment id.
 *
 * Hand-rolled, no dependency (no idb-keyval/Dexie) -- this project adds
 * nothing it does not need; see `cdp.mjs`'s own header comment for the
 * identical reasoning applied to the browser test harness.
 *
 * Every function resolves to a safe fallback (`null`/`false`) rather than
 * throwing when IndexedDB is unavailable (private browsing, disabled
 * storage, an old browser) -- callers treat that exactly like "this
 * attachment is not available" rather than crashing the send/display path.
 */

const DB_NAME = "model-switcher-attachments";
const DB_VERSION = 1;
const STORE = "bytes";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function saveAttachmentBytes(id: string, bytes: ArrayBuffer): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(bytes, id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getAttachmentBytes(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteAttachmentsBytes(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
