// Installation layers of a floor plan – Ventilation, El, Vatten & avlopp, Värme (planner + static SVG/PDF).
// Each layer is stored in the plan record as two id-lists (so the per-object merge works):
//   <key>Lines: [{ id, sys, pts:[[x,y]…], arrow? }]   duct / cable / pipe (polyline), arrow: true → head at the end
//   <key>Pts:   [{ id, sys, kind, x, y, w?, h?, label?, flow?, lside? }]
// with key = vent | el | va | varme (ventLines/ventPts, elLines/elPts …). A point's look comes from its kind's
// `shape` (LAYERS[key].kinds); `flow` is the kind's value (l/s, W …) shown next to it; a "zone" point colours
// the whole room region it sits in (e.g. golvvärme) and shows its m².
// A room label with `novent: true` (e.g. the vinkällare) is outside the ventilation system.
// Questions to the installer are project todos whose area is one of the layer's topics, with pins:
// [{ plan, x, y }]; drawn as numbered markers V1, E1, VA1, VÄ1 … (numbering = order among the layer's todos).
import { areaGrid, areaSummary, regionAt, regionRects, regionArea } from "./geom.js";

export const LAYERS = {
  vent: {
    key: "vent", label: "Ventilation", icon: "🌬", pre: "V", topics: ["Ventilation"], who: "VVS",
    title: "Ventilation – underlag till VVS", defSys: "F",
    sys: {
      F: { label: "Frånluft till återvinning", color: "#12627C" },
      S2B: { label: "S2-B badrum och WC", color: "#7950A1" },
      S2K: { label: "S2-K köksfläkt / imkanal", color: "#C85A22" },
      T: { label: "Friskluft / uteluft in", color: "#3B9B59" },
      A: { label: "Avluft ut", color: "#D95748" },
      BV: { label: "Bergvärmepump", color: "#D99832" },
    },
    lines: [["kanal", "Kanal"], ["pil", "Luftpil"]], pilHint: "Två tryck: varifrån luften kommer → vart den går.",
    kinds: [
      { k: "don", label: "Don", shape: "circle", unit: "l/s" },
      { k: "flakt", label: "Takfläkt", shape: "cross", unit: "l/s" },
      { k: "stam", label: "Stam", shape: "square", ask: "Stammens namn:", def: (s) => (s === "S2B" ? "S2-B" : s === "S2K" ? "S2-K" : "S1") },
      { k: "aggregat", label: "Aggregat", shape: "rect", ask: "Aggregat (kort text, t.ex. FL eller BV):", def: (s) => (s === "BV" ? "BV" : "FL") },
    ],
  },
  el: {
    key: "el", label: "El", icon: "⚡", pre: "E", topics: ["El", "El & styrning"], who: "Elektriker",
    title: "El – underlag till elektriker", defSys: "K",
    sys: {
      M: { label: "Matning / central", color: "#4A4744" },
      K: { label: "Kraft / uttag", color: "#C0392B" },
      B: { label: "Belysning", color: "#D99832" },
      S: { label: "Styrning (Plejd)", color: "#3B9B59" },
      D: { label: "Data / nätverk", color: "#2E7FB8" },
      L: { label: "Brandvarnare", color: "#7950A1" },
    },
    lines: [["kanal", "Kabelväg"]],
    kinds: [
      { k: "central", label: "Central", shape: "rect", sys: "M", ask: "Text (t.ex. EC, UC, mätare):", def: () => "EC", w: 600, h: 300 },
      { k: "uttag", label: "Uttag", shape: "letter", sym: "U", sys: "K", relabel: "Text i symbolen (U = uttag, U2 = dubbelt, UT = ute, IP44 …):" },
      { k: "brytare", label: "Brytare/dimmer", shape: "letter", sym: "S", sys: "S", relabel: "Text i symbolen (S = brytare, D = dimmer, 2S …):" },
      { k: "lampa", label: "Takuttag/lampa", shape: "cross", sys: "B" },
      { k: "spot", label: "Spot", shape: "dot", sys: "B" },
      { k: "data", label: "Data", shape: "letter", sym: "D", sys: "D", relabel: "Text i symbolen (D = datauttag, TV …):" },
      { k: "wifi", label: "Wifi", shape: "letter", sym: "W", sys: "D" },
      { k: "brand", label: "Brandvarnare", shape: "letter", sym: "R", sys: "L" },
      { k: "ladd", label: "Laddbox", shape: "letter", sym: "EV", sys: "K" },
    ],
  },
  va: {
    key: "va", label: "Vatten & avlopp", icon: "💧", pre: "VA", topics: ["Vatten & avlopp", "VVS", "Vatten"], who: "VVS",
    title: "Vatten & avlopp – underlag till VVS", defSys: "KV",
    sys: {
      KV: { label: "Kallvatten", color: "#2E7FB8" },
      VV: { label: "Varmvatten", color: "#D95748" },
      VVC: { label: "Varmvattencirkulation", color: "#E0913C" },
      SP: { label: "Spillvatten / avlopp", color: "#7A5C3E" },
      DG: { label: "Dagvatten / dränering", color: "#5E8C3A" },
    },
    lines: [["kanal", "Rör"], ["pil", "Fall/riktning"]], pilHint: "Två tryck: från → till (t.ex. fallets riktning).",
    kinds: [
      { k: "enhet", label: "Enhet", shape: "rect", sys: "VV", ask: "Text (t.ex. VVB, fördelare, mätare):", def: () => "VVB" },
      { k: "tapp", label: "Tappställe", shape: "letter", sym: "T", sys: "KV", relabel: "Text i symbolen (T = blandare, HF = handfat, DH = diskho …):" },
      { k: "wc", label: "WC", shape: "letter", sym: "WC", sys: "SP" },
      { k: "maskin", label: "Maskin", shape: "letter", sym: "TM", sys: "KV", relabel: "Text i symbolen (TM tvättmaskin, DM diskmaskin, KYL …):" },
      { k: "gb", label: "Golvbrunn", shape: "boxx", sys: "SP" },
      { k: "stam", label: "Stam", shape: "square", sys: "SP", ask: "Stammens namn:", def: () => "AS1" },
      { k: "kran", label: "Utekastare", shape: "letter", sym: "UK", sys: "KV" },
    ],
  },
  varme: {
    key: "varme", label: "Värme", icon: "🔥", pre: "VÄ", topics: ["Värme", "Uppvärmning", "Bergvärme"], who: "VVS",
    title: "Värme – underlag till VVS", defSys: "GV",
    sys: {
      GV: { label: "Golvvärme (vattenburen)", color: "#C85A22" },
      RAD: { label: "Radiatorer", color: "#D95748" },
      EGV: { label: "Elgolvvärme", color: "#D99832" },
      KB: { label: "Köldbärare / energibrunn", color: "#12627C" },
      KAM: { label: "Kamin / skorsten", color: "#4A4744" },
    },
    lines: [["kanal", "Rör/krets"], ["pil", "Pil"]],
    kinds: [
      { k: "zon", label: "Värme i rummet", shape: "zone", sys: "GV", relabel: "Text (t.ex. GV, GV krets 3):" },
      { k: "rad", label: "Radiator", shape: "bar", sys: "RAD", unit: "W", w: 1000, h: 120 },
      { k: "fordelare", label: "Fördelare", shape: "rect", sys: "GV", ask: "Text:", def: () => "GVF", w: 600, h: 250 },
      { k: "termostat", label: "Termostat", shape: "letter", sym: "T", sys: "GV" },
      { k: "enhet", label: "Enhet", shape: "rect", sys: "KB", ask: "Text (t.ex. BV, VVB, kamin):", def: () => "BV" },
      { k: "stam", label: "Stam/schakt", shape: "square", sys: "GV", ask: "Namn:", def: () => "S1" },
    ],
  },
};
export const LAYER_KEYS = Object.keys(LAYERS);
export const kindDef = (layer, kind) => LAYERS[layer].kinds.find((d) => d.k === kind) || { k: kind, label: kind, shape: "circle" };
export const sysColor = (layer, sys) => (LAYERS[layer].sys[sys] || Object.values(LAYERS[layer].sys)[0]).color;
export const sysLabel = (layer, sys) => (LAYERS[layer].sys[sys] || { label: sys }).label;
export const layerFields = (key) => [key + "Lines", key + "Pts"];
export const layerOf = (plan, key) => ({ lines: plan?.[key + "Lines"] || [], pts: plan?.[key + "Pts"] || [] });
export const hasLayer = (plan, key) => { const l = layerOf(plan, key); return !!(l.lines.length || l.pts.length); };
export const isTopic = (layer, area) => LAYERS[layer].topics.includes(area);

const ALERT = "#9a4a3a", MUTED = "#8C8780";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const font = "'Avenir Next','Helvetica Neue',Arial,sans-serif";
export const fmtNum = (v, d = 1) => (v == null ? "–" : v.toFixed(d).replace(".", ","));

// The layer's questions (project todos) with their number (vnum) and tag (V3, E1 …).
export function layerQuestions(todos, layer) {
  return (todos || []).filter((t) => isTopic(layer, t.area)).map((t, i) => ({ ...t, vnum: i + 1, tag: LAYERS[layer].pre + (i + 1) }));
}
// Pins of the questions that sit on this plan: [{ q, pin, idx }]
export function layerPins(todos, layer, planId) {
  const out = [];
  for (const q of layerQuestions(todos, layer)) (q.pins || []).forEach((pin, idx) => { if (pin.plan === planId) out.push({ q, pin, idx }); });
  return out;
}

export const LINE_W = 45, DON_R = 120, STAM = 220, PIN_H = 340;
const pinW = (tag) => Math.max(PIN_H, tag.length * 105 + 110);

// Half-extent of a point (for hit tests and the selection ring).
export function ptRadius(layer, p) {
  const s = kindDef(layer, p.kind).shape;
  if (s === "rect" || s === "bar") { const d = kindDef(layer, p.kind); return Math.max(p.w || d.w || 600, p.h || d.h || 600) / 2; }
  if (s === "square") return STAM / 2;
  if (s === "letter") return DON_R * 1.2;
  if (s === "boxx") return 140;
  if (s === "zone") return 220;
  if (s === "dot") return 80;
  return DON_R;
}

// SVG markup (string) of one layer; `pins` = layerPins(...), `grid` = areaGrid of the plan (for zones).
export function layerSvg(layer, { lines = [], pts = [] }, pins = [], grid = null) {
  const L = LAYERS[layer];
  let s = "";
  const zones = pts.filter((p) => kindDef(layer, p.kind).shape === "zone");
  for (const p of zones) {
    const c = sysColor(layer, p.sys), r = grid ? regionAt(grid, p.x, p.y) : -1;
    if (r >= 0) for (const [x0, y0, x1, y1] of regionRects(grid, [r])) s += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${c}" opacity="0.17"/>`;
    else s += `<circle cx="${p.x}" cy="${p.y}" r="400" fill="${c}" opacity="0.17"/>`;
  }
  for (const l of lines) {
    const c = sysColor(layer, l.sys), q = l.pts || [];
    if (q.length < 2) continue;
    s += `<polyline points="${q.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="${LINE_W}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (l.arrow) {
      const [x1, y1] = q[q.length - 2], [x2, y2] = q[q.length - 1], a = Math.atan2(y2 - y1, x2 - x1), h = 230;
      s += `<polygon points="${x2},${y2} ${x2 - h * Math.cos(a - 0.45)},${y2 - h * Math.sin(a - 0.45)} ${x2 - h * Math.cos(a + 0.45)},${y2 - h * Math.sin(a + 0.45)}" fill="${c}"/>`;
    }
  }
  for (const p of pts) {
    const d = kindDef(layer, p.kind), c = sysColor(layer, p.sys);
    const val = p.flow && d.unit ? `${String(p.flow).replace(".", ",")} ${d.unit}` : "";
    if (d.shape === "zone") {
      const r = grid ? regionAt(grid, p.x, p.y) : -1, m2 = r >= 0 ? regionArea(grid, r) : null;
      const t = [p.label || p.sys, m2 ? fmtNum(m2) + " m²" : ""].filter(Boolean).join(" ");
      s += `<text x="${p.x}" y="${p.y + 55}" text-anchor="middle" font-size="150" font-weight="700" fill="${c}" stroke="#fff" stroke-width="40" paint-order="stroke" font-family="${font}">${esc(t)}</text>`;
    } else if (d.shape === "square") {
      s += `<rect x="${p.x - STAM / 2}" y="${p.y - STAM / 2}" width="${STAM}" height="${STAM}" fill="${c}" stroke="#fff" stroke-width="22"/>`;
      // lside: -1 = text to the left of the shaft (two shafts side by side)
      if (p.label) s += `<text x="${p.lside === -1 ? p.x - STAM / 2 - 50 : p.x + STAM / 2 + 50}" y="${p.y + 60}"${p.lside === -1 ? ' text-anchor="end"' : ""} font-size="170" font-weight="700" fill="${c}" font-family="${font}">${esc(p.label)}</text>`;
    } else if (d.shape === "rect" || d.shape === "bar") {
      const w = p.w || d.w || 600, h = p.h || d.h || 600;
      s += `<rect x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" fill="${c}" stroke="#fff" stroke-width="22"/>`;
      if (d.shape === "rect" && p.label) s += `<text x="${p.x}" y="${p.y + 55}" text-anchor="middle" font-size="${Math.round(Math.min(170, h * 0.6, (w * 0.85) / (0.6 * Math.max(1, String(p.label).length))))}" font-weight="700" fill="#fff" font-family="${font}">${esc(p.label)}</text>`;
      const t = [d.shape === "bar" ? p.label : "", val].filter(Boolean).join(" ");
      if (t) s += `<text x="${p.x}" y="${p.y - h / 2 - 50}" text-anchor="middle" font-size="130" fill="${c}" font-family="${font}">${esc(t)}</text>`;
    } else if (d.shape === "boxx") {
      const r = 130;
      s += `<rect x="${p.x - r}" y="${p.y - r}" width="${2 * r}" height="${2 * r}" fill="#fff" stroke="${c}" stroke-width="30"/>`;
      s += `<path d="M ${p.x - r} ${p.y - r} L ${p.x + r} ${p.y + r} M ${p.x - r} ${p.y + r} L ${p.x + r} ${p.y - r}" stroke="${c}" stroke-width="20"/>`;
    } else if (d.shape === "dot") {
      s += `<circle cx="${p.x}" cy="${p.y}" r="70" fill="${c}" stroke="#fff" stroke-width="18"/>`;
    } else if (d.shape === "letter") {
      const t = p.label || d.sym || "?", R = DON_R * 1.2, fs = t.length <= 1 ? 170 : t.length === 2 ? 125 : 95;
      s += `<circle cx="${p.x}" cy="${p.y}" r="${R}" fill="#fff" stroke="${c}" stroke-width="28"/>`;
      s += `<text x="${p.x}" y="${p.y + fs * 0.35}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${c}" font-family="${font}">${esc(t)}</text>`;
      if (val) s += `<text x="${p.x}" y="${p.y - R - 50}" text-anchor="middle" font-size="130" fill="${c}" font-family="${font}">${esc(val)}</text>`;
    } else {
      s += `<circle cx="${p.x}" cy="${p.y}" r="${DON_R}" fill="#fff" stroke="${c}" stroke-width="32"/>`;
      if (d.shape === "cross") {
        const k = DON_R * 0.62;
        s += `<path d="M ${p.x - k} ${p.y - k} L ${p.x + k} ${p.y + k} M ${p.x - k} ${p.y + k} L ${p.x + k} ${p.y - k}" stroke="${c}" stroke-width="24"/>`;
      }
      if (val) s += `<text x="${p.x}" y="${p.y - DON_R - 50}" text-anchor="middle" font-size="140" fill="${c}" font-family="${font}">${esc(val)}</text>`;
    }
  }
  for (const { q, pin } of pins) {
    const done = q.status === "Klar", tag = q.tag || L.pre + q.vnum, w = pinW(tag);
    s += `<rect x="${pin.x - w / 2}" y="${pin.y - PIN_H / 2}" width="${w}" height="${PIN_H}" rx="${PIN_H / 2}" fill="${done ? MUTED : ALERT}" stroke="#fff" stroke-width="30"/>`;
    s += `<text x="${pin.x}" y="${pin.y + 55}" text-anchor="middle" font-size="150" font-weight="700" fill="#fff" font-family="${font}">${esc(tag)}</text>`;
  }
  return s;
}

// Several layers on one plan: [{ key, lines, pts, pins, faded? }] – zones of all layers first so symbols stay on top.
export function instSvg(layers, grid) {
  let s = "";
  for (const l of layers) {
    const body = layerSvg(l.key, l, l.pins || [], grid);
    s += l.faded ? `<g opacity="0.3">${body}</g>` : body;
  }
  return s;
}

// Systems actually used on some plans (for the legend), in the layer's order.
export function systemsUsed(layer, plans) {
  const used = new Set();
  for (const p of plans) { const l = layerOf(p, layer); for (const x of [...l.lines, ...l.pts]) used.add(x.sys); }
  return Object.keys(LAYERS[layer].sys).filter((k) => used.has(k));
}
// Kinds used (for the symbol key).
export function kindsUsed(layer, plans) {
  const used = new Set();
  for (const p of plans) for (const x of layerOf(p, layer).pts) used.add(x.kind);
  return LAYERS[layer].kinds.filter((d) => used.has(d.k));
}

// Hit test (plan mm) for the planner's select tool: pins first, then points, then lines.
export function layerHit(layer, { lines = [], pts = [] }, pins, x, y, tol = 150) {
  for (const { q, pin, idx } of pins) if (Math.abs(pin.x - x) < pinW(q.tag || "") / 2 + tol && Math.abs(pin.y - y) < PIN_H / 2 + tol) return { kind: "pin", id: q.id, idx };
  for (const p of [...pts].reverse()) {
    const d = kindDef(layer, p.kind), r = ptRadius(layer, p);
    const rx = d.shape === "rect" || d.shape === "bar" ? (p.w || d.w || 600) / 2 : r, ry = d.shape === "rect" || d.shape === "bar" ? (p.h || d.h || 600) / 2 : r;
    if (Math.abs(p.x - x) < rx + tol && Math.abs(p.y - y) < ry + tol) return { kind: "pt", id: p.id };
  }
  for (const l of lines) {
    const q = l.pts || [];
    for (let i = 0; i < q.length; i++) if (Math.hypot(q[i][0] - x, q[i][1] - y) < tol + 40) return { kind: "line", id: l.id, vertex: i };
    for (let i = 0; i < q.length - 1; i++) {
      const [ax, ay] = q[i], [bx, by] = q[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      if (Math.hypot(ax + t * dx - x, ay + t * dy - y) < tol) return { kind: "line", id: l.id, vertex: -1 };
    }
  }
  return null;
}

const pretty = (n) => { const t = (n || "").toLowerCase().replace(/(?<!\p{L})(wc|kpr|tv|d)(?!\p{L})/gu, (m) => m.toUpperCase()); return t.charAt(0).toUpperCase() + t.slice(1); };

// Ventilation flow requirement per room (BBR general ventilation 0,35 l/s per m² floor area).
export const BBR_LS_PER_M2 = 0.35;
// One row per room label of a floor plan: m², BBR requirement and the exhaust terminals inside the room.
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
export const fmtLs = (v) => fmtNum(v);

// Förteckning per rum for any layer: what of the layer sits in each room (count per kind/label, sum of values,
// m² of zones). Points outside every labelled room land in a last row "Utanför rummen".
export function layerRoomRows(plan, layer, floor = "") {
  if (!plan?.room) return [];
  const grid = areaGrid(plan.room, plan.walls || []), sm = areaSummary(grid, plan.areas || []);
  const rows = [], byReg = new Map();
  for (const a of plan.areas || []) {
    const r = regionAt(grid, a.x, a.y);
    if (r >= 0 && byReg.has(r)) continue;
    const row = { floor, id: a.id, name: pretty(a.name), m2: sm?.byArea[a.id] ?? null, kind: a.kind || "boa", items: new Map() };
    rows.push(row); if (r >= 0) byReg.set(r, row);
  }
  const other = { floor, id: "_ute", name: "Utanför rummen", m2: null, kind: "x", items: new Map() };
  for (const p of layerOf(plan, layer).pts) {
    const d = kindDef(layer, p.kind), r = regionAt(grid, p.x, p.y), row = byReg.get(r) || other;
    const named = d.shape === "rect" || d.shape === "square" || d.shape === "bar";
    const label = d.shape === "zone" ? sysLabel(layer, p.sys) : named ? (p.label ? (d.shape === "square" ? `${d.label} ${p.label}` : p.label) : d.label) : d.shape === "letter" && p.label && p.label !== d.sym ? `${d.label} ${p.label}` : d.label;
    const e = row.items.get(label) || { label, sys: p.sys, n: 0, val: 0, unit: d.unit || "", m2: 0, zone: d.shape === "zone" };
    e.n++;
    if (p.flow) e.val += parseFloat(String(p.flow).replace(",", ".")) || 0;
    if (e.zone && r >= 0) e.m2 += regionArea(grid, r);
    row.items.set(label, e);
  }
  if (other.items.size) rows.push(other);
  return rows.filter((r) => r.kind !== "ute" || r.items.size).map((r) => ({ ...r, items: [...r.items.values()] }));
}
export const itemText = (e) => (e.zone ? `${e.label} ${fmtNum(e.m2)} m²` : `${e.label}${e.n > 1 ? " ×" + e.n : ""}${e.val ? ` (${fmtNum(e.val, 0)} ${e.unit})` : ""}`);
