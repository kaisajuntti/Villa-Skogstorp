// Minimal Supabase (PostgREST) client over fetch — no dependency, no realtime.
// Data is keyed by (workspace, kind, key); the app's storage keys map 1:1:
//   vs:v1:rooms        -> kind 'rooms', key 'rooms'
//   vs:v1:plan:<id>    -> kind 'plan',  key <id>
//   vs:v1:space:<id>   -> kind 'space', key <id>

export const SYNC_PREFIX = "vs:v1:";

export function isSyncable(storageKey) {
  return storageKey === SYNC_PREFIX + "rooms" ||
    storageKey.startsWith(SYNC_PREFIX + "plan:") ||
    storageKey.startsWith(SYNC_PREFIX + "space:") ||
    storageKey.startsWith(SYNC_PREFIX + "bg:");
}

export function keyParts(storageKey) {
  const s = storageKey.slice(SYNC_PREFIX.length);
  if (s === "rooms") return { kind: "rooms", key: "rooms" };
  if (s.startsWith("plan:")) return { kind: "plan", key: s.slice(5) };
  if (s.startsWith("space:")) return { kind: "space", key: s.slice(6) };
  if (s.startsWith("bg:")) return { kind: "bg", key: s.slice(3) };
  return null;
}

export function toStorageKey(kind, key) {
  if (kind === "rooms") return SYNC_PREFIX + "rooms";
  if (kind === "plan") return SYNC_PREFIX + "plan:" + key;
  if (kind === "space") return SYNC_PREFIX + "space:" + key;
  if (kind === "bg") return SYNC_PREFIX + "bg:" + key;
  return null;
}

function headers(cfg) {
  return {
    apikey: cfg.key,
    Authorization: "Bearer " + cfg.key,
    "Content-Type": "application/json",
  };
}
const base = (cfg) => cfg.url.replace(/\/+$/, "") + "/rest/v1";
const enc = encodeURIComponent;

// Verify url+key+workspace by doing a scoped read.
export async function testConnection(cfg) {
  const r = await fetch(`${base(cfg)}/vs_items?select=key&limit=1&workspace=eq.${enc(cfg.workspace)}`, {
    headers: headers(cfg),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " — kontrollera URL och nyckel");
  return true;
}

export async function pullAll(cfg) {
  const r = await fetch(
    `${base(cfg)}/vs_items?select=kind,key,data,updated_at,updated_by&workspace=eq.${enc(cfg.workspace)}`,
    { headers: headers(cfg) }
  );
  if (!r.ok) throw new Error("pull HTTP " + r.status);
  return r.json();
}

export async function push(cfg, kind, key, data, updatedAt) {
  const body = [{
    workspace: cfg.workspace,
    kind, key, data,
    updated_at: updatedAt || new Date().toISOString(),
    updated_by: cfg.user || null,
  }];
  const r = await fetch(`${base(cfg)}/vs_items?on_conflict=workspace,kind,key`, {
    method: "POST",
    headers: { ...headers(cfg), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("push HTTP " + r.status);
  return true;
}

export async function remove(cfg, kind, key) {
  const r = await fetch(
    `${base(cfg)}/vs_items?workspace=eq.${enc(cfg.workspace)}&kind=eq.${enc(kind)}&key=eq.${enc(key)}`,
    { method: "DELETE", headers: { ...headers(cfg), Prefer: "return=minimal" } }
  );
  return r.ok;
}

export async function fetchVersions(cfg, kind, key, limit = 50) {
  const r = await fetch(
    `${base(cfg)}/vs_versions?select=id,data,updated_by,created_at` +
    `&workspace=eq.${enc(cfg.workspace)}&kind=eq.${enc(kind)}&key=eq.${enc(key)}` +
    `&order=created_at.desc&limit=${limit}`,
    { headers: headers(cfg) }
  );
  if (!r.ok) throw new Error("versions HTTP " + r.status);
  return r.json();
}
