/*
 * localMediaStore.js — 로컬 데모 모드의 대용량 미디어 저장소 (IndexedDB).
 *
 * localStorage 는 5MB 한도라 360 파노라마(장당 1~2MB)를 넣을 수 없다.
 * 매물 행에는 `idb:<key>` 참조만 저장하고, 실제 바이트는 여기 Blob 으로 둔다.
 * 새로고침 후에도 유지되어 로컬 데모 시연이 끊기지 않는다.
 *
 * 하이브리드 모드(Supabase Storage)에서는 사용되지 않는다.
 */

const DB_NAME = 'geupmae-media';
const DB_VERSION = 1;
const STORE = 'blobs';

let dbPromise = null;

export function hasIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function openDb() {
  if (!hasIndexedDb()) return Promise.reject(new Error('INDEXEDDB_UNAVAILABLE'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('INDEXEDDB_OPEN_FAILED'));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('INDEXEDDB_BLOCKED'));
    };
  });
  return dbPromise;
}

function runTransaction(mode, operation) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const request = operation(store);
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error ?? new Error('INDEXEDDB_TX_FAILED'));
        tx.onabort = () => reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'));
      }),
  );
}

export function putBlob(key, blob) {
  return runTransaction('readwrite', (store) => store.put(blob, key)).then(() => key);
}

export function getBlob(key) {
  return runTransaction('readonly', (store) => store.get(key)).then((value) => value ?? null);
}

export function removeBlob(key) {
  return runTransaction('readwrite', (store) => store.delete(key)).then(() => true);
}

// 같은 키를 여러 화면에서 반복 요청해도 object URL 을 하나만 만든다 (누수 방지).
const objectUrlCache = new Map();

export async function getObjectUrl(key) {
  if (objectUrlCache.has(key)) return objectUrlCache.get(key);
  const blob = await getBlob(key);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(key, url);
  return url;
}

export function revokeObjectUrl(key) {
  const url = objectUrlCache.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrlCache.delete(key);
  }
}
