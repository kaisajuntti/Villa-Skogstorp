// Rooms on the whole-floor plans (u-k-hela · u-p1-hela · u-p2-hela): every room label (area) in a floor
// plan is a room of its own, opened as "#/rum/<planId>:<areaId>" (a focus crop of the floor plan, with its
// own space record space:<planId>:<areaId>). Utrymmen in the rooms list may group several of them via
// { plan, areas }.
import { useEffect, useState } from "react";
import { storage, planKey } from "./storage.js";

export const PLAN_FLOOR = {
  "u-k-hela": { floor: "kallare", short: "K", title: "Källare" },
  "u-p1-hela": { floor: "plan1", short: "P1", title: "Plan 1" },
  "u-p2-hela": { floor: "plan2", short: "P2", title: "Plan 2" },
};

export const areaRoomId = (planId, areaId) => planId + ":" + areaId;
export function parseAreaRoomId(id) {
  const i = (id || "").indexOf(":");
  return i > 0 ? { planId: id.slice(0, i), areaId: id.slice(i + 1) } : null;
}

// "MASTER BEDROOM" → "Master bedroom", "WC/D" stays; two labels with the same name get 1, 2.
const KEEP = /\b(wc|kpr|tv|d)\b/g;
export function prettyName(name) {
  const s = (name || "").toLowerCase().replace(KEEP, (m) => m.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function areaNames(areas) {
  const count = {}, seen = {}, out = {};
  for (const a of areas) count[a.name] = (count[a.name] || 0) + 1;
  for (const a of areas) {
    seen[a.name] = (seen[a.name] || 0) + 1;
    out[a.id] = prettyName(a.name || "Rum") + (count[a.name] > 1 ? " " + seen[a.name] : "");
  }
  return out;
}

// A floor plan record, kept fresh on sync; null while loading, {} when missing.
export function useFloorPlan(planId) {
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await storage.get(planKey(planId));
        if (alive) setPlan(r?.value ? JSON.parse(r.value) : {});
      } catch { if (alive) setPlan({}); }
    };
    setPlan(null);
    if (planId) load();
    window.addEventListener("vs-sync", load);
    return () => { alive = false; window.removeEventListener("vs-sync", load); };
  }, [planId]);
  return plan;
}
