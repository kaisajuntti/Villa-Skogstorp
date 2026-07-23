import { useState, useRef, useEffect, useCallback } from "react";
import { storage } from "../storage.js";
import { canEdit } from "../config.js";

// Ported from kok-planner-v2 (Claude artifact) — behavior parity.
// Props: storageKey (per-room persistence key), title (room name for header).

// ---------- constants ----------
const WALL = 200;
// Freeform-wall thicknesses (mm). Outer = insulated exterior, inner = partition.
const WALL_OUTER = 300;
const WALL_INNER = 100;
const SNAP = 50;
const ink = "#33312E", blue = "#5A7A8C", paper = "#FAF8F3", cab = "#E4EAED", red = "#9a4a3a";
const mono = "ui-monospace, 'SF Mono', Menlo, monospace";

const OPEN_DEFS = {
  dorr: { label: "Dörr", len: 900 },
  pardorr: { label: "Pardörr", len: 1600 },
  oppning: { label: "Öppning", len: 1000 },
  fonster: { label: "Fönster", len: 1200 },
};

// How far outside the room furniture may be dragged (through / past walls).
const OUT = 4000;

const PALETTE = [
  { t: "BÄNK", w: 600, h: 600 },
  { t: "BÄNK", w: 800, h: 600 },
  { t: "HÖGSKÅP", w: 600, h: 600 },
  { t: "KYL", w: 600, h: 600 },
  { t: "FRYS", w: 600, h: 600 },
  { t: "DM", w: 600, h: 600 },
  { t: "DISKHO", w: 800, h: 600 },
  { t: "HÄLL", w: 750, h: 520 },
  { t: "Ö", w: 1100, h: 2400 },
  { t: "BORD", w: 800, h: 1400 },
  { t: "SÄNG", w: 1600, h: 2000 },
  { t: "SOFFA", w: 2200, h: 900 },
  { t: "GARDEROB", w: 600, h: 600 },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const snap = (v) => Math.round(v / SNAP) * SNAP;

// Snap b onto a pure horizontal/vertical line from a when it is near an axis,
// so measuring straight x/y distances is easy.
function axisLock(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx === 0 && ady === 0) return b;
  if (Math.min(adx, ady) / Math.max(adx, ady) < 0.22) {
    return adx >= ady ? [b[0], a[1]] : [a[0], b[1]];
  }
  return b;
}

// Globally-unique ids (time + counter + random) so items/openings from different
// sessions can never collide — the old counter reset to 1000 each load and caused
// two objects to share an id (moving one moved both).
let _uc = 0;
const uid = (p) => p + Date.now().toString(36) + (_uc++).toString(36) + Math.random().toString(36).slice(2, 4);
// Heal any existing duplicate ids on load.
function dedupe(arr, prefix) {
  const seen = new Set();
  return (arr || []).map((el) => {
    if (el && el.id != null && !seen.has(el.id)) { seen.add(el.id); return el; }
    return { ...el, id: uid(prefix) };
  });
}

// wall geometry helpers: A = start corner, along = unit vector along wall, inward = into room
function wallGeom(wall, rw, rl) {
  switch (wall) {
    case "N": return { A: [0, 0], along: [1, 0], inward: [0, 1], L: rw };
    case "S": return { A: [0, rl], along: [1, 0], inward: [0, -1], L: rw };
    case "W": return { A: [0, 0], along: [0, 1], inward: [1, 0], L: rl };
    case "E": return { A: [rw, 0], along: [0, 1], inward: [-1, 0], L: rl };
    default: return null;
  }
}
const pt = (A, along, d, inward, e = 0) => [A[0] + along[0] * d + inward[0] * e, A[1] + along[1] * d + inward[1] * e];

// Downscale an uploaded image to a JPEG data URL so it stays small enough to
// store and sync. Returns { dataUrl, w, h } (pixels of the downscaled image).
function downscaleImage(file, maxDim = 1600, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: c.toDataURL("image/jpeg", quality), w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

export default function RoomPlanner({ storageKey, title }) {
  const readOnly = !canEdit();
  const [room, setRoom] = useState({ w: 3500, l: 6430 });
  const [openings, setOpenings] = useState([]); // {id, wall, pos, len, kind, flip}
  const [items, setItems] = useState([]);       // {id, t, x, y, w, h}
  const [mode, setMode] = useState("rum");      // rum | oppningar | inredning
  const [tool, setTool] = useState("dorr");
  const [sel, setSel] = useState(null);         // {kind:'op'|'it', id}
  const [group, setGroup] = useState([]);       // item ids in a multi-selection
  const [multiMode, setMultiMode] = useState(false);
  const [undoN, setUndoN] = useState(0);
  const [status, setStatus] = useState("");
  const [view, setView] = useState(null); // null = fit view; {zoom, cx, cy}
  const [full, setFull] = useState(false); // fullscreen the plan (hide app chrome)
  const [wStr, setWStr] = useState("");    // raw text for the Bredd/Längd inputs
  const [lStr, setLStr] = useState("");
  const [bgImg, setBgImg] = useState(null); // { dataUrl, w, h } reference image
  const [bgT, setBgT] = useState(null);     // { x, y, wmm, opacity, visible, rot } transform (in plan)
  const [bgHiddenLocal, setBgHiddenLocal] = useState(false); // per-session quick hide (not saved)
  const [walls, setWalls] = useState([]);   // freeform walls: [{ id, pts:[[x,y],...] }]
  const [activeWall, setActiveWall] = useState(null); // id of the polyline being drawn
  const [wallW, setWallW] = useState(WALL_OUTER); // thickness for the next freeform wall
  const [drawRect, setDrawRect] = useState(false);    // object-draw toggle (drag a rectangle)
  const [rectPreview, setRectPreview] = useState(null);
  const [calib, setCalib] = useState(null);  // { pts:[[x,y],...] } while calibrating the background
  const [measures, setMeasures] = useState([]); // finished ruler segments [[p1,p2],...] (ephemeral)
  const [mStart, setMStart] = useState(null);   // first point of the in-progress measurement
  const [mPreview, setMPreview] = useState(null); // live second point while dragging
  const [snapOn, setSnapOn] = useState(true);   // snap points to object/room/wall corners
  const bgStorageKey = storageKey.replace("plan:", "bg:");
  const bgFileRef = useRef(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const ptrs = useRef(new Map());
  const pinchRef = useRef(null);
  const vbRef = useRef(null);
  const undoRef = useRef([]);
  const loadedRef = useRef(false);

  // ---------- undo ----------
  const takeSnap = () => ({
    room: { ...room },
    openings: openings.map((o) => ({ ...o })),
    items: items.map((i) => ({ ...i })),
    walls: walls.map((w) => ({ ...w, pts: w.pts.map((p) => [...p]) })),
    bg: bgT ? { ...bgT } : null,
  });
  const pushUndo = () => {
    undoRef.current.push(takeSnap());
    if (undoRef.current.length > 80) undoRef.current.shift();
    setUndoN(undoRef.current.length);
  };
  const undo = () => {
    const s = undoRef.current.pop();
    if (!s) return;
    setRoom(s.room); setOpenings(s.openings); setItems(s.items); setWalls(s.walls || []);
    if (s.bg !== undefined) setBgT(s.bg);
    setSel(null); setGroup([]); setUndoN(undoRef.current.length);
  };

  // ---------- persistence ----------
  const applySaved = useCallback((s) => {
    if (s.room) setRoom(s.room);
    if (s.openings) setOpenings(dedupe(s.openings, "o"));
    if (s.items) setItems(dedupe(s.items, "i"));
    setWalls(Array.isArray(s.walls) ? s.walls : []);
    setBgT(s.bg || null);
  }, []);
  useEffect(() => {
    undoRef.current = []; setUndoN(0);
    (async () => {
      try {
        const r = await storage.get(storageKey);
        let s = null;
        if (r && r.value) {
          s = JSON.parse(r.value);
          applySaved(s);
          if (s.openings?.length || s.items?.length) setMode("inredning");
          setStatus("Sparat läge laddat");
        }
        const rb = await storage.get(bgStorageKey);
        if (rb && rb.value) {
          setBgImg(JSON.parse(rb.value));
          if (!s || !s.bg) setBgT({ x: 0, y: 0, wmm: (s?.room?.w || 3500), opacity: 0.5, visible: true, rot: 0 });
        } else {
          setBgImg(null);
        }
      } catch (e) { /* nothing saved yet */ }
      loadedRef.current = true;
    })();
    // Refresh from a remote pull, unless a drag is in progress.
    const onSync = async () => {
      if (dragRef.current) return;
      try {
        const r = await storage.get(storageKey);
        if (r && r.value) { applySaved(JSON.parse(r.value)); setStatus("Uppdaterat från synk"); }
        const rb = await storage.get(bgStorageKey);
        setBgImg(rb && rb.value ? JSON.parse(rb.value) : null);
      } catch { /* ignore */ }
    };
    window.addEventListener("vs-sync", onSync);
    return () => window.removeEventListener("vs-sync", onSync);
  }, [storageKey, bgStorageKey, applySaved]);
  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        await storage.set(storageKey, JSON.stringify({ v: 2, room, openings, items, ...(walls.length ? { walls } : {}), ...(bgT ? { bg: bgT } : {}) }));
        setStatus("Sparat");
      } catch (e) { setStatus("Kunde inte spara"); }
    }, 800);
    return () => clearTimeout(t);
  }, [room, openings, items, walls, bgT, storageKey]);

  // ---------- viewbox (zoom/pan aware) ----------
  const M = 480;
  // Grow the fit-view to include any furniture placed outside the room.
  let bx0 = -WALL, by0 = -WALL, bx1 = room.w + WALL, by1 = room.l + WALL;
  for (const it of items) {
    if (it.x < bx0) bx0 = it.x;
    if (it.y < by0) by0 = it.y;
    if (it.x + it.w > bx1) bx1 = it.x + it.w;
    if (it.y + it.h > by1) by1 = it.y + it.h;
  }
  const BASE = { x: bx0 - M, y: by0 - M, w: (bx1 - bx0) + 2 * M, h: (by1 - by0) + 2 * M };
  const zoom = view?.zoom ?? 1;
  const cx = view?.cx ?? BASE.x + BASE.w / 2;
  const cy = view?.cy ?? BASE.y + BASE.h / 2;
  const VB = { w: BASE.w / zoom, h: BASE.h / zoom, x: cx - BASE.w / zoom / 2, y: cy - BASE.h / zoom / 2 };
  vbRef.current = VB;
  const toSvg = useCallback((clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect();
    const vb = vbRef.current;
    const s = Math.min(r.width / vb.w, r.height / vb.h);
    const ox = r.left + (r.width - vb.w * s) / 2;
    const oy = r.top + (r.height - vb.h * s) / 2;
    return { x: vb.x + (clientX - ox) / s, y: vb.y + (clientY - oy) / s };
  }, []);

  // ---------- wall hit test ----------
  const hitWall = (p) => {
    const tol = WALL + 150;
    if (p.x >= -150 && p.x <= room.w + 150) {
      if (p.y >= -tol && p.y <= 150) return { wall: "N", d: clamp(p.x, 0, room.w) };
      if (p.y >= room.l - 150 && p.y <= room.l + tol) return { wall: "S", d: clamp(p.x, 0, room.w) };
    }
    if (p.y >= -150 && p.y <= room.l + 150) {
      if (p.x >= -tol && p.x <= 150) return { wall: "W", d: clamp(p.y, 0, room.l) };
      if (p.x >= room.w - 150 && p.x <= room.w + tol) return { wall: "E", d: clamp(p.y, 0, room.l) };
    }
    return null;
  };

  // ---------- snapping to features (corners, edges, wall vertices) ----------
  const pxToMm = () => {
    const el = svgRef.current, vb = vbRef.current;
    if (!el || !vb) return 1;
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / vb.w, r.height / vb.h);
    return s > 0 ? 1 / s : 1;
  };
  const snapCandidates = () => {
    const rw = room.w, rl = room.l;
    const c = [[0, 0], [rw, 0], [0, rl], [rw, rl], [rw / 2, 0], [rw / 2, rl], [0, rl / 2], [rw, rl / 2]];
    for (const it of items) {
      const { x, y, w, h } = it;
      c.push([x, y], [x + w, y], [x, y + h], [x + w, y + h],
        [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2], [x + w / 2, y + h / 2]);
    }
    for (const w of walls) for (const q of w.pts) c.push(q);
    for (const o of openings) {
      const g = wallGeom(o.wall, rw, rl);
      c.push(pt(g.A, g.along, o.pos, g.inward), pt(g.A, g.along, o.pos + o.len, g.inward));
    }
    return c;
  };
  const snapPoint = (raw) => {
    if (!snapOn) return { p: raw, snapped: false };
    const T = 16 * pxToMm();
    let best = null, bestD = T;
    for (const c of snapCandidates()) {
      const d = Math.hypot(c[0] - raw[0], c[1] - raw[1]);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best ? { p: [best[0], best[1]], snapped: true } : { p: raw, snapped: false };
  };

  // ---------- pointer handlers ----------
  const onCanvasDown = (e) => {
    const p = toSvg(e.clientX, e.clientY);
    // Calibrate the background: tap two points a known distance apart.
    if (calib) {
      const pts = [...calib.pts, [p.x, p.y]];
      if (pts.length >= 2) {
        const D = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
        setCalib(null);
        const inp = prompt("Verkligt avstånd mellan de två punkterna (mm):", String(Math.round(D)));
        const real = inp == null ? NaN : parseFloat(inp);
        if (bgT && Number.isFinite(real) && real > 0 && D > 1) {
          const f = real / D;
          const mx = (pts[0][0] + pts[1][0]) / 2, my = (pts[0][1] + pts[1][1]) / 2;
          pushUndo();
          setBgT((t) => ({ ...t, wmm: Math.round(t.wmm * f), x: mx - (mx - t.x) * f, y: my - (my - t.y) * f }));
          setStatus("Bakgrund kalibrerad");
        }
      } else {
        setCalib({ pts });
      }
      return;
    }
    // Ruler: place two points (tap-tap or drag). Axis-locks near horizontal/vertical.
    if (!readOnly && mode === "mat") {
      const s = snapPoint([p.x, p.y]);
      if (mStart == null) {
        setMStart(s.p);
        dragRef.current = { kind: "meas", first: true, moved: false };
      } else {
        setMPreview(s.snapped ? s.p : axisLock(mStart, s.p));
        dragRef.current = { kind: "meas", first: false, moved: false };
      }
      return;
    }
    if (!readOnly && mode === "vaggar") {
      const s = snapPoint([p.x, p.y]);
      const np = s.snapped ? s.p : [snap(p.x), snap(p.y)];
      pushUndo();
      if (activeWall == null) {
        const aid = uid("w");
        setWalls((ws) => [...ws, { id: aid, pts: [np], w: wallW }]);
        setActiveWall(aid);
      } else {
        setWalls((ws) => ws.map((w) => (w.id === activeWall ? { ...w, pts: [...w.pts, np] } : w)));
      }
      return;
    }
    if (!readOnly && mode === "inredning" && drawRect) {
      const s = snapPoint([p.x, p.y]);
      const x0 = s.snapped ? s.p[0] : snap(p.x), y0 = s.snapped ? s.p[1] : snap(p.y);
      dragRef.current = { kind: "rect", x0, y0, rect: { x: x0, y: y0, w: 0, h: 0 } };
      setRectPreview({ x: x0, y: y0, w: 0, h: 0 });
      return;
    }
    if (!readOnly && mode === "oppningar") {
      const hit = hitWall(p);
      if (hit) {
        const def = OPEN_DEFS[tool];
        const g = wallGeom(hit.wall, room.w, room.l);
        const len = Math.min(def.len, g.L);
        const pos = clamp(snap(hit.d - len / 2), 0, g.L - len);
        pushUndo();
        const id = uid("o");
        setOpenings((a) => [...a, { id, wall: hit.wall, pos, len, kind: tool, flip: false }]);
        setSel({ kind: "op", id });
        return;
      }
    }
    if (zoom > 1) {
      const r = svgRef.current.getBoundingClientRect();
      const s = Math.min(r.width / VB.w, r.height / VB.h);
      dragRef.current = { kind: "pan", c0: { x: e.clientX, y: e.clientY }, cx0: cx, cy0: cy, s };
    }
    setSel(null);
  };
  const onOpDown = (e, o) => {
    e.stopPropagation();
    setSel({ kind: "op", id: o.id });
    if (readOnly) return;
    const p = toSvg(e.clientX, e.clientY);
    const g = wallGeom(o.wall, room.w, room.l);
    const d = g.along[0] ? p.x : p.y;
    dragRef.current = { kind: "op", id: o.id, off: d - o.pos, pre: takeSnap(), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onItemDown = (e, it) => {
    e.stopPropagation();
    if (readOnly) { setSel({ kind: "it", id: it.id }); return; }
    const p = toSvg(e.clientX, e.clientY);
    if (multiMode) {
      // Tap toggles membership (on pointer-up); drag moves the whole group.
      const wasIn = group.includes(it.id);
      const ids = wasIn ? group.slice() : [...group, it.id];
      setGroup(ids);
      setSel({ kind: "it", id: it.id });
      const offs = {};
      items.forEach((x) => { if (ids.includes(x.id)) offs[x.id] = { dx: p.x - x.x, dy: p.y - x.y }; });
      dragRef.current = { kind: "group", ids, offs, tappedId: it.id, wasIn, pre: takeSnap(), moved: false };
    } else {
      setSel({ kind: "it", id: it.id });
      setGroup([]);
      dragRef.current = { kind: "it", id: it.id, dx: p.x - it.x, dy: p.y - it.y, pre: takeSnap(), moved: false };
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onBgDown = (e) => {
    if (readOnly || mode !== "bakgrund" || !bgT) return;
    e.stopPropagation();
    const p = toSvg(e.clientX, e.clientY);
    dragRef.current = { kind: "bg", dx: p.x - bgT.x, dy: p.y - bgT.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onWallPtDown = (e, wallId, idx) => {
    if (readOnly || mode !== "vaggar") return;
    e.stopPropagation();
    dragRef.current = { kind: "wallpt", wallId, idx, pre: takeSnap(), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nz = clamp((pinchRef.current.zoom0 * dist) / pinchRef.current.d0, 1, 8);
      const r = svgRef.current.getBoundingClientRect();
      const w = BASE.w / nz, h = BASE.h / nz;
      const s = Math.min(r.width / w, r.height / h);
      const ox = r.left + (r.width - w * s) / 2;
      const oy = r.top + (r.height - h * s) / 2;
      const p0 = pinchRef.current.p0;
      setView(nz <= 1 ? null : { zoom: nz, cx: p0.x + w / 2 - (mid.x - ox) / s, cy: p0.y + h / 2 - (mid.y - oy) / s });
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      setView({ zoom, cx: d.cx0 - (e.clientX - d.c0.x) / d.s, cy: d.cy0 - (e.clientY - d.c0.y) / d.s });
      return;
    }
    const p = toSvg(e.clientX, e.clientY);
    if (d.kind === "rect") {
      const s = snapPoint([p.x, p.y]);
      const x1 = s.snapped ? s.p[0] : snap(p.x), y1 = s.snapped ? s.p[1] : snap(p.y);
      const r = { x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) };
      d.rect = r; setRectPreview(r);
      return;
    }
    if (d.kind === "meas") {
      d.moved = true;
      if (mStart) { const s = snapPoint([p.x, p.y]); setMPreview(s.snapped ? s.p : axisLock(mStart, s.p)); }
      return;
    }
    d.moved = true;
    if (d.kind === "wallpt") {
      setWalls((ws) => ws.map((w) => (w.id === d.wallId ? { ...w, pts: w.pts.map((pp, i) => (i === d.idx ? [snap(p.x), snap(p.y)] : pp)) } : w)));
    } else if (d.kind === "bg") {
      setBgT((t) => (t ? { ...t, x: snap(p.x - d.dx), y: snap(p.y - d.dy) } : t));
    } else if (d.kind === "op") {
      setOpenings((a) => a.map((o) => {
        if (o.id !== d.id) return o;
        const g = wallGeom(o.wall, room.w, room.l);
        const v = g.along[0] ? p.x : p.y;
        return { ...o, pos: clamp(snap(v - d.off), 0, g.L - o.len) };
      }));
    } else if (d.kind === "group") {
      // Move every grouped item together (furniture may cross/exit walls).
      setItems((a) => a.map((it) => {
        const off = d.offs[it.id];
        if (!off) return it;
        return { ...it, x: clamp(snap(p.x - off.dx), -OUT, room.w + OUT), y: clamp(snap(p.y - off.dy), -OUT, room.l + OUT) };
      }));
    } else {
      setItems((a) => a.map((it) => it.id === d.id ? {
        ...it,
        x: clamp(snap(p.x - d.dx), -OUT, room.w + OUT),
        y: clamp(snap(p.y - d.dy), -OUT, room.l + OUT),
      } : it));
    }
  };
  const onDownCapture = (e) => {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) {
      dragRef.current = null;
      const [a, b] = [...ptrs.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinchRef.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom0: zoom, p0: toSvg(mid.x, mid.y) };
    }
  };
  const onUp = (e) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinchRef.current = null;
    const d = dragRef.current;
    if (d) {
      if (d.kind === "meas") {
        if (d.first && !d.moved) {
          setMPreview(null); // first point placed; wait for the second tap
        } else {
          const up = toSvg(e.clientX, e.clientY);
          const s = snapPoint([up.x, up.y]);
          const p2 = d.moved && mPreview ? mPreview : (mStart ? (s.snapped ? s.p : axisLock(mStart, s.p)) : s.p);
          if (mStart) setMeasures((ms) => [...ms, [mStart, p2]]);
          setMStart(null); setMPreview(null);
        }
        dragRef.current = null;
        return;
      }
      if (d.kind === "rect") {
        const r = d.rect;
        if (r && r.w >= 100 && r.h >= 100) {
          pushUndo();
          const id = uid("i");
          setItems((a) => [...a, { id, t: "", x: r.x, y: r.y, w: r.w, h: r.h }]);
          setSel({ kind: "it", id });
        }
        setRectPreview(null);
        dragRef.current = null;
        return;
      }
      if (d.pre && d.moved) {
        undoRef.current.push(d.pre);
        if (undoRef.current.length > 80) undoRef.current.shift();
        setUndoN(undoRef.current.length);
      }
      // A tap (no drag) in multi-mode toggles membership.
      if (d.kind === "group" && !d.moved) {
        setGroup((g) => (d.wasIn ? g.filter((x) => x !== d.tappedId) : (g.includes(d.tappedId) ? g : [...g, d.tappedId])));
      }
    }
    dragRef.current = null;
  };
  const zoomBy = (f) => {
    const nz = clamp(zoom * f, 1, 8);
    if (nz <= 1) setView(null);
    else setView({ zoom: nz, cx, cy });
  };

  // ---------- actions ----------
  const addItem = (pDef) => {
    pushUndo();
    const id = uid("i");
    setItems((a) => [...a, { id, t: pDef.t, x: snap(clamp(400, 0, room.w - pDef.w)), y: snap(clamp(1000, 0, room.l - pDef.h)), w: pDef.w, h: pDef.h }]);
    setSel({ kind: "it", id }); setGroup([]);
  };
  const selOp = sel?.kind === "op" ? openings.find((o) => o.id === sel.id) : null;
  const selIt = sel?.kind === "it" ? items.find((i) => i.id === sel.id) : null;
  const updOp = (fn) => { pushUndo(); setOpenings((a) => a.map((o) => (o.id === sel.id ? fn(o) : o))); };
  const updIt = (fn) => { pushUndo(); setItems((a) => a.map((i) => (i.id === sel.id ? fn(i) : i))); };
  const removeSel = () => {
    pushUndo();
    if (selOp) setOpenings((a) => a.filter((o) => o.id !== sel.id));
    if (selIt) setItems((a) => a.filter((i) => i.id !== sel.id));
    setSel(null);
  };
  const renameSel = () => {
    if (!selIt) return;
    const n = prompt("Namn på objektet:", selIt.t);
    if (n === null) return;
    updIt((i) => ({ ...i, t: n.trim() || i.t }));
  };
  // ---------- background reference image ----------
  const onPickBg = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("Läser in bild …");
    try {
      const img = await downscaleImage(file, 1600, 0.72);
      setBgImg(img);
      await storage.set(bgStorageKey, JSON.stringify(img));
      setBgT((t) => t || { x: 0, y: 0, wmm: room.w, opacity: 0.5, visible: true, rot: 0 });
      setStatus("Bakgrund inläst");
    } catch { setStatus("Kunde inte läsa bilden"); }
    e.target.value = "";
  };
  const removeBg = () => {
    if (!confirm("Ta bort bakgrundsbilden?")) return;
    setBgImg(null); setBgT(null);
    storage.delete(bgStorageKey);
  };
  // ---------- freeform walls ----------
  const newWallLine = () => setActiveWall(null); // next tap starts a fresh polyline
  const undoWallPoint = () => {
    const id = activeWall || (walls.length ? walls[walls.length - 1].id : null);
    if (!id) return;
    pushUndo();
    setWalls((ws) => ws
      .map((w) => (w.id === id ? { ...w, pts: w.pts.slice(0, -1) } : w))
      .filter((w) => w.pts.length > 0));
  };
  const removeActiveWall = () => {
    const id = activeWall || (walls.length ? walls[walls.length - 1].id : null);
    if (!id) return;
    pushUndo();
    setWalls((ws) => ws.filter((w) => w.id !== id));
    setActiveWall(null);
  };
  const patchBg = (patch) => setBgT((t) => ({ ...(t || { x: 0, y: 0, wmm: room.w, opacity: 0.5, visible: true, rot: 0 }), ...patch }));
  const bgShown = !!(bgImg && bgT && bgT.visible && !bgHiddenLocal);
  const bgW = bgImg && bgT ? bgT.wmm : 0;
  const bgH = bgImg && bgT ? bgT.wmm * (bgImg.h / bgImg.w) : 0;
  // Exact integer mm, no grid-snapping of the room size (so you can type e.g. 6430).
  const setRoomDim = (k, v) => {
    pushUndo();
    const val = clamp(Math.round(v || 0), 1000, 20000);
    setRoom((r) => ({ ...r, [k]: val }));
    setOpenings((a) => a.map((o) => {
      const L = (o.wall === "N" || o.wall === "S") ? (k === "w" ? val : room.w) : (k === "l" ? val : room.l);
      const len = Math.min(o.len, L);
      return { ...o, len, pos: clamp(o.pos, 0, L - len) };
    }));
    // Furniture is left where it is (it may sit outside the room on purpose).
  };
  // Keep the text inputs in sync with room, but let the user type freely and
  // commit on blur / Enter (see the Rum inputs below).
  useEffect(() => { setWStr(String(room.w)); }, [room.w]);
  useEffect(() => { setLStr(String(room.l)); }, [room.l]);
  const commitDim = (k, str) => {
    const n = parseInt(str, 10);
    if (!Number.isFinite(n)) { if (k === "w") setWStr(String(room.w)); else setLStr(String(room.l)); return; }
    setRoomDim(k, n);
  };

  // ---------- wall segments (walls minus openings) ----------
  const wallSegs = (wall) => {
    const g = wallGeom(wall, room.w, room.l);
    const ops = openings.filter((o) => o.wall === wall).sort((a, b) => a.pos - b.pos);
    const segs = [];
    let cur = 0;
    for (const o of ops) {
      if (o.pos > cur) segs.push([cur, o.pos]);
      cur = Math.max(cur, o.pos + o.len);
    }
    if (cur < g.L) segs.push([cur, g.L]);
    return segs.map(([a, b]) => {
      const p1 = pt(g.A, g.along, a, g.inward, 0);
      const horizontal = g.along[0] !== 0;
      const x = horizontal ? p1[0] : (wall === "W" ? -WALL : room.w);
      const y = horizontal ? (wall === "N" ? -WALL : room.l) : p1[1];
      return { x, y, w: horizontal ? b - a : WALL, h: horizontal ? WALL : b - a };
    });
  };

  // ---------- opening rendering ----------
  const renderOpening = (o) => {
    const g = wallGeom(o.wall, room.w, room.l);
    const isSel = selOp?.id === o.id;
    const A = pt(g.A, g.along, o.pos, g.inward);
    const B = pt(g.A, g.along, o.pos + o.len, g.inward);
    const els = [];
    if (o.kind === "fonster") {
      const c1 = pt(g.A, g.along, o.pos, g.inward, -WALL * 0.65);
      const horizontal = g.along[0] !== 0;
      els.push(<rect key="w" x={horizontal ? c1[0] : c1[0] - 35} y={horizontal ? c1[1] - 35 : c1[1]} width={horizontal ? o.len : 70} height={horizontal ? 70 : o.len} fill={ink} />);
      const m1 = pt(g.A, g.along, o.pos, g.inward, -WALL * 0.65);
      const m2 = pt(g.A, g.along, o.pos + o.len, g.inward, -WALL * 0.65);
      els.push(<line key="wl" x1={m1[0]} y1={m1[1]} x2={m2[0]} y2={m2[1]} stroke={paper} strokeWidth="22" />);
    } else if (o.kind === "oppning") {
      // Doorless opening: just the two jamb reveals across the wall thickness.
      const j1o = pt(g.A, g.along, o.pos, g.inward, -WALL);
      const j2o = pt(g.A, g.along, o.pos + o.len, g.inward, -WALL);
      els.push(<line key="j1" x1={A[0]} y1={A[1]} x2={j1o[0]} y2={j1o[1]} stroke={ink} strokeWidth="16" />);
      els.push(<line key="j2" x1={B[0]} y1={B[1]} x2={j2o[0]} y2={j2o[1]} stroke={ink} strokeWidth="16" />);
    } else {
      const doors = o.kind === "pardorr"
        ? [{ hinge: A, other: pt(g.A, g.along, o.pos + o.len / 2, g.inward), dir: 1, L: o.len / 2 },
           { hinge: B, other: pt(g.A, g.along, o.pos + o.len / 2, g.inward), dir: -1, L: o.len / 2 }]
        : [o.flip
            ? { hinge: B, other: A, dir: -1, L: o.len }
            : { hinge: A, other: B, dir: 1, L: o.len }];
      doors.forEach((dr, i) => {
        const leafEnd = [dr.hinge[0] + g.inward[0] * dr.L, dr.hinge[1] + g.inward[1] * dr.L];
        const alongDir = [g.along[0] * dr.dir, g.along[1] * dr.dir];
        const crossZ = g.inward[0] * alongDir[1] - g.inward[1] * alongDir[0];
        const sweep = crossZ > 0 ? 1 : 0;
        els.push(<line key={"l" + i} x1={dr.hinge[0]} y1={dr.hinge[1]} x2={leafEnd[0]} y2={leafEnd[1]} stroke={ink} strokeWidth="16" />);
        els.push(<path key={"a" + i} d={`M ${leafEnd[0]} ${leafEnd[1]} A ${dr.L} ${dr.L} 0 0 ${sweep} ${dr.other[0]} ${dr.other[1]}`} fill="none" stroke={ink} strokeWidth="12" strokeDasharray="34 34" />);
      });
    }
    // hit area + selection halo
    const horizontal = g.along[0] !== 0;
    const hitX = horizontal ? A[0] : (o.wall === "W" ? -WALL - 80 : room.w - 80);
    const hitY = horizontal ? (o.wall === "N" ? -WALL - 80 : room.l - 80) : A[1];
    els.push(
      <rect key="hit" x={hitX} y={hitY}
        width={horizontal ? o.len : WALL + 160} height={horizontal ? WALL + 160 : o.len}
        fill={isSel ? "rgba(90,122,140,0.18)" : "transparent"} stroke={isSel ? blue : "none"} strokeWidth="20"
        style={{ cursor: "grab" }} onPointerDown={(e) => onOpDown(e, o)} />
    );
    // measurements to both corners when selected
    if (isSel) {
      const off = WALL + 260;
      const t1 = pt(g.A, g.along, o.pos / 2, g.inward, -off);
      const t2 = pt(g.A, g.along, o.pos + o.len + (g.L - o.pos - o.len) / 2, g.inward, -off);
      const tm = pt(g.A, g.along, o.pos + o.len / 2, g.inward, -off);
      els.push(<text key="d1" x={t1[0]} y={t1[1]} fontFamily={mono} fontSize="120" fill={blue} textAnchor="middle">{o.pos}</text>);
      els.push(<text key="d2" x={t2[0]} y={t2[1]} fontFamily={mono} fontSize="120" fill={blue} textAnchor="middle">{g.L - o.pos - o.len}</text>);
      els.push(<text key="dm" x={tm[0]} y={tm[1]} fontFamily={mono} fontSize="120" fill={blue} textAnchor="middle" fontWeight="bold">{o.len}</text>);
    }
    return <g key={o.id}>{els}</g>;
  };

  // ---------- UI ----------
  const btn = { background: "#fff", border: `1.5px solid ${ink}`, borderRadius: 8, color: ink, padding: "8px 12px", fontSize: 13, fontFamily: "inherit", cursor: "pointer", flex: "0 0 auto" };
  const btnOn = { ...btn, background: ink, color: "#fff" };
  const modeBtn = (m, label) => (
    <button style={mode === m ? btnOn : btn}
      onClick={() => { setMode(m); setSel(null); setGroup([]); setActiveWall(null); setDrawRect(false); setRectPreview(null); setCalib(null); setMStart(null); setMPreview(null); }}>{label}</button>
  );

  const rootStyle = {
    background: paper, overflow: "hidden", color: ink,
    fontFamily: "'Avenir Next','Helvetica Neue',Arial,sans-serif", display: "flex", flexDirection: "column",
    ...(full
      ? { position: "fixed", inset: 0, zIndex: 50, height: "100dvh", width: "100vw" }
      : { height: "100%" }),
  };

  return (
    <div style={rootStyle}>
      <div style={{ padding: "10px 16px 6px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, letterSpacing: 2, fontWeight: 600 }}>{title || "RUMSPLANERARE"}</div>
          <div style={{ fontSize: 12, color: "#7A756E" }}>
            {readOnly ? "Skrivskyddad vy" : full ? "Helskärm — dra för att flytta · Stäng för verktyg" : "1 Rum → 2 Öppningar → 3 Inredning"}{status ? " · " + status : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {!readOnly && (
            <button style={{ ...btn, whiteSpace: "nowrap", opacity: undoN ? 1 : 0.4 }} disabled={!undoN} onClick={undo}>↶ Ångra</button>
          )}
          <button style={{ ...btn, whiteSpace: "nowrap" }} onClick={() => setFull((f) => !f)}>
            {full ? "✕ Stäng" : "⤢ Helskärm"}
          </button>
        </div>
      </div>

      {!readOnly && !full && (
      <div style={{ display: "flex", gap: 8, padding: "6px 16px", flexWrap: "wrap" }}>
        {modeBtn("rum", "1 · Rum")}
        {modeBtn("oppningar", "2 · Öppningar")}
        {modeBtn("inredning", "3 · Inredning")}
        {modeBtn("vaggar", "✏️ Väggar")}
        {modeBtn("mat", "📏 Mät")}
        {modeBtn("bakgrund", "🖼 Bakgrund")}
      </div>
      )}

      {!readOnly && !full && mode === "rum" && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 16px", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>Bredd&nbsp;
            <input type="number" inputMode="numeric" value={wStr} step={50}
              onChange={(e) => setWStr(e.target.value)}
              onBlur={() => commitDim("w", wStr)}
              onKeyDown={(e) => { if (e.key === "Enter") { commitDim("w", wStr); e.currentTarget.blur(); } }}
              style={{ width: 90, fontFamily: mono, fontSize: 14, padding: 6, border: `1.5px solid ${ink}`, borderRadius: 8 }} /> mm
          </label>
          <label style={{ fontSize: 13 }}>Längd&nbsp;
            <input type="number" inputMode="numeric" value={lStr} step={50}
              onChange={(e) => setLStr(e.target.value)}
              onBlur={() => commitDim("l", lStr)}
              onKeyDown={(e) => { if (e.key === "Enter") { commitDim("l", lStr); e.currentTarget.blur(); } }}
              style={{ width: 90, fontFamily: mono, fontSize: 14, padding: 6, border: `1.5px solid ${ink}`, borderRadius: 8 }} /> mm
          </label>
          <span style={{ fontSize: 12, color: "#7A756E" }}>= {((room.w * room.l) / 1e6).toFixed(1)} m²</span>
        </div>
      )}

      {!readOnly && !full && mode === "oppningar" && (
        <div style={{ display: "flex", gap: 8, padding: "8px 16px", alignItems: "center", flexWrap: "wrap" }}>
          {Object.entries(OPEN_DEFS).map(([k, d]) => (
            <button key={k} style={tool === k ? { ...btnOn, background: blue, borderColor: blue } : btn} onClick={() => setTool(k)}>{d.label}</button>
          ))}
          <span style={{ fontSize: 12, color: "#7A756E" }}>Tryck på en vägg för att skära in · dra för att flytta</span>
        </div>
      )}

      {!readOnly && !full && mode === "mat" && (
        <div style={{ display: "flex", gap: 8, padding: "8px 16px", alignItems: "center", flexWrap: "wrap" }}>
          <button style={btn} onClick={() => { setMeasures([]); setMStart(null); setMPreview(null); }}>Rensa mätningar</button>
          <button style={snapOn ? { ...btnOn, background: blue, borderColor: blue } : btn} onClick={() => setSnapOn((s) => !s)}>{snapOn ? "✓ Fäst mot objekt" : "Fäst mot objekt"}</button>
          <span style={{ fontSize: 12, color: "#7A756E" }}>Tryck/dra mellan två punkter · flera tillåts · nära vågrätt/lodrätt låses till x/y</span>
        </div>
      )}

      {!readOnly && !full && mode === "vaggar" && (
        <div style={{ display: "flex", gap: 8, padding: "8px 16px", alignItems: "center", flexWrap: "wrap" }}>
          <button style={wallW === WALL_OUTER ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => { setWallW(WALL_OUTER); setActiveWall(null); }}>Yttervägg {WALL_OUTER}</button>
          <button style={wallW === WALL_INNER ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => { setWallW(WALL_INNER); setActiveWall(null); }}>Innervägg {WALL_INNER}</button>
          <span style={{ width: 1, alignSelf: "stretch", background: "#00000022" }} />
          <button style={btn} onClick={newWallLine}>+ Ny vägg</button>
          <button style={btn} onClick={undoWallPoint}>Ångra punkt</button>
          <button style={{ ...btn, color: red, borderColor: red }} onClick={removeActiveWall}>Ta bort vägg</button>
          <button style={snapOn ? { ...btnOn, background: blue, borderColor: blue } : btn} onClick={() => setSnapOn((s) => !s)}>{snapOn ? "✓ Fäst mot objekt" : "Fäst mot objekt"}</button>
          <span style={{ fontSize: 12, color: "#7A756E" }}>Tryck för att sätta hörn · dra hörn för att justera · fäster mot hörn</span>
        </div>
      )}

      {!readOnly && !full && mode === "inredning" && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "8px 16px", WebkitOverflowScrolling: "touch" }}>
          {PALETTE.map((p, i) => (
            <button key={i} style={btn} onClick={() => addItem(p)}>
              + {p.t} <span style={{ fontFamily: mono, fontSize: 11, color: blue }}>{p.w}</span>
            </button>
          ))}
        </div>
      )}

      {!readOnly && !full && mode === "inredning" && (
        <div style={{ display: "flex", gap: 8, padding: "0 16px 8px", alignItems: "center", flexWrap: "wrap" }}>
          <button style={drawRect ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => { setDrawRect((d) => !d); setMultiMode(false); }}>
            {drawRect ? "✓ Ritar ruta" : "✏️ Rita ruta"}
          </button>
          {drawRect && <span style={{ fontSize: 12, color: "#7A756E" }}>Dra på ytan för att rita en egen ruta</span>}
          <button style={multiMode ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => { setMultiMode((m) => !m); setDrawRect(false); setGroup([]); }}>
            {multiMode ? "✓ Markerar flera" : "Markera flera"}
          </button>
          {multiMode && (
            <span style={{ fontSize: 12, color: "#7A756E" }}>
              Tryck på objekt för att markera · dra för att flytta ihop{group.length ? ` · ${group.length} valda` : ""}
            </span>
          )}
          {multiMode && group.length > 0 && (
            <>
              <button style={{ ...btn, color: red, borderColor: red }} onClick={() => { pushUndo(); setItems((a) => a.filter((i) => !group.includes(i.id))); setGroup([]); }}>Ta bort valda</button>
              <button style={btn} onClick={() => setGroup([])}>Rensa</button>
            </>
          )}
        </div>
      )}

      {!readOnly && !full && mode === "bakgrund" && (
        <div style={{ display: "flex", gap: 10, padding: "4px 16px 8px", alignItems: "center", flexWrap: "wrap" }}>
          <input ref={bgFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickBg} />
          <button style={btn} onClick={() => bgFileRef.current?.click()}>{bgImg ? "Byt bild" : "Ladda upp bild"}</button>
          {bgImg && bgT && (
            <>
              <button style={btn} onClick={() => patchBg({ visible: !bgT.visible })}>{bgT.visible ? "Dölj (delad)" : "Visa (delad)"}</button>
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>Opacitet
                <input type="range" min={10} max={100} value={Math.round((bgT.opacity ?? 0.5) * 100)}
                  onChange={(e) => patchBg({ opacity: parseInt(e.target.value, 10) / 100 })} />
              </label>
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>Skala
                <input type="range" min={500} max={20000} step={50} value={Math.round(bgT.wmm || room.w)}
                  onChange={(e) => patchBg({ wmm: parseInt(e.target.value, 10) })} />
              </label>
              <button style={btn} onClick={() => patchBg({ rot: ((bgT.rot || 0) + 90) % 360 })}>Rotera 90°</button>
              <button style={btn} onClick={() => patchBg({ x: 0, y: 0, wmm: room.w, rot: 0 })}>Passa bredd</button>
              <button style={calib ? { ...btnOn, background: blue, borderColor: blue } : btn}
                onClick={() => setCalib(calib ? null : { pts: [] })}>{calib ? "Avbryt kalibrering" : "Kalibrera skala"}</button>
              <button style={{ ...btn, color: red, borderColor: red }} onClick={removeBg}>Ta bort bild</button>
              <span style={{ fontSize: 12, color: "#7A756E" }}>
                {calib ? "Tryck på två punkter med känt avstånd, ange sedan måttet i mm" : "Dra bilden för att flytta"}
              </span>
            </>
          )}
          {!bgImg && <span style={{ fontSize: 12, color: "#7A756E" }}>Ladda upp en ritning/foto att rita ovanpå.</span>}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, padding: "0 8px 8px", position: "relative" }}>
        <div style={{ position: "absolute", right: 18, top: 10, display: "flex", flexDirection: "column", gap: 6, zIndex: 2 }}>
          <button style={{ background: "#fff", border: `1.5px solid ${ink}`, borderRadius: 8, width: 40, height: 40, fontSize: 18, cursor: "pointer" }} onClick={() => zoomBy(1.4)}>+</button>
          <button style={{ background: "#fff", border: `1.5px solid ${ink}`, borderRadius: 8, width: 40, height: 40, fontSize: 18, cursor: "pointer" }} onClick={() => zoomBy(1 / 1.4)}>−</button>
          <button style={{ background: "#fff", border: `1.5px solid ${ink}`, borderRadius: 8, width: 40, height: 40, fontSize: 14, cursor: "pointer" }} onClick={() => setView(null)}>⤢</button>
          {bgImg && bgT?.visible && (
            <button title={bgHiddenLocal ? "Visa bakgrund" : "Dölj bakgrund"}
              style={{ background: !bgHiddenLocal ? blue : "#fff", color: !bgHiddenLocal ? "#fff" : ink, border: `1.5px solid ${!bgHiddenLocal ? blue : ink}`, borderRadius: 8, width: 40, height: 40, fontSize: 16, cursor: "pointer" }}
              onClick={() => setBgHiddenLocal((h) => !h)}>🖼</button>
          )}
        </div>
        <svg ref={svgRef} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
          style={{ width: "100%", height: "100%", touchAction: "none", display: "block" }}
          onPointerDownCapture={onDownCapture}
          onPointerDown={onCanvasDown} onPointerMove={onMove}
          onPointerUp={onUp} onPointerCancel={onUp}>

          <defs>
            <pattern id="g2" width="500" height="500" patternUnits="userSpaceOnUse">
              <path d="M 500 0 L 0 0 0 500" fill="none" stroke="#E7E1D6" strokeWidth="6" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={room.w} height={room.l} fill="url(#g2)" />

          {/* background reference image (below walls/items) */}
          {bgShown && (
            <g opacity={bgT.opacity}
               transform={bgT.rot ? `rotate(${bgT.rot} ${bgT.x + bgW / 2} ${bgT.y + bgH / 2})` : undefined}
               style={{ pointerEvents: !readOnly && mode === "bakgrund" && !calib ? "auto" : "none", cursor: !readOnly && mode === "bakgrund" && !calib ? "grab" : "default" }}
               onPointerDown={onBgDown}>
              <image href={bgImg.dataUrl} x={bgT.x} y={bgT.y} width={bgW} height={bgH} preserveAspectRatio="none" />
            </g>
          )}

          {/* corner blocks */}
          {[[-WALL, -WALL], [room.w, -WALL], [-WALL, room.l], [room.w, room.l]].map((c, i) => (
            <rect key={i} x={c[0]} y={c[1]} width={WALL} height={WALL} fill={ink} />
          ))}
          {/* wall segments */}
          {["N", "S", "W", "E"].flatMap((w) => wallSegs(w).map((s, i) => (
            <rect key={w + i} x={s.x} y={s.y} width={s.w} height={s.h} fill={ink} />
          )))}

          {/* freeform drawn walls */}
          {walls.map((w) => (
            w.pts.length >= 2 ? (
              <polyline key={w.id} points={w.pts.map((p) => p.join(",")).join(" ")}
                fill="none" stroke={ink} strokeWidth={w.w ?? WALL} strokeLinejoin="round" strokeLinecap="round" style={{ pointerEvents: "none" }} />
            ) : null
          ))}
          {!readOnly && mode === "vaggar" && walls.flatMap((w) =>
            w.pts.map((p, i) => (
              <circle key={w.id + ":" + i} cx={p[0]} cy={p[1]} r="90"
                fill="#fff" stroke={w.id === activeWall ? blue : ink} strokeWidth="18"
                style={{ cursor: "grab" }} onPointerDown={(e) => onWallPtDown(e, w.id, i)} />
            ))
          )}

          {/* rectangle-draw preview */}
          {rectPreview && rectPreview.w > 0 && (
            <rect x={rectPreview.x} y={rectPreview.y} width={rectPreview.w} height={rectPreview.h}
              fill="rgba(90,122,140,0.18)" stroke={blue} strokeWidth="16" strokeDasharray="40 30" style={{ pointerEvents: "none" }} />
          )}

          {/* overall dims */}
          <g fontFamily={mono} fontSize="130" fill={blue} style={{ pointerEvents: "none" }}>
            <line x1={0} y1={-WALL - 220} x2={room.w} y2={-WALL - 220} stroke={blue} strokeWidth="12" />
            <text x={room.w / 2 - 150} y={-WALL - 270}>{room.w}</text>
            <line x1={-WALL - 220} y1={0} x2={-WALL - 220} y2={room.l} stroke={blue} strokeWidth="12" />
            <text x={-WALL - 270} y={room.l / 2} transform={`rotate(-90 ${-WALL - 270} ${room.l / 2})`}>{room.l}</text>
          </g>

          {/* openings */}
          <g style={{ pointerEvents: mode === "mat" ? "none" : undefined }}>
            {openings.map(renderOpening)}
          </g>

          {/* calibration markers */}
          {calib && (
            <g style={{ pointerEvents: "none" }}>
              {calib.pts.map((pp, i) => (
                <circle key={i} cx={pp[0]} cy={pp[1]} r="70" fill="none" stroke={red} strokeWidth="20" />
              ))}
            </g>
          )}

          {/* ruler measurements (multiple) + live one */}
          {(measures.length > 0 || mStart) && (
            <g style={{ pointerEvents: "none" }} fontFamily={mono}>
              {[...measures, ...(mStart && mPreview ? [[mStart, mPreview]] : [])].map((seg, i) => {
                const [p1, p2] = seg;
                const d = Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
                const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
                return (
                  <g key={i}>
                    <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke={blue} strokeWidth="14" strokeDasharray="40 26" />
                    <circle cx={p1[0]} cy={p1[1]} r="55" fill={blue} />
                    <circle cx={p2[0]} cy={p2[1]} r="55" fill={blue} />
                    <rect x={mx - 320} y={my - 150} width="640" height="200" rx="24" fill="#fff" stroke={blue} strokeWidth="8" />
                    <text x={mx} y={my - 10} textAnchor="middle" fontSize="150" fontWeight="bold" fill={blue}>{d} mm</text>
                  </g>
                );
              })}
              {mStart && !mPreview && <circle cx={mStart[0]} cy={mStart[1]} r="55" fill={blue} />}
            </g>
          )}

          {/* items */}
          <g style={{ pointerEvents: mode === "mat" ? "none" : undefined }}>
          {items.map((it) => {
            const isSel = selIt?.id === it.id;
            const inGroup = group.includes(it.id);
            const hl = isSel || inGroup;
            const label = it.t || "";
            // shrink long custom names so they fit the box
            const fs = Math.max(60, Math.min(140, it.w / 3.2, (it.w * 1.7) / Math.max(label.length, 1)));
            return (
              <g key={it.id} onPointerDown={(e) => onItemDown(e, it)} style={{ cursor: "grab" }}>
                <rect x={it.x} y={it.y} width={it.w} height={it.h}
                  fill={hl ? "rgba(90,122,140,0.28)" : cab}
                  stroke={hl ? blue : ink}
                  strokeWidth={isSel ? 44 : inGroup ? 30 : 14}
                  strokeDasharray={inGroup && !isSel ? "70 45" : undefined} />
                <text x={it.x + it.w / 2} y={it.y + it.h / 2 + fs * 0.34} textAnchor="middle" fontSize={fs} letterSpacing={label.length > 8 ? "0" : "4"} fill={ink}>{label}</text>
                {isSel && <text x={it.x + it.w / 2} y={it.y - 50} textAnchor="middle" fontFamily={mono} fontSize="120" fill={blue}>{it.w}×{it.h}</text>}
              </g>
            );
          })}
          </g>

          {/* wall-distance guides for selected item */}
          {selIt && (
            <g fontFamily={mono} fontSize="115" fill={blue} stroke={blue} strokeWidth="10" style={{ pointerEvents: "none" }}>
              <line x1={0} y1={selIt.y + selIt.h / 2} x2={selIt.x} y2={selIt.y + selIt.h / 2} strokeDasharray="30 30" />
              <text x={selIt.x / 2 - 80} y={selIt.y + selIt.h / 2 - 40} stroke="none">{selIt.x}</text>
              <line x1={selIt.x + selIt.w} y1={selIt.y + selIt.h / 2} x2={room.w} y2={selIt.y + selIt.h / 2} strokeDasharray="30 30" />
              <text x={(selIt.x + selIt.w + room.w) / 2 - 80} y={selIt.y + selIt.h / 2 - 40} stroke="none">{room.w - selIt.x - selIt.w}</text>
              <line x1={selIt.x + selIt.w / 2} y1={0} x2={selIt.x + selIt.w / 2} y2={selIt.y} strokeDasharray="30 30" />
              <text x={selIt.x + selIt.w / 2 + 40} y={selIt.y / 2} stroke="none">{selIt.y}</text>
              <line x1={selIt.x + selIt.w / 2} y1={selIt.y + selIt.h} x2={selIt.x + selIt.w / 2} y2={room.l} strokeDasharray="30 30" />
              <text x={selIt.x + selIt.w / 2 + 40} y={(selIt.y + selIt.h + room.l) / 2} stroke="none">{room.l - selIt.y - selIt.h}</text>
            </g>
          )}
        </svg>

        {/* selection controls — absolute overlay so selecting never reflows/rescales the canvas */}
        {!readOnly && (selOp || selIt) && (
          <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, background: "#fff", border: `1.5px solid ${ink}`, borderRadius: 10, padding: "8px 12px", paddingBottom: "calc(8px + env(safe-area-inset-bottom))", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.14)", zIndex: 3 }}>
          {selOp && (
            <>
              <div style={{ fontWeight: 600 }}>{OPEN_DEFS[selOp.kind].label} <span style={{ fontFamily: mono, color: blue, fontSize: 13 }}>{selOp.len}</span></div>
              <button style={btn} onClick={() => updOp((o) => {
                const g = wallGeom(o.wall, room.w, room.l);
                return { ...o, len: clamp(o.len - 50, 300, g.L - o.pos) };
              })}>−50</button>
              <button style={btn} onClick={() => updOp((o) => {
                const g = wallGeom(o.wall, room.w, room.l);
                return { ...o, len: clamp(o.len + 50, 300, g.L - o.pos) };
              })}>+50</button>
              {selOp.kind === "dorr" && <button style={btn} onClick={() => updOp((o) => ({ ...o, flip: !o.flip }))}>Vänd</button>}
              <button style={{ ...btn, color: red, borderColor: red }} onClick={removeSel}>Ta bort</button>
            </>
          )}
          {selIt && (
            <>
              <div style={{ fontWeight: 600 }}>{selIt.t} <span style={{ fontFamily: mono, color: blue, fontSize: 13 }}>{selIt.w}×{selIt.h}</span></div>
              <button style={btn} onClick={renameSel}>✎ Namn</button>
              <button style={btn} onClick={() => updIt((i) => ({ ...i, w: clamp(i.w - 50, 50, 20000) }))}>B −</button>
              <button style={btn} onClick={() => updIt((i) => ({ ...i, w: clamp(i.w + 50, 50, 20000) }))}>B +</button>
              <button style={btn} onClick={() => updIt((i) => ({ ...i, h: clamp(i.h - 50, 50, 20000) }))}>D −</button>
              <button style={btn} onClick={() => updIt((i) => ({ ...i, h: clamp(i.h + 50, 50, 20000) }))}>D +</button>
              <button style={btn} onClick={() => updIt((i) => ({ ...i, w: i.h, h: i.w }))}>⟳ 90°</button>
              <button style={btn} onClick={() => {
                pushUndo();
                const id = uid("i");
                setItems((a) => [...a, { ...selIt, id, x: clamp(selIt.x + 200, -OUT, room.w + OUT), y: clamp(selIt.y + 200, -OUT, room.l + OUT) }]);
                setSel({ kind: "it", id });
              }}>Kopiera</button>
              <button style={{ ...btn, color: red, borderColor: red }} onClick={removeSel}>Ta bort</button>
            </>
          )}
          </div>
        )}
      </div>
    </div>
  );
}
