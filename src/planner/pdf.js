// Real PDF generation (jsPDF) — builds and downloads a .pdf file directly, so the
// user gets a saved document instead of the browser print dialog. The plan drawing
// (from buildPlanSvg) is rasterized to an image; comment photos are embedded; the
// whole-project export adds a cover page and the colour scheme.
import { jsPDF } from "jspdf";

const A4 = { w: 210, h: 297 };
const M = 14;
const CW = A4.w - 2 * M;
const INK = [51, 49, 46], BLUE = [90, 122, 140], MUTED = [122, 117, 110], LINE = [214, 208, 198], SOFT = [246, 243, 237], TXT = [70, 66, 62];
const titleCase = (s) => String(s || "").toLowerCase().replace(/(^|\s|-)([a-zåäö])/g, (_, a, b) => a + b.toUpperCase());

const safe = (s) => (String(s || "plan").replace(/[^\w\-åäöÅÄÖ ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "plan");

function hexToRgb(hex) {
  const h = String(hex || "#000000").replace("#", "");
  const n = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const int = parseInt(n || "0", 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("img load"));
    im.src = src;
  });
}

// Rasterize a plan (vector SVG, no embedded bitmap) to a white JPEG data URL. Any
// background reference image is drawn separately from its data URL first, so the
// canvas never gets tainted by an SVG-embedded bitmap (which breaks toDataURL on Safari).
async function svgToJpeg(svgString, pxWidth = 1600, bgImg = null, bgT = null) {
  const m = svgString.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/);
  const vbx = m ? parseFloat(m[1]) : 0, vby = m ? parseFloat(m[2]) : 0;
  const vbw = m ? parseFloat(m[3]) : 1000, vbh = m ? parseFloat(m[4]) : 1000;
  const w = pxWidth, h = Math.max(1, Math.round(pxWidth * (vbh / vbw)));
  const scale = w / vbw;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  // background reference image (data URL → does not taint the canvas)
  if (bgImg && bgImg.dataUrl && bgT && bgT.visible !== false) {
    try {
      const bim = await loadImg(bgImg.dataUrl);
      const bgW = bgT.wmm, bgH = bgT.wmm * (bgImg.h / bgImg.w);
      const px = (bgT.x - vbx) * scale, py = (bgT.y - vby) * scale;
      const pw = bgW * scale, ph = bgH * scale;
      ctx.save();
      ctx.globalAlpha = bgT.opacity ?? 0.5;
      if (bgT.rot) {
        const cx = px + pw / 2, cy = py + ph / 2;
        ctx.translate(cx, cy); ctx.rotate((bgT.rot * Math.PI) / 180); ctx.translate(-cx, -cy);
      }
      ctx.drawImage(bim, px, py, pw, ph);
      ctx.restore();
    } catch { /* skip background */ }
  }
  const svg = svgString.replace('width="100%"', `width="${w}"`).replace('height="auto"', `height="${h}"`);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await loadImg(url);
    ctx.drawImage(img, 0, 0, w, h);
  } finally { URL.revokeObjectURL(url); }
  return { dataUrl: c.toDataURL("image/jpeg", 0.92), ratio: h / w };
}

async function fetchDataUrl(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => res(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}

const ensure = (doc, y, need) => (y + need > A4.h - M ? (doc.addPage(), M) : y);

async function addRoom(doc, section, first) {
  if (!first) doc.addPage();
  let y = M;
  doc.setTextColor(30);
  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text(section.title || "Planritning", M, y + 5); y += 11;
  // plan drawing (background reference image composited separately)
  try {
    const { dataUrl, ratio } = await svgToJpeg(section.svgString, 1600, section.bgImg, section.bgT);
    let imgW = CW, imgH = CW * ratio;
    const maxH = A4.h - M - y - 4;
    if (imgH > maxH) { imgH = maxH; imgW = imgH / ratio; }
    doc.addImage(dataUrl, "JPEG", M, y, imgW, imgH);
    y += imgH + 6;
  } catch { /* skip plan image on failure */ }
  // description
  const desc = (section.description || "").trim();
  if (desc) {
    y = ensure(doc, y, 10);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Beskrivning", M, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    for (const line of doc.splitTextToSize(desc, CW)) { y = ensure(doc, y, 5); doc.text(line, M, y); y += 5; }
    y += 3;
  }
  // comments & photos
  const comments = section.comments || [];
  if (comments.length) {
    const photoData = {};
    for (const c of comments) if (c.photo) photoData[c.id] = await fetchDataUrl(c.photo);
    y = ensure(doc, y, 10);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Kommentarer & bilder", M, y); y += 6;
    for (let i = 0; i < comments.length; i++) {
      const c = comments[i];
      y = ensure(doc, y, 10);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text(`#${i + 1} · ${c.photo ? "Bild" : "Kommentar"}`, M, y); y += 5;
      doc.setFont("helvetica", "normal");
      if (c.photo && photoData[c.id]) {
        try {
          const props = doc.getImageProperties(photoData[c.id]);
          const iw = Math.min(85, CW), ih = iw * (props.height / props.width);
          y = ensure(doc, y, ih + 2);
          doc.addImage(photoData[c.id], "JPEG", M, y, iw, ih); y += ih + 2;
        } catch { /* skip image */ }
      }
      const text = (c.text || "").trim();
      if (text) for (const line of doc.splitTextToSize(text, CW)) { y = ensure(doc, y, 5); doc.text(line, M, y); y += 5; }
      y += 3;
    }
  }
}

function addColors(doc, colors) {
  doc.addPage();
  let y = M;
  doc.setTextColor(30);
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("Färgschema", M, y + 5); y += 12;
  doc.setFontSize(10);
  for (const c of colors) {
    y = ensure(doc, y, 16);
    const rgb = hexToRgb(c.hex);
    doc.setFillColor(rgb.r, rgb.g, rgb.b); doc.setDrawColor(120);
    doc.rect(M, y, 14, 10, "FD");
    doc.setTextColor(30); doc.setFont("helvetica", "bold");
    doc.text(String(c.name || c.hex || ""), M + 18, y + 4);
    doc.setTextColor(110); doc.setFont("helvetica", "normal");
    doc.text(String(c.hex || "").toUpperCase(), M + 18, y + 9);
    if (c.note) { doc.setTextColor(70); doc.text(doc.splitTextToSize(String(c.note), CW - 62), M + 62, y + 4); }
    y += 14;
  }
}

// ---- professional single-room layout helpers ----
function topBar(doc, crumb) {
  doc.setFillColor(...BLUE); doc.rect(0, 0, A4.w, 4, "F");
  doc.setTextColor(...BLUE); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
  doc.text(crumb, M, 13);
}
function sectionHead(doc, title, y) {
  y = ensure(doc, y, 12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...BLUE);
  doc.text(title, M, y);
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, y + 1.8, A4.w - M, y + 1.8);
  return y + 8;
}
function textBlock(doc, title, text, y) {
  if (!(text && text.trim())) return y;
  y = sectionHead(doc, title, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...INK);
  for (const line of doc.splitTextToSize(text.trim(), CW)) { y = ensure(doc, y, 5.6); doc.text(line, M, y); y += 5.6; }
  return y + 7;
}
function drawCommentCard(doc, c, num, x, y, w, h, photo) {
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.setFillColor(...SOFT);
  doc.roundedRect(x, y, w, h, 2, 2, "FD");
  const pad = 3;
  doc.setFillColor(...BLUE); doc.circle(x + pad + 2.4, y + pad + 2.4, 2.4, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  doc.text(String(num), x + pad + 2.4, y + pad + 2.4, { align: "center", baseline: "middle" });
  doc.setTextColor(...INK); doc.setFontSize(8.5);
  doc.text(c.photo ? "Bild" : "Kommentar", x + pad + 6.5, y + pad + 3.4);
  const cy = y + pad + 7, ch = h - (pad + 7) - pad;
  let tx = x + pad, tw = w - 2 * pad;
  if (photo) {
    try {
      const p = doc.getImageProperties(photo);
      let iw = Math.min((w - 2 * pad) * 0.5, ch * (p.width / p.height));
      let ih = iw * (p.height / p.width);
      if (ih > ch) { ih = ch; iw = ih * (p.width / p.height); }
      doc.addImage(photo, "JPEG", x + pad, cy, iw, ih);
      tx = x + pad + iw + 3; tw = (x + w - pad) - tx;
    } catch { /* skip image */ }
  }
  const text = (c.text || "").trim();
  if (text && tw > 8) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...TXT);
    const lh = 3.5, maxLines = Math.max(1, Math.floor(ch / lh));
    let lines = doc.splitTextToSize(text, tw);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = (lines[maxLines - 1] || "").slice(0, -1) + "…"; }
    doc.text(lines, tx, cy + 3);
  }
}

// Render one room's 3 pages (summary · plan+comments · colours+links+images+inventory)
// into an existing doc. `first` = don't start with a page break.
async function addRoomPages(doc, data, first) {
  const { roomName, title, svgString, comments = [], bgImg = null, bgT = null,
    description = "", actions = "", colors = [], docs = [], items = [], inventory = {}, cover = {} } = data;
  const name = titleCase(roomName || title || "Rum");
  const crumb = "VILLA SKOGSTORP · " + name.toUpperCase();

  // prefetch comment photos + uploaded document images
  const photoData = {};
  for (const c of comments) if (c.photo) photoData[c.id] = await fetchDataUrl(c.photo);
  const docPhotoData = {};
  for (const d of (docs || [])) if (d && d.photo && !docPhotoData[d.photo]) docPhotoData[d.photo] = await fetchDataUrl(d.photo);

  // ---------- PAGE 1 — summary ----------
  if (!first) doc.addPage();
  doc.setFillColor(...BLUE); doc.rect(0, 0, A4.w, 4, "F");
  doc.setTextColor(...BLUE); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("VILLA SKOGSTORP", M, 20);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(30);
  doc.text(name, M, 33);
  doc.setDrawColor(...BLUE); doc.setLineWidth(0.9); doc.line(M, 37, M + 26, 37);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...MUTED);
  doc.text("Rumsplanering · " + new Date().toLocaleDateString("sv-SE"), M, 44);
  let y = 52;
  const info = [];
  if (cover.projectName) info.push(["Projekt", cover.projectName]);
  if (cover.officialName) info.push(["Fastighet", cover.officialName]);
  if (cover.houseAddress) info.push(["Adress", cover.houseAddress]);
  const contact = [cover.contactName, cover.email, cover.phone].filter(Boolean).join("   ·   ");
  if (contact) info.push(["Kontakt", contact]);
  if (info.length) {
    const ch = 5 + info.length * 5.6 + 2;
    doc.setFillColor(...SOFT); doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
    doc.roundedRect(M, y, CW, ch, 2, 2, "FD");
    let yy = y + 7.5;
    for (const [k, v] of info) {
      doc.setFont("helvetica", "bold"); doc.setTextColor(...INK); doc.setFontSize(8.5);
      doc.text(k.toUpperCase(), M + 5, yy);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...TXT); doc.setFontSize(9.5);
      doc.text(String(v), M + 33, yy);
      yy += 5.6;
    }
    y += ch + 10;
  }
  y = textBlock(doc, "Beskrivning", description, y);
  y = textBlock(doc, "Sammanfattning av åtgärder", actions, y);

  // ---------- PAGE 2 — plan + comments (one page) ----------
  doc.addPage();
  topBar(doc, crumb);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("Planritning & kommentarer", M, 22);
  const top = 28, gap = 5;
  const planW = Math.round(CW * 0.40);
  let planH = 96;
  try {
    const { dataUrl, ratio } = await svgToJpeg(svgString, 1500, bgImg, bgT);
    planH = Math.min(Math.round(planW * ratio), 118);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.roundedRect(M, top, planW, planH, 2, 2, "S");
    let dw = planW - 2, dh = dw * ratio;
    if (dh > planH - 2) { dh = planH - 2; dw = dh / ratio; }
    doc.addImage(dataUrl, "JPEG", M + (planW - dw) / 2, top + (planH - dh) / 2, dw, dh);
  } catch {
    doc.setDrawColor(...LINE); doc.roundedRect(M, top, planW, planH, 2, 2, "S");
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("PLANRITNING", M + 1, top + planH + 4.5);

  const list = comments.slice(0, 6);
  const rx = M + planW + gap, rw = CW - planW - gap;
  const rh = (planH - gap) / 2;
  const bTop = top + planH + 9;
  const bH = (A4.h - M) - bTop;
  const bcW = (CW - gap) / 2, bcH = (bH - gap) / 2;
  const slots = [
    { x: rx, y: top, w: rw, h: rh },
    { x: rx, y: top + rh + gap, w: rw, h: rh },
    { x: M, y: bTop, w: bcW, h: bcH },
    { x: M + bcW + gap, y: bTop, w: bcW, h: bcH },
    { x: M, y: bTop + bcH + gap, w: bcW, h: bcH },
    { x: M + bcW + gap, y: bTop + bcH + gap, w: bcW, h: bcH },
  ];
  list.forEach((c, i) => { const s = slots[i]; if (s) drawCommentCard(doc, c, i + 1, s.x, s.y, s.w, s.h, photoData[c.id]); });
  if (comments.length > 6) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(`+ ${comments.length - 6} till (se appen)`, M, A4.h - M + 3);
  }

  // ---------- PAGE 3 — colours + links + document images + inventory ----------
  const linkDocs = (docs || []).filter((d) => d && d.url);
  const photoDocs = (docs || []).filter((d) => d && d.photo);
  const invItems = (items || []).filter((it) => it && (it.t || inventory[it.id]));
  if ((colors && colors.length) || linkDocs.length || photoDocs.length || invItems.length) {
    doc.addPage();
    topBar(doc, crumb);
    let y3 = 24;
    if (colors && colors.length) {
      y3 = sectionHead(doc, "Färger & material", y3);
      for (const c of colors) {
        y3 = ensure(doc, y3, 13);
        const rgb = hexToRgb(c.hex);
        doc.setFillColor(rgb.r, rgb.g, rgb.b); doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
        doc.roundedRect(M, y3 - 4.5, 18, 10, 1.2, 1.2, "FD");
        doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
        doc.text(String(c.name || c.hex || ""), M + 23, y3);
        doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
        doc.text(String(c.hex || "").toUpperCase(), M + 23, y3 + 4.5);
        if (c.note) { doc.setTextColor(...TXT); doc.setFontSize(9); doc.text(doc.splitTextToSize(String(c.note), CW - 78), M + 78, y3); }
        y3 += 13;
      }
      y3 += 5;
    }
    if (linkDocs.length) {
      y3 = sectionHead(doc, "Dokument & länkar", y3);
      for (const d of linkDocs) {
        y3 = ensure(doc, y3, 12);
        doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...INK);
        doc.text(String(d.title || d.url), M, y3); y3 += 4.8;
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...BLUE);
        doc.textWithLink(String(d.url), M, y3, { url: d.url });
        const tw = doc.getTextWidth(String(d.url));
        doc.setDrawColor(...BLUE); doc.setLineWidth(0.2); doc.line(M, y3 + 0.8, M + tw, y3 + 0.8);
        if (d.note) { y3 += 4.6; doc.setTextColor(...MUTED); doc.setFontSize(8.5); const nl = doc.splitTextToSize(String(d.note), CW); doc.text(nl, M, y3); y3 += (nl.length - 1) * 4; }
        y3 += 8;
      }
    }
    if (photoDocs.length) {
      y3 = sectionHead(doc, "Bilder (dokument)", y3);
      for (const d of photoDocs) {
        if (d.title) { y3 = ensure(doc, y3, 8); doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(String(d.title), M, y3); y3 += 5; }
        const data = docPhotoData[d.photo];
        if (data) {
          try {
            const p = doc.getImageProperties(data);
            let iw = Math.min(CW, 150), ih = iw * (p.height / p.width);
            if (ih > 130) { ih = 130; iw = ih * (p.width / p.height); }
            y3 = ensure(doc, y3, ih + 3);
            doc.addImage(data, "JPEG", M, y3, iw, ih); y3 += ih + 3;
          } catch { /* skip image */ }
        }
        if (d.note) { doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); const nl = doc.splitTextToSize(String(d.note), CW); y3 = ensure(doc, y3, nl.length * 4); doc.text(nl, M, y3); y3 += nl.length * 4; }
        y3 += 6;
      }
    }
    if (invItems.length) {
      y3 = sectionHead(doc, "Inventarielista", y3);
      for (const it of invItems) {
        const meta = inventory[it.id] || {};
        y3 = ensure(doc, y3, 8);
        doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
        doc.text(String((it.t && it.t.trim()) || "(namnlöst)"), M, y3);
        doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED); doc.setFontSize(9);
        doc.text(`${it.w}×${it.h} mm`, M + 70, y3);
        y3 += 4.6;
        if (meta.note) { doc.setTextColor(...TXT); doc.setFontSize(8.5); const nl = doc.splitTextToSize(String(meta.note), CW); doc.text(nl, M, y3); y3 += nl.length * 4; }
        if (meta.url) {
          doc.setTextColor(...BLUE); doc.setFontSize(8.5); doc.textWithLink(String(meta.url), M, y3, { url: meta.url });
          y3 += 4;
        }
        y3 += 3;
      }
    }
  }

}

// Single room → nicely designed 3-page PDF.
export async function savePlanPdf(data) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await addRoomPages(doc, data, true);
  const name = titleCase(data.roomName || data.title || "Rum");
  doc.save(data.filename || safe("Villa Skogstorp " + name) + ".pdf");
}

// Whole project → cover page + each room's full 3-page layout, stacked into one PDF.
export async function saveProjectPdf({ title = "Villa Skogstorp", cover = {}, colors = [], sections = [], filename }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const name = cover.projectName || title;
  const date = new Date().toLocaleDateString("sv-SE");

  // ---- cover page ----
  doc.setFillColor(...BLUE); doc.rect(0, 0, A4.w, 4, "F");
  doc.setTextColor(...BLUE); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("VILLA SKOGSTORP", M, 26);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(30);
  doc.text(name, M, 42);
  doc.setDrawColor(...BLUE); doc.setLineWidth(0.9); doc.line(M, 46, M + 26, 46);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...MUTED);
  doc.text("Renoverings- och tillbyggnadsplan · " + date, M, 54);
  let y = 66;
  doc.setTextColor(...INK); doc.setFontSize(11);
  const lines = [];
  if (cover.officialName) lines.push("Fastighet: " + cover.officialName);
  if (cover.houseAddress) lines.push("Husets adress: " + cover.houseAddress);
  const contact = [cover.contactName, cover.email, cover.phone, cover.contactAddress].filter(Boolean).join("  ·  ");
  if (contact) lines.push("Kontakt: " + contact);
  for (const l of lines) { const ls = doc.splitTextToSize(l, CW); doc.text(ls, M, y); y += ls.length * 6; }
  if ((cover.freeText || "").trim()) {
    y += 4; doc.setFontSize(10); doc.setTextColor(...TXT);
    const ls = doc.splitTextToSize(cover.freeText.trim(), CW); doc.text(ls, M, y); y += ls.length * 5;
    doc.setTextColor(...INK); doc.setFontSize(11);
  }
  y += 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...BLUE); doc.text("Innehåll", M, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...INK);
  sections.forEach((s, i) => { y = ensure(doc, y, 6); doc.text(`${i + 1}. ${titleCase(s.roomName || s.title || "Rum")}`, M, y); y += 6; });

  if (colors && colors.length) addColors(doc, colors); // project-wide colour scheme
  for (const s of sections) await addRoomPages(doc, { ...s, cover }, false);
  doc.save(filename || safe(name) + ".pdf");
}
