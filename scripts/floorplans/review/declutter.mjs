// Move dimension labels (lt/ls) and room labels (x,y) away from collisions. declutter.mjs in.json out.json
import { resolveDims, dimGeom, wallBands, areaGrid, regionAt, openGeom } from "../../../src/planner/geom.js";
import { itemLabel } from "../../../src/planner/planSvg.js";
import fs from "fs";
const [,, inp, outp] = process.argv;
const P = JSON.parse(fs.readFileSync(inp, "utf8")).plan;
const ctx = { room: P.room, walls: P.walls, items: P.items, openings: P.openings };
const dims = resolveDims(P.dims, ctx);
// oriented boxes -> polygons; overlap via SAT on convex quads
const box = (cx, cy, w, h, angDeg) => { const a = angDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]); };
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function sat(A, B) {
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % 4], nx = y1 - y2, ny = x2 - x1;
    const pa = A.map(([x, y]) => x * nx + y * ny), pb = B.map(([x, y]) => x * nx + y * ny);
    if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
  }
  return true;
}
const segQuad = (A, B, t) => { const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * t / 2, ny = dx / L * t / 2;
  return [[A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny], [A[0] - nx, A[1] - ny]]; };
// static obstacles
const obs = [];
for (const b of wallBands(P.room, P.walls)) if (!b.sep) obs.push({ q: segQuad(b.A, b.B, b.T), w: 3, k: "wall" });
for (const o of P.openings) {
  if (o.kind !== "dorr" && o.kind !== "pardorr") continue;
  const g = openGeom(o, P.room, P.walls); if (!g) continue;
  const side = (o.out ?? (o.kind === "pardorr" ? o.flip : false)) ? -1 : 1;
  const A = [g.A[0] + g.along[0] * o.pos, g.A[1] + g.along[1] * o.pos], B = [g.A[0] + g.along[0] * (o.pos + o.len), g.A[1] + g.along[1] * (o.pos + o.len)];
  const d = o.kind === "pardorr" ? o.len / 2 : o.len, iw = [g.inward[0] * side * d, g.inward[1] * side * d];
  obs.push({ q: [A, B, [B[0] + iw[0], B[1] + iw[1]], [A[0] + iw[0], A[1] + iw[1]]], w: 1.5, k: "swing" });
}
for (const it of P.items) {
  obs.push({ q: rect(it.x, it.y, it.x + it.w, it.y + it.h), w: 0.4, k: "item" });
  if (it.t) { const l = itemLabel(it), tw = it.t.length * l.fs * 0.6, th = l.fs; obs.push({ q: l.horiz ? rect(l.cx - tw / 2, l.cy - th / 2, l.cx + tw / 2, l.cy + th / 2) : rect(l.cx - th / 2, l.cy - tw / 2, l.cx + th / 2, l.cy + tw / 2), w: 3, k: "itemlabel" }); }
}
for (const c of P.comments || []) {
  obs.push({ q: rect(c.tx - 150, c.ty - 150, c.tx + 150, c.ty + 150), w: 3, k: "comment" });
  if (c.photo) { const d = (c.dir ?? 0) * Math.PI / 180; obs.push({ q: segQuad([c.tx, c.ty], [c.tx + Math.cos(d) * 620, c.ty + Math.sin(d) * 620], 160), w: 2, k: "arrow" }); }
}
const areaBox = (ar) => { const n = (ar.name || "").length * 170 * 0.66 + 80, m = 9 * 150 * 0.62 + 80; const w = Math.max(n, m); return rect(ar.x - w / 2, ar.y - 170, ar.x + w / 2, ar.y + 200); };
const dimLab = (d) => { const g = dimGeom(d), w = String(g.L).length * 130 * 0.62 + 50, h = 150; return box(g.lab[0], g.lab[1], w, h, g.ang); };
const dimLine = (d) => { const g = dimGeom(d); return segQuad(g.a2, g.b2, 20); };
function cost(q, skip) {
  let c = 0;
  for (const o of obs) if (o !== skip && o.q !== skip && sat(q, o.q)) c += o.w;
  return c;
}
// dynamic: other dim labels, dim lines, area labels
const dyn = () => [
  ...dims.map((d) => ({ q: dimLab(d), w: 5, k: "dimlab", ref: d })),
  ...dims.map((d) => ({ q: dimLine(d), w: 0.8, k: "dimline", ref: d })),
  ...P.areas.map((a) => ({ q: areaBox(a), w: 4, k: "area", ref: a })),
];
const totalCost = (q, self) => cost(q) + dyn().filter((o) => o.ref !== self && sat(q, o.q)).reduce((s, o) => s + o.w, 0);
let moved = 0;
// 1) room labels: keep inside their region
const grid = areaGrid(P.room, P.walls);
for (const ar of P.areas) {
  const c0 = totalCost(areaBox(ar), ar);
  if (c0 === 0) continue;
  const reg = regionAt(grid, ar.x, ar.y); let best = null;
  for (let dy = -1500; dy <= 1500; dy += 100) for (let dx = -1500; dx <= 1500; dx += 100) {
    const t = { ...ar, x: ar.x + dx, y: ar.y + dy };
    const corners = areaBox(t); if (corners.some(([x, y]) => regionAt(grid, x, y) !== reg)) continue;
    const c = totalCost(areaBox(t), ar) + Math.hypot(dx, dy) / 2000;
    if (!best || c < best.c) best = { c, x: t.x, y: t.y };
  }
  if (best && best.c < c0 - 0.5) { console.log("area", ar.id, ar.name, c0, "->", best.c.toFixed(2), [ar.x, ar.y], "->", [best.x, best.y]); ar.x = best.x; ar.y = best.y; moved++; }
}
// 2) dim labels
for (let pass = 0; pass < 2; pass++) for (const d of dims) {
  const c0 = totalCost(dimLab(d), d);
  if (c0 === 0) continue;
  const g = dimGeom({ ...d, lt: 0 }), L = g.L, wlab = String(L).length * 130 * 0.62 + 50;
  const lts = new Set([0]);
  const room = (L - wlab) / 2 - 20;  // label stays over its own segment
  if (room > 0) for (const f of [-1, -0.75, -0.5, -0.25, 0.25, 0.5, 0.75, 1]) lts.add(Math.round(f * room));
  else for (const s of [-1, 1]) lts.add(Math.round(s * (L / 2 + wlab / 2 + 40)));
  let best = null;
  for (const lt of lts) for (const ls of [1, -1]) {
    const t = { ...d, lt: lt || undefined, ls: ls === -1 ? -1 : undefined };
    const c = totalCost(dimLab(t), d) + Math.abs(lt) / 4000 + (ls === -1 ? 0.15 : 0) + (Math.abs(lt) > L / 2 ? 1.2 : 0);
    if (!best || c < best.c) best = { c, lt, ls };
  }
  if (best.c < c0 - 0.5) {
    const src = P.dims.find((x) => x.id === d.id);
    console.log("dim", d.id, g.L, c0, "->", best.c.toFixed(2), "lt", best.lt, "ls", best.ls);
    for (const o of [src, d]) { if (best.lt) o.lt = best.lt; else delete o.lt; if (best.ls === -1) o.ls = -1; else delete o.ls; }
    moved++;
  }
}
// remaining collisions report
for (const d of dims) { const c = totalCost(dimLab(d), d); if (c >= 3) console.log("still", d.id, dimGeom(d).L, c); }
for (const a of P.areas) { const c = totalCost(areaBox(a), a); if (c >= 3) console.log("still area", a.id, a.name, c); }
console.log("moved", moved);
fs.writeFileSync(outp, JSON.stringify({ plan: P }));
