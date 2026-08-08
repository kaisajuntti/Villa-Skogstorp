import { useEffect, useRef, useState } from "react";
import { storage, roomsKey, planKey, spaceKey, bgKey, PREFIX } from "./storage.js";

const DEFAULT_ROOMS = [{ id: "kok", name: "Kök", zone: "befintlig" }];

const newId = (name) =>
  name
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 24) + "-" + Math.random().toString(36).slice(2, 6);

export function useRooms() {
  const [rooms, setRooms] = useState(null); // null = loading
  const load = async () => {
    try {
      const r = await storage.get(roomsKey);
      setRooms(r ? JSON.parse(r.value) : DEFAULT_ROOMS);
    } catch {
      setRooms(DEFAULT_ROOMS);
    }
  };
  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener("vs-sync", onSync);
    return () => window.removeEventListener("vs-sync", onSync);
  }, []);
  const save = (next) => {
    setRooms(next);
    storage.set(roomsKey, JSON.stringify(next));
  };
  const addRoom = (zone, name) => {
    const room = { id: newId(name || "rum"), name: name || "Nytt rum", zone };
    save([...(rooms || []), room]);
    return room;
  };
  const renameRoom = (id, name) =>
    save(rooms.map((r) => (r.id === id ? { ...r, name } : r)));
  const deleteRoom = (id) => {
    save(rooms.filter((r) => r.id !== id));
    storage.delete(planKey(id));
    storage.delete(spaceKey(id));
  };
  // Duplicate a room including its plan + space, under a new name.
  const copyRoom = async (id, name) => {
    const src = (rooms || []).find((r) => r.id === id);
    if (!src) return null;
    const nid = newId(name || src.name + " kopia");
    const plan = await storage.get(planKey(id));
    const space = await storage.get(spaceKey(id));
    if (plan?.value) await storage.set(planKey(nid), plan.value);
    if (space?.value) await storage.set(spaceKey(nid), space.value);
    const room = { id: nid, name: name || src.name + " (kopia)", zone: src.zone };
    save([...(rooms || []), room]);
    return room;
  };
  return { rooms, addRoom, renameRoom, deleteRoom, copyRoom };
}

const EMPTY_SPACE = { colors: [], docs: [], notes: "" };

// Space = { colors:[{hex,name,note}], docs:[{title,url,note}], notes:"" }
export function useSpace(id) {
  const key = spaceKey(id);
  const [space, setSpace] = useState(null);
  const loaded = useRef(false);
  const timer = useRef(null);
  const dirty = useRef(false);
  useEffect(() => {
    loaded.current = false;
    dirty.current = false;
    setSpace(null);
    const load = async () => {
      try {
        const r = await storage.get(key);
        setSpace(r ? { ...EMPTY_SPACE, ...JSON.parse(r.value) } : EMPTY_SPACE);
      } catch {
        setSpace(EMPTY_SPACE);
      }
      loaded.current = true;
    };
    load();
    // Refresh from a remote pull, unless the user has unsaved local edits.
    const onSync = () => { if (!dirty.current) load(); };
    window.addEventListener("vs-sync", onSync);
    return () => window.removeEventListener("vs-sync", onSync);
  }, [key]);
  const update = (patch) => {
    dirty.current = true;
    setSpace((s) => {
      const next = { ...s, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        storage.set(key, JSON.stringify(next));
        dirty.current = false;
      }, 500);
      return next;
    });
  };
  return [space, update];
}

// Read-only view of a field on a room's plan record (kept fresh via sync/focus).
function usePlanField(id, field) {
  const key = planKey(id);
  const [val, setVal] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await storage.get(key);
        const plan = r ? JSON.parse(r.value) : null;
        if (alive) setVal(Array.isArray(plan?.[field]) ? plan[field] : []);
      } catch { if (alive) setVal([]); }
    };
    load();
    const onSync = () => load();
    const onFocus = () => load();
    window.addEventListener("vs-sync", onSync);
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.removeEventListener("vs-sync", onSync); window.removeEventListener("focus", onFocus); };
  }, [key, field]);
  return val;
}
export const usePlanComments = (id) => usePlanField(id, "comments");
export const usePlanItems = (id) => usePlanField(id, "items");

// Load a room's plan + background image + space (for off-screen PDF generation).
export async function loadPlanForPrint(id) {
  let plan = {};
  try { const r = await storage.get(planKey(id)); if (r?.value) plan = JSON.parse(r.value); } catch { /* none */ }
  let bgImg = null;
  try { const rb = await storage.get(bgKey(id)); if (rb?.value) bgImg = JSON.parse(rb.value); } catch { /* none */ }
  let space = {};
  try { const rs = await storage.get(spaceKey(id)); if (rs?.value) space = JSON.parse(rs.value); } catch { /* none */ }
  return { plan, bgImg, space };
}

// Extra content for a room's PDF: its space (description/actions/colors/docs) + project cover.
export async function loadRoomPdfData(roomId) {
  const get = async (k) => { try { const r = await storage.get(k); return r?.value ? JSON.parse(r.value) : null; } catch { return null; } };
  const space = (await get(spaceKey(roomId))) || {};
  const project = (await get(spaceKey("project"))) || {};
  return { space, cover: project.cover || {} };
}

export async function exportAll() {
  const keys = await storage.keys(PREFIX);
  const data = {};
  for (const k of keys) {
    const r = await storage.get(k);
    if (r) data[k] = r.value;
  }
  return JSON.stringify({ app: "villa-skogstorp", exported: new Date().toISOString(), data }, null, 2);
}

export async function importAll(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed.data !== "object") throw new Error("Ogiltigt format");
  let n = 0;
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k.startsWith(PREFIX) && typeof v === "string") {
      await storage.set(k, v);
      n++;
    }
  }
  return n;
}
