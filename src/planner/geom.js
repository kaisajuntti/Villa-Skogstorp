// Shared plan geometry for the planner and the static SVG/PDF renderer:
// opening geometry, anchored dimension lines and room areas (m²) computed from the walls.
export const WALL = 200;
// A room boundary ("rumsgräns", wall with `sep`) is drawn as a dashed line and only
// separates areas; it blocks the area fill with this nominal thickness.
export const SEP_T = 10;

export function wallGeom(wall, rw, rl) {
  switch (wall) {
    case "N": return { A: [0, 0], along: [1, 0], inward: [0, 1], L: rw };
    case "S": return { A: [0, rl], along: [1, 0], inward: [0, -1], L: rw };
    case "W": return { A: [0, 0], along: [0, 1], inward: [1, 0], L: rl };
    case "E": return { A: [rw, 0], along: [0, 1], inward: [-1, 0], L: rl };
    default: return null;
  }
}

// Unified opening geometry: room wall (o.wall) or freeform wall segment (o.wallId, o.seg).
// Band across the wall = e0..e1 along `inward` (room wall: -WALL..0, freeform: ±T/2).
export function openGeom(o, room, walls) {
  if (o.wallId != null) {
    const w = (walls || []).find((x) => x.id === o.wallId);
    if (!w || !w.pts[o.seg] || !w.pts[o.seg + 1]) return null;
    const A = w.pts[o.seg], B = w.pts[o.seg + 1];
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L = Math.hypot(dx, dy) || 1;
    const along = [dx / L, dy / L];
    const T = w.w ?? WALL;
    return { A: [A[0], A[1]], along, inward: [-along[1], along[0]], L, T, e0: -T / 2, e1: T / 2, free: true };
  }
  const g = wallGeom(o.wall, room.w, room.l);
  return g ? { ...g, T: WALL, e0: -WALL, e1: 0, free: false } : null;
}

// ---------- snap candidates with anchors ----------
// A dimension end that was snapped to a feature keeps a reference to it (`ra` / `rb`), so the
// dimension follows when the wall, opening, object or room size changes.
//   { k:"rc", fx, fy }               room corner / edge midpoint
//   { k:"it", id, fx, fy }           furniture point
//   { k:"wv", id, i }                freeform wall vertex (centre line)
//   { k:"wf", id, seg, end, n }      freeform wall face corner (end 0 = A, 1 = B; n = ±1 side)
//   { k:"wp", id, seg, t, n }        point on a freeform wall face, t mm from A along the segment
//   { k:"op", id, end, f }           opening edge (end 0 = start, 1 = end; f = 0 / 1 across the band)
export function anchorPt(ref, { room, walls = [], items = [], openings = [] }) {
  if (!ref) return null;
  if (ref.k === "rc") return [ref.fx * room.w, ref.fy * room.l];
  if (ref.k === "it") {
    const it = items.find((x) => x.id === ref.id);
    return it ? [it.x + ref.fx * it.w, it.y + ref.fy * it.h] : null;
  }
  if (ref.k === "wv") {
    const w = walls.find((x) => x.id === ref.id);
    return w && w.pts[ref.i] ? [w.pts[ref.i][0], w.pts[ref.i][1]] : null;
  }
  if (ref.k === "wf") {
    const w = walls.find((x) => x.id === ref.id);
    if (!w || !w.pts[ref.seg] || !w.pts[ref.seg + 1]) return null;
    const A = w.pts[ref.seg], B = w.pts[ref.seg + 1];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L, h = (w.w ?? WALL) / 2 * ref.n;
    const P = ref.end ? B : A;
    return [P[0] - uy * h, P[1] + ux * h];
  }
  if (ref.k === "wp") {
    const w = walls.find((x) => x.id === ref.id);
    if (!w || !w.pts[ref.seg] || !w.pts[ref.seg + 1]) return null;
    const A = w.pts[ref.seg], B = w.pts[ref.seg + 1];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L, h = (w.w ?? WALL) / 2 * ref.n;
    const t = Math.max(0, Math.min(L, ref.t));
    return [A[0] + ux * t - uy * h, A[1] + uy * t + ux * h];
  }
  if (ref.k === "op") {
    const o = openings.find((x) => x.id === ref.id);
    const g = o && openGeom(o, room, walls);
    if (!g) return null;
    const d = ref.end ? o.pos + o.len : o.pos, e = g.e0 + (ref.f || 0) * (g.e1 - g.e0);
    return [g.A[0] + g.along[0] * d + g.inward[0] * e, g.A[1] + g.along[1] * d + g.inward[1] * e];
  }
  return null;
}

export function snapCandidates({ room, walls = [], items = [], openings = [] }) {
  const c = [];
  const add = (ref, ctx) => { const p = anchorPt(ref, ctx); if (p) c.push({ p, ref }); };
  const ctx = { room, walls, items, openings };
  if (room.frame !== false)
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]]) add({ k: "rc", fx, fy }, ctx);
  for (const it of items)
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5], [0.5, 0.5]]) add({ k: "it", id: it.id, fx, fy }, ctx);
  for (const w of walls) {
    (w.pts || []).forEach((_, i) => add({ k: "wv", id: w.id, i }, ctx));
    if (w.sep) continue;
    for (let s = 0; s < (w.pts || []).length - 1; s++)
      for (const end of [0, 1]) for (const n of [-1, 1]) add({ k: "wf", id: w.id, seg: s, end, n }, ctx);
  }
  for (const o of openings)
    for (const end of [0, 1]) for (const f of [0, 1]) add({ k: "op", id: o.id, end, f }, ctx);
  return c;
}

// Nearest point on a wall face (when no corner/edge is close): lets a measurement start
// anywhere along a wall and still follow it.
export function faceSnap({ walls = [] }, p, tol) {
  let best = null, bestD = tol;
  for (const w of walls) {
    if (w.sep || !w.pts) continue;
    const h = (w.w ?? WALL) / 2;
    for (let s = 0; s < w.pts.length - 1; s++) {
      const A = w.pts[s], B = w.pts[s + 1], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (!L) continue;
      const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
      const t = (p[0] - A[0]) * ux + (p[1] - A[1]) * uy;
      if (t < 0 || t > L) continue;
      const d = -(p[0] - A[0]) * uy + (p[1] - A[1]) * ux; // signed distance from the centre line
      for (const n of [-1, 1]) {
        const e = Math.abs(d - n * h);
        if (e < bestD) { bestD = e; best = { p: [A[0] + ux * t - uy * h * n, A[1] + uy * t + ux * h * n], d: e, ref: { k: "wp", id: w.id, seg: s, t: Math.round(t), n } }; }
      }
    }
  }
  return best;
}

// ---------- dimension lines ----------
// dm = { id, a, b, off, ra?, rb?, ax?: "x"|"y", lt?, ls? }. `ax` keeps a dimension horizontal ("x")
// or vertical ("y") when its anchors move; `lt` slides the label along the line, `ls: -1` puts it on
// the other side of the line (short chain pieces).
export function resolveDim(dm, ctx) {
  const a = anchorPt(dm.ra, ctx) || dm.a, b = anchorPt(dm.rb, ctx) || dm.b;
  return { ...dm, a: [Math.round(a[0]), Math.round(a[1])], b: [Math.round(b[0]), Math.round(b[1])] };
}
export const resolveDims = (dims, ctx) => (dims || []).filter((d) => d.a && d.b).map((d) => resolveDim(d, ctx));

// Drawing geometry of a (resolved) dimension: measured points, the offset dimension line,
// its length and where/how the label sits (always readable: never upside down).
export function dimGeom(dm) {
  const a = dm.a;
  const b = dm.ax === "x" ? [dm.b[0], a[1]] : dm.ax === "y" ? [a[0], dm.b[1]] : dm.b;
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const off = dm.off || 0;
  const a2 = [a[0] + nx * off, a[1] + ny * off], b2 = [b[0] + nx * off, b[1] + ny * off];
  const lt = dm.lt || 0, s = (off >= 0 ? 1 : -1) * (dm.ls === -1 ? -1 : 1);
  const lab = [(a2[0] + b2[0]) / 2 + ux * lt + nx * s * 95, (a2[1] + b2[1]) / 2 + uy * lt + ny * s * 95];
  let ang = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (ang > 90.5) ang -= 180; else if (ang <= -89.5) ang += 180;
  return { a, b, a2, b2, ext: [dm.a, dm.b], L: Math.round(L), lab, ang, n: [nx, ny] };
}

// Bounding box [x0, y0, x1, y1] of resolved dimension lines incl. labels (to fit the view).
export function dimsBounds(dims) {
  let b = null;
  for (const d of dims) {
    const g = dimGeom(d);
    for (const [x, y] of [g.a2, g.b2, g.lab, ...g.ext]) {
      if (!b) b = [x, y, x, y];
      b = [Math.min(b[0], x - 200), Math.min(b[1], y - 200), Math.max(b[2], x + 200), Math.max(b[3], y + 200)];
    }
  }
  return b;
}

// ---------- room areas ----------
// Every wall as a band: centre segment A→B with thickness T (butt ends). Rectangle room walls
// sit outside the interior and overlap at the corners, freeform polylines get corner squares.
export function wallBands(room, walls) {
  const out = [];
  if (room && room.frame !== false) {
    const W = WALL, h = W / 2, rw = room.w, rl = room.l;
    out.push({ A: [-W, -h], B: [rw + W, -h], T: W }, { A: [-W, rl + h], B: [rw + W, rl + h], T: W },
      { A: [-h, -W], B: [-h, rl + W], T: W }, { A: [rw + h, -W], B: [rw + h, rl + W], T: W });
  }
  for (const w of walls || []) {
    const pts = w.pts || [];
    const T = w.sep ? SEP_T : (w.w ?? WALL);
    for (let i = 0; i < pts.length - 1; i++) out.push({ A: pts[i], B: pts[i + 1], T });
    for (let i = 1; i < pts.length - 1; i++) out.push({ A: [pts[i][0] - T / 2, pts[i][1]], B: [pts[i][0] + T / 2, pts[i][1]], T });
  }
  return out.filter((b) => b.A[0] !== b.B[0] || b.A[1] !== b.B[1]);
}

// Area grid: cell borders at every wall face (exact for straight, axis-parallel walls) plus a
// 100 mm grid when a wall is diagonal. Openings count as closed, so a door closes the room.
export function areaGrid(room, walls) {
  const bands = wallBands(room, walls).map((b) => {
    const dx = b.B[0] - b.A[0], dy = b.B[1] - b.A[1], L = Math.hypot(dx, dy);
    return { ...b, ux: dx / L, uy: dy / L, L, diag: Math.abs(dx) > 1e-9 && Math.abs(dy) > 1e-9 };
  });
  if (!bands.length) return null;
  const xs = new Set(), ys = new Set();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, diag = false;
  for (const b of bands) {
    const h = b.T / 2, cs = [];
    for (const P of [b.A, b.B]) for (const s of [-1, 1]) cs.push([P[0] - b.uy * h * s, P[1] + b.ux * h * s]);
    if (Math.abs(b.ux) > 1e-9 && Math.abs(b.uy) > 1e-9) diag = true;
    for (const [x, y] of cs) { xs.add(Math.round(x * 10) / 10); ys.add(Math.round(y * 10) / 10); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  x0 -= 100; y0 -= 100; x1 += 100; y1 += 100;
  xs.add(x0); xs.add(x1); ys.add(y0); ys.add(y1);
  if (diag) {
    for (let x = Math.ceil(x0 / 100) * 100; x < x1; x += 100) xs.add(x);
    for (let y = Math.ceil(y0 / 100) * 100; y < y1; y += 100) ys.add(y);
  }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  const nx = X.length - 1, ny = Y.length - 1;
  const blocked = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const cy = (Y[j] + Y[j + 1]) / 2;
    for (let i = 0; i < nx; i++) {
      const cx = (X[i] + X[i + 1]) / 2;
      const r = Math.hypot(X[i + 1] - X[i], Y[j + 1] - Y[j]) / 2;
      for (const b of bands) {
        const rx = cx - b.A[0], ry = cy - b.A[1];
        const t = rx * b.ux + ry * b.uy, d = -rx * b.uy + ry * b.ux;
        // 1 mm tolerance: walls that meet at half-millimetre faces leave no hairline gap for the fill;
        // a diagonal wall blocks every cell it touches (a thin one could slip between cell centres)
        const e = b.diag ? r : 1;
        if (t > -e && t < b.L + e && Math.abs(d) < b.T / 2 + e) { blocked[j * nx + i] = 1; break; }
      }
    }
  }
  return { X, Y, nx, ny, blocked };
}

// Area (m²) of the enclosed region around (x, y); null when the point is in a wall or the
// region is open to the outside.
export function areaAt(grid, x, y) {
  if (!grid) return null;
  const { X, Y, nx, ny, blocked } = grid;
  const find = (A, v) => { let lo = 0, hi = A.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m] <= v) lo = m; else hi = m - 1; } return lo; };
  if (x <= X[0] || x >= X[nx] || y <= Y[0] || y >= Y[ny]) return null;
  const i0 = find(X, x), j0 = find(Y, y);
  if (blocked[j0 * nx + i0]) return null;
  const seen = new Uint8Array(nx * ny), stack = [j0 * nx + i0];
  seen[stack[0]] = 1;
  let area = 0;
  while (stack.length) {
    const c = stack.pop(), i = c % nx, j = (c - i) / nx;
    if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) return null; // leaked outside
    area += (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]);
    for (const n of [c - 1, c + 1, c - nx, c + nx]) if (!seen[n] && !blocked[n]) { seen[n] = 1; stack.push(n); }
  }
  return area / 1e6;
}

// Room area classes for the floor summary (SS 21054): BOA boarea, BIA biarea, EJ = not counted (e.g. the
// stairwell on the upper floor – a stair counts on the floor it starts from), UTE = outdoors (balkong, terrass):
// its m² is shown, and a wall towards it is an outer wall (not counted, like a wall towards the outside).
export const AREA_KINDS = [["boa", "BOA"], ["bia", "BIA"], ["ej", "Räknas ej"], ["ute", "Ute"]];

// Floor summary: m² per room label plus BOA/BIA totals the way SS 21054 measures them – to the inside of the
// outer walls, interior walls included (a wall between two counted rooms is split half/half; a wall towards the
// outside or an unlabelled space such as a krypgrund is not counted).
export function areaSummary(grid, areas) {
  if (!grid || !areas?.length) return null;
  const { X, Y, nx, ny, blocked } = grid;
  const find = (A, v) => { let lo = 0, hi = A.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m] <= v) lo = m; else hi = m - 1; } return lo; };
  // label every free region (a region touching the grid border is the outside) and find each wall cell's two
  // neighbouring regions across its thinner direction – cached per grid, labels only pick kinds
  const { reg, regArea, regOut, wallCells } = gridRegions(grid);
  const kindOf = new Map(), byArea = {}, sum = { boa: 0, bia: 0, ej: 0, ute: 0 }, rooms = { boa: 0, bia: 0, ej: 0, ute: 0 }, walls = { boa: 0, bia: 0, ej: 0, ute: 0 };
  for (const ar of areas) {
    const x = ar.x, y = ar.y;
    if (x <= X[0] || x >= X[nx] || y <= Y[0] || y >= Y[ny]) { byArea[ar.id] = null; continue; }
    const r = reg[find(Y, y) * nx + find(X, x)];
    if (r < 0 || regOut[r]) { byArea[ar.id] = null; continue; }
    byArea[ar.id] = regArea[r] / 1e6;
    if (!kindOf.has(r)) { const k = ar.kind || "boa"; kindOf.set(r, k); rooms[k] += regArea[r] / 1e6; }
  }
  for (const [ra, rb, a] of wallCells) {
    const ka = kindOf.get(ra), kb = kindOf.get(rb);
    if (!ka || !kb || ka === "ute" || kb === "ute") continue; // towards the outside / an unlabelled space: measured to the inside face
    walls[ka] += a / 2e6; walls[kb] += a / 2e6;
  }
  for (const k of Object.keys(sum)) sum[k] = rooms[k] + walls[k];
  return { byArea, sum, rooms, walls };
}
const regionCache = new WeakMap();
function gridRegions(grid) {
  if (!regionCache.has(grid)) {
    const { X, Y, nx } = grid;
    regionCache.set(grid, regions(grid, (c) => { const i = c % nx, j = (c - i) / nx; return (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]); }));
  }
  return regionCache.get(grid);
}

// Index of the closed room region at (x, y), or -1 (in a wall, outside, or open to the outside).
export function regionAt(grid, x, y) {
  if (!grid) return -1;
  const { X, Y, nx, ny } = grid;
  if (x <= X[0] || x >= X[nx] || y <= Y[0] || y >= Y[ny]) return -1;
  const find = (A, v) => { let lo = 0, hi = A.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m] <= v) lo = m; else hi = m - 1; } return lo; };
  const { reg, regOut } = gridRegions(grid);
  const r = reg[find(Y, y) * nx + find(X, x)];
  return r < 0 || regOut[r] ? -1 : r;
}

// m² of a region index from regionAt (0 for -1).
export function regionArea(grid, r) {
  return grid && r >= 0 ? gridRegions(grid).regArea[r] / 1e6 : 0;
}

// The regions as rectangles [x0, y0, x1, y1] (row runs, stacked runs merged), grown by pad mm –
// for highlighting a room or masking everything around a focused one.
export function regionRects(grid, regIds, pad = 0) {
  if (!grid || !regIds.length) return [];
  const { X, Y, nx, ny } = grid, { reg } = gridRegions(grid), want = new Set(regIds);
  let open = new Map(); const out = [];
  for (let j = 0; j < ny; j++) {
    const next = new Map();
    for (let i = 0; i < nx; i++) {
      if (!want.has(reg[j * nx + i])) continue;
      let k = i; while (k + 1 < nx && want.has(reg[j * nx + k + 1])) k++;
      const key = i + ":" + k, prev = open.get(key);
      if (prev) { prev[3] = Y[j + 1]; next.set(key, prev); open.delete(key); }
      else next.set(key, [X[i], Y[j], X[k + 1], Y[j + 1]]);
      i = k;
    }
    for (const r of open.values()) out.push(r);
    open = next;
  }
  for (const r of open.values()) out.push(r);
  return out.map(([a, b, c, d]) => [a - pad, b - pad, c + pad, d + pad]);
}
function regions(grid, cellA) {
  const { X, Y, nx, ny, blocked } = grid;
  const reg = new Int32Array(nx * ny).fill(-1), regArea = [], regOut = [];
  for (let s = 0; s < nx * ny; s++) {
    if (blocked[s] || reg[s] >= 0) continue;
    const r = regArea.length; let a = 0, out = false; const st = [s]; reg[s] = r;
    while (st.length) {
      const c = st.pop(), i = c % nx, j = (c - i) / nx;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) out = true;
      a += cellA(c);
      for (const n of [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1])
        if (n >= 0 && !blocked[n] && reg[n] < 0) { reg[n] = r; st.push(n); }
    }
    regArea.push(a); regOut.push(out);
  }
  // wall cells: the nearest free cell on each side, across the thinner direction of the wall
  const wallCells = [];
  const side = (c, d, max) => { let k = c + d, n = 0; while (n++ < max && k >= 0 && k < nx * ny && blocked[k]) k += d; return k >= 0 && k < nx * ny && !blocked[k] ? k : -1; };
  for (let c = 0; c < nx * ny; c++) {
    if (!blocked[c]) continue;
    const i = c % nx, l = side(c, -1, i), r = side(c, 1, nx - 1 - i), u = side(c, -nx, ny), d = side(c, nx, ny);
    const sx = l >= 0 && r >= 0 && Math.floor(l / nx) === Math.floor(c / nx) && Math.floor(r / nx) === Math.floor(c / nx) ? X[r % nx] - X[l % nx + 1] : Infinity;
    const sy = u >= 0 && d >= 0 ? Y[Math.floor(d / nx)] - Y[Math.floor(u / nx) + 1] : Infinity;
    if (sx === Infinity && sy === Infinity) continue;
    const [a, b] = sx <= sy ? [l, r] : [u, d];
    wallCells.push([reg[a], reg[b], cellA(c)]);
  }
  return { reg, regArea, regOut, wallCells };
}

// Lines of the floor summary box drawn under the plan (planner + PDF).
export function areaLegend(sm) {
  if (!sm) return [];
  const f = (v) => v.toFixed(1).replace(".", ",") + " m²";
  const out = [{ t: "BOA " + f(sm.sum.boa), big: true }];
  if (sm.sum.bia > 0.05) out.push({ t: "BIA " + f(sm.sum.bia), big: true });
  out.push({ t: `rum ${f(sm.rooms.boa + sm.rooms.bia)} + innerväggar ${f(sm.walls.boa + sm.walls.bia)}` });
  if (sm.sum.ej > 0.05) out.push({ t: "räknas ej " + f(sm.sum.ej) + " (trapphål o.d.)" });
  if (sm.sum.ute > 0.05) out.push({ t: "ute " + f(sm.sum.ute) + " (balkong o.d.)" });
  out.push({ t: "SS 21054: till ytterväggarnas insida" });
  return out;
}
export const LEGEND_STEP = 360;
export const kindTag = (k) => (k === "bia" ? " · BIA" : k === "ej" ? " · ej" : k === "ute" ? " · ute" : "");

// "10,4 m²" (Swedish decimal comma), or "– m²" for an open region.
export const fmtM2 = (v) => (v == null ? "– m²" : v.toFixed(1).replace(".", ",") + " m²");
