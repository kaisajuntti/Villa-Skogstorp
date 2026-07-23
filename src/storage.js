// Local store (localStorage) with optional Supabase sync layered on top.
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
    const value = localStorage.getItem(key);
    return value == null ? null : { key, value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    maybePush(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
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
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  },
};

// Pull all remote rows and merge in the newer ones. Fires "vs-sync" if anything changed.
export async function syncPull() {
  const cfg = getConfig();
  if (!cfg) return { ok: false };
  setStatus("pulling");
  try {
    const rows = await sync.pullAll(cfg);
    let changed = 0;
    for (const r of rows) {
      const k = sync.toStorageKey(r.kind, r.key);
      if (!k) continue;
      const localAt = getMeta()[k];
      if (!localAt || new Date(r.updated_at) > new Date(localAt)) {
        localStorage.setItem(k, JSON.stringify(r.data));
        setMetaAt(k, r.updated_at);
        changed++;
      }
    }
    setStatus("idle");
    if (changed) window.dispatchEvent(new Event("vs-sync"));
    return { ok: true, changed, total: rows.length };
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
