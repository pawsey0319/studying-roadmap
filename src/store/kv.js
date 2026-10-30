// 极简键值存储：优先用 IndexedDB，打不开时（隐私模式、旧浏览器）退回 localStorage。
const DB = 'learning-hub', OS = 'kv';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in globalThis)) return rej(new Error('no idb'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch(() => null);
  return dbp;
}

export async function kvGet(key) {
  const db = await open();
  if (!db) { try { return JSON.parse(localStorage.getItem('lh2.' + key)); } catch (e) { return null; } }
  return new Promise(res => {
    const r = db.transaction(OS).objectStore(OS).get(key);
    r.onsuccess = () => res(r.result ?? null);
    r.onerror = () => res(null);
  });
}

export async function kvSet(key, val) {
  const db = await open();
  if (!db) { try { localStorage.setItem('lh2.' + key, JSON.stringify(val)); } catch (e) {} return; }
  return new Promise(res => {
    const t = db.transaction(OS, 'readwrite');
    t.objectStore(OS).put(val, key);
    t.oncomplete = () => res();
    t.onerror = () => res();
  });
}
