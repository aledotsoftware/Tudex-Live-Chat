const DB_NAME = "tapchat-cache";
const DB_VERSION = 1;
const STORE_NAME = "kv";

const CHATS_PREFIX = "chats";
const MESSAGES_PREFIX = "messages";

export function getStorageKey(prefix, provider, accountId, conversationId = "") {
  return `${prefix}:${provider}:${accountId}:${conversationId}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function readEntry(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function writeEntry(key, value) {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({
        key,
        value,
        savedAt: Date.now()
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

export async function clearCache() {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  } catch (e) {}
}

export async function getCachedChats(provider, accountId) {
  try {
    const key = getStorageKey(CHATS_PREFIX, provider, accountId);
    const entry = await readEntry(key);
    return Array.isArray(entry?.value) ? entry.value : [];
  } catch (_error) {
    return [];
  }
}

export async function setCachedChats(provider, accountId, chats) {
  if (!Array.isArray(chats)) return;
  const limitedChats = chats.slice(0, 150);
  const key = getStorageKey(CHATS_PREFIX, provider, accountId);
  try { await writeEntry(key, limitedChats); } catch (e) {}
}

export async function getCachedMessages(provider, accountId, conversationId) {
  if (!conversationId) return [];
  try {
    const key = getStorageKey(MESSAGES_PREFIX, provider, accountId, conversationId);
    const entry = await readEntry(key);
    return Array.isArray(entry?.value) ? entry.value : [];
  } catch (_error) {
    return [];
  }
}

export async function setCachedMessages(provider, accountId, conversationId, messages) {
  if (!conversationId || !Array.isArray(messages)) return;
  const limitedMessages = messages.slice(-150);
  const key = getStorageKey(MESSAGES_PREFIX, provider, accountId, conversationId);
  try { await writeEntry(key, limitedMessages); } catch (e) {}
}

const OFFLINE_QUEUE_PREFIX = "offline_queue";

export async function getOfflineQueue(provider, accountId) {
  try {
    const key = getStorageKey(OFFLINE_QUEUE_PREFIX, provider, accountId);
    const entry = await readEntry(key);
    return Array.isArray(entry?.value) ? entry.value : [];
  } catch (_error) {
    return [];
  }
}

export async function setOfflineQueue(provider, accountId, queue) {
  if (!Array.isArray(queue)) return;
  const key = getStorageKey(OFFLINE_QUEUE_PREFIX, provider, accountId);
  try { await writeEntry(key, queue); } catch (e) {}
}
