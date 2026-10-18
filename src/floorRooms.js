// Rooms on the whole-floor plans (u-k-hela · u-p1-hela · u-p2-hela): every room label (area) in a floor
// plan is a room of its own, opened as "#/rum/<planId>:<areaId>" (a focus crop of the floor plan, with its
// own space record space:<planId>:<areaId>). Utrymmen in the rooms list may group several of them via
// { plan, areas }.
import { useEffect, useState } from "react";
import { storage, planKey } from "./storage.js";
import { areaGrid, regionAt, regionRects } from "./planner/geom.js";

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
    if (!planId) return undefined;
    load();
    window.addEventListener("vs-sync", load);
    return () => { alive = false; window.removeEventListener("vs-sync", load); };
  }, [planId]);
  return plan;
}

// The part of a floor plan that belongs to some of its room labels: the rooms' regions as rectangles, plus
// which comments (marker inside) and objects (centre inside or within a wall's width of it) are in them.
// Comments keep their floor-plan number (num) so the lists match the markers in the planner.
export function cropPlan(plan, areaIds) {
  if (!plan?.room || !areaIds?.length) return null;
  const grid = areaGrid(plan.room, plan.walls || []), ids = new Set(areaIds);
  const regs = [...new Set((plan.areas || []).filter((a) => ids.has(a.id)).map((a) => regionAt(grid, a.x, a.y)).filter((r) => r >= 0))];
  if (!regs.length) return null;
  const rects = regionRects(grid, regs, 0);
  const inside = (x, y, pad = 0) => rects.some((r) => x >= r[0] - pad && x <= r[2] + pad && y >= r[1] - pad && y <= r[3] + pad);
  const comments = (plan.comments || []).map((c, i) => ({ ...c, num: i + 1 })).filter((c) => inside(c.tx ?? c.x, c.ty ?? c.y));
  const items = (plan.items || []).filter((it) => inside(it.x + it.w / 2, it.y + it.h / 2, 200));
  return { rects, comments, items };
}

// Everything the PDF renderers need for a room: own plan, or the floor-plan crop for an utrymme ({ plan, areas }).
export function pdfPlanArgs(room, plan) {
  const crop = room?.plan && room.areas?.length ? cropPlan(plan, room.areas) : null;
  const base = { room: plan.room || { w: 4000, l: 3000 }, openings: plan.openings || [], items: plan.items || [],
    walls: plan.walls || [], dims: plan.dims || [], areas: plan.areas || [], embedBg: false };
  if (!crop) return { svg: { ...base, comments: plan.comments || [] }, comments: plan.comments || [], items: plan.items || [], crop: false };
  return { svg: { ...base, comments: crop.comments, focus: crop.rects }, comments: crop.comments, items: crop.items, crop: true };
}
