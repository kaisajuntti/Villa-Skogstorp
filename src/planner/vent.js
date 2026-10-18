// Ventilation layer of a floor plan (planner + static SVG/PDF). Stored in the plan record as two id-lists so the
// per-object merge works:
//   ventLines: [{ id, sys, pts:[[x,y]…], arrow? }]   duct (polyline) or an air arrow (arrow: true → head at the end)
//   ventPts:   [{ id, sys, kind, x, y, w?, h?, label?, flow? }]
//              kind "don" (frånluftsdon, open circle) | "flakt" (takfläkt, circle with a cross) |
//                   "stam" (vertical shaft, filled square + name) | "aggregat" (unit, filled rect + label)
// A room label with `novent: true` (e.g. the vinkällare) is outside the ventilation system.
// Questions to the VVS are project todos (area "Ventilation") with pins: [{ plan, x, y }]; they are drawn as
// numbered markers V1, V2 … (numbering = order among the Ventilation todos).
import { areaGrid, areaSummary, regionAt } from "./geom.js";

export const VENT_SYS = {
  F: { label: "Frånluft till återvinning", color: "#12627C" },
  S2B: { label: "S2-B badrum och WC", color: "#7950A1" },
  S2K: { label: "S2-K köksfläkt / imkanal", color: "#C85A22" },
  T: { label: "Friskluft / uteluft in", color: "#3B9B59" },
  A: { label: "Avluft ut", color: "#D95748" },
  BV: { label: "Bergvärmepump", color: "#D99832" },
};
export const VENT_KINDS = [["don", "Don"], ["flakt", "Takfläkt"], ["stam", "Stam"], ["aggregat", "Aggregat"]];
export const ventColor = (sys) => (VENT_SYS[sys] || VENT_SYS.F).color;
export const VENT_TOPIC = "Ventilation";
const ALERT = "#9a4a3a", MUTED = "#8C8780";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const font = "'Avenir Next','Helvetica Neue',Arial,sans-serif";

// Ventilation questions (project todos) with their V-number.
export function ventQuestions(todos) {
  return (todos || []).filter((t) => t.area === VENT_TOPIC).map((t, i) => ({ ...t, vnum: i + 1 }));
}
// Pins of the questions that sit on this plan: [{ q, pin, idx }]
export function ventPinsFor(todos, planId) {
  const out = [];
  for (const q of ventQuestions(todos)) (q.pins || []).forEach((pin, idx) => { if (pin.plan === planId) out.push({ q, pin, idx }); });
  return out;
}

export const LINE_W = 45, DON_R = 120, STAM = 220, PIN_R = 170;

// SVG markup (string) of the layer; `pins` = ventPinsFor(...).
export function ventSvg({ ventLines = [], ventPts = [] }, pins = []) {
  let s = "";
  for (const l of ventLines) {
    const c = ventColor(l.sys), pts = l.pts || [];
    if (pts.length < 2) continue;
    s += `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="${LINE_W}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (l.arrow) {
      const [x1, y1] = pts[pts.length - 2], [x2, y2] = pts[pts.length - 1], a = Math.atan2(y2 - y1, x2 - x1), h = 230;
      s += `<polygon points="${x2},${y2} ${x2 - h * Math.cos(a - 0.45)},${y2 - h * Math.sin(a - 0.45)} ${x2 - h * Math.cos(a + 0.45)},${y2 - h * Math.sin(a + 0.45)}" fill="${c}"/>`;
    }
  }
  for (const p of ventPts) {
    const c = ventColor(p.sys);
    if (p.kind === "stam") {
      s += `<rect x="${p.x - STAM / 2}" y="${p.y - STAM / 2}" width="${STAM}" height="${STAM}" fill="${c}" stroke="#fff" stroke-width="22"/>`;
      // lside: -1 = text to the left of the shaft (two shafts side by side)
      if (p.label) s += `<text x="${p.lside === -1 ? p.x - STAM / 2 - 50 : p.x + STAM / 2 + 50}" y="${p.y + 60}"${p.lside === -1 ? ' text-anchor="end"' : ""} font-size="170" font-weight="700" fill="${c}" font-family="${font}">${esc(p.label)}</text>`;
    } else if (p.kind === "aggregat") {
      const w = p.w || 600, h = p.h || 600;
      s += `<rect x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" fill="${c}" stroke="#fff" stroke-width="22"/>`;
      if (p.label) s += `<text x="${p.x}" y="${p.y + 60}" text-anchor="middle" font-size="170" font-weight="700" fill="#fff" font-family="${font}">${esc(p.label)}</text>`;
    } else {
      s += `<circle cx="${p.x}" cy="${p.y}" r="${DON_R}" fill="#fff" stroke="${c}" stroke-width="32"/>`;
      if (p.kind === "flakt") {
        const d = DON_R * 0.62;
        s += `<path d="M ${p.x - d} ${p.y - d} L ${p.x + d} ${p.y + d} M ${p.x - d} ${p.y + d} L ${p.x + d} ${p.y - d}" stroke="${c}" stroke-width="24"/>`;
      }
      if (p.flow) s += `<text x="${p.x}" y="${p.y - DON_R - 50}" text-anchor="middle" font-size="140" fill="${c}" font-family="${font}">${esc(p.flow)} l/s</text>`;
    }
  }
  for (const { q, pin } of pins) {
    const done = q.status === "Klar";
    s += `<circle cx="${pin.x}" cy="${pin.y}" r="${PIN_R}" fill="${done ? MUTED : ALERT}" stroke="#fff" stroke-width="30"/>`;
    s += `<text x="${pin.x}" y="${pin.y + 55}" text-anchor="middle" font-size="150" font-weight="700" fill="#fff" font-family="${font}">V${q.vnum}</text>`;
  }
  return s;
}

// Systems actually used on a plan (for the legend), in VENT_SYS order.
export function ventSystemsUsed(plans) {
  const used = new Set();
  for (const p of plans) for (const x of [...(p.ventLines || []), ...(p.ventPts || [])]) used.add(x.sys);
  return Object.keys(VENT_SYS).filter((k) => used.has(k));
}
export const hasVent = (p) => !!((p?.ventLines || []).length || (p?.ventPts || []).length);

// Hit test (plan mm) for the planner's select tool: pins first, then points, then lines.
export function ventHit({ ventLines = [], ventPts = [] }, pins, x, y, tol = 150) {
  for (const { q, pin, idx } of pins) if (Math.hypot(pin.x - x, pin.y - y) < PIN_R + tol) return { kind: "pin", id: q.id, idx };
  for (const p of ventPts) {
    const r = p.kind === "aggregat" ? Math.max(p.w || 600, p.h || 600) / 2 : p.kind === "stam" ? STAM / 2 : DON_R;
    if (Math.abs(p.x - x) < r + tol && Math.abs(p.y - y) < r + tol) return { kind: "pt", id: p.id };
  }
  for (const l of ventLines) {
    const pts = l.pts || [];
    for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i][0] - x, pts[i][1] - y) < tol + 40) return { kind: "line", id: l.id, vertex: i };
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      if (Math.hypot(ax + t * dx - x, ay + t * dy - y) < tol) return { kind: "line", id: l.id, vertex: -1 };
    }
  }
  return null;
}

// Flow requirement per room (BBR general ventilation 0,35 l/s per m² floor area) from the area summary.
export const BBR_LS_PER_M2 = 0.35;

// One row per room label of a floor plan: m², BBR requirement and the exhaust terminals inside the room.
const pretty = (n) => { const t = (n || "").toLowerCase().replace(/(?<!\p{L})(wc|kpr|tv|d)(?!\p{L})/gu, (m) => m.toUpperCase()); return t.charAt(0).toUpperCase() + t.slice(1); };
export function ventFlowRows(plan, floor = "") {
  if (!plan?.room || !(plan.areas || []).length) return [];
  const grid = areaGrid(plan.room, plan.walls || []), sm = areaSummary(grid, plan.areas);
  const terms = (plan.ventPts || []).filter((p) => p.kind === "don" || p.kind === "flakt").map((p) => ({ ...p, reg: regionAt(grid, p.x, p.y) }));
  return plan.areas.filter((a) => a.kind !== "ute").map((a) => {
    const reg = regionAt(grid, a.x, a.y), m2 = sm?.byArea[a.id] ?? null;
    const counted = a.kind !== "ej" && !a.novent;
    const t = terms.filter((x) => x.reg >= 0 && x.reg === reg);
    return { floor, id: a.id, name: pretty(a.name), m2, kind: a.kind || "boa", novent: !!a.novent, req: counted && m2 ? m2 * BBR_LS_PER_M2 : 0,
      terms: t.map((x) => ({ sys: x.sys, kind: x.kind, flow: x.flow ? parseFloat(x.flow) : null })) };
  });
}
export const fmtLs = (v) => (v == null ? "–" : v.toFixed(1).replace(".", ","));

