// Local store with optional Supabase sync layered on top.
// Small records live in localStorage; big ones (background / floor images, `vs:v1:bg:*`)
// live in IndexedDB — Safari caps localStorage at ~5 MB and the images alone exceed that.
// Callers use the same async facade; when a workspace is configured, writes
// also push to Supabase and `syncPull` merges remote changes back in.
import { getConfig, canEdit } from "./config.js";
import * as sync from "./sync.js";

export const PREFIX = "vs:v1:";
export const roomsKey = PREFIX + "rooms";
export const planKey = (roomId) => PREFIX + "plan:" + roomId;
export const spaceKey = (id) => PREFIX + "space:" + id; // roomId or "project"
export const bgKey = (roomId) => PREFIX + "bg:" + roomId; // reference image per room

const META_KEY = PREFIX + "_meta"; // { storageKey: updated_at } last-synced marker
const getMeta = () => { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; } };
const setMetaAt = (k, at) => { const m = getMeta(); m[k] = at; localStorage.setItem(META_KEY, JSON.stringify(m)); };

// ---------- IndexedDB for big values (with in-memory cache + fallbacks) ----------
const isBig = (k) => k.startsWith(PREFIX + "bg:");
const mem = new Map();
let dbp = null;
function idb() {
  if (!dbp) dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open("villa-skogstorp", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
async function idbDo(mode, fn) {
  const db = await idb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction("kv", mode); const st = tx.objectStore("kv");
      const req = fn(st);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = tx.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
const bigGet = async (k) => {
  if (mem.has(k)) return mem.get(k);
  let v = await idbDo("readonly", (st) => st.get(k));
  if (v == null) { try { v = localStorage.getItem(k); } catch { /* ignore */ } }
  if (v != null) mem.set(k, v);
  return v ?? null;
};
const bigSet = async (k, v) => { mem.set(k, v); await idbDo("readwrite", (st) => st.put(v, k)); try { localStorage.removeItem(k); } catch { /* ignore */ } };
const bigDel = async (k) => { mem.delete(k); await idbDo("readwrite", (st) => st.delete(k)); try { localStorage.removeItem(k); } catch { /* ignore */ } };
const bigKeys = async () => (await idbDo("readonly", (st) => st.getAllKeys())) || [...mem.keys()];
// One-time: move images that older versions put in localStorage over to IndexedDB (frees quota).
export async function migrateBigKeys() {
  const ks = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && isBig(k)) ks.push(k); } } catch { return; }
  for (const k of ks) { const v = localStorage.getItem(k); if (v != null) await bigSet(k, v); }
}

let syncStatus = "idle"; // idle | pushing | pulling | error
export const getSyncStatus = () => syncStatus;
const announce = () => window.dispatchEvent(new Event("vs-syncstatus"));
const setStatus = (s) => { syncStatus = s; announce(); };

function maybePush(key, value) {
  const cfg = getConfig();
  if (!cfg || !canEdit() || !sync.isSyncable(key)) return;
  let data; try { data = JSON.parse(value); } catch { return; }
  const parts = sync.keyParts(key);
  const at = new Date().toISOString();
  setMetaAt(key, at);
  setStatus("pushing");
  sync.push(cfg, parts.kind, parts.key, data, at)
    .then(() => setStatus("idle"))
    .catch(() => setStatus("error"));
}

export const storage = {
  async get(key) {
    if (isBig(key)) { const v = await bigGet(key); return v == null ? null : { key, value: v }; }
    const value = localStorage.getItem(key);
    return value == null ? null : { key, value };
  },
  async set(key, value) {
    if (isBig(key)) await bigSet(key, value);
    else localStorage.setItem(key, value);
    maybePush(key, value);
    return { key, value };
  },
  async delete(key) {
    if (isBig(key)) await bigDel(key);
    else localStorage.removeItem(key);
    const cfg = getConfig();
    if (cfg && canEdit() && sync.isSyncable(key)) {
      const parts = sync.keyParts(key);
      sync.remove(cfg, parts.kind, parts.key).catch(() => {});
    }
    return true;
  },
  async keys(prefix = "") {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && !isBig(k)) out.push(k);
    }
    for (const k of await bigKeys()) if (typeof k === "string" && k.startsWith(prefix)) out.push(k);
    return out;
  },
};

// Pull all remote rows and merge in the newer ones. Fires "vs-sync" if anything changed.
const LASTPULL_KEY = PREFIX + "_lastpull"; // newest server updated_at seen (incremental pulls)
let pulling = null;
export function syncPull() {
  if (!pulling) pulling = doPull().finally(() => { pulling = null; });
  return pulling;
}
async function doPull() {
  const cfg = getConfig();
  if (!cfg) return { ok: false };
  setStatus("pulling");
  try {
    await migrateBigKeys();
    let since = null;
    try { since = localStorage.getItem(LASTPULL_KEY); } catch { /* ignore */ }
    // 10 min margin for clock skew between devices (updated_at is set by the writing client)
    const sinceArg = since ? new Date(new Date(since).getTime() - 10 * 60 * 1000).toISOString() : null;
    const rows = await sync.pullAll(cfg, sinceArg);
    let changed = 0, failed = 0, newest = since;
    for (const r of rows) {
      const k = sync.toStorageKey(r.kind, r.key);
      if (!k) continue;
      const localAt = getMeta()[k];
      if (!localAt || new Date(r.updated_at) > new Date(localAt)) {
        try {
          if (isBig(k)) await bigSet(k, JSON.stringify(r.data));
          else localStorage.setItem(k, JSON.stringify(r.data));
          setMetaAt(k, r.updated_at);
          changed++;
        } catch { failed++; continue; }
      }
      if (!newest || new Date(r.updated_at) > new Date(newest)) newest = r.updated_at;
    }
    if (!failed && newest) { try { localStorage.setItem(LASTPULL_KEY, newest); } catch { /* ignore */ } }
    setStatus(failed ? "error" : "idle");
    if (changed) window.dispatchEvent(new Event("vs-sync"));
    return { ok: !failed, changed, failed, total: rows.length };
  } catch (e) {
    setStatus("error");
    return { ok: false, error: e.message };
  }
}

// Restore a previous version's data into a storage key (also pushes remotely).
export async function restoreValue(storageKey, data) {
  await storage.set(storageKey, JSON.stringify(data));
  window.dispatchEvent(new Event("vs-sync"));
}
