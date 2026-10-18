import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { storage } from "../storage.js";
import { canEdit } from "../config.js";
import { uploadPhoto, deletePhoto } from "../photos.js";
import { useSpace } from "../state.js";
import { VENT_SYS, VENT_KINDS, VENT_TOPIC, ventSvg, ventPinsFor, ventQuestions, ventHit, ventColor, hasVent, LINE_W } from "./vent.js";
import { buildPlanSvg, itemLabel, coveredItemIds, stairLines } from "./planSvg.js";
import { snapCandidates as featurePoints, faceSnap, resolveDims, dimGeom, dimsBounds, areaGrid, areaSummary, areaLegend, LEGEND_STEP, kindTag, AREA_KINDS, fmtM2, regionAt, regionRects } from "./geom.js";

// Ported from kok-planner-v2 (Claude artifact) — behavior parity.
// Props: storageKey (per-room persistence key), title (room name for header),
// focus (optional area ids: show only those rooms of a whole-floor plan, the rest dimmed but still editable).

// ---------- constants ----------
const WALL = 200;
// Freeform-wall thicknesses (mm). Outer = insulated exterior, inner = partition.
const WALL_OUTER = 300;
const WALL_INNER = 100;
const SNAP = 50;
const ink = "#33312E", blue = "#5A7A8C", paper = "#FAF8F3", cab = "#E4EAED", red = "#9a4a3a";
const mono = "ui-monospace, 'SF Mono', Menlo, monospace";

// Wrap comment text into lines of at most maxChars, honoring explicit newlines.
function wrapText(text, maxChars) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      if (line && (line.length + 1 + w.length) > maxChars) { out.push(line); line = w; }
      else line = line ? line + " " + w : w;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

const OPEN_DEFS = {
  dorr: { label: "Dörr", len: 900 },
  pardorr: { label: "Pardörr", len: 1600 },
  oppning: { label: "Öppning", len: 1000 },
  skjut: { label: "Skjutdörr", len: 900 },
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
  { t: "TRAPPA", w: 3000, h: 900, stair: { steps: 12 } },
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

export default function RoomPlanner({ storageKey, title, focus = null, spaceId = null }) {
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
  const [focusOn, setFocusOn] = useState(true); // focus mode: zoomed to the room(s) vs the whole floor
  const [wStr, setWStr] = useState("");    // raw text for the Bredd/Längd inputs
  const [lStr, setLStr] = useState("");
  const [bgImg, setBgImg] = useState(null); // { dataUrl, w, h } reference image
  const [bgT, setBgT] = useState(null);     // { x, y, wmm, opacity, visible, rot } transform (in plan)
  const [bgHiddenLocal, setBgHiddenLocal] = useState(false); // per-session quick hide (not saved)
  const [walls, setWalls] = useState([]);   // freeform walls: [{ id, pts:[[x,y],...] }]
  const [activeWall, setActiveWall] = useState(null); // id of the selected / being-drawn polyline
  const [drawingWall, setDrawingWall] = useState(false); // true = taps add corners to activeWall (or start one)
  const [wallW, setWallW] = useState(WALL_OUTER); // thickness for the next freeform wall
  const [drawRect, setDrawRect] = useState(false);    // object-draw toggle (drag a rectangle)
  const [rectPreview, setRectPreview] = useState(null);
  const [calib, setCalib] = useState(null);  // { pts:[[x,y],...] } while calibrating the background
  const [measures, setMeasures] = useState([]); // finished ruler segments [[p1,p2],...] (ephemeral)
  const [mStart, setMStart] = useState(null);   // first point of the in-progress measurement
  const [mPreview, setMPreview] = useState(null); // live second point while dragging
  const [dims, setDims] = useState([]);         // saved dimension lines {id,a,b,off} (persistent, in plan)
  const [saveMeas, setSaveMeas] = useState(false); // when on, a completed measurement is saved as a dim
  const [areas, setAreas] = useState([]);       // room labels {id,x,y,name}; m² computed from the walls
  const mRefs = useRef({ a: null, b: null });   // anchors of the in-progress measurement's ends
  // ventilation layer (see vent.js) + the project's ventilation questions pinned on this plan
  const [ventLines, setVentLines] = useState([]);
  const [ventPts, setVentPts] = useState([]);
  const [showVent, setShowVent] = useState(() => { try { return localStorage.getItem("vs:v1:ui:vent") !== "0"; } catch { return true; } });
  const [ventSys, setVentSys] = useState("F");
  const [ventTool, setVentTool] = useState("valj"); // valj | kanal | pil | don | flakt | stam | aggregat | fraga
  const [ventDraft, setVentDraft] = useState(null); // in-progress duct/arrow: { sys, pts, arrow }
  const [project, updateProject] = useSpace("project");
  const planId = storageKey.replace(/^.*plan:/, "");
  const [snapOn, setSnapOn] = useState(true);   // snap points to object/room/wall corners
  const [comments, setComments] = useState([]); // {id, x, y, tx, ty, text, photo?, photoPath?}
  const [photoBusy, setPhotoBusy] = useState(false);
  const [cmType, setCmType] = useState("comment"); // what a tap in Kommentar mode creates: comment | photo
  const [bigPhoto, setBigPhoto] = useState(null);  // id of the comment whose photo is enlarged in-plan
  const cmPhotoRef = useRef(null);
  const photoForRef = useRef(null); // { id, isNew } target of the pending photo pick
  const bgStorageKey = storageKey.replace("plan:", "bg:");
  const bgFileRef = useRef(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const ptrs = useRef(new Map());
  const pinchRef = useRef(null);
  const vbRef = useRef(null);
  const undoRef = useRef([]);
  const loadedRef = useRef(false);
  // Save only after a real user edit on this device. Loading (or a sync refresh)
  // must never push the local copy back — it may be stale and would overwrite
  // newer changes from another device.
  const editedRef = useRef(false);
  const markEdited = () => { editedRef.current = true; };

  // ---------- undo ----------
  const takeSnap = () => ({
    room: { ...room },
    openings: openings.map((o) => ({ ...o })),
    items: items.map((i) => ({ ...i })),
    walls: walls.map((w) => ({ ...w, pts: w.pts.map((p) => [...p]) })),
    comments: comments.map((c) => ({ ...c })),
    dims: dims.map((d) => ({ ...d, a: [...d.a], b: [...d.b] })),
    areas: areas.map((a) => ({ ...a })),
    ventLines: ventLines.map((l) => ({ ...l, pts: l.pts.map((q) => [...q]) })),
    ventPts: ventPts.map((v) => ({ ...v })),
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
    setComments(s.comments || []);
    setDims(s.dims || []);
    setAreas(s.areas || []);
    setVentLines(s.ventLines || []); setVentPts(s.ventPts || []);
    if (s.bg !== undefined) setBgT(s.bg);
    setSel(null); setGroup([]); setUndoN(undoRef.current.length);
  };

  // ---------- persistence ----------
  const applySaved = useCallback((s) => {
    if (s.room) setRoom(s.room);
    if (s.openings) setOpenings(dedupe(s.openings, "o"));
    if (s.items) setItems(dedupe(s.items, "i"));
    setWalls(Array.isArray(s.walls) ? s.walls : []);
    setComments(Array.isArray(s.comments) ? s.comments : []);
    setDims(Array.isArray(s.dims) ? s.dims : []);
    setAreas(Array.isArray(s.areas) ? s.areas : []);
    setVentLines(Array.isArray(s.ventLines) ? s.ventLines : []);
    setVentPts(Array.isArray(s.ventPts) ? s.ventPts : []);
    setBgT(s.bg || null);
  }, []);
  useEffect(() => {
    undoRef.current = []; setUndoN(0);
    editedRef.current = false;
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
        if (r && r.value) { editedRef.current = false; applySaved(JSON.parse(r.value)); setStatus("Uppdaterat från synk"); }
        const rb = await storage.get(bgStorageKey);
        setBgImg(rb && rb.value ? JSON.parse(rb.value) : null);
      } catch { /* ignore */ }
    };
    window.addEventListener("vs-sync", onSync);
    return () => window.removeEventListener("vs-sync", onSync);
  }, [storageKey, bgStorageKey, applySaved]);
  useEffect(() => {
    if (!loadedRef.current || !editedRef.current) return;
    const t = setTimeout(async () => {
      try {
        // Dimension ends are stored resolved (anchors applied), so readers without the anchor logic stay right.
        const sd = resolveDims(dims, { room, walls, items, openings });
        await storage.set(storageKey, JSON.stringify({ v: 2, room, openings, items, ...(walls.length ? { walls } : {}), ...(comments.length ? { comments } : {}), ...(sd.length ? { dims: sd } : {}), ...(areas.length ? { areas } : {}), ...(ventLines.length ? { ventLines } : {}), ...(ventPts.length ? { ventPts } : {}), ...(bgT ? { bg: bgT } : {}) }));
        setStatus("Sparat");
      } catch (e) { setStatus("Kunde inte spara"); }
    }, 800);
    return () => clearTimeout(t);
  }, [room, openings, items, walls, comments, dims, areas, ventLines, ventPts, bgT, storageKey]);

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
  // …and the saved dimension lines (exterior chains sit well outside the walls).
  const liveDims = resolveDims(dims, { room, walls, items, openings });
  const db = dimsBounds(liveDims);
  if (db) { bx0 = Math.min(bx0, db[0]); by0 = Math.min(by0, db[1]); bx1 = Math.max(bx1, db[2]); by1 = Math.max(by1, db[3]); }
  // Room areas + BOA/BIA summary, recomputed from the walls on every change; the summary box sits under the plan.
  const grid = useMemo(() => (areas.length ? areaGrid(room, walls) : null), [areas.length, room, walls]);
  const summary = useMemo(() => areaSummary(grid, areas), [grid, areas]);
  const legend = areaLegend(summary);
  const legendAt = [bx0, by1 + 500];
  if (legend.length) by1 += 500 + legend.length * LEGEND_STEP + 200;
  // Focus: the fit view is the focused rooms (walls + a margin for nearby dims); the rest is dimmed by a mask.
  const focusKey = focus ? focus.join(",") : "";
  const focusRects = useMemo(() => {
    if (!focusKey || !grid) return null;
    const ids = new Set(focusKey.split(","));
    const regs = [...new Set(areas.filter((a) => ids.has(a.id)).map((a) => regionAt(grid, a.x, a.y)).filter((r) => r >= 0))];
    return regs.length ? regionRects(grid, regs, 0) : null;
  }, [focusKey, grid, areas]);
  const focused = !!(focusRects && focusOn);
  if (focused) {
    bx0 = Math.min(...focusRects.map((r) => r[0])) - 900; by0 = Math.min(...focusRects.map((r) => r[1])) - 900;
    bx1 = Math.max(...focusRects.map((r) => r[2])) + 900; by1 = Math.max(...focusRects.map((r) => r[3])) + 900;
  }
  const BASE = { x: bx0 - M, y: by0 - M, w: (bx1 - bx0) + 2 * M, h: (by1 - by0) + 2 * M };
  const zoom = view?.zoom ?? 1;
  const cx = view?.cx ?? BASE.x + BASE.w / 2;
  const cy = view?.cy ?? BASE.y + BASE.h / 2;
  const VB = { w: BASE.w / zoom, h: BASE.h / zoom, x: cx - BASE.w / zoom / 2, y: cy - BASE.h / zoom / 2 };
  vbRef.current = VB;
  const itemsCovered = coveredItemIds(items);
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
    if (room.frame === false) return null;
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
  // Unified opening geometry: room wall (o.wall) or freeform wall segment (o.wallId,o.seg).
  const openGeom = (o) => {
    if (o.wallId != null) {
      const w = walls.find((x) => x.id === o.wallId);
      if (!w || !w.pts[o.seg] || !w.pts[o.seg + 1]) return null;
      const A = w.pts[o.seg], B = w.pts[o.seg + 1];
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const L = Math.hypot(dx, dy) || 1;
      const along = [dx / L, dy / L];
      // Freeform wall is a centred stroke → band spans ±T/2 around the line.
      return { A: [A[0], A[1]], along, inward: [-along[1], along[0]], L, T: w.w ?? WALL, e0: -(w.w ?? WALL) / 2, e1: (w.w ?? WALL) / 2, free: true };
    }
    const g = wallGeom(o.wall, room.w, room.l);
    // Room wall poché sits outside the interior edge (A) → band spans -WALL..0.
    return g ? { ...g, T: WALL, e0: -WALL, e1: 0, free: false } : null;
  };
  // Nearest freeform wall segment to a point (for placing openings on drawn walls).
  const hitFreeWall = (p) => {
    let best = null, bestDist = Infinity;
    for (const w of walls) {
      if (!w.pts || w.pts.length < 2 || w.sep) continue;
      const T = w.w ?? WALL;
      for (let i = 0; i < w.pts.length - 1; i++) {
        const A = w.pts[i], B = w.pts[i + 1];
        const dx = B[0] - A[0], dy = B[1] - A[1];
        const L2 = dx * dx + dy * dy || 1;
        const t = clamp(((p.x - A[0]) * dx + (p.y - A[1]) * dy) / L2, 0, 1);
        const dist = Math.hypot(p.x - (A[0] + dx * t), p.y - (A[1] + dy * t));
        if (dist < T / 2 + 220 && dist < bestDist) {
          bestDist = dist; best = { wallId: w.id, seg: i, d: t * Math.sqrt(L2), L: Math.sqrt(L2) };
        }
      }
    }
    return best;
  };

  // ---------- snapping to features (corners, edges, wall vertices) ----------
  const pxToMm = () => {
    const el = svgRef.current, vb = vbRef.current;
    if (!el || !vb) return 1;
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / vb.w, r.height / vb.h);
    return s > 0 ? 1 / s : 1;
  };
  // Feature points (with anchors, so saved dimensions follow their wall/object).
  const snapPoint = (raw) => {
    if (!snapOn) return { p: raw, snapped: false, ref: null };
    const T = 16 * pxToMm();
    let best = null, bestD = T;
    for (const c of featurePoints({ room, walls, items, openings })) {
      const d = Math.hypot(c.p[0] - raw[0], c.p[1] - raw[1]);
      if (d < bestD) { bestD = d; best = c; }
    }
    // A wall face clearly closer than any corner/edge point wins (measure to the face, not a nearby object).
    const f = faceSnap({ walls }, raw, T);
    if (f && (!best || f.d * 3 < bestD)) return { p: f.p, snapped: true, ref: f.ref };
    if (best) return { p: [best.p[0], best.p[1]], snapped: true, ref: best.ref };
    return { p: raw, snapped: false, ref: null };
  };

  // ---------- pointer handlers ----------
  // ---------- ventilation layer ----------
  const ventPins = useMemo(() => ventPinsFor(project?.todos, planId), [project, planId]);
  const [pinMove, setPinMove] = useState(null); // { id, idx, x, y } while a question marker is dragged
  const pinsShown = pinMove ? ventPins.map((v) => (v.q.id === pinMove.id && v.idx === pinMove.idx ? { ...v, pin: { ...v.pin, x: pinMove.x, y: pinMove.y } } : v)) : ventPins;
  const ventSnap = (p) => {
    let best = null;
    for (const v of ventPts) { const d = Math.hypot(v.x - p.x, v.y - p.y); if (d < 260 && (!best || d < best.d)) best = { d, q: [v.x, v.y] }; }
    for (const l of ventLines) for (const q of l.pts) { const d = Math.hypot(q[0] - p.x, q[1] - p.y); if (d < 160 && (!best || d < best.d)) best = { d, q: [q[0], q[1]] }; }
    return best ? best.q : [snap(p.x), snap(p.y)];
  };
  const finishDraft = (d) => {
    if (d && d.pts.length >= 2) {
      pushUndo();
      const id = uid("vl");
      setVentLines((a) => [...a, { id, sys: d.sys, pts: d.pts, ...(d.arrow ? { arrow: true } : {}) }]);
      setSel({ kind: "vent", vk: "line", id });
    }
    setVentDraft(null);
  };
  const setTodos = (fn) => updateProject({ todos: fn(project?.todos || []) });
  const onVentDown = (p) => {
    if (ventTool === "valj") {
      const h = ventHit({ ventLines, ventPts }, ventPins, p.x, p.y);
      if (!h) return false;
      if (h.kind === "pt") {
        const v = ventPts.find((x) => x.id === h.id);
        setSel({ kind: "vent", vk: "pt", id: h.id });
        dragRef.current = { kind: "ventpt", id: h.id, dx: p.x - v.x, dy: p.y - v.y, pre: takeSnap(), moved: false };
      } else if (h.kind === "line") {
        const l = ventLines.find((x) => x.id === h.id);
        setSel({ kind: "vent", vk: "line", id: h.id });
        dragRef.current = h.vertex >= 0
          ? { kind: "ventvtx", id: h.id, idx: h.vertex, pre: takeSnap(), moved: false }
          : { kind: "ventline", id: h.id, x0: p.x, y0: p.y, pts0: l.pts.map((q) => [...q]), pre: takeSnap(), moved: false };
      } else {
        setSel({ kind: "vent", vk: "pin", id: h.id, idx: h.idx });
        dragRef.current = { kind: "ventpin", id: h.id, idx: h.idx, moved: false };
      }
      return true;
    }
    if (ventTool === "kanal" || ventTool === "pil") {
      const q = ventSnap(p), arrow = ventTool === "pil";
      const d = ventDraft && !!ventDraft.arrow === arrow ? ventDraft : { sys: ventSys, pts: [], arrow };
      const last = d.pts[d.pts.length - 1];
      if (last && Math.hypot(last[0] - q[0], last[1] - q[1]) < 1) { finishDraft(d); return true; } // tap the last point again = done
      const nd = { ...d, pts: [...d.pts, q] };
      if (arrow && nd.pts.length === 2) finishDraft(nd); else setVentDraft(nd);
      return true;
    }
    if (ventTool === "fraga") {
      const t = prompt("Fråga till VVS (hamnar i Projekt → Att besluta / att göra):", "");
      if (!t || !t.trim()) return true;
      const id = uid("q");
      setTodos((ts) => [...ts, { id, area: VENT_TOPIC, item: t.trim(), detail: "", who: "VVS", due: "", status: "Öppen", pins: [{ plan: planId, x: snap(p.x), y: snap(p.y) }] }]);
      setSel({ kind: "vent", vk: "pin", id, idx: 0 });
      return true;
    }
    // don | flakt | stam | aggregat
    let label;
    if (ventTool === "stam") { label = prompt("Stammens namn:", ventSys === "S2B" ? "S2-B" : ventSys === "S2K" ? "S2-K" : "S1"); if (label === null) return true; }
    if (ventTool === "aggregat") { label = prompt("Aggregat (kort text, t.ex. FL eller BV):", ventSys === "BV" ? "BV" : "FL"); if (label === null) return true; }
    pushUndo();
    const id = uid("vp");
    const [x, y] = ventTool === "don" || ventTool === "flakt" ? [snap(p.x), snap(p.y)] : ventSnap(p);
    setVentPts((a) => [...a, { id, sys: ventSys, kind: ventTool, x, y, ...(label ? { label: label.trim() } : {}), ...(ventTool === "aggregat" ? { w: 600, h: 600 } : {}) }]);
    setSel({ kind: "vent", vk: "pt", id });
    return true;
  };

  const onCanvasDown = (e) => {
    const p = toSvg(e.clientX, e.clientY);
    if (!readOnly && mode === "vent" && onVentDown(p)) return;
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
        mRefs.current = { a: s.ref, b: null };
        dragRef.current = { kind: "meas", first: true, moved: false };
      } else {
        setMPreview(s.snapped ? s.p : axisLock(mStart, s.p));
        mRefs.current.b = s.snapped ? s.ref : null;
        dragRef.current = { kind: "meas", first: false, moved: false };
      }
      return;
    }
    if (!readOnly && mode === "vaggar") {
      if (!drawingWall) { setActiveWall(null); return; } // tap on empty canvas = deselect
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
      const fh = hitFreeWall(p);
      if (fh) {
        const def = OPEN_DEFS[tool];
        const len = Math.min(def.len, fh.L);
        const pos = clamp(snap(fh.d - len / 2), 0, fh.L - len);
        pushUndo();
        const id = uid("o");
        setOpenings((a) => [...a, { id, wallId: fh.wallId, seg: fh.seg, pos, len, kind: tool, flip: false }]);
        setSel({ kind: "op", id });
        return;
      }
    }
    if (!readOnly && mode === "kommentar") {
      addComment(snap(p.x), snap(p.y), cmType === "photo");
      return;
    }
    if (!readOnly && mode === "ytor") {
      const n = prompt("Namn på rummet/ytan:", "");
      if (n === null) return;
      pushUndo();
      const id = uid("a");
      setAreas((a) => [...a, { id, x: snap(p.x), y: snap(p.y), name: n.trim() }]);
      setSel({ kind: "area", id });
      return;
    }
    {
      // Free pan at any zoom, so a selected object can be dragged out from
      // behind the bottom toolbar (drag empty canvas to slide the drawing).
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
    const g = openGeom(o);
    const along = g ? (p.x - g.A[0]) * g.along[0] + (p.y - g.A[1]) * g.along[1] : 0;
    dragRef.current = { kind: "op", id: o.id, off: along - o.pos, pre: takeSnap(), moved: false };
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
  const onCommentDown = (e, c) => {
    e.stopPropagation();
    setSel({ kind: "cm", id: c.id }); setGroup([]);
    if (readOnly) return;
    const p = toSvg(e.clientX, e.clientY);
    dragRef.current = { kind: "cm", id: c.id, dx: p.x - c.x, dy: p.y - c.y, pre: takeSnap(), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onCommentTargetDown = (e, c) => {
    e.stopPropagation();
    setBigPhoto(null);
    setSel({ kind: "cm", id: c.id });
    if (readOnly) return;
    dragRef.current = { kind: "cmt", id: c.id, pre: takeSnap(), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onCommentDirDown = (e, c) => {
    e.stopPropagation();
    setSel({ kind: "cm", id: c.id });
    if (readOnly) return;
    dragRef.current = { kind: "cmd", id: c.id, pre: takeSnap(), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onLabelDown = (e, it) => {
    e.stopPropagation();
    setSel({ kind: "it", id: it.id }); setGroup([]);
    if (readOnly) return;
    const p = toSvg(e.clientX, e.clientY);
    const lcx = it.x + it.w / 2 + (it.lx || 0), lcy = it.y + it.h / 2 + (it.ly || 0);
    dragRef.current = { kind: "label", id: it.id, gx: lcx - p.x, gy: lcy - p.y, pre: takeSnap(), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDimDown = (e, dm) => {
    e.stopPropagation();
    setSel({ kind: "dim", id: dm.id });
    if (readOnly) return;
    dragRef.current = { kind: "dim", id: dm.id, pre: takeSnap(), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDimLabelDown = (e, dm) => {
    e.stopPropagation();
    setSel({ kind: "dim", id: dm.id });
    if (readOnly) return;
    dragRef.current = { kind: "dimlab", id: dm.id, pre: takeSnap(), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onAreaDown = (e, ar) => {
    e.stopPropagation();
    setSel({ kind: "area", id: ar.id });
    if (readOnly) return;
    const p = toSvg(e.clientX, e.clientY);
    dragRef.current = { kind: "area", id: ar.id, dx: p.x - ar.x, dy: p.y - ar.y, pre: takeSnap(), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onBgDown = (e) => {
    if (readOnly || mode !== "bakgrund" || !bgT) return;
    e.stopPropagation();
    const p = toSvg(e.clientX, e.clientY);
    dragRef.current = { kind: "bg", dx: p.x - bgT.x, dy: p.y - bgT.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onWallBodyDown = (e, wallId) => {
    if (readOnly || mode !== "vaggar" || drawingWall) return;
    e.stopPropagation();
    setActiveWall(wallId);
    const p = toSvg(e.clientX, e.clientY);
    const w = walls.find((x) => x.id === wallId);
    dragRef.current = { kind: "wallmove", wallId, x0: p.x, y0: p.y, pts0: w.pts.map((q) => [...q]), pre: takeSnap(), moved: false };
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
      if (mStart) { const s = snapPoint([p.x, p.y]); setMPreview(s.snapped ? s.p : axisLock(mStart, s.p)); mRefs.current.b = s.snapped ? s.ref : null; }
      return;
    }
    d.moved = true;
    if (d.kind === "wallmove") {
      const dx = snap(p.x - d.x0), dy = snap(p.y - d.y0);
      setWalls((ws) => ws.map((w) => (w.id === d.wallId ? { ...w, pts: d.pts0.map((q) => [q[0] + dx, q[1] + dy]) } : w)));
    } else if (d.kind === "wallpt") {
      setWalls((ws) => ws.map((w) => (w.id === d.wallId ? { ...w, pts: w.pts.map((pp, i) => (i === d.idx ? [snap(p.x), snap(p.y)] : pp)) } : w)));
    } else if (d.kind === "bg") {
      setBgT((t) => (t ? { ...t, x: snap(p.x - d.dx), y: snap(p.y - d.dy) } : t));
    } else if (d.kind === "op") {
      setOpenings((a) => a.map((o) => {
        if (o.id !== d.id) return o;
        const g = openGeom(o);
        if (!g) return o;
        const along = (p.x - g.A[0]) * g.along[0] + (p.y - g.A[1]) * g.along[1];
        return { ...o, pos: clamp(snap(along - d.off), 0, g.L - o.len) };
      }));
    } else if (d.kind === "cm") {
      setComments((a) => a.map((c) => c.id === d.id ? { ...c, x: snap(p.x - d.dx), y: snap(p.y - d.dy) } : c));
    } else if (d.kind === "cmt") {
      setComments((a) => a.map((c) => c.id === d.id ? { ...c, tx: snap(p.x), ty: snap(p.y) } : c));
    } else if (d.kind === "cmd") {
      setComments((a) => a.map((c) => c.id === d.id
        ? { ...c, dir: Math.round(Math.atan2(p.y - c.ty, p.x - c.tx) * 180 / Math.PI / 15) * 15 } : c));
    } else if (d.kind === "label") {
      setItems((a) => a.map((it) => it.id === d.id
        ? { ...it, lx: snap((p.x + d.gx) - (it.x + it.w / 2)), ly: snap((p.y + d.gy) - (it.y + it.h / 2)) } : it));
    } else if (d.kind === "dim" || d.kind === "dimlab") {
      const live = liveDims.find((m) => m.id === d.id);
      if (!live) return;
      const g = dimGeom(live), [nx, ny] = g.n, ux = ny, uy = -nx;
      if (d.kind === "dim") {
        const off = snap((p.x - g.a[0]) * nx + (p.y - g.a[1]) * ny);
        setDims((a) => a.map((m) => (m.id === d.id ? { ...m, off } : m)));
      } else {
        const mx = (g.a2[0] + g.b2[0]) / 2, my = (g.a2[1] + g.b2[1]) / 2;
        const lt = snap((p.x - mx) * ux + (p.y - my) * uy);
        setDims((a) => a.map((m) => (m.id === d.id ? { ...m, lt } : m)));
      }
    } else if (d.kind === "area") {
      setAreas((a) => a.map((r) => (r.id === d.id ? { ...r, x: snap(p.x - d.dx), y: snap(p.y - d.dy) } : r)));
    } else if (d.kind === "ventpt") {
      setVentPts((a) => a.map((v) => (v.id === d.id ? { ...v, x: snap(p.x - d.dx), y: snap(p.y - d.dy) } : v)));
    } else if (d.kind === "ventvtx") {
      setVentLines((a) => a.map((l) => (l.id === d.id ? { ...l, pts: l.pts.map((q, i) => (i === d.idx ? [snap(p.x), snap(p.y)] : q)) } : l)));
    } else if (d.kind === "ventline") {
      const dx = snap(p.x - d.x0), dy = snap(p.y - d.y0);
      setVentLines((a) => a.map((l) => (l.id === d.id ? { ...l, pts: d.pts0.map((q) => [q[0] + dx, q[1] + dy]) } : l)));
    } else if (d.kind === "ventpin") {
      setPinMove({ id: d.id, idx: d.idx, x: snap(p.x), y: snap(p.y) });
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
          if (!(d.moved && mPreview)) mRefs.current.b = s.snapped ? s.ref : null;
          if (mStart) {
            const len = Math.hypot(p2[0] - mStart[0], p2[1] - mStart[1]);
            if (saveMeas && len > 1) {
              pushUndo();
              const id = uid("d");
              const { a: ra, b: rb } = mRefs.current;
              // Near-horizontal/vertical measurements stay straight even when their anchors move.
              const adx = Math.abs(p2[0] - mStart[0]), ady = Math.abs(p2[1] - mStart[1]);
              const ax = Math.min(adx, ady) / (Math.max(adx, ady) || 1) < 0.22 ? (adx >= ady ? "x" : "y") : undefined;
              setDims((a) => [...a, { id, a: mStart, b: p2, off: 350, ...(ra ? { ra } : {}), ...(rb ? { rb } : {}), ...(ax ? { ax } : {}) }]);
              setSel({ kind: "dim", id });
            } else {
              setMeasures((ms) => [...ms, [mStart, p2]]);
            }
          }
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
      if (d.kind === "ventpin") {
        if (d.moved && pinMove) {
          const { id, idx, x, y } = pinMove;
          setTodos((ts) => ts.map((t) => (t.id === id ? { ...t, pins: (t.pins || []).map((q, i) => (i === idx ? { ...q, x, y } : q)) } : t)));
        }
        setPinMove(null); dragRef.current = null; return;
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
    setItems((a) => [...a, { id, t: pDef.t, x: snap(clamp(400, 0, room.w - pDef.w)), y: snap(clamp(1000, 0, room.l - pDef.h)), w: pDef.w, h: pDef.h, ...(pDef.stair ? { stair: { ...pDef.stair } } : {}) }]);
    setSel({ kind: "it", id }); setGroup([]);
  };
  const selOp = sel?.kind === "op" ? openings.find((o) => o.id === sel.id) : null;
  const selIt = sel?.kind === "it" ? items.find((i) => i.id === sel.id) : null;
  const selCm = sel?.kind === "cm" ? comments.find((c) => c.id === sel.id) : null;
  const selDim = sel?.kind === "dim" ? liveDims.find((d) => d.id === sel.id) : null;
  const selArea = sel?.kind === "area" ? areas.find((a) => a.id === sel.id) : null;
  const selVent = sel?.kind !== "vent" ? null
    : sel.vk === "pt" ? (() => { const o = ventPts.find((v) => v.id === sel.id); return o ? { vk: "pt", o } : null; })()
    : sel.vk === "line" ? (() => { const o = ventLines.find((v) => v.id === sel.id); return o ? { vk: "line", o } : null; })()
    : (() => { const o = ventQuestions(project?.todos).find((q) => q.id === sel.id); return o ? { vk: "pin", o, idx: sel.idx } : null; })();
  const updVent = (fn) => {
    pushUndo();
    if (selVent?.vk === "pt") setVentPts((a) => a.map((v) => (v.id === sel.id ? fn(v) : v)));
    if (selVent?.vk === "line") setVentLines((a) => a.map((v) => (v.id === sel.id ? fn(v) : v)));
  };
  const areaOf = (ar) => (summary ? summary.byArea[ar.id] : null);
  const commentNumber = (id) => comments.findIndex((c) => c.id === id) + 1;
  const updOp = (fn) => { pushUndo(); setOpenings((a) => a.map((o) => (o.id === sel.id ? fn(o) : o))); };
  const updIt = (fn) => { pushUndo(); setItems((a) => a.map((i) => (i.id === sel.id ? fn(i) : i))); };
  const updCm = (fn) => { pushUndo(); setComments((a) => a.map((c) => (c.id === sel.id ? fn(c) : c))); };
  const updDim = (fn) => { pushUndo(); setDims((a) => a.map((d) => (d.id === sel.id ? fn(d) : d))); };
  const removeSel = () => {
    pushUndo();
    if (selOp) setOpenings((a) => a.filter((o) => o.id !== sel.id));
    if (selIt) setItems((a) => a.filter((i) => i.id !== sel.id));
    if (selCm) { if (selCm.photoPath) deletePhoto(selCm.photoPath); setComments((a) => a.filter((c) => c.id !== sel.id)); }
    if (selDim) setDims((a) => a.filter((d) => d.id !== sel.id));
    if (selArea) setAreas((a) => a.filter((r) => r.id !== sel.id));
    if (selVent?.vk === "pt") setVentPts((a) => a.filter((v) => v.id !== sel.id));
    if (selVent?.vk === "line") setVentLines((a) => a.filter((v) => v.id !== sel.id));
    setSel(null);
  };
  const renameSel = () => {
    if (!selIt) return;
    const n = prompt("Namn på objektet:", selIt.t);
    if (n === null) return;
    updIt((i) => ({ ...i, t: n.trim() || i.t }));
  };
  const editCommentText = () => {
    if (!selCm) return;
    const n = prompt("Kommentar:", selCm.text);
    if (n === null) return;
    updCm((c) => ({ ...c, text: n }));
  };
  const newComment = (tx, ty, text) => {
    const id = uid("c");
    setComments((a) => [...a, {
      id, tx, ty,
      x: clamp(tx + 300, -OUT, room.w + OUT),
      y: clamp(ty - 1200, -OUT, room.l + OUT),
      text: text || "",
    }]);
    setSel({ kind: "cm", id });
    return id;
  };
  const addComment = (tx, ty, wantPhoto) => {
    if (wantPhoto) {
      pushUndo();
      const id = newComment(tx, ty, "");
      photoForRef.current = { id, isNew: true };
      cmPhotoRef.current?.click();
      return;
    }
    const n = prompt("Kommentar:", "");
    if (n === null) return;
    pushUndo();
    newComment(tx, ty, n.trim() || "Kommentar");
  };
  const pickCommentPhoto = () => {
    if (!selCm) return;
    photoForRef.current = { id: selCm.id, isNew: false };
    cmPhotoRef.current?.click();
  };
  const onPickCommentPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target = photoForRef.current; photoForRef.current = null;
    const id = target?.id || selCm?.id;
    if (!id) return;
    if (!file) { if (target?.isNew) setComments((a) => a.filter((c) => c.id !== id)); return; }
    setPhotoBusy(true); setStatus("Laddar upp bild …");
    try {
      const old = comments.find((c) => c.id === id)?.photoPath;
      const { url, path } = await uploadPhoto(file);
      if (!target?.isNew) pushUndo();
      setComments((a) => a.map((c) => (c.id === id ? { ...c, photo: url, photoPath: path } : c)));
      if (old) deletePhoto(old);
      setStatus("Bild uppladdad");
    } catch (err) {
      setStatus("Kunde inte ladda upp bild");
      alert(err.message || "Kunde inte ladda upp bild");
      if (target?.isNew) setComments((a) => a.filter((c) => c.id !== id));
    }
    setPhotoBusy(false);
  };
  const removeCommentPhoto = () => {
    const old = selCm?.photoPath;
    updCm((c) => ({ ...c, photo: undefined, photoPath: undefined }));
    if (old) deletePhoto(old);
  };
  // Build and save a PDF of the plan drawing + numbered comments/photos (no print dialog).
  const printPlan = async () => {
    setStatus("Skapar PDF …");
    try {
      // in focus mode: the crop of the floor plan, with the room's own comments/objects
      const { pdfPlanArgs } = await import("../floorRooms.js");
      const pa = pdfPlanArgs({ plan: focused ? "floor" : null, areas: focus }, { room, openings, items, walls, comments, dims, areas });
      if (showVent && (hasVent({ ventLines, ventPts }) || ventPins.length)) pa.svg.vent = { ventLines, ventPts, pins: ventPins };
      const svgString = buildPlanSvg(pa.svg);
      const roomId = spaceId || storageKey.replace(/^.*plan:/, "");
      const { loadRoomPdfData } = await import("../state.js");
      const { space, cover } = await loadRoomPdfData(roomId);
      const { savePlanPdf } = await import("./pdf.js");
      await savePlanPdf({
        roomName: title, svgString, comments: pa.comments, bgImg: pa.crop ? null : bgImg, bgT: pa.crop ? null : bgT, cover,
        description: space.description || "", actions: space.actions || "",
        colors: space.colors || [], docs: space.docs || [],
        items: pa.items, inventory: space.inventory || {},
      });
      setStatus("PDF sparad");
    } catch { setStatus("Kunde inte skapa PDF"); }
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
  const newWallLine = () => { setActiveWall(null); setDrawingWall(true); }; // next tap starts a fresh polyline
  const undoWallPoint = () => {
    const id = activeWall;
    if (!id) return;
    pushUndo();
    setWalls((ws) => ws
      .map((w) => (w.id === id ? { ...w, pts: w.pts.slice(0, -1) } : w))
      .filter((w) => w.pts.length > 0));
  };
  const removeActiveWall = () => {
    const id = activeWall;
    if (!id) return;
    pushUndo();
    setWalls((ws) => ws.filter((w) => w.id !== id));
    setOpenings((a) => a.filter((o) => o.wallId !== id));
    setActiveWall(null); setDrawingWall(false);
  };
  // Thickness: applies to the selected wall (and becomes the default for new walls).
  const setThick = (nw) => {
    setWallW(nw);
    if (activeWall) { pushUndo(); setWalls((ws) => ws.map((w) => (w.id === activeWall ? { ...w, w: nw } : w))); }
  };
  const selWall = activeWall ? walls.find((w) => w.id === activeWall) : null;
  const selWallInfo = selWall && selWall.pts.length > 1
    ? `Markerad vägg: ${selWall.w ?? WALL} mm tjock · längd ${selWall.pts.slice(1).map((q, i) => Math.round(Math.hypot(q[0] - selWall.pts[i][0], q[1] - selWall.pts[i][1]))).join(" + ")} mm`
    : null;
  useEffect(() => { if (selWall && selWall.w != null) setWallW(selWall.w); }, [activeWall]); // eslint-disable-line
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
      if (o.wallId != null) return o; // freeform-wall openings aren't tied to room size
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
    const g = openGeom(o);
    if (!g) return null;
    const isSel = selOp?.id === o.id;
    const T = g.T;
    const A = pt(g.A, g.along, o.pos, g.inward);
    const B = pt(g.A, g.along, o.pos + o.len, g.inward);
    const els = [];
    const emid = (g.e0 + g.e1) / 2;
    if (o.kind === "fonster") {
      const c1 = pt(g.A, g.along, o.pos, g.inward, emid);
      const m2 = pt(g.A, g.along, o.pos + o.len, g.inward, emid);
      els.push(<line key="w" x1={c1[0]} y1={c1[1]} x2={m2[0]} y2={m2[1]} stroke={ink} strokeWidth="70" strokeLinecap="butt" />);
      els.push(<line key="wl" x1={c1[0]} y1={c1[1]} x2={m2[0]} y2={m2[1]} stroke={paper} strokeWidth="22" strokeLinecap="butt" />);
    } else if (o.kind === "skjut") {
      // Sliding door: jambs + the leaf (closed, solid) along one face of the wall and its open
      // position (dashed) slid past the opening – `flip` = slides the other way, `out` = other face,
      // `ficka` = pocket door (the leaf runs inside the wall).
      const a0 = pt(g.A, g.along, o.pos, g.inward, g.e0), a1 = pt(g.A, g.along, o.pos, g.inward, g.e1);
      const b0 = pt(g.A, g.along, o.pos + o.len, g.inward, g.e0), b1 = pt(g.A, g.along, o.pos + o.len, g.inward, g.e1);
      els.push(<line key="j1" x1={a0[0]} y1={a0[1]} x2={a1[0]} y2={a1[1]} stroke={ink} strokeWidth="16" />);
      els.push(<line key="j2" x1={b0[0]} y1={b0[1]} x2={b1[0]} y2={b1[1]} stroke={ink} strokeWidth="16" />);
      const e = o.ficka ? emid : o.out ? g.e0 - 30 : g.e1 + 30, sh = o.flip ? -o.len : o.len;
      const l0 = pt(g.A, g.along, o.pos, g.inward, e), l1 = pt(g.A, g.along, o.pos + o.len, g.inward, e);
      const m0 = pt(g.A, g.along, o.pos + sh, g.inward, e), m1 = pt(g.A, g.along, o.pos + o.len + sh, g.inward, e);
      els.push(<line key="lf" x1={l0[0]} y1={l0[1]} x2={l1[0]} y2={l1[1]} stroke={ink} strokeWidth="40" strokeLinecap="butt" />);
      els.push(<line key="lo" x1={m0[0]} y1={m0[1]} x2={m1[0]} y2={m1[1]} stroke={o.ficka ? paper : ink} strokeWidth="14" strokeDasharray="40 30" />);
    } else if (o.kind === "oppning") {
      // Doorless opening: the two jamb reveals across the wall band.
      const a0 = pt(g.A, g.along, o.pos, g.inward, g.e0), a1 = pt(g.A, g.along, o.pos, g.inward, g.e1);
      const b0 = pt(g.A, g.along, o.pos + o.len, g.inward, g.e0), b1 = pt(g.A, g.along, o.pos + o.len, g.inward, g.e1);
      els.push(<line key="j1" x1={a0[0]} y1={a0[1]} x2={a1[0]} y2={a1[1]} stroke={ink} strokeWidth="16" />);
      els.push(<line key="j2" x1={b0[0]} y1={b0[1]} x2={b1[0]} y2={b1[1]} stroke={ink} strokeWidth="16" />);
    } else {
      // Door: `flip` = hinge side (single door), `out` = swing to the outer side.
      const side = (o.out ?? (o.kind === "pardorr" ? o.flip : false)) ? -1 : 1;
      const iw = [g.inward[0] * side, g.inward[1] * side];
      const doors = o.kind === "pardorr"
        ? [{ hinge: A, other: pt(g.A, g.along, o.pos + o.len / 2, g.inward), dir: 1, L: o.len / 2 },
           { hinge: B, other: pt(g.A, g.along, o.pos + o.len / 2, g.inward), dir: -1, L: o.len / 2 }]
        : [o.flip
            ? { hinge: B, other: A, dir: -1, L: o.len }
            : { hinge: A, other: B, dir: 1, L: o.len }];
      doors.forEach((dr, i) => {
        const leafEnd = [dr.hinge[0] + iw[0] * dr.L, dr.hinge[1] + iw[1] * dr.L];
        const alongDir = [g.along[0] * dr.dir, g.along[1] * dr.dir];
        const crossZ = iw[0] * alongDir[1] - iw[1] * alongDir[0];
        const sweep = crossZ > 0 ? 1 : 0;
        els.push(<line key={"l" + i} x1={dr.hinge[0]} y1={dr.hinge[1]} x2={leafEnd[0]} y2={leafEnd[1]} stroke={ink} strokeWidth="16" />);
        els.push(<path key={"a" + i} d={`M ${leafEnd[0]} ${leafEnd[1]} A ${dr.L} ${dr.L} 0 0 ${sweep} ${dr.other[0]} ${dr.other[1]}`} fill="none" stroke={ink} strokeWidth="12" strokeDasharray="34 34" />);
      });
    }
    // hit area + selection halo (+ dimensions when selected)
    if (g.free) {
      els.push(<line key="hit" x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]}
        stroke={isSel ? "rgba(90,122,140,0.5)" : "transparent"} strokeWidth={T + 160} strokeLinecap="butt"
        style={{ cursor: "grab", pointerEvents: mode === "vaggar" || mode === "mat" ? "none" : "all" }} onPointerDown={(e) => onOpDown(e, o)} />);
      if (isSel) {
        const tm = pt(g.A, g.along, o.pos + o.len / 2, g.inward, -(T + 260));
        els.push(<text key="dm" x={tm[0]} y={tm[1]} fontFamily={mono} fontSize="120" fill={blue} textAnchor="middle" fontWeight="bold">{o.len}</text>);
      }
    } else {
      const horizontal = g.along[0] !== 0;
      const hitX = horizontal ? A[0] : (o.wall === "W" ? -WALL - 80 : room.w - 80);
      const hitY = horizontal ? (o.wall === "N" ? -WALL - 80 : room.l - 80) : A[1];
      els.push(
        <rect key="hit" x={hitX} y={hitY}
          width={horizontal ? o.len : WALL + 160} height={horizontal ? WALL + 160 : o.len}
          fill={isSel ? "rgba(90,122,140,0.18)" : "transparent"} stroke={isSel ? blue : "none"} strokeWidth="20"
          style={{ cursor: "grab" }} onPointerDown={(e) => onOpDown(e, o)} />
      );
      if (isSel) {
        const off = WALL + 260;
        const t1 = pt(g.A, g.along, o.pos / 2, g.inward, -off);
        const t2 = pt(g.A, g.along, o.pos + o.len + (g.L - o.pos - o.len) / 2, g.inward, -off);
        const tm = pt(g.A, g.along, o.pos + o.len / 2, g.inward, -off);
        els.push(<text key="d1" x={t1[0]} y={t1[1]} fontFamily={mono} fontSize="120" fill={blue} textAnchor="middle">{o.pos}</text>);
        els.push(<text key="d2" x={t2[0]} y={t2[1]} fontFamily={mono} fontSize="120" fill={blue} textAnchor="middle">{g.L - o.pos - o.len}</text>);
        els.push(<text key="dm" x={tm[0]} y={tm[1]} fontFamily={mono} fontSize="120" fill={blue} textAnchor="middle" fontWeight="bold">{o.len}</text>);
      }
    }
    return <g key={o.id}>{els}</g>;
  };

  // Saved dimension line: offset parallel line with extension lines from the measured points,
  // end ticks and an upright label (drag the label in Mät mode to slide it along the line).
  const renderDim = (dm) => {
    const isSel = selDim?.id === dm.id;
    const interactive = !readOnly && mode === "mat";
    const g = dimGeom(dm), [nx, ny] = g.n, tick = 90;
    const ext = (P, Q) => (Math.hypot(Q[0] - P[0], Q[1] - P[1]) > 1
      ? <line x1={P[0]} y1={P[1]} x2={Q[0]} y2={Q[1]} stroke={blue} strokeWidth="8" strokeDasharray="24 20" style={{ pointerEvents: "none" }} /> : null);
    const anchored = dm.ra || dm.rb;
    return (
      <g key={dm.id} onPointerDown={interactive ? (e) => onDimDown(e, dm) : undefined} style={{ cursor: interactive ? "grab" : "default" }}>
        {ext(g.ext[0], g.a2)}
        {ext(g.ext[1], g.b2)}
        <line x1={g.a2[0]} y1={g.a2[1]} x2={g.b2[0]} y2={g.b2[1]} stroke={blue} strokeWidth={isSel ? 20 : 12} style={{ pointerEvents: "none" }} />
        <line x1={g.a2[0] - nx * tick} y1={g.a2[1] - ny * tick} x2={g.a2[0] + nx * tick} y2={g.a2[1] + ny * tick} stroke={blue} strokeWidth="12" style={{ pointerEvents: "none" }} />
        <line x1={g.b2[0] - nx * tick} y1={g.b2[1] - ny * tick} x2={g.b2[0] + nx * tick} y2={g.b2[1] + ny * tick} stroke={blue} strokeWidth="12" style={{ pointerEvents: "none" }} />
        {interactive && <line x1={g.a2[0]} y1={g.a2[1]} x2={g.b2[0]} y2={g.b2[1]} stroke={isSel ? "rgba(90,122,140,0.25)" : "transparent"} strokeWidth="260" style={{ pointerEvents: "stroke" }} />}
        {isSel && anchored && [dm.ra && g.ext[0], dm.rb && g.ext[1]].filter(Boolean).map((P, i) => (
          <circle key={i} cx={P[0]} cy={P[1]} r="60" fill="none" stroke={blue} strokeWidth="16" style={{ pointerEvents: "none" }} />
        ))}
        <text x={g.lab[0]} y={g.lab[1]} fontFamily={mono} fontSize="130" fill={blue} textAnchor="middle" dominantBaseline="central"
          transform={g.ang ? `rotate(${g.ang} ${g.lab[0]} ${g.lab[1]})` : undefined}
          onPointerDown={interactive ? (e) => onDimLabelDown(e, dm) : undefined}
          style={{ pointerEvents: interactive ? "all" : "none", cursor: interactive ? "ew-resize" : "default" }}>{g.L}</text>
      </g>
    );
  };

  // Room label: name + m² of the enclosed region the label sits in (computed from the walls).
  const renderArea = (ar) => {
    const isSel = selArea?.id === ar.id;
    const interactive = !readOnly && mode === "ytor";
    const m2 = areaOf(ar);
    return (
      <g key={ar.id} onPointerDown={interactive ? (e) => onAreaDown(e, ar) : undefined}
        style={{ cursor: interactive ? "grab" : "default", pointerEvents: interactive ? "all" : "none" }}>
        {isSel && <rect x={ar.x - 700} y={ar.y - 300} width="1400" height="560" rx="60" fill="rgba(90,122,140,0.15)" stroke={blue} strokeWidth="12" strokeDasharray="30 24" />}
        {interactive && !isSel && <rect x={ar.x - 600} y={ar.y - 260} width="1200" height="480" fill="transparent" />}
        {ar.name && <text x={ar.x} y={ar.y - 20} textAnchor="middle" fontSize="170" letterSpacing="20" fill={ink} opacity="0.8">{ar.name}</text>}
        <text x={ar.x} y={ar.y + 170} textAnchor="middle" fontSize="150" fontFamily={mono} fill={m2 == null ? red : ink} opacity="0.8">{fmtM2(m2)}{kindTag(ar.kind)}</text>
      </g>
    );
  };
  const renderLegend = () => legend.length > 0 && (
    <g style={{ pointerEvents: "none" }}>
      {legend.map((l, i) => (
        <text key={i} x={legendAt[0]} y={legendAt[1] + i * LEGEND_STEP + 280} fontSize={l.big ? 300 : 190} fontWeight={l.big ? 700 : 400}
          fontFamily={l.big ? undefined : mono} fill={l.big ? ink : "#7A756E"}>{l.t}</text>
      ))}
    </g>
  );

  // ---------- UI ----------
  const btn = { background: "#fff", border: `1.5px solid ${ink}`, borderRadius: 8, color: ink, padding: "8px 12px", fontSize: 13, fontFamily: "inherit", cursor: "pointer", flex: "0 0 auto" };
  const btnOn = { ...btn, background: ink, color: "#fff" };
  const modeBtn = (m, label) => (
    <button style={mode === m ? btnOn : btn}
      onClick={() => { setMode(m); setSel(null); setGroup([]); setActiveWall(null); setDrawingWall(false); setDrawRect(false); setRectPreview(null); setCalib(null); setMStart(null); setMPreview(null); }}>{label}</button>
  );

  const rootStyle = {
    background: paper, overflow: "hidden", color: ink,
    fontFamily: "'Avenir Next','Helvetica Neue',Arial,sans-serif", display: "flex", flexDirection: "column",
    ...(full
      ? { position: "fixed", inset: 0, zIndex: 50, height: "100dvh", width: "100vw" }
      : { height: "100%" }),
  };

  return (
    <div style={rootStyle} onPointerDownCapture={markEdited} onKeyDownCapture={markEdited} onChangeCapture={markEdited}>
      <input ref={cmPhotoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickCommentPhoto} />
      <div className="pl-head" style={{ padding: "10px 16px 6px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="pl-title" style={{ fontSize: 15, letterSpacing: 2, fontWeight: 600 }}>{title || "RUMSPLANERARE"}</div>
          <div className="pl-sub" style={{ fontSize: 12, color: "#7A756E" }}>
            {readOnly ? "Skrivskyddad vy" : full ? "Helskärm — dra för att flytta · Stäng för verktyg" : "1 Rum → 2 Öppningar → 3 Inredning"}{status ? " · " + status : ""}
          </div>
        </div>
        <div className="pl-acts" style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {!readOnly && (
            <button style={{ ...btn, whiteSpace: "nowrap", opacity: undoN ? 1 : 0.4 }} disabled={!undoN} onClick={undo} title="Ångra">↶<span className="pl-lbl"> Ångra</span></button>
          )}
          {focusRects && (
            <button style={{ ...(focusOn ? btn : btnOn), whiteSpace: "nowrap" }} onClick={() => { setFocusOn((f) => !f); setView(null); }}
              title={focusOn ? "Visa hela planet" : "Visa bara rummet"}>▣<span className="pl-lbl">{focusOn ? " Hela planet" : " Bara rummet"}</span></button>
          )}
          {(hasVent({ ventLines, ventPts }) || ventPins.length > 0) && mode !== "vent" && (
            <button style={{ ...(showVent ? btnOn : btn), whiteSpace: "nowrap" }} title={showVent ? "Dölj ventilationen" : "Visa ventilationen"}
              onClick={() => setShowVent((v) => { try { localStorage.setItem("vs:v1:ui:vent", v ? "0" : "1"); } catch { /* ignore */ } return !v; })}>🌬<span className="pl-lbl"> Ventilation</span></button>
          )}
          <button style={{ ...btn, whiteSpace: "nowrap" }} onClick={printPlan} title="PDF">⬇<span className="pl-lbl"> PDF</span></button>
          <button style={{ ...btn, whiteSpace: "nowrap" }} onClick={() => setFull((f) => !f)}>
            {full ? "✕" : "⤢"}<span className="pl-lbl">{full ? " Stäng" : " Helskärm"}</span>
          </button>
        </div>
      </div>

      {!readOnly && !full && (
      <div className="pl-bar" style={{ display: "flex", gap: 8, padding: "6px 16px", flexWrap: "wrap" }}>
        {modeBtn("rum", "1 · Rum")}
        {modeBtn("oppningar", "2 · Öppningar")}
        {modeBtn("inredning", "3 · Inredning")}
        {modeBtn("vaggar", "✏️ Väggar")}
        {modeBtn("mat", "📏 Mät")}
        {modeBtn("ytor", "▦ Ytor m²")}
        {modeBtn("kommentar", "💬 Kommentar")}
        {modeBtn("vent", "🌬 Rita ventilation")}
        {modeBtn("bakgrund", "🖼 Bakgrund")}
      </div>
      )}

      {!readOnly && !full && mode === "rum" && (
        <div className="pl-bar" style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 16px", flexWrap: "wrap" }}>
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
          <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>= {((room.w * room.l) / 1e6).toFixed(1)} m²</span>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={room.frame !== false}
              onChange={(e) => { pushUndo(); setRoom((r) => ({ ...r, frame: e.target.checked ? undefined : false })); }} /> Rumsväggar (rektangel)
          </label>
        </div>
      )}

      {!readOnly && !full && mode === "oppningar" && (
        <div className="pl-bar" style={{ display: "flex", gap: 8, padding: "8px 16px", alignItems: "center", flexWrap: "wrap" }}>
          {Object.entries(OPEN_DEFS).map(([k, d]) => (
            <button key={k} style={tool === k ? { ...btnOn, background: blue, borderColor: blue } : btn} onClick={() => setTool(k)}>{d.label}</button>
          ))}
          <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>Tryck på en vägg (rummets eller en ritad) för att skära in · dra för att flytta</span>
        </div>
      )}

      {!readOnly && !full && mode === "mat" && (
        <div className="pl-bar" style={{ display: "flex", gap: 8, padding: "8px 16px", alignItems: "center", flexWrap: "wrap" }}>
          <button style={saveMeas ? { ...btnOn, background: blue, borderColor: blue } : btn} onClick={() => setSaveMeas((s) => !s)}>{saveMeas ? "✓ Spara mått" : "Spara mått"}</button>
          <button style={btn} onClick={() => { setMeasures([]); setMStart(null); setMPreview(null); }}>Rensa tillfälliga</button>
          <button style={snapOn ? { ...btnOn, background: blue, borderColor: blue } : btn} onClick={() => setSnapOn((s) => !s)}>{snapOn ? "✓ Fäst mot objekt" : "Fäst mot objekt"}</button>
          <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>{saveMeas ? "Sparade mått blir kvar på ritningen — dra måttlinjen i sidled för att lägga den bredvid bilden." : "Tryck/dra mellan två punkter · nära vågrätt/lodrätt låses · slå på “Spara mått” för bestående mått"}</span>
        </div>
      )}

      {!readOnly && !full && mode === "vent" && (
        <div className="pl-bar" style={{ display: "flex", gap: 8, padding: "8px 16px", alignItems: "center", flexWrap: "wrap" }}>
          {[["valj", "Välj / flytta"], ["kanal", "Kanal"], ["pil", "Luftpil"], ["don", "Don"], ["flakt", "Takfläkt"], ["stam", "Stam"], ["aggregat", "Aggregat"], ["fraga", "❓ Fråga till VVS"]].map(([k, l]) => (
            <button key={k} style={ventTool === k ? btnOn : btn} onClick={() => { setVentTool(k); setVentDraft(null); }}>{l}</button>
          ))}
          {ventDraft && <button style={{ ...btnOn, background: blue, borderColor: blue }} onClick={() => finishDraft(ventDraft)}>✓ Klar</button>}
          {ventDraft && <button style={btn} onClick={() => setVentDraft(null)}>Avbryt</button>}
        </div>
      )}
      {!readOnly && !full && mode === "vent" && ventTool !== "valj" && ventTool !== "fraga" && (
        <div className="pl-bar" style={{ display: "flex", gap: 6, padding: "0 16px 8px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#7A756E" }}>System:</span>
          {Object.entries(VENT_SYS).map(([k, d]) => (
            <button key={k} style={{ ...btn, padding: "6px 10px", fontSize: 12, ...(ventSys === k ? { background: d.color, color: "#fff", borderColor: d.color } : { borderColor: d.color, color: d.color }) }}
              onClick={() => { setVentSys(k); setVentDraft((dr) => (dr ? { ...dr, sys: k } : dr)); }}>{d.label}</button>
          ))}
          <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>
            {ventTool === "kanal" ? "Tryck punkt för punkt, ✓ Klar (eller tryck sista punkten igen). Punkter fäster mot stammar och don."
              : ventTool === "pil" ? "Två tryck: varifrån luften kommer → vart den går."
              : "Tryck där den ska sitta."}
          </span>
        </div>
      )}

      {!readOnly && !full && mode === "ytor" && (
        <div className="pl-bar" style={{ display: "flex", gap: 8, padding: "8px 16px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13 }}>{areas.length} ytor · <b style={{ fontFamily: mono }}>BOA {fmtM2(summary?.sum.boa ?? 0)}</b>{summary?.sum.bia > 0.05 && <> · <b style={{ fontFamily: mono }}>BIA {fmtM2(summary.sum.bia)}</b></>}</span>
          <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>Tryck i ett rum för att sätta namn + m² (räknas från väggarna, dörrar räknas som stängda) · dra etiketten för att flytta · öppna planlösningar delas med en rumsgräns under ✏️ Väggar</span>
        </div>
      )}

      {!readOnly && !full && mode === "vaggar" && (
        <div className="pl-bar" style={{ display: "flex", gap: 8, padding: "8px 16px", alignItems: "center", flexWrap: "wrap" }}>
          <button style={wallW === WALL_OUTER ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => setThick(WALL_OUTER)}>Yttervägg {WALL_OUTER}</button>
          <button style={wallW === WALL_INNER ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => setThick(WALL_INNER)}>Innervägg {WALL_INNER}</button>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>Bredd
            <input type="number" inputMode="numeric" step={10} value={wallW}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isFinite(v)) return;
                setThick(clamp(v, 20, 1000));
              }}
              style={{ width: 66, fontFamily: mono, fontSize: 13, padding: 5, border: `1.5px solid ${ink}`, borderRadius: 8 }} /> mm
          </label>
          <span style={{ width: 1, alignSelf: "stretch", background: "#00000022" }} />
          {drawingWall
            ? <button style={{ ...btnOn, background: blue, borderColor: blue }} onClick={() => { setDrawingWall(false); setWalls((ws) => ws.filter((w) => w.pts.length > 1)); }}>✓ Klar</button>
            : <button style={btn} onClick={newWallLine}>+ Ny vägg</button>}
          {drawingWall && activeWall && <button style={btn} onClick={undoWallPoint}>Ångra punkt</button>}
          {activeWall && !drawingWall && <button style={selWall?.sep ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => { pushUndo(); setWalls((ws) => ws.map((w) => (w.id === activeWall ? { ...w, sep: w.sep ? undefined : true } : w))); setOpenings((a) => a.filter((o) => o.wallId !== activeWall || selWall?.sep)); }}>
            {selWall?.sep ? "✓ Rumsgräns" : "Rumsgräns"}</button>}
          {activeWall && !drawingWall && <button style={{ ...btn, color: red, borderColor: red }} onClick={removeActiveWall}>Ta bort vägg</button>}
          <button style={snapOn ? { ...btnOn, background: blue, borderColor: blue } : btn} onClick={() => setSnapOn((s) => !s)}>{snapOn ? "✓ Fäst mot objekt" : "Fäst mot objekt"}</button>
          <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>
            {drawingWall ? "Tryck för att sätta hörn · ✓ Klar när väggen är färdig"
              : selWallInfo ? selWallInfo
              : "Tryck på en vägg för att markera den · dra väggen för att flytta · dra i hörnen för att justera"}
          </span>
        </div>
      )}

      {!readOnly && !full && mode === "kommentar" && (
        <div className="pl-bar" style={{ display: "flex", gap: 8, padding: "8px 16px", alignItems: "center", flexWrap: "wrap" }}>
          <button style={cmType === "comment" ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => setCmType("comment")}>💬 Kommentar</button>
          <button style={cmType === "photo" ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => setCmType("photo")}>📷 Bild</button>
          <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>
            Tryck på planen där {cmType === "photo" ? "bilden" : "kommentaren"} ska sitta.{" "}
            {cmType === "photo" ? "Välj en bild." : "Skriv texten."} Klicka på markören (● / ▾) för att visa innehållet.
          </span>
        </div>
      )}

      {!readOnly && !full && mode === "inredning" && (
        <div className="pl-bar" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "8px 16px", WebkitOverflowScrolling: "touch" }}>
          {PALETTE.map((p, i) => (
            <button key={i} style={btn} onClick={() => addItem(p)}>
              + {p.t} <span style={{ fontFamily: mono, fontSize: 11, color: blue }}>{p.w}</span>
            </button>
          ))}
        </div>
      )}

      {!readOnly && !full && mode === "inredning" && (
        <div className="pl-bar" style={{ display: "flex", gap: 8, padding: "0 16px 8px", alignItems: "center", flexWrap: "wrap" }}>
          <button style={drawRect ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => { setDrawRect((d) => !d); setMultiMode(false); }}>
            {drawRect ? "✓ Ritar ruta" : "✏️ Rita ruta"}
          </button>
          {drawRect && <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>Dra på ytan för att rita en egen ruta</span>}
          <button style={multiMode ? { ...btnOn, background: blue, borderColor: blue } : btn}
            onClick={() => { setMultiMode((m) => !m); setDrawRect(false); setGroup([]); }}>
            {multiMode ? "✓ Markerar flera" : "Markera flera"}
          </button>
          {multiMode && (
            <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>
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
        <div className="pl-bar" style={{ display: "flex", gap: 10, padding: "4px 16px 8px", alignItems: "center", flexWrap: "wrap" }}>
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
              <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>
                {calib ? "Tryck på två punkter med känt avstånd, ange sedan måttet i mm" : "Dra bilden för att flytta"}
              </span>
            </>
          )}
          {!bgImg && <span className="pl-hint" style={{ fontSize: 12, color: "#7A756E" }}>Ladda upp en ritning/foto att rita ovanpå.</span>}
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

          {/* corner blocks (room frame; off when the utrymme is drawn with freeform walls only) */}
          {room.frame !== false && [[-WALL, -WALL], [room.w, -WALL], [-WALL, room.l], [room.w, room.l]].map((c, i) => (
            <rect key={i} x={c[0]} y={c[1]} width={WALL} height={WALL} fill={ink} />
          ))}
          {/* wall segments */}
          {room.frame !== false && ["N", "S", "W", "E"].flatMap((w) => wallSegs(w).map((s, i) => (
            <rect key={w + i} x={s.x} y={s.y} width={s.w} height={s.h} fill={ink} />
          )))}

          {/* freeform drawn walls — sharp (butt) ends, corners filled, openings cut out */}
          {walls.flatMap((w) => {
            if (!w.pts || w.pts.length < 2) return [];
            if (w.sep) return [<polyline key={w.id} points={w.pts.map((q) => q.join(",")).join(" ")} fill="none" stroke={ink} strokeWidth="14" strokeDasharray="60 45" opacity="0.6" style={{ pointerEvents: "none" }} />];
            const T = w.w ?? WALL;
            const out = [];
            for (let i = 0; i < w.pts.length - 1; i++) {
              const A = w.pts[i], B = w.pts[i + 1];
              const dx = B[0] - A[0], dy = B[1] - A[1];
              const L = Math.hypot(dx, dy) || 1;
              const ux = dx / L, uy = dy / L;
              const ops = openings.filter((o) => o.wallId === w.id && o.seg === i).sort((a, b) => a.pos - b.pos);
              const segs = []; let cur = 0;
              for (const o of ops) { if (o.pos > cur) segs.push([cur, o.pos]); cur = Math.max(cur, o.pos + o.len); }
              if (cur < L) segs.push([cur, L]);
              for (const [a, b] of segs) out.push(
                <line key={w.id + ":" + i + ":" + a} x1={A[0] + ux * a} y1={A[1] + uy * a} x2={A[0] + ux * b} y2={A[1] + uy * b}
                  stroke={ink} strokeWidth={T} strokeLinecap="butt" style={{ pointerEvents: "none" }} />);
            }
            for (let i = 1; i < w.pts.length - 1; i++) {
              const v = w.pts[i];
              out.push(<rect key={w.id + "c" + i} x={v[0] - T / 2} y={v[1] - T / 2} width={T} height={T} fill={ink} style={{ pointerEvents: "none" }} />);
            }
            return out;
          })}
          {!readOnly && mode === "vaggar" && !drawingWall && walls.flatMap((w) =>
            w.pts.slice(1).map((q, i) => (
              <line key={"hit" + w.id + i} x1={w.pts[i][0]} y1={w.pts[i][1]} x2={q[0]} y2={q[1]}
                stroke={w.id === activeWall ? blue : "transparent"} strokeOpacity={w.id === activeWall ? 0.45 : 0}
                strokeWidth={Math.max((w.w ?? WALL) + 40, 260)} strokeLinecap="butt"
                style={{ cursor: "move" }} onPointerDown={(e) => onWallBodyDown(e, w.id)} />
            ))
          )}
          {!readOnly && mode === "vaggar" && walls.filter((w) => w.id === activeWall).flatMap((w) =>
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
          {room.frame !== false && <g fontFamily={mono} fontSize="130" fill={blue} style={{ pointerEvents: "none" }}>
            <line x1={0} y1={-WALL - 220} x2={room.w} y2={-WALL - 220} stroke={blue} strokeWidth="12" />
            <text x={room.w / 2 - 150} y={-WALL - 270}>{room.w}</text>
            <line x1={-WALL - 220} y1={0} x2={-WALL - 220} y2={room.l} stroke={blue} strokeWidth="12" />
            <text x={-WALL - 270} y={room.l / 2} transform={`rotate(-90 ${-WALL - 270} ${room.l / 2})`}>{room.l}</text>
          </g>}

          {/* openings */}
          <g style={{ pointerEvents: mode === "mat" || mode === "vaggar" ? "none" : undefined }}>
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

          {/* saved dimension lines (part of the drawing) */}
          {liveDims.map(renderDim)}

          {/* room labels with m² + the BOA/BIA summary */}
          {areas.map(renderArea)}
          {renderLegend()}

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

          {/* items — bodies first, then de-collided labels on top */}
          <g style={{ pointerEvents: mode === "mat" || mode === "vaggar" ? "none" : undefined }}>
          {items.map((it) => {
            const isSel = selIt?.id === it.id;
            const inGroup = group.includes(it.id);
            const hl = isSel || inGroup;
            const st = it.stair ? stairLines(it) : null;
            return (
              <g key={it.id}>
                <rect x={it.x} y={it.y} width={it.w} height={it.h}
                  onPointerDown={(e) => onItemDown(e, it)} style={{ cursor: "grab" }}
                  fill={hl ? "rgba(90,122,140,0.28)" : st ? paper : cab}
                  stroke={hl ? blue : ink}
                  strokeWidth={isSel ? 44 : inGroup ? 30 : 14}
                  strokeDasharray={inGroup && !isSel ? "70 45" : undefined} />
                {st && (
                  <g style={{ pointerEvents: "none" }} stroke={ink}>
                    {st.treads.map(([a, b], i) => <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth="10" />)}
                    <line x1={st.arrow[0][0]} y1={st.arrow[0][1]} x2={st.arrow[1][0]} y2={st.arrow[1][1]} strokeWidth="14" />
                    <polygon points={st.head.map((q) => q.join(",")).join(" ")} fill={ink} stroke="none" />
                  </g>
                )}
              </g>
            );
          })}
          {[...itemsCovered].map((id) => { const it = items.find((x) => x.id === id); if (!it) return null; return (
            <rect key={"cov" + id} x={it.x} y={it.y} width={it.w} height={it.h} fill="none" stroke={ink}
              strokeWidth="10" strokeDasharray="55 40" opacity="0.65" style={{ pointerEvents: "none" }} />
          ); })}
          {items.map((it) => {
            const label = it.t || "";
            const isSel = selIt?.id === it.id;
            const pl = itemLabel(it);
            const lw = label.length * pl.fs * 0.62, bw = pl.horiz ? lw : pl.fs, bh = pl.horiz ? pl.fs : lw;
            return (
              <g key={"lb" + it.id}>
                {pl.leader && <line x1={pl.ax} y1={pl.ay} x2={pl.cx} y2={pl.cy} stroke={ink} strokeWidth="8" opacity="0.5" style={{ pointerEvents: "none" }} />}
                {isSel && label && <rect x={pl.cx - bw / 2 - 40} y={pl.cy - bh / 2 - 40} width={bw + 80} height={bh + 80} rx="30"
                  fill="rgba(90,122,140,0.12)" stroke={blue} strokeWidth="8" strokeDasharray="30 24"
                  style={{ cursor: "grab" }} onPointerDown={(e) => onLabelDown(e, it)} />}
                {label && <text x={pl.cx} y={pl.cy + pl.fs * 0.34} textAnchor="middle" fontSize={pl.fs} fill={ink} style={{ pointerEvents: "none" }}
                  transform={pl.horiz ? undefined : `rotate(-90 ${pl.cx} ${pl.cy})`}>{label}</text>}
                {isSel && <text x={it.x + it.w / 2} y={it.y - 50} textAnchor="middle" fontFamily={mono} fontSize="120" fill={blue} style={{ pointerEvents: "none" }}>{it.w}×{it.h}</text>}
              </g>
            );
          })}
          </g>

          {/* ventilation layer (dims the building while editing it) */}
          {(mode === "vent" || (showVent && (ventLines.length || ventPts.length || pinsShown.length))) ? (
            <g style={{ pointerEvents: "none" }}>
              {mode === "vent" && <rect x={BASE.x - 1e5} y={BASE.y - 1e5} width={BASE.w + 2e5} height={BASE.h + 2e5} fill={paper} opacity="0.45" />}
              <g dangerouslySetInnerHTML={{ __html: ventSvg({ ventLines, ventPts }, pinsShown) }} />
              {ventDraft && ventDraft.pts.length > 0 && (
                <polyline points={ventDraft.pts.map((q) => q.join(",")).join(" ")} fill="none" stroke={ventColor(ventDraft.sys)} strokeWidth={LINE_W} strokeDasharray="90 60" />
              )}
              {ventDraft && ventDraft.pts.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r="60" fill={ventColor(ventDraft.sys)} />)}
              {selVent?.vk === "pt" && <circle cx={selVent.o.x} cy={selVent.o.y} r={selVent.o.kind === "aggregat" ? Math.max(selVent.o.w || 600, selVent.o.h || 600) * 0.75 : 260} fill="none" stroke={blue} strokeWidth="30" strokeDasharray="70 45" />}
              {selVent?.vk === "line" && <>
                <polyline points={selVent.o.pts.map((q) => q.join(",")).join(" ")} fill="none" stroke={blue} strokeWidth={LINE_W + 90} opacity="0.3" strokeLinejoin="round" />
                {selVent.o.pts.map((q, i) => <rect key={i} x={q[0] - 70} y={q[1] - 70} width="140" height="140" fill="#fff" stroke={blue} strokeWidth="22" />)}
              </>}
              {selVent?.vk === "pin" && (() => { const pin = pinsShown.find((v) => v.q.id === selVent.o.id && v.idx === selVent.idx)?.pin; return pin ? <circle cx={pin.x} cy={pin.y} r="290" fill="none" stroke={blue} strokeWidth="30" strokeDasharray="70 45" /> : null; })()}
            </g>
          ) : null}

          {/* focus: dim everything but the focused rooms and their walls */}
          {focused && (
            <g style={{ pointerEvents: "none" }}>
              <mask id="vs-focus-mask">
                <rect x={BASE.x - 1e5} y={BASE.y - 1e5} width={BASE.w + 2e5} height={BASE.h + 2e5} fill="#fff" />
                {focusRects.map((r, i) => <rect key={i} x={r[0] - 330} y={r[1] - 330} width={r[2] - r[0] + 660} height={r[3] - r[1] + 660} fill="#000" />)}
              </mask>
              <rect x={BASE.x - 1e5} y={BASE.y - 1e5} width={BASE.w + 2e5} height={BASE.h + 2e5} fill={paper} opacity="0.72" mask="url(#vs-focus-mask)" />
            </g>
          )}

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

          {/* comments: yellow note box with a leader line to a target point */}
          {comments.map((c, ci) => {
            const isSel = selCm?.id === c.id;
            const hasPhoto = !!c.photo;
            const num = ci + 1;
            const badgeR = isSel ? 170 : 135;
            // Numbered badge at the anchor; photos also get a rotatable arrow.
            const badge = (
              <>
                <circle cx={c.tx} cy={c.ty} r={badgeR} fill={blue} stroke="#fff" strokeWidth="28"
                  onPointerDown={(e) => onCommentTargetDown(e, c)} style={{ cursor: "grab" }} />
                <text x={c.tx} y={c.ty + badgeR * 0.36} textAnchor="middle" fontSize={badgeR * 1.02}
                  fontWeight="700" fill="#fff" style={{ pointerEvents: "none" }}>{num}</text>
              </>
            );
            let marker;
            if (hasPhoto) {
              const dir = ((c.dir ?? 0) * Math.PI) / 180;
              const L = 620, ah = 200;
              const tipx = c.tx + Math.cos(dir) * L, tipy = c.ty + Math.sin(dir) * L;
              const b1 = dir + Math.PI * 0.83, b2 = dir - Math.PI * 0.83;
              const head = `M ${tipx} ${tipy} L ${tipx + Math.cos(b1) * ah} ${tipy + Math.sin(b1) * ah} L ${tipx + Math.cos(b2) * ah} ${tipy + Math.sin(b2) * ah} Z`;
              marker = (
                <g>
                  <line x1={c.tx} y1={c.ty} x2={tipx} y2={tipy} stroke={blue} strokeWidth={isSel ? 48 : 40}
                    strokeLinecap="round" onPointerDown={(e) => onCommentDirDown(e, c)} style={{ cursor: "grab" }} />
                  <path d={head} fill={blue} stroke="#fff" strokeWidth="16"
                    onPointerDown={(e) => onCommentDirDown(e, c)} style={{ cursor: "grab" }} />
                  {badge}
                </g>
              );
            } else {
              marker = <g>{badge}</g>;
            }
            if (!isSel) return <g key={c.id}>{marker}</g>;
            // Selected: content card at (x,y), offset from the marker.
            const big = bigPhoto === c.id;
            const FS = 150, lineH = 200, pad = 90, gap = 70;
            const showText = !!(c.text && c.text.trim());
            const lines = showText ? wrapText(c.text, big ? 30 : 18) : [];
            const textW = Math.max(0, ...lines.map((l) => l.length)) * FS * 0.56;
            const innerW = Math.max(hasPhoto ? (big ? 3800 : 1700) : 900, textW);
            const imgH = hasPhoto ? Math.round(innerW * 0.7) : 0;
            const boxW = innerW + pad * 2;
            const boxH = pad * 2 + (hasPhoto ? imgH : 0) + (hasPhoto && showText ? gap : 0) + lines.length * lineH;
            const textTop = c.y + pad + (hasPhoto ? imgH + gap : 0);
            const cxb = c.x + boxW / 2, cyb = c.y + boxH / 2;
            const dx = c.tx - cxb, dy = c.ty - cyb;
            let sx = cxb, sy = cyb;
            if (dx !== 0 || dy !== 0) {
              const t = Math.min(dx !== 0 ? (boxW / 2) / Math.abs(dx) : Infinity,
                                 dy !== 0 ? (boxH / 2) / Math.abs(dy) : Infinity);
              sx = cxb + dx * t; sy = cyb + dy * t;
            }
            return (
              <g key={c.id}>
                <line x1={sx} y1={sy} x2={c.tx} y2={c.ty} stroke={blue} strokeWidth="26" />
                <g onPointerDown={(e) => onCommentDown(e, c)} style={{ cursor: "grab" }}>
                  <rect x={c.x} y={c.y} width={boxW} height={boxH} rx="70"
                    fill="#FFF7D6" stroke={blue} strokeWidth="34" />
                  {hasPhoto && (
                    <>
                      <image href={c.photo} x={c.x + pad} y={c.y + pad} width={innerW} height={imgH}
                        preserveAspectRatio="xMidYMid slice" style={{ cursor: big ? "zoom-out" : "zoom-in" }}
                        onClick={(e) => { e.stopPropagation(); setBigPhoto(big ? null : c.id); }} />
                      <rect x={c.x + pad} y={c.y + pad} width={innerW} height={imgH} rx="24"
                        fill="none" stroke={ink} strokeWidth="10" style={{ pointerEvents: "none" }} />
                    </>
                  )}
                  {showText && (
                    <text x={c.x + pad} y={textTop + FS * 0.9} fontSize={FS} fill={ink}
                      fontFamily="'Avenir Next','Helvetica Neue',Arial,sans-serif">
                      {lines.map((ln, i) => (
                        <tspan key={i} x={c.x + pad} dy={i === 0 ? 0 : lineH}>{ln || " "}</tspan>
                      ))}
                    </text>
                  )}
                </g>
                {/* draw the marker last so the card never covers it */}
                {marker}
              </g>
            );
          })}
          {/* in ventilation mode every tap goes to the layer (nothing underneath – comments, objects – steals it) */}
          {!readOnly && mode === "vent" && <rect x={BASE.x - 1e5} y={BASE.y - 1e5} width={BASE.w + 2e5} height={BASE.h + 2e5} fill="transparent" />}
        </svg>

        {/* selection controls — absolute overlay so selecting never reflows/rescales the canvas */}
        {!readOnly && (selOp || selIt || selCm || selDim || selArea || selVent) && (
          <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, background: "#fff", border: `1.5px solid ${ink}`, borderRadius: 10, padding: "8px 12px", paddingBottom: "calc(8px + env(safe-area-inset-bottom))", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.14)", zIndex: 3 }}>
          {selOp && (
            <>
              <div style={{ fontWeight: 600 }}>{OPEN_DEFS[selOp.kind].label} <span style={{ fontFamily: mono, color: blue, fontSize: 13 }}>{selOp.len}</span></div>
              <button style={btn} onClick={() => updOp((o) => {
                const g = openGeom(o);
                return { ...o, len: clamp(o.len - 50, 300, (g ? g.L : o.pos + o.len) - o.pos) };
              })}>−50</button>
              <button style={btn} onClick={() => updOp((o) => {
                const g = openGeom(o);
                return { ...o, len: clamp(o.len + 50, 300, (g ? g.L : o.pos + o.len) - o.pos) };
              })}>+50</button>
              <select value={selOp.kind} onChange={(e) => { const kind = e.target.value; updOp((o) => ({ ...o, kind })); }}
                style={{ ...btn, padding: "7px 8px" }} title="Typ av öppning">
                {Object.entries(OPEN_DEFS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
              </select>
              {(selOp.kind === "dorr" || selOp.kind === "skjut") && <button style={btn} onClick={() => updOp((o) => ({ ...o, flip: !o.flip }))}>↔ {selOp.kind === "skjut" ? "Skjuts åt andra hållet" : "Vänd sida"}</button>}
              {selOp.kind === "skjut" && <button style={selOp.ficka ? btnOn : btn} onClick={() => updOp((o) => ({ ...o, ficka: !o.ficka || undefined }))}>Ficka i väggen</button>}
              {selOp.kind === "skjut" && !selOp.ficka && <button style={btn} onClick={() => updOp((o) => ({ ...o, out: !o.out }))}>⇅ Andra väggsidan</button>}
              {(selOp.kind === "dorr" || selOp.kind === "pardorr") && <button style={btn} onClick={() => updOp((o) => ({ ...o, out: !(o.out ?? (o.kind === "pardorr" ? o.flip : false)) }))}>⇅ Öppnas ut/in</button>}
              <button style={{ ...btn, color: red, borderColor: red }} onClick={removeSel}>Ta bort</button>
            </>
          )}
          {selIt && (
            <>
              <div style={{ fontWeight: 600 }}>{selIt.t} <span style={{ fontFamily: mono, color: blue, fontSize: 13 }}>{selIt.w}×{selIt.h}</span></div>
              <button style={btn} onClick={renameSel}>✎ Namn</button>
              <button style={btn} onClick={() => updIt((i) => ({ ...i, lrot: i.lrot ? 0 : 1 }))}>⟲ Vrid text</button>
              {selIt.stair && <>
                <button style={btn} onClick={() => updIt((i) => ({ ...i, stair: { ...i.stair, rev: !i.stair.rev || undefined } }))}>⇄ Upp åt andra hållet</button>
                <button style={btn} onClick={() => updIt((i) => ({ ...i, stair: { ...i.stair, steps: Math.max(2, (i.stair.steps || 12) - 1) } }))}>Steg −</button>
                <span style={{ fontFamily: mono, fontSize: 13 }}>{selIt.stair.steps || Math.round(Math.max(selIt.w, selIt.h) / 250)} steg</span>
                <button style={btn} onClick={() => updIt((i) => ({ ...i, stair: { ...i.stair, steps: (i.stair.steps || 12) + 1 } }))}>Steg +</button>
              </>}
              <button style={btn} onClick={() => updIt((i) => ({ ...i, lx: undefined, ly: undefined, lrot: undefined }))}>↺ Text mitt</button>
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
          {selDim && (
            <>
              <div style={{ fontWeight: 600 }}>📐 Mått <span style={{ fontFamily: mono, color: blue, fontSize: 13 }}>{dimGeom(selDim).L} mm</span>
                <span style={{ fontSize: 11, color: "#7A756E", fontWeight: 400 }}>{selDim.ra || selDim.rb ? " · fäst i ritningen" : " · fritt"}</span></div>
              <button style={btn} onClick={() => updDim((d) => ({ ...d, off: -(d.off || 0) }))}>⇄ Byt sida</button>
              <button style={{ ...btn, color: red, borderColor: red }} onClick={removeSel}>Ta bort</button>
            </>
          )}
          {selVent && selVent.vk !== "pin" && (
            <>
              <div style={{ fontWeight: 600 }}>🌬 {selVent.vk === "line" ? (selVent.o.arrow ? "Luftpil" : "Kanal") : (VENT_KINDS.find(([k]) => k === selVent.o.kind) || [, "Punkt"])[1]}{selVent.o.label ? " " + selVent.o.label : ""}</div>
              <select value={selVent.o.sys} onChange={(e) => { const sys = e.target.value; updVent((v) => ({ ...v, sys })); }} style={{ ...btn, padding: "7px 8px", color: ventColor(selVent.o.sys) }}>
                {Object.entries(VENT_SYS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
              </select>
              {selVent.vk === "pt" && (selVent.o.kind === "stam" || selVent.o.kind === "aggregat") && (
                <button style={btn} onClick={() => { const n = prompt("Text:", selVent.o.label || ""); if (n !== null) updVent((v) => ({ ...v, label: n.trim() })); }}>✎ Text</button>
              )}
              {selVent.vk === "pt" && selVent.o.kind === "stam" && (
                <button style={btn} onClick={() => updVent((v) => { const o = { ...v }; if (o.lside === -1) delete o.lside; else o.lside = -1; return o; })}>⇄ Text vänster/höger</button>
              )}
              {selVent.vk === "pt" && (selVent.o.kind === "don" || selVent.o.kind === "flakt") && (
                <button style={btn} onClick={() => { const n = prompt("Flöde (l/s, tomt = inget):", selVent.o.flow || ""); if (n !== null) updVent((v) => { const f = n.trim().replace(",", "."); const o = { ...v }; if (f) o.flow = f; else delete o.flow; return o; }); }}>{selVent.o.flow ? selVent.o.flow + " l/s" : "l/s"}</button>
              )}
              {selVent.vk === "pt" && selVent.o.kind === "aggregat" && <>
                <button style={btn} onClick={() => updVent((v) => ({ ...v, w: Math.max(200, (v.w || 600) - 100) }))}>B −</button>
                <button style={btn} onClick={() => updVent((v) => ({ ...v, w: (v.w || 600) + 100 }))}>B +</button>
                <button style={btn} onClick={() => updVent((v) => ({ ...v, h: Math.max(200, (v.h || 600) - 100) }))}>D −</button>
                <button style={btn} onClick={() => updVent((v) => ({ ...v, h: (v.h || 600) + 100 }))}>D +</button>
              </>}
              {selVent.vk === "line" && <button style={selVent.o.arrow ? btnOn : btn} onClick={() => updVent((v) => { const o = { ...v }; if (o.arrow) delete o.arrow; else o.arrow = true; return o; })}>➜ Pil</button>}
              {selVent.vk === "line" && <button style={btn} onClick={() => updVent((v) => ({ ...v, pts: [...v.pts].reverse() }))}>⇄ Vänd</button>}
              <button style={{ ...btn, color: red, borderColor: red }} onClick={removeSel}>Ta bort</button>
            </>
          )}
          {selVent && selVent.vk === "pin" && (
            <>
              <div style={{ fontWeight: 600, maxWidth: 420 }}>❓ V{selVent.o.vnum} <span style={{ fontWeight: 400 }}>{selVent.o.item}</span></div>
              <button style={btn} onClick={() => { const n = prompt("Frågan:", selVent.o.item || ""); if (n !== null && n.trim()) setTodos((ts) => ts.map((t) => (t.id === selVent.o.id ? { ...t, item: n.trim() } : t))); }}>✎ Text</button>
              <button style={btn} onClick={() => { const n = prompt("Svar / detaljer:", selVent.o.detail || ""); if (n !== null) setTodos((ts) => ts.map((t) => (t.id === selVent.o.id ? { ...t, detail: n } : t))); }}>✎ Svar</button>
              <select value={selVent.o.status || "Öppen"} onChange={(e) => { const st = e.target.value; setTodos((ts) => ts.map((t) => (t.id === selVent.o.id ? { ...t, status: st } : t))); }} style={{ ...btn, padding: "7px 8px" }}>
                {["Öppen", "Pågår", "Klar"].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button style={btn} onClick={() => { setTodos((ts) => ts.map((t) => (t.id === selVent.o.id ? { ...t, pins: (t.pins || []).filter((_, i) => i !== selVent.idx) } : t))); setSel(null); }}>Ta bort markören</button>
              <button style={{ ...btn, color: red, borderColor: red }} onClick={() => { if (confirm("Ta bort frågan helt (även från Projekt)?")) { setTodos((ts) => ts.filter((t) => t.id !== selVent.o.id)); setSel(null); } }}>Ta bort frågan</button>
            </>
          )}
          {selArea && (
            <>
              <div style={{ fontWeight: 600 }}>▦ {selArea.name || "Yta"} <span style={{ fontFamily: mono, color: blue, fontSize: 13 }}>{fmtM2(areaOf(selArea))}</span></div>
              <button style={btn} onClick={() => { const n = prompt("Namn:", selArea.name); if (n !== null) { pushUndo(); setAreas((a) => a.map((r) => (r.id === selArea.id ? { ...r, name: n.trim() } : r))); } }}>✎ Namn</button>
              {AREA_KINDS.map(([k, lbl]) => (
                <button key={k} style={(selArea.kind || "boa") === k ? { ...btnOn, background: blue, borderColor: blue } : btn}
                  onClick={() => { pushUndo(); setAreas((a) => a.map((r) => (r.id === selArea.id ? { ...r, kind: k === "boa" ? undefined : k } : r))); }}>{lbl}</button>
              ))}
              <button style={{ ...btn, color: red, borderColor: red }} onClick={removeSel}>Ta bort</button>
            </>
          )}
          {selCm && (
            <>
              <div style={{ fontWeight: 600 }}>{selCm.photo ? "📷 Bild" : "💬 Kommentar"} #{commentNumber(selCm.id)}</div>
              <button style={btn} onClick={editCommentText}>✎ Text</button>
              <button style={btn} disabled={photoBusy} onClick={pickCommentPhoto}>
                {photoBusy ? "Laddar …" : (selCm.photo ? "📷 Byt bild" : "📷 Bild")}
              </button>
              {selCm.photo && (
                <button style={bigPhoto === selCm.id ? btnOn : btn}
                  onClick={() => setBigPhoto(bigPhoto === selCm.id ? null : selCm.id)}>
                  {bigPhoto === selCm.id ? "➖ Förminska" : "🔍 Förstora"}
                </button>
              )}
              {selCm.photo && <button style={btn} onClick={() => updCm((c) => ({ ...c, dir: ((c.dir || 0) + 45) % 360 }))}>⟳ Vrid pil</button>}
              {selCm.photo && <button style={btn} onClick={removeCommentPhoto}>🗑 Bild</button>}
              <button style={{ ...btn, color: red, borderColor: red }} onClick={removeSel}>Ta bort</button>
            </>
          )}
          </div>
        )}
      </div>
    </div>
  );
}
