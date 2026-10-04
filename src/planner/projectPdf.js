// The project PDF (Projekt page): one document built section by section from the same data the
// Projekt page shows, honouring every "I PDF"/option choice stored in project.pdf.
// buildProjectPdf({ project, ids }) → downloads a .pdf. `ids` = the sections to include, in PDF order
// (one id = that section on its own). Bilagor (private PDFs in vs-docs) are merged in at the end
// with pdf-lib, each behind a "Bilaga A" divider page. Lazy-loaded (jsPDF + pdf-lib stay out of the
// main bundle).
import { storage, bgKey, spaceKey, roomsKey } from "../storage.js";
import { loadPlanForPrint } from "../state.js";
import { signedDocUrl } from "../photos.js";
import { buildPlanSvg } from "./planSvg.js";
import { newDoc, safe, hexToRgb, loadImg, svgToJpeg, fetchDataUrl, addRoomPages } from "./pdf.js";
import { computeBudget, BUILDS, matLines, lineAmt, est, parseNum } from "../budgetCalc.js";

const M = 14;
const INK = [51, 49, 46], BLUE = [90, 122, 140], MUTED = [122, 117, 110], LINE = [214, 208, 198], SOFT = [246, 243, 237], TXT = [70, 66, 62], RED = [154, 74, 58], OKL = [251, 243, 228];
const TYP_COLORS = ["#5A7A8C", "#8C6A3F", "#5E8C5A", "#9a4a3a", "#7A5A8C", "#3F7F8C", "#8C8C3F"].map((h) => { const c = hexToRgb(h); return [c.r, c.g, c.b]; });
const nf = (n, d = 0) => new Intl.NumberFormat("sv-SE", { maximumFractionDigits: d }).format(n);
const kr = (n) => nf(Math.round(n)) + " kr";
const hF = (h) => nf(Math.round(h)) + " h";
const short = (n) => String(n || "").replace(/^(K|P1|P2)\s*·\s*/, "");
const today = () => new Date().toLocaleDateString("sv-SE");
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" }).replace(".", "") : "");
const ETAPP_TITLE = { budget: "Etapp 1 – huset till inflytt", budget2: "Etapp 2 – efter inflytt" };

const getJson = async (key) => { try { const r = await storage.get(key); return r?.value ? JSON.parse(r.value) : null; } catch { return null; } };

// ---------- images: every image is re-encoded to a bounded JPEG (smaller file, no WebP/PNG surprises) ----------
const imgCache = new Map();
async function toJpeg(src, maxPx = 1600) {
  if (!src) return null;
  const k = maxPx + "|" + src.slice(0, 200) + src.length;
  if (imgCache.has(k)) return imgCache.get(k);
  let out = null;
  try {
    const im = await loadImg(src);
    const s = Math.min(1, maxPx / Math.max(im.width, im.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(im.width * s)); c.height = Math.max(1, Math.round(im.height * s));
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
    out = { data: c.toDataURL("image/jpeg", 0.85), ratio: c.height / c.width };
  } catch { out = null; }
  imgCache.set(k, out);
  return out;
}
// A photo/inspo entry ({photo}) or a private drawing reference ({ref} = bg key).
async function imageOf(p, maxPx) {
  if (p.ref) { const r = await getJson(bgKey(p.ref)); return r?.dataUrl ? toJpeg(r.dataUrl, maxPx) : null; }
  if (p.photo) { const d = await fetchDataUrl(p.photo); return d ? toJpeg(d, maxPx) : null; }
  return null;
}

// ---------- page writer ----------
function writer(doc) {
  const W = { doc, y: M, crumb: "", used: false, orient: "p" };
  W.pw = () => doc.internal.pageSize.getWidth();
  W.ph = () => doc.internal.pageSize.getHeight();
  W.cw = () => W.pw() - 2 * M;
  W.bottom = () => W.ph() - 16;
  W.page = () => doc.internal.getCurrentPageInfo().pageNumber;
  W.newPage = (orient = "p") => {
    if (!W.used) W.used = true; // reuse jsPDF's initial blank page (always portrait)
    else doc.addPage("a4", orient);
    W.orient = orient;
    doc.setFillColor(...BLUE); doc.rect(0, 0, W.pw(), 4, "F");
    if (W.crumb) { doc.setTextColor(...BLUE); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.text(W.crumb.toUpperCase(), M, 11.5); }
    W.y = 22;
  };
  W.ensure = (need) => { if (W.y + need > W.bottom()) W.newPage(W.orient); };
  W.font = (size, style = "normal", color = INK) => { doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color); };
  // Section opener: new page, number + title.
  W.h1 = (n, title) => {
    W.crumb = "Villa Skogstorp · " + title;
    W.newPage("p");
    W.font(11, "bold", BLUE); if (n) doc.text(String(n), M, 30);
    W.font(22, "bold", INK); doc.text(title, M + (n ? 9 : 0), 30);
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.8); doc.line(M, 34, M + 26, 34);
    W.y = 44;
  };
  W.h2 = (title, right) => {
    W.ensure(16);
    W.font(13, "bold", BLUE); doc.text(title, M, W.y);
    if (right) { W.font(9.5, "normal", MUTED); doc.text(right, W.pw() - M, W.y, { align: "right" }); }
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, W.y + 1.8, W.pw() - M, W.y + 1.8);
    W.y += 8;
  };
  W.h3 = (title, right) => {
    W.ensure(12);
    W.font(10.5, "bold", INK); doc.text(title, M, W.y);
    if (right) { W.font(9, "normal", MUTED); doc.text(right, W.pw() - M, W.y, { align: "right" }); }
    W.y += 5.5;
  };
  // Paragraph text: blank line = paragraph gap, "- "/"• " lines = bullets.
  W.para = (text, { size = 10.5, color = TXT, lh = size * 0.5 } = {}) => {
    const raw = String(text || "").replace(/\r/g, "").trim();
    if (!raw) return;
    W.font(size, "normal", color);
    for (const line of raw.split("\n")) {
      if (!line.trim()) { W.y += lh * 0.6; continue; }
      const m = line.match(/^\s*[-•*]\s+(.*)$/);
      const x = m ? M + 5 : M;
      const parts = doc.splitTextToSize(m ? m[1] : line, W.cw() - (x - M));
      parts.forEach((p, i) => {
        W.ensure(lh);
        if (m && i === 0) doc.text("•", M + 1, W.y);
        doc.text(p, x, W.y); W.y += lh;
      });
    }
    W.y += lh * 0.5;
  };
  W.note = (text) => { W.font(9, "italic", MUTED); for (const l of doc.splitTextToSize(text, W.cw())) { W.ensure(4.5); doc.text(l, M, W.y); W.y += 4.5; } W.y += 2; };
  // Image block (+caption). maxH limits tall images; centred when narrower than maxW.
  W.image = (img, { maxW = W.cw(), maxH = 150, caption, x = M } = {}) => {
    if (!img) return;
    let w = maxW, h = w * img.ratio;
    if (h > maxH) { h = maxH; w = h / img.ratio; }
    W.ensure(h + (caption ? 7 : 3));
    doc.addImage(img.data, "JPEG", x + (maxW - w) / 2, W.y, w, h);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.rect(x + (maxW - w) / 2, W.y, w, h);
    W.y += h + 2;
    if (caption) { W.font(8.5, "italic", MUTED); doc.text(caption, x + (maxW - w) / 2, W.y + 2.5); W.y += 5; }
    W.y += 3;
  };
  // Image grid: cells of equal width, row height = tallest (capped), captions + optional notes.
  W.grid = (cells, cols = 2, maxH = 80) => {
    const gap = 5, cw = (W.cw() - gap * (cols - 1)) / cols;
    for (let i = 0; i < cells.length; i += cols) {
      const row = cells.slice(i, i + cols);
      const hs = row.map((c) => (c.img ? Math.min(maxH, cw * c.img.ratio) : 0));
      const ih = Math.max(...hs, 0);
      W.font(8.5, "normal", TXT);
      const texts = row.map((c) => [c.title ? doc.splitTextToSize(c.title, cw) : [], c.note ? doc.splitTextToSize(c.note, cw).slice(0, 6) : []]);
      const th = Math.max(...texts.map(([a, b]) => a.length * 4 + b.length * 3.8), 0);
      W.ensure(ih + th + 6);
      row.forEach((c, k) => {
        const x = M + k * (cw + gap);
        let yy = W.y;
        if (c.img) {
          let w = cw, h = cw * c.img.ratio; if (h > ih) { h = ih; w = h / c.img.ratio; }
          doc.addImage(c.img.data, "JPEG", x, yy, w, h);
          doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.rect(x, yy, w, h);
        }
        yy += ih + 4;
        const [tl, nl] = texts[k];
        if (tl.length) { W.font(9, "bold", INK); doc.text(tl, x, yy); yy += tl.length * 4; }
        if (nl.length) { W.font(8.3, "normal", MUTED); doc.text(nl, x, yy); }
      });
      W.y += ih + th + 8;
    }
  };
  // Table: cols [{ label, w?, align? }] (w in mm; cols without w share the rest).
  // rows: arrays of cell strings, or { cells, bold, fill, muted, size, indent }.
  W.table = (cols, rows, { size = 9, head = true } = {}) => {
    const fixed = cols.reduce((s, c) => s + (c.w || 0), 0);
    const flex = cols.filter((c) => !c.w).length;
    const ws = cols.map((c) => c.w || (W.cw() - fixed) / Math.max(1, flex));
    const pad = 1.6;
    const drawHead = () => {
      if (!head) return;
      W.font(7.5, "bold", MUTED);
      let x = M;
      cols.forEach((c, i) => { doc.text(String(c.label || "").toUpperCase(), c.align === "right" ? x + ws[i] - pad : x + pad, W.y + 3.5, { align: c.align === "right" ? "right" : "left" }); x += ws[i]; });
      W.y += 5.2;
      doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.line(M, W.y, M + W.cw(), W.y);
    };
    W.ensure(14); drawHead();
    for (const r0 of rows) {
      const r = Array.isArray(r0) ? { cells: r0 } : r0;
      const fs = r.size || size, rlh = fs * 0.43;
      W.font(fs, r.bold ? "bold" : "normal", r.muted ? MUTED : INK);
      const lines = r.cells.map((cell, i) => doc.splitTextToSize(String(cell ?? ""), ws[i] - 2 * pad - (i === 0 ? r.indent || 0 : 0)));
      const h = Math.max(1, ...lines.map((l) => l.length)) * rlh + 2 * pad + 0.6;
      if (W.y + h > W.bottom()) { W.newPage(W.orient); drawHead(); W.font(fs, r.bold ? "bold" : "normal", r.muted ? MUTED : INK); }
      if (r.fill) { doc.setFillColor(...r.fill); doc.rect(M, W.y, W.cw(), h, "F"); }
      let x = M;
      lines.forEach((l, i) => {
        const al = cols[i].align === "right";
        const tx = al ? x + ws[i] - pad : x + pad + (i === 0 ? r.indent || 0 : 0);
        if (r.tag && i === 0) { doc.setTextColor(...RED); }
        doc.text(l, tx, W.y + pad + rlh * 0.8, { align: al ? "right" : "left" });
        if (r.tag && i === 0) doc.setTextColor(...(r.muted ? MUTED : INK));
        x += ws[i];
      });
      W.y += h;
      doc.setDrawColor(...LINE); doc.setLineWidth(0.15); doc.line(M, W.y, M + W.cw(), W.y);
    }
    W.y += 5;
  };
  // Key figures in a soft box: [[label, value], …] laid out in columns.
  W.figures = (pairs, cols = 3) => {
    if (!pairs.length) return;
    const rows = Math.ceil(pairs.length / cols), cw = W.cw() / cols, h = rows * 11 + 4;
    W.ensure(h + 4);
    doc.setFillColor(...SOFT); doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.roundedRect(M, W.y, W.cw(), h, 2, 2, "FD");
    pairs.forEach(([k, v, color], i) => {
      const x = M + 4 + (i % cols) * cw, y = W.y + 6 + Math.floor(i / cols) * 11;
      W.font(7.5, "bold", MUTED); doc.text(String(k).toUpperCase(), x, y);
      W.font(11.5, "bold", color || INK); doc.text(String(v), x, y + 5);
    });
    W.y += h + 6;
  };
  return W;
}

// ---------- sections ----------
// Each renderer returns false when it has nothing to show (the section is then left out).

async function renderCover(W, P) {
  const { doc } = W;
  const cover = P.cover || {};
  W.crumb = "";
  W.newPage("p");
  W.font(11, "bold", BLUE); doc.text("VILLA SKOGSTORP", M, 26);
  W.font(30, "bold", INK); doc.text(cover.projectName || "Villa Skogstorp", M, 42);
  doc.setDrawColor(...BLUE); doc.setLineWidth(0.9); doc.line(M, 46, M + 26, 46);
  W.font(11, "normal", MUTED);
  doc.text("Om- och tillbyggnad · projektplan · " + today(), M, 54);
  let y = 63;
  W.font(11, "normal", INK);
  for (const l of [cover.officialName && "Fastighet: " + cover.officialName, cover.houseAddress && "Adress: " + cover.houseAddress].filter(Boolean)) { doc.text(l, M, y); y += 6; }
  const imgSrc = (P.pdf.cover || {}).image;
  if (imgSrc) {
    const img = await imageOf(imgSrc.startsWith("http") ? { photo: imgSrc } : { ref: imgSrc }, 2200);
    if (img) { W.y = y + 4; W.image(img, { maxH: 150 }); y = W.y; }
  }
  if ((cover.freeText || "").trim()) { W.y = Math.max(y, W.y) + 2; W.para(cover.freeText, { size: 10 }); y = W.y; }
  const contact = [cover.contactName, cover.email, cover.phone, cover.contactAddress].filter(Boolean);
  if (contact.length) {
    const by = W.ph() - 34;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, by - 6, W.pw() - M, by - 6);
    W.font(7.5, "bold", MUTED); doc.text("BYGGHERRE / KONTAKT", M, by);
    W.font(10, "normal", INK); doc.text(contact.join("   ·   "), M, by + 5.5);
  }
  return true;
}

function renderContacts(W, P, n, title) {
  const list = P.contacts || [];
  if (!list.length) return false;
  W.h1(n, title);
  const details = (P.pdf.contacts || {}).details !== false;
  const cols = details
    ? [{ label: "Roll", w: 40 }, { label: "Namn / företag" }, { label: "Telefon", w: 30 }, { label: "E-post", w: 52 }]
    : [{ label: "Roll", w: 50 }, { label: "Namn / företag" }];
  W.table(cols, list.map((c) => {
    const who = [c.name, c.company].filter(Boolean).join(", ") + (c.note ? "\n" + c.note : "");
    return details ? [c.role, who, c.phone, c.email] : [c.role, who];
  }), { size: 9.5 });
  return true;
}

async function renderChapters(W, P, n, title, progress) {
  const off = (P.pdf.chapters || {}).off || [];
  const chapters = (P.chapters || []).filter((c) => !off.includes(c.id));
  const inspo = P.inspo || [];
  if (!chapters.length && !inspo.length) return false;
  W.h1(n, title);
  let k = 0;
  for (const c of chapters) {
    k++;
    progress?.("Projektbeskrivning – " + (c.title || k));
    W.h2(`${n ? n + "." : ""}${k}  ${c.title || ""}`);
    W.para(c.text);
    const photos = c.photos || [];
    const imgs = await Promise.all(photos.map(async (p) => ({ img: await imageOf(p, 1800), title: p.caption })));
    const ok = imgs.filter((x) => x.img);
    if (ok.length === 1) W.image(ok[0].img, { maxH: 135, caption: ok[0].title });
    else if (ok.length > 1) W.grid(ok, 2, 85);
    W.y += 2;
  }
  if (inspo.length) {
    progress?.("Inspirationsbilder");
    W.h2(`${n ? n + "." : ""}${k + 1}  Inspirationsbilder`);
    const cells = await Promise.all(inspo.map(async (p) => ({ img: await imageOf(p, 1400), title: p.title, note: p.note })));
    W.grid(cells.filter((c) => c.img), 2, 90);
  }
  return true;
}

function renderTech(W, P, n, title) {
  const list = P.tech || [];
  if (!list.length) return false;
  W.h1(n, title);
  W.table([{ label: "Område", w: 34 }, { label: "Val", w: 52 }, { label: "Beskrivning / motivering" }],
    list.map((t) => ({ cells: [t.area, t.choice, t.detail] })), { size: 9.3 });
  return true;
}

function renderDecisions(W, P, n, title) {
  const list = P.decisions || [];
  const todos = (P.pdf.decisions || {}).todos !== false ? P.todos || [] : [];
  if (!list.length && !todos.length) return false;
  W.h1(n, title);
  const sub = (k, t) => `${n ? n + "." : ""}${k}  ${t}`;
  if (list.length) {
    W.h2(sub(1, "Fattade beslut"));
    W.table([{ label: "Datum", w: 20 }, { label: "Område", w: 28 }, { label: "Beslut", w: 62 }, { label: "Motivering" }],
      list.map((d) => [d.date, d.area, d.decision, d.why]), { size: 9 });
  }
  if (todos.length) {
    const order = { "Öppen": 0, "Pågår": 1, "Klar": 2 };
    const rows = todos.map((t, i) => ({ t, i })).sort((a, b) => (order[a.t.status || "Öppen"] - order[b.t.status || "Öppen"]) || a.i - b.i);
    W.ensure(40);
    W.h2(sub(list.length ? 2 : 1, "Att besluta / att göra"), `${todos.filter((t) => (t.status || "Öppen") !== "Klar").length} öppna`);
    W.table([{ label: "Status", w: 16 }, { label: "Område", w: 26 }, { label: "Vad" }, { label: "Ansvarig", w: 26 }, { label: "Senast", w: 20 }],
      rows.map(({ t }) => ({ cells: [t.status || "Öppen", t.area, (t.item || "") + (t.detail ? "\n" + t.detail : ""), t.who, t.due], muted: t.status === "Klar" })), { size: 8.8 });
  }
  return true;
}

// ---- budget ----
function gantt(W, B, title) {
  const { doc } = W;
  if (!B.dated.length) return;
  W.newPage("l");
  W.font(13, "bold", BLUE); doc.text(title, M, W.y); W.y += 6;
  const all = [...B.dated.flatMap((p) => [+new Date(p.start + "T00:00:00"), +new Date(p.end + "T23:59:59")]), ...Object.values(B.typSegs).flat().map((s) => s.end), ...B.deliveries.map((d) => d.t)];
  const minT = Math.min(...all), maxT = Math.max(...all), span = maxT - minT || 1;
  const LW = 64, x0 = M + LW, x1 = W.pw() - M, cw = x1 - x0;
  const X = (t) => x0 + ((t - minT) / span) * cw;
  const rows = B.phases.length + (B.typRows.length ? B.typRows.length + 1 : 0) + (B.deliveries.length ? 1 : 0);
  const top = W.y + 6, avail = W.bottom() - top - 4;
  const rh = Math.min(6.5, avail / Math.max(1, rows));
  const fs = Math.max(5.5, Math.min(8.5, rh * 1.45));
  // month ticks
  const d = new Date(minT); d.setDate(1);
  const gridBottom = top + rows * rh;
  while (+d <= maxT) {
    const x = X(+d);
    if (x >= x0 - 0.1) {
      doc.setDrawColor(...LINE); doc.setLineWidth(0.15); doc.line(x, top - 1, x, gridBottom);
      W.font(7, "normal", MUTED); doc.text(d.toLocaleDateString("sv-SE", { month: "short" }).replace(".", "") + " " + String(d.getFullYear()).slice(2), x + 0.8, top - 2);
    }
    d.setMonth(d.getMonth() + 1);
  }
  let y = top;
  const label = (t, color = INK, bold = false) => { W.font(fs, bold ? "bold" : "normal", color); doc.text(doc.splitTextToSize(t, LW - 3)[0] || "", M, y + rh * 0.68); };
  B.phases.forEach((p, i) => {
    label(`${i + 1}. ${p.name}`);
    doc.setFillColor(...SOFT); doc.rect(x0, y + rh * 0.2, cw, rh * 0.6, "F");
    if (p.start && p.end) {
      const a = X(+new Date(p.start + "T00:00:00")), b = X(+new Date(p.end + "T23:59:59"));
      doc.setFillColor(...BLUE); doc.roundedRect(a, y + rh * 0.2, Math.max(0.8, b - a), rh * 0.6, 0.6, 0.6, "F");
    }
    y += rh;
  });
  if (B.typRows.length) {
    W.font(fs * 0.9, "bold", MUTED); doc.text("PER YRKE", M, y + rh * 0.68);
    doc.setDrawColor(...LINE); doc.setLineDashPattern([0.8, 0.8], 0); doc.line(M, y + 0.3, x1, y + 0.3); doc.setLineDashPattern([], 0);
    y += rh;
    B.typRows.forEach((t, k) => {
      label(`${t} (${B.crewOf(t)})`);
      doc.setFillColor(...SOFT); doc.rect(x0, y + rh * 0.2, cw, rh * 0.6, "F");
      for (const sg of B.typSegs[t]) {
        doc.setFillColor(...(sg.over ? RED : TYP_COLORS[k % TYP_COLORS.length]));
        const a = X(sg.start), b = X(sg.end);
        doc.rect(a, y + rh * 0.2, Math.max(0.5, b - a), rh * 0.6, "F");
      }
      y += rh;
    });
  }
  if (B.deliveries.length) {
    label("Materialleveranser");
    doc.setFillColor(...INK);
    for (const dl of B.deliveries) {
      const x = X(dl.t), cy = y + rh / 2, r = Math.min(1.6, rh * 0.32);
      doc.triangle(x - r, cy, x, cy - r, x + r, cy, "F"); doc.triangle(x - r, cy, x, cy + r, x + r, cy, "F");
    }
    y += rh;
  }
  W.y = y + 5;
  W.font(7.5, "normal", MUTED);
  doc.text("Blå = fas. Per yrke: varje yrke arbetar från fasens start i timmar / (bemanning × 7 h) arbetsdagar – rött = längre än fasen (flaskhals). Romb = materialleverans.", M, W.y);
  W.y += 6;
}

function renderBudgetEtapp(W, b, etapp, opt, first) {
  const B = computeBudget(b);
  const prices = opt.prices !== false;
  const views = opt.views || ["summary", "gantt", "phases"];
  const detail = opt.detail || "rows";
  const etTitle = ETAPP_TITLE[etapp] || etapp;
  if (!first) W.newPage("p");
  W.h2(etTitle, prices ? kr(B.total) + " ex moms" : hF(B.hours));

  if (views.includes("summary")) {
    W.h3("Sammanfattning");
    const fig = prices ? [["Total (ex moms)", kr(B.total)], ["Material", kr(B.byCat.Material)], ["Extern (UE/tjänster)", kr(B.byCat.Extern)], ["Arbete (egna hantverkare)", kr(B.byCat.Arbete)]] : [];
    if (prices && B.oklart) fig.push(["varav oklart", kr(B.oklart), RED]);
    fig.push(["Arbetstimmar", hF(B.hours)]);
    const ds = B.dated.map((p) => p.start).sort(), de = B.dated.map((p) => p.end).sort();
    if (ds.length) fig.push(["Tidsram", fmtD(ds[0]) + " " + ds[0].slice(0, 4) + " – " + fmtD(de[de.length - 1]) + " " + de[de.length - 1].slice(0, 4)]);
    W.figures(fig, 3);
    const builds = BUILDS.filter((x) => B.byBuild[x]);
    if (prices && builds.length > 1) W.table([{ label: "Per byggnad" }, { label: "Summa", w: 40, align: "right" }], builds.map((x) => [x, kr(B.byBuild[x])]));
  }
  if (views.includes("phases")) {
    W.h3("Per fas");
    const when = (p) => (p.start && p.end ? fmtD(p.start) + " – " + fmtD(p.end) + " " + p.end.slice(2, 4) : "");
    if (detail === "sums") {
      const cols = [{ label: "#", w: 8 }, { label: "Fas" }, { label: "När", w: 38 }, { label: "Timmar", w: 22, align: "right" }];
      if (prices) cols.push({ label: "Summa", w: 30, align: "right" });
      const rows = B.phases.map((p, i) => { const r = [String(i + 1), p.name, when(p), B.phaseHrs[p.id] ? hF(B.phaseHrs[p.id]) : "–"]; if (prices) r.push(kr(B.phaseCost[p.id] || 0)); return r; });
      const tot = ["", "Totalt", "", hF(B.hours)]; if (prices) tot.push(kr(B.total));
      rows.push({ cells: tot, bold: true });
      W.table(cols, rows);
    } else {
      const cols = [{ label: "Post" }, { label: "Ansvarig", w: 22 }];
      if (prices) cols.push({ label: "Material", w: 24, align: "right" }, { label: "Extern", w: 24, align: "right" });
      cols.push({ label: "Arbete", w: 34 });
      if (prices) cols.push({ label: "Summa", w: 25, align: "right" });
      B.phases.forEach((p, i) => {
        const its = B.items.filter((it) => it.phaseId === p.id);
        if (!its.length) return;
        W.ensure(24);
        W.h3(`${i + 1}. ${p.name}`, [when(p), B.phaseHrs[p.id] ? hF(B.phaseHrs[p.id]) : "", prices ? kr(B.phaseCost[p.id] || 0) : ""].filter(Boolean).join("  ·  "));
        const rows = [];
        for (const it of its) {
          const work = B.workOf(it).filter((w) => parseNum(w.h)).map((w) => w.typ + " " + nf(parseNum(w.h)) + " h").join("\n") || (it.category === "Arbete" ? "Snickare " + nf(parseNum(it.qty)) + " h" : "");
          const desc = (it.oklart ? "[OKLART] " : "") + (it.desc || "–") + (it.del ? "  (" + it.del + ")" : "") + (prices && it.extNote ? "\nExtern: " + it.extNote : "");
          const r = [desc, it.entreprenor || ""];
          if (prices) r.push(est(it) ? kr(est(it)) : "", B.extOf(it) ? kr(B.extOf(it)) : "");
          r.push(work);
          if (prices) r.push(kr(B.current(it)));
          rows.push({ cells: r, fill: it.oklart ? OKL : null });
          if (detail === "lines" && matLines(it)) {
            for (const l of matLines(it)) {
              const q = parseNum(l.qty) ? nf(parseNum(l.qty), 1) + " " + (l.unit || "") : "";
              const lr = [(l.desc || "Material") + (q ? "  –  " + q : "") + (prices && parseNum(l.qty) && l.price ? " × " + l.price + " kr" : "") + (l.leverans ? "  (lev. " + l.leverans + ")" : ""), ""];
              if (prices) lr.push(kr(lineAmt(l)), "");
              lr.push("");
              if (prices) lr.push("");
              rows.push({ cells: lr, muted: true, size: 7.8, indent: 4 });
            }
          }
        }
        W.table(cols, rows, { size: 8.6 });
      });
      const orphan = B.items.filter((it) => !B.phases.some((p) => p.id === it.phaseId));
      if (orphan.length) W.note(`${orphan.length} poster saknar fas och visas inte här.`);
    }
  }
  if (views.includes("material")) {
    W.h3("Material totalt", prices ? kr(B.materials.reduce((s, r) => s + r.sum, 0)) : "");
    const cols = [{ label: "Material" }, { label: "Total mängd", w: 26, align: "right" }, { label: "Enhet", w: 18 }];
    if (prices) cols.push({ label: "Summa", w: 28, align: "right" });
    W.table(cols, B.materials.map((r) => { const x = [r.desc, r.qty ? nf(r.qty, 1) : "–", r.unit]; if (prices) x.push(kr(r.sum)); return x; }), { size: 8.6 });
  }
  if (views.includes("trades")) {
    W.h3("Per yrke – timmar & bemanning");
    const typs = [...B.typs.filter((t) => B.byTypH[t]), ...Object.keys(B.byTypH).filter((t) => !B.typs.includes(t))];
    const cols = [{ label: "Yrke" }];
    if (prices) cols.push({ label: "kr/h", w: 20, align: "right" });
    cols.push({ label: "Personer", w: 20, align: "right" }, { label: "Timmar", w: 24, align: "right" }, { label: "ca arbetsdagar", w: 28, align: "right" });
    if (prices) cols.push({ label: "Kostnad", w: 30, align: "right" });
    W.table(cols, typs.map((t) => {
      const h = B.byTypH[t], r = [t];
      if (prices) r.push(nf(B.rateOf(t)));
      r.push(String(B.crewOf(t)), hF(h), nf(Math.ceil(h / (B.crewOf(t) * 7))));
      if (prices) r.push(kr(h * B.rateOf(t)));
      return r;
    }));
  }
  if (views.includes("deliveries") && B.deliveries.length) {
    W.h3("Leveranser");
    W.table([{ label: "Datum", w: 24 }, { label: "Vad" }, { label: "Fas", w: 55 }], B.deliveries.map((d) => [d.date, d.desc, B.phaseName(d.it.phaseId)]), { size: 8.6 });
  }
  if (views.includes("gantt")) gantt(W, B, "Tidplan – " + etTitle);
}

function renderBudget(W, P, n, title, budgets) {
  const opt = P.pdf.budget || {};
  const etapper = (opt.etapper || ["budget"]).filter((e) => budgets[e]?.items?.length);
  if (!etapper.length) return false;
  W.h1(n, title);
  if (opt.prices !== false) W.note("Alla belopp exklusive moms. Byggmaterial räknat på inköpspris; el-, VVS-material och plåt via respektive hantverkare.");
  etapper.forEach((e, i) => renderBudgetEtapp(W, budgets[e], e, opt, i === 0));
  return true;
}

// ---- våningar & utrymmen ----
async function floorOverview(fl, rooms) {
  const r = await getJson(bgKey("floor-" + fl.id));
  if (!r?.dataUrl) return null;
  try {
    const im = await loadImg(r.dataUrl);
    const c = document.createElement("canvas");
    const S = 1.5; c.width = Math.round(fl.w * S); c.height = Math.round(fl.h * S);
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(im, 0, 0, c.width, c.height);
    const poly = (pts, fill, stroke) => { if (!pts?.length) return; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * S, y * S) : g.moveTo(x * S, y * S))); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); } };
    poly(fl.bef, "rgba(90,122,140,0.20)");
    poly(fl.till, "rgba(214,160,70,0.26)");
    const byId = Object.fromEntries(rooms.map((x) => [x.id, x]));
    const fs = Math.round((fl.w / 50) * S);
    for (const a of fl.areas || []) {
      if (!byId[a.roomId]) continue;
      poly(a.poly, null, "rgba(90,122,140,0.9)");
      let A = 0, cx = 0, cy = 0;
      for (let i = 0; i < a.poly.length; i++) { const [x0, y0] = a.poly[i], [x1, y1] = a.poly[(i + 1) % a.poly.length]; const f = x0 * y1 - x1 * y0; A += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f; }
      const [lx, ly] = A ? [cx / (3 * A), cy / (3 * A)] : a.poly[0];
      g.font = `600 ${fs}px Helvetica, Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = fs / 4; g.strokeStyle = "rgba(255,255,255,0.92)"; g.lineJoin = "round";
      const label = short(byId[a.roomId].name);
      g.strokeText(label, lx * S, ly * S); g.fillStyle = "#33312E"; g.fillText(label, lx * S, ly * S);
    }
    return { data: c.toDataURL("image/jpeg", 0.88), ratio: c.height / c.width };
  } catch { return null; }
}

async function roomData(room) {
  const { plan, bgImg, space } = await loadPlanForPrint(room.id);
  const svgString = buildPlanSvg({
    room: plan.room || { w: 4000, l: 3000 }, openings: plan.openings || [], items: plan.items || [],
    walls: plan.walls || [], comments: plan.comments || [], dims: plan.dims || [], embedBg: false,
  });
  return {
    roomName: short(room.name), svgString, comments: plan.comments || [], bgImg, bgT: plan.bg || null,
    description: space.description || "", actions: space.actions || "",
    colors: space.colors || [], docs: space.docs || [], items: plan.items || [], inventory: space.inventory || {},
    inspo: space.inspo || [],
  };
}

async function renderFloors(W, P, n, title, floorsRec, rooms, progress) {
  const opt = P.pdf.floors || {};
  const ovOff = opt.overviewOff || [];
  const ropt = opt.rooms || {};
  const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
  const floors = floorsRec?.floors || [];
  const placed = new Set(floors.flatMap((f) => (f.areas || []).map((a) => a.roomId)));
  const groups = floors.map((f) => ({ floor: f, rooms: (f.areas || []).map((a) => byId[a.roomId]).filter(Boolean) }));
  const loose = rooms.filter((r) => !placed.has(r.id));
  if (loose.length) groups.push({ floor: null, rooms: loose });
  const isOn = (r) => ropt[r.id]?.on !== false;
  const any = groups.some((g) => (g.floor && !ovOff.includes(g.floor.id)) || g.rooms.some(isOn));
  if (!any) return false;
  W.h1(n, title);
  W.note("Gult = tillbyggnad, blått = befintligt hus. Varje utrymme beskrivs på följande sidor.");
  W.y += 4;
  let firstOnPage = true;
  const { doc } = W;
  for (const g of groups) {
    if (g.floor && !ovOff.includes(g.floor.id)) {
      progress?.("Våningar – " + g.floor.title);
      const img = await floorOverview(g.floor, rooms);
      if (!firstOnPage) { W.crumb = "Villa Skogstorp · " + title; W.newPage("p"); }
      W.h2(g.floor.title, g.rooms.filter(isOn).map((r) => short(r.name)).length + " utrymmen");
      if (img) W.image(img, { maxH: 200 });
      firstOnPage = false;
    }
    for (const r of g.rooms.filter(isOn)) {
      progress?.("Utrymme – " + short(r.name));
      const d = await roomData(r);
      const name = (g.floor ? g.floor.title + " · " : "") + short(r.name);
      if ((ropt[r.id]?.detail || "full") === "full") {
        await addRoomPages(doc, { ...d, roomName: name, cover: {} }, false);
        W.y = W.ph(); // whatever comes next starts on a new page
      } else {
        W.crumb = "Villa Skogstorp · " + title;
        W.newPage("p");
        W.font(18, "bold", INK); doc.text(name, M, W.y + 4); W.y += 12;
        try {
          const { dataUrl, ratio } = await svgToJpeg(d.svgString, 1400, d.bgImg, d.bgT);
          W.image({ data: dataUrl, ratio }, { maxW: W.cw() * 0.7, maxH: 115 });
        } catch { /* no plan */ }
        if (d.description.trim()) { W.h3("Beskrivning"); W.para(d.description, { size: 9.5 }); }
        if (d.actions.trim()) { W.h3("Sammanfattning av åtgärder"); W.para(d.actions, { size: 9.5 }); }
      }
      if (opt.inspo !== false && d.inspo.length) {
        const cells = await Promise.all(d.inspo.map(async (p) => ({ img: await imageOf(p, 1400), title: p.title, note: p.note })));
        const ok = cells.filter((c) => c.img);
        if (ok.length) {
          W.crumb = "Villa Skogstorp · " + title;
          if (W.y > W.bottom() - 60) W.newPage("p");
          W.h2("Inspiration – " + short(r.name));
          W.note("Inspirationsbilder / första utkast – inga kulörer eller material är beslutade utifrån dessa.");
          W.grid(ok, 2, 85);
        }
      }
      firstOnPage = false;
    }
  }
  return true;
}

function renderColors(W, P, n, title) {
  const colors = P.colors || [];
  if (!colors.length) return false;
  W.h1(n, title);
  const { doc } = W;
  for (const c of colors) {
    W.ensure(14);
    const rgb = hexToRgb(c.hex);
    doc.setFillColor(rgb.r, rgb.g, rgb.b); doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
    doc.roundedRect(M, W.y - 4.5, 18, 10, 1.2, 1.2, "FD");
    W.font(10.5, "bold", INK); doc.text(String(c.name || c.hex || ""), M + 23, W.y);
    W.font(8.5, "normal", MUTED); doc.text(String(c.hex || "").toUpperCase(), M + 23, W.y + 4.5);
    if (c.note) { W.font(9, "normal", TXT); doc.text(doc.splitTextToSize(String(c.note), W.cw() - 78), M + 78, W.y); }
    W.y += 14;
  }
  return true;
}

// Attachments: fetched + parsed before the jsPDF pass so page numbers are known.
async function loadAttachments(list, progress) {
  const out = [];
  for (const a of list) {
    if (a.mode === "list") { out.push({ ...a, kind: "list", pages: 0 }); continue; }
    progress?.("Hämtar bilaga – " + a.title);
    try {
      const url = await signedDocUrl(a.path);
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const buf = await r.arrayBuffer();
      if (/pdf/i.test(a.type || "") || /\.pdf$/i.test(a.path)) {
        const { PDFDocument } = await import("pdf-lib");
        const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
        out.push({ ...a, kind: "pdf", pdf, pages: pdf.getPageCount() });
      } else {
        const blob = new Blob([buf], { type: a.type || "image/jpeg" });
        const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
        out.push({ ...a, kind: "img", img: await toJpeg(dataUrl, 2400), pages: 0 });
      }
    } catch (e) {
      out.push({ ...a, kind: "err", error: e.message, pages: 0 });
    }
  }
  return out;
}

function renderAttachments(W, atts, n, title) {
  if (!atts.length) return false;
  W.h1(n, title);
  const L = (i) => String.fromCharCode(65 + i);
  W.table([{ label: "", w: 10 }, { label: "Bilaga" }, { label: "I denna PDF", w: 34 }],
    atts.map((a, i) => [L(i), a.title + (a.kind === "err" ? "  (kunde inte hämtas: " + a.error + ")" : ""),
      a.kind === "pdf" ? "Bifogad, " + a.pages + " s." : a.kind === "img" ? "Bifogad, 1 s." : a.kind === "list" ? "Listad – separat" : "–"]), { size: 10 });
  if (atts.some((a) => a.kind === "list")) W.note("Listade bilagor ingår i handlingarna men är inte inlagda i denna PDF (t.ex. ritningar i stort format).");
  const { doc } = W;
  atts.forEach((a, i) => {
    if (a.kind === "err" || a.kind === "list") return;
    W.newPage("p");
    a.dividerPage = W.page();
    W.font(12, "bold", BLUE); doc.text("BILAGA " + L(i), M, 110);
    W.font(24, "bold", INK); doc.text(doc.splitTextToSize(a.title, W.cw()), M, 122);
    W.font(10, "normal", MUTED); if (a.kind === "pdf") doc.text(a.pages + " sidor", M, 140);
    if (a.kind === "img" && a.img) { W.newPage(a.img.ratio < 1 ? "l" : "p"); W.y = 14; W.image(a.img, { maxH: W.ph() - 32 }); }
  });
  return true;
}

// ---------- main ----------
export const SECTION_TITLES = {
  cover: "Försättsblad", contacts: "Kontakter & roller", chapters: "Projektbeskrivning", tech: "Tekniska val",
  decisions: "Beslutslogg & att göra", budget: "Arbetsplan & budget", floors: "Våningar & utrymmen", colors: "Färgschema", attachments: "Bilagor",
};

export async function buildProjectPdf({ project, ids, filename, onProgress }) {
  const P = { ...project, pdf: project.pdf || {} };
  const progress = (t) => onProgress?.(t);
  progress("Hämtar data …");
  const budgets = { budget: await getJson(spaceKey("budget")), budget2: await getJson(spaceKey("budget2")) };
  const floorsRec = await getJson(spaceKey("floors"));
  const rooms = (await getJson(roomsKey)) || [];
  const atts = ids.includes("attachments") ? await loadAttachments((P.attachments || []).filter((a) => a.on !== false), progress) : [];

  const doc = newDoc();
  const W = writer(doc);
  const multi = ids.length > 1;
  let tocPage = 0;
  const toc = [];
  let n = 0;
  for (const id of ids) {
    const title = SECTION_TITLES[id];
    if (id === "cover") {
      progress("Försättsblad");
      await renderCover(W, P);
      continue;
    }
    if (multi && !tocPage) { W.crumb = ""; W.newPage("p"); tocPage = W.page(); }
    const num = multi ? n + 1 : "";
    const start = doc.getNumberOfPages() + 1;
    progress(title);
    let ok = false;
    if (id === "contacts") ok = renderContacts(W, P, num, title);
    else if (id === "chapters") ok = await renderChapters(W, P, num, title, progress);
    else if (id === "tech") ok = renderTech(W, P, num, title);
    else if (id === "decisions") ok = renderDecisions(W, P, num, title);
    else if (id === "budget") ok = renderBudget(W, P, num, title, budgets);
    else if (id === "floors") ok = await renderFloors(W, P, num, title, floorsRec, rooms, progress);
    else if (id === "colors") ok = renderColors(W, P, num, title);
    else if (id === "attachments") ok = renderAttachments(W, atts, num, title);
    if (ok) { n++; toc.push({ n: num, title, page: start }); }
  }
  if (!n && !ids.includes("cover")) throw new Error("Det finns inget innehåll att skapa PDF av i " + (ids.length === 1 ? "det här avsnittet" : "de valda avsnitten") + ".");

  // Final page numbers: attachment pages are inserted after their divider page.
  const jsPages = doc.getNumberOfPages();
  const extraBefore = (p) => atts.reduce((s, a) => s + (a.kind === "pdf" && a.dividerPage && a.dividerPage < p ? a.pages : 0), 0);
  const finalNo = (p) => p + extraBefore(p);
  const total = jsPages + atts.reduce((s, a) => s + (a.kind === "pdf" && a.dividerPage ? a.pages : 0), 0);

  // Table of contents
  if (tocPage) {
    doc.setPage(tocPage);
    let y = 34;
    W.font(22, "bold", INK); doc.text("Innehåll", M, 30);
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.8); doc.line(M, 34, M + 26, 34);
    y = 48;
    for (const e of toc) {
      W.font(12, "normal", INK);
      doc.text(`${e.n}`, M, y); doc.text(e.title, M + 9, y);
      const pg = String(finalNo(e.page));
      doc.text(pg, W.pw() - M, y, { align: "right" });
      const tw = doc.getTextWidth(e.title);
      doc.setDrawColor(...LINE); doc.setLineDashPattern([0.4, 1.2], 0); doc.setLineWidth(0.3);
      doc.line(M + 11 + tw, y, W.pw() - M - doc.getTextWidth(pg) - 2, y); doc.setLineDashPattern([], 0);
      doc.link(M, y - 5, W.cw(), 7, { pageNumber: e.page });
      y += 9;
    }
    const att = atts.filter((a) => a.dividerPage);
    if (att.length) {
      y += 4;
      for (const a of att) {
        W.font(10, "normal", MUTED);
        doc.text("Bilaga " + String.fromCharCode(65 + atts.indexOf(a)) + "  " + a.title, M + 9, y);
        doc.text(String(finalNo(a.dividerPage)), W.pw() - M, y, { align: "right" });
        y += 6.5;
      }
    }
  }
  // Footer on every page except a cover page.
  for (let p = 1; p <= jsPages; p++) {
    if (p === 1 && ids[0] === "cover") continue;
    doc.setPage(p);
    W.font(7.5, "normal", MUTED);
    doc.text("Villa Skogstorp · " + (P.cover?.officialName || "projektplan") + " · " + today(), M, W.ph() - 6);
    doc.text(finalNo(p) + " / " + total, W.pw() - M, W.ph() - 6, { align: "right" });
  }

  const base = (filename || P.pdf.filename || "Villa Skogstorp – projekt").trim();
  const name = safe(ids.length === 1 ? base + " " + SECTION_TITLES[ids[0]] : base) + ".pdf";
  const merge = atts.filter((a) => a.kind === "pdf" && a.dividerPage);
  if (!merge.length) { progress("Sparar …"); doc.save(name); return; }

  progress("Slår ihop bilagor …");
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.load(doc.output("arraybuffer"));
  // insert from the last divider backwards so earlier indices stay valid
  for (const a of [...merge].sort((x, y) => y.dividerPage - x.dividerPage)) {
    const pages = await out.copyPages(a.pdf, a.pdf.getPageIndices());
    pages.forEach((pg, i) => out.insertPage(a.dividerPage + i, pg));
  }
  const bytes = await out.save();
  progress("Sparar …");
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
