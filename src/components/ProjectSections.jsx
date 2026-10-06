// Building blocks for the Projekt page, which mirrors the project PDF section by section.
// Own-data sections are edited here; linked sections (budget, våningar/utrymmen) only show
// a summary + PDF options, their content lives on their own pages.
// PDF options are stored on the project space as `pdf = { <sectionId>: { on, ...opts }, filename }`.
import { useEffect, useRef, useState } from "react";
import { canEdit } from "../config.js";
import { storage, bgKey } from "../storage.js";
import { useSpace } from "../state.js";
import { uploadPhoto, deletePhoto, uploadDoc, signedDocUrl, deleteDoc } from "../photos.js";
import { RowList } from "./ProjectInfo.jsx";
import { InspoLightbox } from "./Spaces.jsx";
import { computeBudget } from "../budgetCalc.js";

const rid = () => Math.random().toString(36).slice(2, 9);
const muted = { color: "var(--muted)", fontSize: 13 };

// ---------- PDF options helpers ----------
export function usePdfOpts(space, update) {
  const pdf = space.pdf || {};
  const sec = (id) => ({ on: true, ...(pdf[id] || {}) });
  const setSec = (id, patch) => update({ pdf: { ...pdf, [id]: { ...sec(id), ...patch } } });
  return { pdf, sec, setSec, setPdf: (patch) => update({ pdf: { ...pdf, ...patch } }) };
}

// ---------- Section shell: number, title, summary, "Med i PDF", "⬇ PDF", collapsible body ----------
export function Section({ n, id, title, summary, opts, children, defaultOpen = false, onPdf, busy }) {
  const ro = !canEdit();
  const [open, setOpen] = useState(defaultOpen);
  const s = opts.sec(id);
  return (
    <section className="card" style={{ padding: 0, marginBottom: 12, opacity: s.on ? 1 : 0.62 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontFamily: "var(--mono)", color: "var(--muted)", width: 22 }}>{n}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", fontSize: 14 }}>{title}</div>
          {summary && <div style={{ ...muted, marginTop: 2 }}>{summary}</div>}
        </div>
        <label onClick={(e) => e.stopPropagation()} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={!!s.on} disabled={ro} onChange={(e) => opts.setSec(id, { on: e.target.checked })} /> I PDF
        </label>
        <button className="btn small" onClick={(e) => { e.stopPropagation(); onPdf?.(id); }} disabled={!onPdf || !!busy}
          title="Skapa PDF för bara detta avsnitt">{busy === id ? "…" : "⬇ PDF"}</button>
        <span style={{ color: "var(--muted)", width: 14, textAlign: "center" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--line)" }}><div style={{ height: 12 }} />{children}</div>}
    </section>
  );
}

// ---------- private drawing images (bg keys), e.g. floor plans + bygglov sheets ----------
export function useBgImage(key) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    if (!key) { setImg(null); return undefined; }
    let alive = true;
    const load = async () => { const r = await storage.get(bgKey(key)); if (alive) setImg(r?.value ? JSON.parse(r.value) : null); };
    load(); window.addEventListener("vs-sync", load);
    return () => { alive = false; window.removeEventListener("vs-sync", load); };
  }, [key]);
  return img;
}
function DrawingThumb({ refKey, style, onClick }) {
  const img = useBgImage(refKey);
  return img ? <img src={img.dataUrl} alt="" onClick={onClick} style={style} />
    : <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", ...muted, background: "#fff" }}>Laddar ritning …</div>;
}
// Available drawings = floor plans + bygglov sheets listed in space:floors (`sheets`).
function useDrawings() {
  const [fl] = useSpace("floors");
  return [
    ...(fl?.floors || []).map((f) => ({ key: "floor-" + f.id, title: "Planritning – " + f.title })),
    ...(fl?.sheets || []),
  ];
}

// ---------- Projektbeskrivning: chapters with text + images ----------
// space.chapters = [{ id, title, text, photos:[{ id, photo?, path?, ref?, caption }] }]
export function Chapters({ space, update, opts }) {
  const ro = !canEdit();
  const chapters = space.chapters || [];
  const drawings = useDrawings();
  const [busy, setBusy] = useState(null);
  const [big, setBig] = useState(null);
  const fileRefs = useRef({});
  const off = opts.sec("chapters").off || [];
  const set = (next) => update({ chapters: next });
  const patch = (i, p) => set(chapters.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= chapters.length) return; const n = chapters.slice(); [n[i], n[j]] = [n[j], n[i]]; set(n); };
  const remove = (i) => {
    if (!confirm("Ta bort kapitlet “" + (chapters[i].title || "") + "”?")) return;
    (chapters[i].photos || []).forEach((p) => p.path && deletePhoto(p.path));
    set(chapters.filter((_, j) => j !== i));
  };
  const addPhotos = async (i, files) => {
    setBusy(i);
    try {
      const added = [];
      for (const f of files) { const { url, path } = await uploadPhoto(f); added.push({ id: rid(), photo: url, path, caption: f.name.replace(/\.[^.]+$/, "") }); }
      patch(i, { photos: [...(chapters[i].photos || []), ...added] });
    } catch (e) { alert(e.message); }
    setBusy(null);
  };
  const addRef = (i, key) => { const d = drawings.find((x) => x.key === key); if (d) patch(i, { photos: [...(chapters[i].photos || []), { id: rid(), ref: key, caption: d.title }] }); };
  const patchPhoto = (i, k, p) => patch(i, { photos: chapters[i].photos.map((x, j) => (j === k ? { ...x, ...p } : x)) });
  const movePhoto = (i, k, d) => { const ps = chapters[i].photos.slice(); const j = k + d; if (j < 0 || j >= ps.length) return; [ps[k], ps[j]] = [ps[j], ps[k]]; patch(i, { photos: ps }); };
  const removePhoto = (i, k) => { const p = chapters[i].photos[k]; if (p.path) deletePhoto(p.path); patch(i, { photos: chapters[i].photos.filter((_, j) => j !== k) }); };
  const toggleOff = (id, on) => opts.setSec("chapters", { off: on ? off.filter((x) => x !== id) : [...off, id] });
  const thumb = { width: 150, height: 105, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "zoom-in", display: "block" };

  return (
    <div>
      {!chapters.length && <p className="sub">Inga kapitel ännu.</p>}
      {chapters.map((c, i) => (
        <div key={c.id} style={{ borderBottom: "1px solid var(--line)", padding: "10px 0 14px", opacity: off.includes(c.id) ? 0.55 : 1 }}>
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <span style={{ fontFamily: "var(--mono)", ...muted }}>{i + 1}.</span>
            <input type="text" value={c.title || ""} readOnly={ro} placeholder="Kapitelrubrik"
              onChange={(e) => patch(i, { title: e.target.value })} style={{ flex: 1, fontWeight: 600 }} />
            <label style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={!off.includes(c.id)} disabled={ro} onChange={(e) => toggleOff(c.id, e.target.checked)} /> I PDF
            </label>
            {!ro && <>
              <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="btn small" onClick={() => move(i, 1)} disabled={i === chapters.length - 1}>↓</button>
              <button className="btn small danger" onClick={() => remove(i)}>Ta bort</button>
            </>}
          </div>
          <textarea value={c.text || ""} readOnly={ro} placeholder={ro ? "" : "Skriv kapitlets text …"}
            onChange={(e) => patch(i, { text: e.target.value })}
            rows={Math.max(6, (c.text || "").split("\n").length + Math.ceil((c.text || "").length / 110))} style={{ width: "100%" }} />
          {(c.photos || []).length > 0 && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              {c.photos.map((p, k) => (
                <div key={p.id} style={{ width: 150 }}>
                  {p.ref ? <DrawingThumb refKey={p.ref} style={thumb} onClick={() => setBig({ i, k })} />
                    : <img src={p.photo} alt="" loading="lazy" style={thumb} onClick={() => setBig({ i, k })} />}
                  <input type="text" value={p.caption || ""} readOnly={ro} placeholder="Bildtext"
                    onChange={(e) => patchPhoto(i, k, { caption: e.target.value })} style={{ fontSize: 11.5, padding: "3px 5px", marginTop: 3, width: "100%" }} />
                  {!ro && <div className="row" style={{ gap: 3, marginTop: 3 }}>
                    <button className="btn small" style={{ padding: "1px 6px" }} onClick={() => movePhoto(i, k, -1)}>←</button>
                    <button className="btn small" style={{ padding: "1px 6px" }} onClick={() => movePhoto(i, k, 1)}>→</button>
                    <button className="btn small danger" style={{ padding: "1px 6px" }} onClick={() => removePhoto(i, k)}>✕</button>
                  </div>}
                </div>
              ))}
            </div>
          )}
          {!ro && (
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <input type="file" accept="image/*" multiple style={{ display: "none" }} ref={(el) => { fileRefs.current[c.id] = el; }}
                onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ""; if (f.length) addPhotos(i, f); }} />
              <button className="btn small" disabled={busy === i} onClick={() => fileRefs.current[c.id]?.click()}>{busy === i ? "Laddar upp …" : "📷 Bild"}</button>
              {drawings.length > 0 && (
                <select value="" onChange={(e) => e.target.value && addRef(i, e.target.value)} style={{ fontSize: 12.5, padding: "4px 6px", width: "auto" }}>
                  <option value="">+ Ritning / bygglovsutdrag …</option>
                  {drawings.map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}
                </select>
              )}
            </div>
          )}
        </div>
      ))}
      {!ro && <button className="btn" style={{ marginTop: 10 }} onClick={() => set([...chapters, { id: rid(), title: "", text: "", photos: [] }])}>+ Nytt kapitel</button>}
      {big && (() => {
        const p = chapters[big.i]?.photos?.[big.k]; if (!p) return null;
        return p.ref ? <RefLightbox refKey={p.ref} caption={p.caption} onClose={() => setBig(null)} />
          : <InspoLightbox items={[{ photo: p.photo, title: p.caption }]} index={0} onClose={() => setBig(null)} />;
      })()}
    </div>
  );
}
function RefLightbox({ refKey, caption, onClose }) {
  const img = useBgImage(refKey);
  if (!img) return null;
  return <InspoLightbox items={[{ photo: img.dataUrl, title: caption }]} index={0} onClose={onClose} />;
}

// ---------- Beslutslogg: space.decisions = [{ id, date, area, decision, why }] ----------
const DEC_FIELDS = [
  { k: "date", label: "Datum (ÅÅÅÅ-MM-DD)" },
  { k: "area", label: "Område" },
  { k: "decision", label: "Beslut", wide: true, multi: true },
  { k: "why", label: "Motivering", wide: true, multi: true },
];
const decSummary = (r) => (
  <div>
    <div><span style={{ fontFamily: "var(--mono)", ...muted, fontSize: 12 }}>{r.date || "—"}</span>{" "}
      <span style={{ ...muted, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }}>{r.area}</span>{" "}<b>{r.decision}</b></div>
    {r.why && <div style={{ ...muted, marginTop: 2, lineHeight: 1.45 }}>{r.why}</div>}
  </div>
);
// Part 2: Att besluta / att göra. space.todos = [{ id, area, item, detail, who, due, status }]
export const TODO_STATUS = ["Öppen", "Pågår", "Klar"];
const TODO_FIELDS = [
  { k: "item", label: "Vad ska beslutas / göras", wide: true },
  { k: "area", label: "Område" },
  { k: "status", label: "Status", options: TODO_STATUS },
  { k: "who", label: "Ansvarig" },
  { k: "due", label: "Senast (ÅÅÅÅ-MM-DD)" },
  { k: "detail", label: "Detaljer", wide: true, multi: true },
];
const STATUS_STYLE = {
  "Öppen": { color: "#9a4a3a", borderColor: "#9a4a3a" },
  "Pågår": { color: "#8C6A3F", borderColor: "#8C6A3F" },
  "Klar": { color: "#5E8C5A", borderColor: "#5E8C5A" },
};
const todoSummary = (r) => {
  const st = r.status || "Öppen";
  return (
    <div style={{ opacity: st === "Klar" ? 0.6 : 1 }}>
      <div>
        <span style={{ fontSize: 10.5, fontWeight: 700, border: "1px solid", borderRadius: 4, padding: "0 4px", marginRight: 6, ...STATUS_STYLE[st] }}>{st.toUpperCase()}</span>
        <span style={{ ...muted, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }}>{r.area}</span>{" "}
        <b style={{ textDecoration: st === "Klar" ? "line-through" : "none" }}>{r.item}</b>
        {(r.who || r.due) && <span style={{ ...muted, marginLeft: 8 }}>{[r.who, r.due && "senast " + r.due].filter(Boolean).join(" · ")}</span>}
      </div>
      {r.detail && <div style={{ ...muted, marginTop: 2, lineHeight: 1.45, whiteSpace: "pre-line" }}>{r.detail}</div>}
    </div>
  );
};
export function Decisions({ space, update, opts }) {
  const ro = !canEdit();
  const todos = space.todos || [];
  const open = todos.filter((t) => (t.status || "Öppen") !== "Klar").length;
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Fattade beslut</h3>
      <RowList rows={space.decisions || []} onChange={(decisions) => update({ decisions })}
        fields={DEC_FIELDS} addLabel="+ Lägg till beslut" summary={decSummary} empty="Inga beslut loggade än." />
      <h3 style={{ marginTop: 26 }}>Att besluta / att göra <span style={{ ...muted, fontWeight: 400 }}>· {open} öppna av {todos.length}</span></h3>
      <RowList rows={todos} onChange={(t) => update({ todos: t })}
        fields={TODO_FIELDS} addLabel="+ Lägg till punkt" summary={todoSummary} empty="Inget att göra just nu." />
      {opts && (
        <label style={{ fontSize: 13, display: "block", marginTop: 12 }}>
          <input type="checkbox" disabled={ro} checked={opts.sec("decisions").todos !== false}
            onChange={(e) => opts.setSec("decisions", { todos: e.target.checked })} /> Ta med att göra-listan i PDF:en
        </label>
      )}
    </div>
  );
}

// ---------- Bilagor: private PDFs in vs-docs. space.attachments = [{ id, title, path, size, on }] ----------
export function Attachments({ space, update }) {
  const ro = !canEdit();
  const items = space.attachments || [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const set = (next) => update({ attachments: next });
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = "";
    if (!files.length) return;
    setBusy(true); setErr("");
    try {
      const added = [];
      for (const f of files) { const r = await uploadDoc(f); added.push({ id: rid(), title: f.name.replace(/\.[^.]+$/, ""), ...r, on: true }); }
      set([...items, ...added]);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  const open = async (it) => { const w = window.open("", "_blank"); try { const u = await signedDocUrl(it.path); if (w) w.location = u; else window.location = u; } catch (e) { w?.close(); alert(e.message); } };
  const patch = (i, p) => set(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= items.length) return; const n = items.slice(); [n[i], n[j]] = [n[j], n[i]]; set(n); };
  const remove = (i) => { if (!confirm("Ta bort bilagan “" + items[i].title + "”? Filen raderas.")) return; deleteDoc(items[i].path); set(items.filter((_, j) => j !== i)); };
  const mb = (b) => (b ? (b / 1048576).toFixed(1) + " MB" : "");
  return (
    <div>
      <p className="sub" style={{ marginTop: 0 }}>Alla ibockade bilagor står i bilageförteckningen. <b>Bifogas</b> = sidorna läggs in sist i projekt-PDF:en, <b>Listas bara</b> = bara namnet (t.ex. stora ritningar som skrivs ut separat). Lagras privat – öppnas bara inloggad.</p>
      {!ro && (
        <div className="row" style={{ marginBottom: 10 }}>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple style={{ display: "none" }} onChange={onPick} />
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Laddar upp …" : "📎 Ladda upp bilaga (PDF)"}</button>
          {err && <span style={{ fontSize: 12, color: "var(--red)" }}>{err}</span>}
        </div>
      )}
      {!items.length && <p className="sub">Inga bilagor ännu.</p>}
      {items.map((it, i) => (
        <div key={it.id} className="row" style={{ gap: 6, padding: "6px 0", borderBottom: "1px solid var(--line)", opacity: it.on === false ? 0.55 : 1 }}>
          <span style={{ fontFamily: "var(--mono)", ...muted, width: 22 }}>{String.fromCharCode(65 + i)}</span>
          <input type="checkbox" title="Med i PDF" checked={it.on !== false} disabled={ro} onChange={(e) => patch(i, { on: e.target.checked })} />
          <input type="text" value={it.title} readOnly={ro} onChange={(e) => patch(i, { title: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          <select disabled={ro || it.on === false} value={it.mode || "full"} onChange={(e) => patch(i, { mode: e.target.value })} style={{ width: "auto", padding: "3px 6px", fontSize: 12.5 }}
            title="Bifogas = sidorna läggs in i PDF:en. Listas = bara namnet står i bilageförteckningen.">
            <option value="full">Bifogas</option>
            <option value="list">Listas bara</option>
          </select>
          <span style={muted}>{mb(it.size)}</span>
          <button className="btn small" onClick={() => open(it)}>Öppna</button>
          {!ro && <>
            <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button className="btn small" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</button>
            <button className="btn small danger" onClick={() => remove(i)}>Ta bort</button>
          </>}
        </div>
      ))}
    </div>
  );
}

// ---------- Linked: Arbetsplan & budget ----------
const budgetTotal = (b) => (b?.items ? computeBudget(b).total : null);
const tkr = (n) => (n == null ? "–" : new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(Math.round(n / 1000)) + " tkr");
export const BUDGET_VIEWS = [
  ["summary", "Sammanfattning (totaler, per byggnad)"],
  ["gantt", "Tidplan (Gantt)"],
  ["phases", "Per fas"],
  ["material", "Material totalt"],
  ["trades", "Per yrke (timmar & bemanning)"],
  ["deliveries", "Leveranser"],
];
export function useBudgetSummary() {
  const [b1] = useSpace("budget"); const [b2] = useSpace("budget2");
  const t1 = budgetTotal(b1), t2 = budgetTotal(b2);
  const s = (b) => b?.phases?.length ? `${b.items?.length || 0} rader · ${b.phases.length} faser` : "";
  return { t1, t2, s1: s(b1), s2: s(b2), phases1: b1?.phases || [] };
}
export function BudgetOptions({ opts, sum }) {
  const ro = !canEdit();
  const s = opts.sec("budget");
  const etapper = s.etapper || ["budget"];
  const views = s.views || ["summary", "gantt", "phases"];
  const tog = (arr, v, on) => (on ? [...new Set([...arr, v])] : arr.filter((x) => x !== v));
  return (
    <div>
      <p className="sub" style={{ marginTop: 0 }}>Innehållet hämtas från <a href="#/budget">Budget</a> – redigera där. Här väljer du vad som kommer med i PDF:en.</p>
      <div style={{ display: "grid", gap: 4, marginBottom: 10, fontSize: 14 }}>
        <label><input type="checkbox" disabled={ro} checked={etapper.includes("budget")} onChange={(e) => opts.setSec("budget", { etapper: tog(etapper, "budget", e.target.checked) })} /> Etapp 1 – huset till inflytt <span style={muted}>· {tkr(sum.t1)} · {sum.s1}</span> <a href="#/budget">öppna →</a></label>
        <label><input type="checkbox" disabled={ro} checked={etapper.includes("budget2")} onChange={(e) => opts.setSec("budget", { etapper: tog(etapper, "budget2", e.target.checked) })} /> Etapp 2 – efter inflytt <span style={muted}>· {tkr(sum.t2)} · {sum.s2}</span> <a href="#/budget/etapp2">öppna →</a></label>
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Vyer</div>
      <div style={{ display: "grid", gap: 4, marginBottom: 10, fontSize: 14 }}>
        {BUDGET_VIEWS.map(([k, label]) => (
          <label key={k}><input type="checkbox" disabled={ro} checked={views.includes(k)} onChange={(e) => opts.setSec("budget", { views: tog(views, k, e.target.checked) })} /> {label}</label>
        ))}
      </div>
      <label style={{ fontSize: 13 }}>Detaljnivå i fas-vyn{" "}
        <select disabled={ro} value={s.detail || "lines"} onChange={(e) => opts.setSec("budget", { detail: e.target.value })} style={{ width: "auto", padding: "4px 6px" }}>
          <option value="sums">Bara summor per fas</option>
          <option value="rows">Rader</option>
          <option value="lines">Rader + materialrader</option>
        </select>
      </label>
      <label style={{ fontSize: 13, display: "block", marginTop: 8 }}>
        <input type="checkbox" disabled={ro} checked={s.prices !== false} onChange={(e) => opts.setSec("budget", { prices: e.target.checked })} /> Visa belopp (avbocka för en version utan priser, t.ex. till hantverkare)
      </label>
    </div>
  );
}

// ---------- Linked: Våningar & utrymmen ----------
export function FloorsRoomsOptions({ opts, rooms }) {
  const ro = !canEdit();
  const [fl] = useSpace("floors");
  const s = opts.sec("floors");
  const ovOff = s.overviewOff || [];
  const roomOpt = s.rooms || {};
  const setRoom = (id, p) => opts.setSec("floors", { rooms: { ...roomOpt, [id]: { ...(roomOpt[id] || {}), ...p } } });
  const byId = Object.fromEntries((rooms || []).map((r) => [r.id, r]));
  const floors = fl?.floors || [];
  const placed = new Set(floors.flatMap((f) => f.areas.map((a) => a.roomId)));
  const loose = (rooms || []).filter((r) => !placed.has(r.id));
  const short = (n) => (n || "").replace(/^(K|P1|P2)\s*·\s*/, "");
  const RoomRow = ({ r }) => {
    const o = roomOpt[r.id] || {};
    return (
      <div className="row" style={{ gap: 8, padding: "4px 0 4px 18px", opacity: o.on === false ? 0.55 : 1 }}>
        <input type="checkbox" disabled={ro} checked={o.on !== false} onChange={(e) => setRoom(r.id, { on: e.target.checked })} />
        <a href={"#/rum/" + r.id} style={{ flex: 1, minWidth: 140, fontSize: 14 }}>{short(r.name)}</a>
        <select disabled={ro} value={o.detail || "full"} onChange={(e) => setRoom(r.id, { detail: e.target.value })} style={{ width: "auto", padding: "3px 6px", fontSize: 12.5 }}>
          <option value="full">Full (ritning, text, inspo, kommentarer, färger)</option>
          <option value="compact">Kompakt (1 sida)</option>
        </select>
      </div>
    );
  };
  return (
    <div>
      <p className="sub" style={{ marginTop: 0 }}>Innehållet hämtas från <a href="#/vaning/plan1">Våningar</a> och varje utrymmes egen sida (ritning, beskrivning, åtgärder, inspirationsbilder, dokument, färger) – redigera där.</p>
      <label style={{ fontSize: 13, display: "block", marginBottom: 8 }}>
        <input type="checkbox" disabled={ro} checked={s.inspo !== false} onChange={(e) => opts.setSec("floors", { inspo: e.target.checked })} /> Ta med inspirationsbilder
      </label>
      {floors.map((f) => (
        <div key={f.id} style={{ marginBottom: 8 }}>
          <label style={{ fontWeight: 600, fontSize: 14 }}>
            <input type="checkbox" disabled={ro} checked={!ovOff.includes(f.id)}
              onChange={(e) => opts.setSec("floors", { overviewOff: e.target.checked ? ovOff.filter((x) => x !== f.id) : [...ovOff, f.id] })} /> {f.title} – översiktsritning
          </label>{" "}<a href={"#/vaning/" + f.id} style={{ fontSize: 13 }}>öppna →</a>
          {f.areas.filter((a) => byId[a.roomId]).map((a) => <RoomRow key={a.roomId} r={byId[a.roomId]} />)}
        </div>
      ))}
      {loose.length > 0 && (
        <div><div style={{ fontWeight: 600 }}>Övriga utrymmen</div>{loose.map((r) => <RoomRow key={r.id} r={r} />)}</div>
      )}
    </div>
  );
}

// ---------- Skapa PDF: checklist ----------
export function PdfBuilder({ opts, sections, onBuild, busy, status }) {
  const ro = !canEdit();
  const n = sections.filter(([id]) => opts.sec(id).on).length;
  return (
    <div className="card" style={{ padding: 14, marginBottom: 12, background: "#fff" }}>
      <div style={{ fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", fontSize: 14, marginBottom: 8 }}>⬇ Skapa projekt-PDF</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 4, marginBottom: 10 }}>
        {sections.map(([id, num, title]) => (
          <label key={id} style={{ fontSize: 13.5 }}>
            <input type="checkbox" disabled={ro} checked={opts.sec(id).on} onChange={(e) => opts.setSec(id, { on: e.target.checked })} /> {num}. {title}
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input type="text" disabled={ro} value={opts.pdf.filename || ""} placeholder="Filnamn, t.ex. Villa Skogstorp – projekt"
          onChange={(e) => opts.setPdf({ filename: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn primary" disabled={!!busy || !n} onClick={onBuild}>{busy === "all" ? "Skapar …" : "Skapa PDF"}</button>
      </div>
      {status && <p className="sub" style={{ margin: "8px 0 0", color: status.startsWith("Fel") ? "var(--red)" : undefined }}>{status}</p>}
    </div>
  );
}

// Cover image for the PDF: a drawing/bygglov sheet or one of the project's inspiration images.
export function CoverImagePicker({ space, opts }) {
  const ro = !canEdit();
  const drawings = useDrawings();
  const s = opts.sec("cover");
  const inspo = space.inspo || [];
  const cur = s.image || "";
  const isRef = cur && !cur.startsWith("http");
  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ fontSize: 13 }}>Bild på framsidan{" "}
        <select disabled={ro} value={cur} onChange={(e) => opts.setSec("cover", { image: e.target.value })} style={{ width: "auto", padding: "4px 6px" }}>
          <option value="">Ingen bild</option>
          <optgroup label="Ritningar">{drawings.map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}</optgroup>
          {inspo.length > 0 && <optgroup label="Inspirationsbilder">{inspo.map((x) => <option key={x.id} value={x.photo}>{x.title}</option>)}</optgroup>}
        </select>
      </label>
      {cur && <div style={{ marginTop: 8 }}>{isRef
        ? <DrawingThumb refKey={cur} style={{ width: 260, borderRadius: 6, border: "1px solid var(--line)" }} />
        : <img src={cur} alt="" style={{ width: 260, borderRadius: 6, border: "1px solid var(--line)" }} />}</div>}
    </div>
  );
}
