// Static SVG-string renderer for a room plan — used for print/PDF, so a plan can
// be rendered without mounting the interactive RoomPlanner. Mirrors the planner's
// on-screen drawing (walls, openings, furniture, numbered comment markers) minus
// all interaction/selection chrome.
const WALL = 200;
const M = 480;
const ink = "#33312E", blue = "#5A7A8C", paper = "#FAF8F3", cab = "#E4EAED";
const mono = "ui-monospace, 'SF Mono', Menlo, monospace";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

function wallSegs(wall, room, openings) {
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
}

// Unified opening geometry: room wall (o.wall) or freeform wall segment (o.wallId,o.seg).
function openGeomS(o, room, walls) {
  if (o.wallId != null) {
    const w = (walls || []).find((x) => x.id === o.wallId);
    if (!w || !w.pts[o.seg] || !w.pts[o.seg + 1]) return null;
    const A = w.pts[o.seg], B = w.pts[o.seg + 1];
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L = Math.hypot(dx, dy) || 1;
    const along = [dx / L, dy / L];
    const T = w.w ?? WALL;
    return { A: [A[0], A[1]], along, inward: [-along[1], along[0]], L, T, e0: -T / 2, e1: T / 2 };
  }
  const g = wallGeom(o.wall, room.w, room.l);
  return g ? { ...g, T: WALL, e0: -WALL, e1: 0 } : null;
}

function openingEls(o, room, walls) {
  const g = openGeomS(o, room, walls);
  if (!g) return "";
  const A = pt(g.A, g.along, o.pos, g.inward);
  const B = pt(g.A, g.along, o.pos + o.len, g.inward);
  let s = "";
  const emid = (g.e0 + g.e1) / 2;
  if (o.kind === "fonster") {
    const c1 = pt(g.A, g.along, o.pos, g.inward, emid);
    const m2 = pt(g.A, g.along, o.pos + o.len, g.inward, emid);
    s += `<line x1="${c1[0]}" y1="${c1[1]}" x2="${m2[0]}" y2="${m2[1]}" stroke="${ink}" stroke-width="70" stroke-linecap="butt"/>`;
    s += `<line x1="${c1[0]}" y1="${c1[1]}" x2="${m2[0]}" y2="${m2[1]}" stroke="${paper}" stroke-width="22" stroke-linecap="butt"/>`;
  } else if (o.kind === "oppning") {
    const a0 = pt(g.A, g.along, o.pos, g.inward, g.e0), a1 = pt(g.A, g.along, o.pos, g.inward, g.e1);
    const b0 = pt(g.A, g.along, o.pos + o.len, g.inward, g.e0), b1 = pt(g.A, g.along, o.pos + o.len, g.inward, g.e1);
    s += `<line x1="${a0[0]}" y1="${a0[1]}" x2="${a1[0]}" y2="${a1[1]}" stroke="${ink}" stroke-width="16"/>`;
    s += `<line x1="${b0[0]}" y1="${b0[1]}" x2="${b1[0]}" y2="${b1[1]}" stroke="${ink}" stroke-width="16"/>`;
  } else {
    const side = (o.out ?? (o.kind === "pardorr" ? o.flip : false)) ? -1 : 1;
    const iw = [g.inward[0] * side, g.inward[1] * side];
    const doors = o.kind === "pardorr"
      ? [{ hinge: A, other: pt(g.A, g.along, o.pos + o.len / 2, g.inward), dir: 1, L: o.len / 2 },
         { hinge: B, other: pt(g.A, g.along, o.pos + o.len / 2, g.inward), dir: -1, L: o.len / 2 }]
      : [o.flip ? { hinge: B, other: A, dir: -1, L: o.len } : { hinge: A, other: B, dir: 1, L: o.len }];
    for (const dr of doors) {
      const leafEnd = [dr.hinge[0] + iw[0] * dr.L, dr.hinge[1] + iw[1] * dr.L];
      const alongDir = [g.along[0] * dr.dir, g.along[1] * dr.dir];
      const crossZ = iw[0] * alongDir[1] - iw[1] * alongDir[0];
      const sweep = crossZ > 0 ? 1 : 0;
      s += `<line x1="${dr.hinge[0]}" y1="${dr.hinge[1]}" x2="${leafEnd[0]}" y2="${leafEnd[1]}" stroke="${ink}" stroke-width="16"/>`;
      s += `<path d="M ${leafEnd[0]} ${leafEnd[1]} A ${dr.L} ${dr.L} 0 0 ${sweep} ${dr.other[0]} ${dr.other[1]}" fill="none" stroke="${ink}" stroke-width="12" stroke-dasharray="34 34"/>`;
    }
  }
  return s;
}

// Where to draw an item's label. Default: centred, oriented along the longer side, sized
// to fit. A manual offset (it.lx, it.ly) moves it; it.lrot flips the orientation. A leader
// line is used when the label sits outside the object. Returns {cx,cy,fs,horiz,leader,ax,ay}.
export function itemLabel(it) {
  const label = it.t || "";
  const cx0 = it.x + it.w / 2, cy0 = it.y + it.h / 2;
  const horizAuto = it.w >= it.h;
  const horiz = it.lrot ? !horizAuto : horizAuto;
  const along = horiz ? it.w : it.h, across = horiz ? it.h : it.w;
  let fs = Math.max(34, Math.min((along * 0.88) / Math.max(label.length * 0.62, 1), across * 0.62, 140));
  const lx = it.lx || 0, ly = it.ly || 0;
  const moved = lx !== 0 || ly !== 0;
  if (moved) fs = Math.max(70, Math.min(fs * 1.5, 120)); // readable when placed off the object
  const cx = cx0 + lx, cy = cy0 + ly;
  const outside = cx < it.x || cx > it.x + it.w || cy < it.y || cy > it.y + it.h;
  return { cx, cy, fs, horiz, leader: moved && outside, ax: cx0, ay: cy0 };
}

// Ids of items that are >50% covered by a later-drawn (on-top) item — their footprint is
// otherwise hidden, so callers draw a dashed outline on top.
export function coveredItemIds(items) {
  const covered = new Set();
  for (let i = 0; i < items.length; i++) {
    const a = items[i], aArea = (a.w * a.h) || 1;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ox * oy > 0.5 * aArea) { covered.add(a.id); break; }
    }
  }
  return covered;
}

// Build a standalone SVG string for a plan (mm units). `bgImg` = {dataUrl,w,h}, `bgT` = transform.
export function buildPlanSvg({ room, openings = [], items = [], walls = [], comments = [], dims = [], bgImg = null, bgT = null, embedBg = true }) {
  if (!room) room = { w: 3500, l: 6430 };
  let bx0 = -WALL, by0 = -WALL, bx1 = room.w + WALL, by1 = room.l + WALL;
  for (const it of items) {
    if (it.x < bx0) bx0 = it.x;
    if (it.y < by0) by0 = it.y;
    if (it.x + it.w > bx1) bx1 = it.x + it.w;
    if (it.y + it.h > by1) by1 = it.y + it.h;
  }
  const VB = { x: bx0 - M, y: by0 - M, w: (bx1 - bx0) + 2 * M, h: (by1 - by0) + 2 * M };

  let s = "";
  if (embedBg && bgImg && bgT && bgT.visible !== false) {
    const bgW = bgT.wmm, bgH = bgT.wmm * (bgImg.h / bgImg.w);
    const rot = bgT.rot ? ` transform="rotate(${bgT.rot} ${bgT.x + bgW / 2} ${bgT.y + bgH / 2})"` : "";
    s += `<g opacity="${bgT.opacity ?? 0.5}"${rot}><image href="${bgImg.dataUrl}" x="${bgT.x}" y="${bgT.y}" width="${bgW}" height="${bgH}" preserveAspectRatio="none"/></g>`;
  }
  for (const [cx, cy] of [[-WALL, -WALL], [room.w, -WALL], [-WALL, room.l], [room.w, room.l]])
    s += `<rect x="${cx}" y="${cy}" width="${WALL}" height="${WALL}" fill="${ink}"/>`;
  for (const w of ["N", "S", "W", "E"])
    for (const seg of wallSegs(w, room, openings))
      s += `<rect x="${seg.x}" y="${seg.y}" width="${seg.w}" height="${seg.h}" fill="${ink}"/>`;
  for (const w of walls) {
    if (!w.pts || w.pts.length < 2) continue;
    const T = w.w ?? WALL;
    for (let i = 0; i < w.pts.length - 1; i++) {
      const A = w.pts[i], B = w.pts[i + 1];
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const ops = openings.filter((o) => o.wallId === w.id && o.seg === i).sort((a, b) => a.pos - b.pos);
      const segs = []; let cur = 0;
      for (const o of ops) { if (o.pos > cur) segs.push([cur, o.pos]); cur = Math.max(cur, o.pos + o.len); }
      if (cur < L) segs.push([cur, L]);
      for (const [a, b] of segs)
        s += `<line x1="${A[0] + ux * a}" y1="${A[1] + uy * a}" x2="${A[0] + ux * b}" y2="${A[1] + uy * b}" stroke="${ink}" stroke-width="${T}" stroke-linecap="butt"/>`;
    }
    for (let i = 1; i < w.pts.length - 1; i++) {
      const v = w.pts[i];
      s += `<rect x="${v[0] - T / 2}" y="${v[1] - T / 2}" width="${T}" height="${T}" fill="${ink}"/>`;
    }
  }
  s += `<g font-family="${mono}" font-size="130" fill="${blue}">` +
    `<line x1="0" y1="${-WALL - 220}" x2="${room.w}" y2="${-WALL - 220}" stroke="${blue}" stroke-width="12"/>` +
    `<text x="${room.w / 2 - 150}" y="${-WALL - 270}">${room.w}</text>` +
    `<line x1="${-WALL - 220}" y1="0" x2="${-WALL - 220}" y2="${room.l}" stroke="${blue}" stroke-width="12"/>` +
    `<text x="${-WALL - 270}" y="${room.l / 2}" transform="rotate(-90 ${-WALL - 270} ${room.l / 2})">${room.l}</text></g>`;
  for (const o of openings) s += openingEls(o, room, walls);
  for (const dm of dims) {
    if (!dm.a || !dm.b) continue;
    const [ax, ay] = dm.a, [bx, by] = dm.b;
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L, off = dm.off || 0, tick = 90;
    const a2 = [ax + nx * off, ay + ny * off], b2 = [bx + nx * off, by + ny * off];
    const mid = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2], lab = off >= 0 ? 150 : -60;
    if (off !== 0) {
      s += `<line x1="${ax}" y1="${ay}" x2="${a2[0]}" y2="${a2[1]}" stroke="${blue}" stroke-width="8" stroke-dasharray="24 20"/>`;
      s += `<line x1="${bx}" y1="${by}" x2="${b2[0]}" y2="${b2[1]}" stroke="${blue}" stroke-width="8" stroke-dasharray="24 20"/>`;
    }
    s += `<line x1="${a2[0]}" y1="${a2[1]}" x2="${b2[0]}" y2="${b2[1]}" stroke="${blue}" stroke-width="12"/>`;
    s += `<line x1="${a2[0] - nx * tick}" y1="${a2[1] - ny * tick}" x2="${a2[0] + nx * tick}" y2="${a2[1] + ny * tick}" stroke="${blue}" stroke-width="12"/>`;
    s += `<line x1="${b2[0] - nx * tick}" y1="${b2[1] - ny * tick}" x2="${b2[0] + nx * tick}" y2="${b2[1] + ny * tick}" stroke="${blue}" stroke-width="12"/>`;
    s += `<text x="${mid[0] + nx * lab}" y="${mid[1] + ny * lab}" font-family="${mono}" font-size="130" fill="${blue}" text-anchor="middle">${Math.round(L)}</text>`;
  }
  for (const it of items) s += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${cab}" stroke="${ink}" stroke-width="14"/>`;
  const covered = coveredItemIds(items);
  for (const it of items) if (covered.has(it.id))
    s += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="none" stroke="${ink}" stroke-width="10" stroke-dasharray="55 40" opacity="0.65"/>`;
  for (const it of items) {
    const label = it.t || "";
    const pl = itemLabel(it);
    const rot = pl.horiz ? "" : ` transform="rotate(-90 ${pl.cx} ${pl.cy})"`;
    if (pl.leader) s += `<line x1="${pl.ax}" y1="${pl.ay}" x2="${pl.cx}" y2="${pl.cy}" stroke="${ink}" stroke-width="8" opacity="0.5"/>`;
    if (label) s += `<text x="${pl.cx}" y="${pl.cy + pl.fs * 0.34}" text-anchor="middle" font-size="${pl.fs}" fill="${ink}" font-family="'Avenir Next','Helvetica Neue',Arial,sans-serif"${rot}>${esc(label)}</text>`;
  }
  comments.forEach((c, i) => {
    const num = i + 1, badgeR = 135;
    if (c.photo) {
      const dir = ((c.dir ?? 0) * Math.PI) / 180, L = 620, ah = 200;
      const tipx = c.tx + Math.cos(dir) * L, tipy = c.ty + Math.sin(dir) * L;
      const b1 = dir + Math.PI * 0.83, b2 = dir - Math.PI * 0.83;
      s += `<line x1="${c.tx}" y1="${c.ty}" x2="${tipx}" y2="${tipy}" stroke="${blue}" stroke-width="40" stroke-linecap="round"/>`;
      s += `<path d="M ${tipx} ${tipy} L ${tipx + Math.cos(b1) * ah} ${tipy + Math.sin(b1) * ah} L ${tipx + Math.cos(b2) * ah} ${tipy + Math.sin(b2) * ah} Z" fill="${blue}" stroke="#fff" stroke-width="16"/>`;
    }
    s += `<circle cx="${c.tx}" cy="${c.ty}" r="${badgeR}" fill="${blue}" stroke="#fff" stroke-width="28"/>`;
    s += `<text x="${c.tx}" y="${c.ty + badgeR * 0.36}" text-anchor="middle" font-size="${badgeR * 1.02}" font-weight="700" fill="#fff">${num}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" width="100%" height="auto" preserveAspectRatio="xMidYMid meet">${s}</svg>`;
}

const cardsHtml = (comments) => comments.map((c, i) => {
  const label = c.photo ? "📷 Bild" : "💬 Kommentar";
  const img = c.photo ? `<img src="${esc(c.photo)}"/>` : "";
  const txt = (c.text || "").trim() ? `<div class="t">${esc(c.text)}</div>` : "";
  return `<div class="card"><div class="hd">#${i + 1} · ${label}</div>${img}${txt}</div>`;
}).join("");

// One room block: title, plan drawing, then its numbered comments/photos.
const roomSection = ({ title, svgString, comments = [], sub }, breakBefore) =>
  `<section class="room"${breakBefore ? ' style="break-before:page"' : ""}>` +
  `<h1>${esc(title || "Planritning")}</h1>` +
  (sub ? `<div class="sub">${esc(sub)}</div>` : "") +
  `<div class="plan">${svgString}</div>` +
  (comments.length
    ? `<h2>Kommentarer &amp; bilder</h2><div class="cards">${cardsHtml(comments)}</div>`
    : `<p class="empty">Inga kommentarer eller bilder på planritningen.</p>`) +
  `</section>`;

const PRINT_CSS =
  `#vs-print-root{display:none}` +
  `@media print{` +
  `  html,body{background:#fff!important;margin:0!important}` +
  `  body>*{display:none!important}` +
  `  #vs-print-root{display:block!important;position:static!important;color:#222;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif}` +
  `  #vs-print-root h1{font-size:20px;margin:0 0 2px}` +
  `  #vs-print-root .sub{color:#666;font-size:12px;margin:0 0 14px}` +
  `  #vs-print-root .plan{width:100%;border:1px solid #999;border-radius:6px;margin-bottom:16px}` +
  `  #vs-print-root .plan svg{width:100%;height:auto}` +
  `  #vs-print-root h2{font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px;margin:14px 0 10px}` +
  `  #vs-print-root .cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}` +
  `  #vs-print-root .card{border:1px solid #ddd;border-radius:8px;padding:10px;break-inside:avoid}` +
  `  #vs-print-root .card .hd{font-weight:700;font-size:13px}` +
  `  #vs-print-root .card img{display:block;max-width:100%;border-radius:6px;margin-top:6px;border:1px solid #ccc}` +
  `  #vs-print-root .card .t{margin-top:6px;font-size:12px;color:#444;white-space:pre-wrap}` +
  `  #vs-print-root .empty{color:#888;font-size:12px}` +
  `  #vs-print-root .cover{height:90vh;display:flex;flex-direction:column;justify-content:center}` +
  `  #vs-print-root .cover .ctitle{font-size:34px;font-weight:800;letter-spacing:1px}` +
  `  #vs-print-root .cover .csub{font-size:14px;color:#666;margin-top:8px}` +
  `  #vs-print-root .cover .cline{font-size:14px;margin-top:8px}` +
  `  #vs-print-root .cover .cfree{font-size:13px;color:#444;margin-top:16px;white-space:pre-wrap;max-width:60ch}` +
  `  #vs-print-root .toc{margin-top:30px;font-size:14px;line-height:1.9;list-style:none;padding:0}` +
  `  @page{margin:12mm}` +
  `}`;

// Inject a print-only section into the current page, wait for images, then print.
// Reliable on iPad Safari (no iframe / new tab).
function doPrint(innerHtml) {
  document.getElementById("vs-print-root")?.remove();
  document.getElementById("vs-print-style")?.remove();
  const style = document.createElement("style");
  style.id = "vs-print-style";
  style.textContent = PRINT_CSS;
  const root = document.createElement("div");
  root.id = "vs-print-root";
  root.innerHTML = innerHtml;
  document.body.appendChild(style);
  document.body.appendChild(root);
  const cleanup = () => { root.remove(); style.remove(); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  let printed = false;
  const go = () => { if (printed) return; printed = true; window.print(); setTimeout(cleanup, 60000); };
  const imgs = Array.from(root.querySelectorAll("img"));
  if (!imgs.length) { setTimeout(go, 300); return; }
  let left = imgs.length;
  const tick = () => { if (--left <= 0) go(); };
  imgs.forEach((im) => { if (im.complete) tick(); else { im.onload = tick; im.onerror = tick; } });
  setTimeout(go, 10000);
}

// One room's plan + comments. `svgString` from buildPlanSvg.
export function printPlanDoc({ title, svgString, comments = [] }) {
  doPrint(roomSection({ title, svgString, comments, sub: `Villa Skogstorp · ${new Date().toLocaleDateString("sv-SE")}` }, false));
}

// Whole project: a cover page (from the cover details) + one page-broken section per room.
export function printProjectDoc({ title = "Villa Skogstorp", sections = [], cover = {} }) {
  const date = new Date().toLocaleDateString("sv-SE");
  const name = cover.projectName || title;
  const lines = [];
  if (cover.officialName) lines.push(`<div class="cline"><b>Fastighet:</b> ${esc(cover.officialName)}</div>`);
  if (cover.houseAddress) lines.push(`<div class="cline"><b>Husets adress:</b> ${esc(cover.houseAddress)}</div>`);
  const contact = [cover.contactName, cover.email, cover.phone, cover.contactAddress].filter(Boolean).map(esc);
  if (contact.length) lines.push(`<div class="cline"><b>Kontakt:</b> ${contact.join(" · ")}</div>`);
  const free = (cover.freeText || "").trim() ? `<div class="cfree">${esc(cover.freeText)}</div>` : "";
  const coverHtml =
    `<section class="cover">` +
    `<div class="ctitle">${esc(name)}</div>` +
    `<div class="csub">Renoverings- och tillbyggnadsplan · ${date}</div>` +
    lines.join("") + free +
    `<ul class="toc">${sections.map((s, i) => `<li>${i + 1}. ${esc(s.title)}</li>`).join("")}</ul>` +
    `</section>`;
  doPrint(coverHtml + sections.map((s) => roomSection(s, true)).join(""));
}
