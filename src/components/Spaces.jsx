import { useState, useRef, useEffect } from "react";
import { canEdit } from "../config.js";
import { uploadPhoto, deletePhoto } from "../photos.js";
import { usePlanComments, usePlanItems, useRooms, loadPlanForPrint } from "../state.js";
import { buildPlanSvg } from "../planner/planSvg.js";

// Presentational: numbered cards for a room's plan comments/photos.
function CommentCards({ items }) {
  return (
    <div className="cardlist">
      {items.map((c, i) => (
        <div key={c.id || i} className="card">
          <div className="row">
            <div className="grow"><strong>#{i + 1} · {c.photo ? "📷 Bild" : "💬 Kommentar"}</strong></div>
          </div>
          {c.photo && (
            <img src={c.photo} alt="" loading="lazy"
              style={{ display: "block", maxWidth: "100%", borderRadius: 8, marginTop: 8, border: "1px solid var(--line)" }} />
          )}
          {c.text && c.text.trim() && (
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>{c.text}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// Cover-page details for the whole-project PDF. Stored on the project space as `cover`.
const COVER_FIELDS = [
  ["projectName", "Projektnamn"],
  ["officialName", "Fastighetsbeteckning / officiellt namn"],
  ["houseAddress", "Husets adress"],
  ["contactName", "Kontaktperson"],
  ["email", "E-post"],
  ["phone", "Telefon"],
  ["contactAddress", "Adress (kontakt)"],
];
export function CoverInfo({ space, update }) {
  const ro = !canEdit();
  const cover = space.cover || {};
  const set = (k, v) => update({ cover: { ...cover, [k]: v } });
  return (
    <div>
      <p className="sub">Visas på försättsbladet när du skapar en PDF för hela projektet.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {COVER_FIELDS.map(([k, label]) => (
          <label key={k} style={{ fontSize: 12 }}>
            <div className="sub" style={{ margin: "0 0 4px" }}>{label}</div>
            <input type="text" value={cover[k] || ""} readOnly={ro}
              inputMode={k === "email" ? "email" : k === "phone" ? "tel" : undefined}
              onChange={ro ? undefined : (e) => set(k, e.target.value)} />
          </label>
        ))}
      </div>
      <label style={{ display: "block", marginTop: 12, fontSize: 12 }}>
        <div className="sub" style={{ margin: "0 0 4px" }}>Fritext</div>
        <textarea value={cover.freeText || ""} readOnly={ro}
          placeholder={ro ? "" : "T.ex. kort projektbeskrivning eller önskemål till hantverkaren …"}
          onChange={ro ? undefined : (e) => set("freeText", e.target.value)} />
      </label>
    </div>
  );
}

// One room's comments (used inside the tabbed browser); shows a message if empty.
function RoomComments({ roomId }) {
  const items = usePlanComments(roomId);
  if (!items.length) return <p className="sub">Inga kommentarer eller bilder på planritningen ännu.</p>;
  return <CommentCards items={items} />;
}

// Read-only section on a room's Documents tab that auto-collects that room's
// plan comments & photos — handy for a print-out. Editing happens on the plan.
export function PlanCollection({ roomId }) {
  const items = usePlanComments(roomId);
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 26 }}>
      <h2>Från planritningen</h2>
      <p className="sub">Kommentarer och bilder du placerat på planritningen — samlas här automatiskt.</p>
      <CommentCards items={items} />
    </div>
  );
}

// Inventory of every object drawn on the plan (name + size), with an editable
// comment and optional link per object. Notes/links live on the space record
// (keyed by item id); names/sizes are read live from the plan.
export function InventoryList({ roomId, space, update }) {
  const ro = !canEdit();
  const items = usePlanItems(roomId);
  const inv = space.inventory || {};
  const setField = (id, field, val) => update({ inventory: { ...inv, [id]: { ...(inv[id] || {}), [field]: val } } });
  return (
    <div style={{ marginTop: 26 }}>
      <h2>Inventarielista</h2>
      <p className="sub">Alla objekt du ritat in på planritningen. Lägg gärna till en kommentar och länk per objekt.</p>
      {items.length === 0 ? (
        <p className="sub">Inga objekt inritade ännu.</p>
      ) : (
        <div className="cardlist">
          {items.map((it, i) => {
            const meta = inv[it.id] || {};
            return (
              <div key={it.id || i} className="card">
                <div className="row">
                  <div className="grow">
                    <strong>{(it.t && it.t.trim()) || "(namnlöst objekt)"}</strong>{" "}
                    <span className="mono" style={{ color: "var(--muted)", fontSize: 13 }}>{it.w}×{it.h} mm</span>
                  </div>
                </div>
                {ro ? (
                  <>
                    {meta.note ? <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>{meta.note}</div> : null}
                    {meta.url ? <div style={{ marginTop: 4 }}><a href={meta.url} target="_blank" rel="noreferrer">{meta.url} ↗</a></div> : null}
                  </>
                ) : (
                  <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                    <input type="text" className="grow" placeholder="Kommentar …" value={meta.note || ""}
                      onChange={(e) => setField(it.id, "note", e.target.value)} />
                    <input type="url" className="grow" placeholder="https:// (valfritt)" value={meta.url || ""}
                      onChange={(e) => setField(it.id, "url", e.target.value)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Project-level browser: all rooms' plan comments/photos, grouped by room as tabs.
// Each room has its own 🖨 PDF button that renders that room's plan without opening it.
export function RoomsCommentBrowser({ cover, colors }) {
  const { rooms } = useRooms();
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(null);
  const [busyAll, setBusyAll] = useState(false);
  if (rooms === null) return <p className="sub">Laddar …</p>;
  if (!rooms.length) return <p className="sub">Inga rum ännu.</p>;
  const cur = rooms.some((r) => r.id === active) ? active : rooms[0].id;
  // Full per-room data for the PDF renderer (used for single-room and whole-project).
  const sectionFor = async (room) => {
    const { plan, bgImg, space } = await loadPlanForPrint(room.id);
    const svgString = buildPlanSvg({
      room: plan.room, openings: plan.openings || [], items: plan.items || [],
      walls: plan.walls || [], comments: plan.comments || [], dims: plan.dims || [], embedBg: false,
    });
    return {
      roomName: room.name, svgString, comments: plan.comments || [], bgImg, bgT: plan.bg || null,
      description: space.description || "", actions: space.actions || "",
      colors: space.colors || [], docs: space.docs || [], items: plan.items || [], inventory: space.inventory || {},
    };
  };
  const printRoom = async (room) => {
    setBusy(room.id);
    try {
      const { savePlanPdf } = await import("../planner/pdf.js");
      await savePlanPdf({ ...(await sectionFor(room)), cover: cover || {} });
    } finally { setBusy(null); }
  };
  const printAll = async () => {
    setBusyAll(true);
    try {
      const sections = [];
      for (const r of rooms) sections.push(await sectionFor(r));
      const { saveProjectPdf } = await import("../planner/pdf.js");
      await saveProjectPdf({
        title: (cover && cover.projectName) || "Villa Skogstorp",
        cover: cover || {}, colors: colors || [], sections,
      });
    } finally { setBusyAll(false); }
  };
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <button className="btn primary" disabled={busyAll} onClick={printAll}>
          {busyAll ? "Skapar PDF …" : "⬇ Skapa PDF för hela projektet"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {rooms.map((r) => (
          <div key={r.id} style={{ display: "flex" }}>
            <button className={"btn" + (cur === r.id ? " primary" : "")} onClick={() => setActive(r.id)}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}>{r.name}</button>
            <button className="btn" title={"Skapa PDF för " + r.name} disabled={busy === r.id}
              onClick={() => printRoom(r)}
              style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, marginLeft: -1 }}>
              {busy === r.id ? "…" : "🖨"}
            </button>
          </div>
        ))}
      </div>
      <RoomComments key={cur} roomId={cur} />
    </div>
  );
}

export function ColorScheme({ space, update }) {
  const ro = !canEdit();
  const [hex, setHex] = useState("#5a7a8c");
  const [name, setName] = useState("");
  const colors = space.colors || [];
  const add = () => {
    update({ colors: [...colors, { hex, name: name.trim() || hex, note: "" }] });
    setName("");
  };
  const setNote = (i, note) =>
    update({ colors: colors.map((c, j) => (j === i ? { ...c, note } : c)) });
  const remove = (i) => update({ colors: colors.filter((_, j) => j !== i) });

  return (
    <div>
      {!ro && (
        <div className="row" style={{ marginBottom: 14 }}>
          <input type="color" value={hex} onChange={(e) => setHex(e.target.value)}
            style={{ width: 46, height: 40, border: "1.5px solid var(--ink)", borderRadius: 8, background: "#fff", padding: 3 }} />
          <input type="text" className="grow" placeholder="Namn, t.ex. Väggfärg NCS S 1002-Y"
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn primary" onClick={add}>+ Färg</button>
        </div>
      )}
      {colors.length === 0 && <p className="sub">Inga färger sparade ännu.</p>}
      <div className="swatchgrid">
        {colors.map((c, i) => (
          <div key={i} className="swatch">
            <div className="chip" style={{ background: c.hex }} />
            <div className="body">
              <div>{c.name}</div>
              <div className="hex">{c.hex.toUpperCase()}</div>
              {ro ? (
                c.note ? <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{c.note}</div> : null
              ) : (
                <>
                  <input type="text" placeholder="Anteckning …" value={c.note || ""}
                    onChange={(e) => setNote(i, e.target.value)}
                    style={{ marginTop: 6, fontSize: 12, padding: "4px 6px", border: "1px solid var(--line)" }} />
                  <button className="btn small danger" style={{ marginTop: 6 }} onClick={() => remove(i)}>Ta bort</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DocList({ space, update }) {
  const ro = !canEdit();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const docs = space.docs || [];
  const add = () => {
    if (!title.trim() && !url.trim()) return;
    update({ docs: [...docs, { title: title.trim() || url.trim(), url: url.trim(), note: "" }] });
    setTitle(""); setUrl("");
  };
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true); setErr("");
    try {
      const added = [];
      for (const file of files) {
        const { url: photo, path } = await uploadPhoto(file);
        const name = file.name.replace(/\.[^.]+$/, "");
        added.push({ title: title.trim() || name || "Bild", photo, path, url: "", note: "" });
      }
      update({ docs: [...docs, ...added] });
      setTitle("");
    } catch (e2) { setErr(e2.message || "Kunde inte ladda upp bilden"); }
    setBusy(false);
  };
  const setNote = (i, note) => update({ docs: docs.map((d, j) => (j === i ? { ...d, note } : d)) });
  const remove = (i) => {
    const d = docs[i];
    if (d?.path) deletePhoto(d.path);
    update({ docs: docs.filter((_, j) => j !== i) });
  };

  return (
    <div>
      <label style={{ display: "block", marginBottom: 18 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Beskrivning</div>
        <div className="sub" style={{ margin: "0 0 6px" }}>Övergripande beskrivning och scensättning — får gärna vara lång. Visas på sida 1 i PDF:en.</div>
        <textarea value={space.description || ""} readOnly={ro}
          placeholder={ro ? "" : "Beskriv projektet/rummet: bakgrund, mål, förutsättningar, önskemål …"}
          onChange={ro ? undefined : (e) => update({ description: e.target.value })}
          style={{ minHeight: 160 }} />
      </label>
      <label style={{ display: "block", marginBottom: 18 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Sammanfattning av åtgärder</div>
        <div className="sub" style={{ margin: "0 0 6px" }}>Punktlista/kort text över vad som ska göras. Visas på sida 1 i PDF:en.</div>
        <textarea value={space.actions || ""} readOnly={ro}
          placeholder={ro ? "" : "T.ex. Riv vägg mot vardagsrum · Nytt kök · Flytta fönster …"}
          onChange={ro ? undefined : (e) => update({ actions: e.target.value })}
          style={{ minHeight: 120 }} />
      </label>
      <p className="sub">
        Bilder du laddar upp, samt länkar till dokument, offerter, produktblad m.m.
      </p>
      {!ro && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <input type="text" className="grow" placeholder="Titel (valfritt)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input type="url" className="grow" placeholder="https:// (valfritt)" value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()} />
            <button className="btn primary" onClick={add}>+ Länk</button>
          </div>
          <div className="row" style={{ marginBottom: 14, alignItems: "center" }}>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onPick} />
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Laddar upp …" : "📷 Ladda upp bild"}
            </button>
            {err && <span style={{ fontSize: 12, color: "var(--danger, #9a4a3a)" }}>{err}</span>}
          </div>
        </>
      )}
      {docs.length === 0 && <p className="sub">Inga dokument ännu.</p>}
      <div className="cardlist">
        {docs.map((d, i) => (
          <div key={i} className="card">
            <div className="row">
              <div className="grow">
                {d.url ? <a href={d.url} target="_blank" rel="noreferrer"><strong>{d.title}</strong> ↗</a> : <strong>{d.title}</strong>}
              </div>
              {!ro && <button className="btn small danger" onClick={() => remove(i)}>Ta bort</button>}
            </div>
            {d.photo && (
              <a href={d.photo} target="_blank" rel="noreferrer">
                <img src={d.photo} alt={d.title} loading="lazy"
                  style={{ display: "block", maxWidth: "100%", borderRadius: 8, marginTop: 8, border: "1px solid var(--line)" }} />
              </a>
            )}
            {ro ? (
              d.note ? <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>{d.note}</div> : null
            ) : (
              <input type="text" placeholder="Anteckning …" value={d.note || ""}
                onChange={(e) => setNote(i, e.target.value)}
                style={{ marginTop: 8, fontSize: 13, padding: "5px 8px", border: "1px solid var(--line)" }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Notes({ space, update, placeholder }) {
  const ro = !canEdit();
  return (
    <textarea
      value={space.notes || ""}
      readOnly={ro}
      placeholder={ro ? "Inga anteckningar." : (placeholder || "Anteckningar …")}
      onChange={ro ? undefined : (e) => update({ notes: e.target.value })}
      style={ro ? { background: "#faf8f3", color: "var(--ink)" } : undefined}
    />
  );
}

// ---------- Inspirationsbilder (space.inspo = [{ id, title, photo, path, note }]) ----------
// AI renders / mood images of how the finished room should look. Shown big in Dokument and
// in a side panel next to the floor plan. Photos live in the public vs-photos bucket.
export function InspoLightbox({ items, index, onClose }) {
  const [i, setI] = useState(index);
  useEffect(() => setI(index), [index]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") setI((x) => (x + 1) % items.length); if (e.key === "ArrowLeft") setI((x) => (x - 1 + items.length) % items.length); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);
  const it = items[i]; if (!it) return null;
  const nav = { position: "absolute", top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.9)", border: "none", borderRadius: 99, width: 44, height: 44, fontSize: 22, cursor: "pointer" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,20,20,0.88)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <img src={it.photo} alt={it.title} style={{ maxWidth: "100%", maxHeight: "86vh", objectFit: "contain", borderRadius: 8 }} onClick={(e) => e.stopPropagation()} />
      <div style={{ color: "#fff", marginTop: 10, fontSize: 14, textAlign: "center" }}>{it.title}{it.note ? " — " + it.note : ""} <span style={{ opacity: 0.6 }}>({i + 1}/{items.length})</span></div>
      {items.length > 1 && <>
        <button style={{ ...nav, left: 12 }} onClick={(e) => { e.stopPropagation(); setI((x) => (x - 1 + items.length) % items.length); }}>‹</button>
        <button style={{ ...nav, right: 12 }} onClick={(e) => { e.stopPropagation(); setI((x) => (x + 1) % items.length); }}>›</button>
      </>}
      <button onClick={onClose} style={{ position: "absolute", top: 12, right: 12, background: "#fff", border: "none", borderRadius: 99, width: 40, height: 40, fontSize: 18, cursor: "pointer" }}>✕</button>
    </div>
  );
}

export function InspoGallery({ space, update }) {
  const ro = !canEdit();
  const items = space.inspo || [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [big, setBig] = useState(null);
  const fileRef = useRef(null);
  const set = (next) => update({ inspo: next });
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = "";
    if (!files.length) return;
    setBusy(true); setErr("");
    try {
      const added = [];
      for (const f of files) {
        const { url, path } = await uploadPhoto(f);
        added.push({ id: Math.random().toString(36).slice(2, 9), title: f.name.replace(/\.[^.]+$/, ""), photo: url, path, note: "" });
      }
      set([...items, ...added]);
    } catch (e2) { setErr(e2.message || "Kunde inte ladda upp bilden"); }
    setBusy(false);
  };
  const patch = (i, p) => set(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= items.length) return; const n = items.slice(); [n[i], n[j]] = [n[j], n[i]]; set(n); };
  const remove = (i) => { if (!confirm("Ta bort bilden?")) return; if (items[i].path) deletePhoto(items[i].path); set(items.filter((_, j) => j !== i)); };
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ margin: "4px 0 6px" }}>Inspirationsbilder</h3>
      <p className="sub" style={{ marginTop: 0 }}>Så här tänker vi oss att det ser ut när det är klart (t.ex. AI-bilder, moodboards). Visas även bredvid planritningen.</p>
      {!ro && (
        <div className="row" style={{ marginBottom: 12 }}>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onPick} />
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Laddar upp …" : "✨ Ladda upp inspirationsbild"}</button>
          {err && <span style={{ fontSize: 12, color: "var(--red)" }}>{err}</span>}
        </div>
      )}
      {!items.length && <p className="sub">Inga inspirationsbilder ännu.</p>}
      <div style={{ display: "grid", gap: 14 }}>
        {items.map((it, i) => (
          <div key={it.id || i} className="card" style={{ padding: 10 }}>
            <img src={it.photo} alt={it.title} loading="lazy" onClick={() => setBig(i)}
              style={{ display: "block", width: "100%", height: "auto", borderRadius: 8, cursor: "zoom-in", border: "1px solid var(--line)" }} />
            {ro ? (
              <div style={{ marginTop: 6 }}><strong>{it.title}</strong>{it.note ? <span className="sub"> — {it.note}</span> : null}</div>
            ) : (
              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                <input type="text" value={it.title || ""} placeholder="Titel" onChange={(e) => patch(i, { title: e.target.value })} style={{ flex: "1 1 160px" }} />
                <input type="text" value={it.note || ""} placeholder="Anteckning …" onChange={(e) => patch(i, { note: e.target.value })} style={{ flex: "2 1 200px" }} />
                <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="btn small" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</button>
                <button className="btn small danger" onClick={() => remove(i)}>Ta bort</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {big != null && <InspoLightbox items={items} index={big} onClose={() => setBig(null)} />}
    </div>
  );
}
