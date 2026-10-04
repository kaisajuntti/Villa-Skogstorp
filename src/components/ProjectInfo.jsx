// Project-level structured lists on the project space record:
//   contacts: [{ id, role, name, company, phone, email, note }]   — Kontakter & roller
//   tech:     [{ id, area, choice, detail }]                      — Tekniska val
// Both feed the whole-project PDF. Contacts are personal data → they live only in
// Supabase (behind login), never in the public repo.
import { useState } from "react";
import { canEdit } from "../config.js";

const rid = () => Math.random().toString(36).slice(2, 9);

// Compact list of records; tap a row to edit it as a card.
// `fields` = [{ k, label, wide?, multi?, type? }], `summary(r)` = collapsed rendering.
export function RowList({ rows, onChange, fields, addLabel, empty, summary }) {
  const ro = !canEdit();
  const [open, setOpen] = useState(null); // id of the expanded row
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i) => { if (confirm("Ta bort raden?")) onChange(rows.filter((_, j) => j !== i)); };
  const add = () => { const r = { id: rid() }; onChange([...rows, r]); setOpen(r.id); };

  return (
    <div>
      {!rows.length && <p className="sub">{empty}</p>}
      {rows.map((r, i) => open !== r.id ? (
        <div key={r.id || i} onClick={ro ? undefined : () => setOpen(r.id)}
          style={{ padding: "8px 2px", borderBottom: "1px solid var(--line)", cursor: ro ? "default" : "pointer",
            display: "flex", gap: 10, alignItems: "baseline" }}>
          <div style={{ flex: 1, minWidth: 0 }}>{summary(r)}</div>
          {!ro && <span className="sub" style={{ margin: 0 }}>✎</span>}
        </div>
      ) : (
        <div key={r.id || i} className="card" style={{ margin: "8px 0", padding: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
            {fields.map((f) => (
              <label key={f.k} style={{ fontSize: 12, gridColumn: f.wide ? "1 / -1" : undefined }}>
                <div className="sub" style={{ margin: "0 0 3px" }}>{f.label}</div>
                {f.multi ? (
                  <textarea value={r[f.k] || ""} readOnly={ro} style={{ minHeight: 60 }}
                    onChange={ro ? undefined : (e) => set(i, f.k, e.target.value)} />
                ) : (
                  <input type="text" value={r[f.k] || ""} readOnly={ro} inputMode={f.type}
                    onChange={ro ? undefined : (e) => set(i, f.k, e.target.value)} />
                )}
              </label>
            ))}
          </div>
          {!ro && (
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="btn small" onClick={() => move(i, 1)} disabled={i === rows.length - 1}>↓</button>
              <button className="btn small danger" onClick={() => remove(i)}>Ta bort</button>
              <button className="btn small primary" style={{ marginLeft: "auto" }} onClick={() => setOpen(null)}>Klar</button>
            </div>
          )}
        </div>
      ))}
      {!ro && <button className="btn" style={{ marginTop: 10 }} onClick={add}>{addLabel}</button>}
    </div>
  );
}

const CONTACT_FIELDS = [
  { k: "role", label: "Roll" },
  { k: "name", label: "Namn" },
  { k: "company", label: "Företag" },
  { k: "phone", label: "Telefon", type: "tel" },
  { k: "email", label: "E-post", type: "email" },
  { k: "note", label: "Anteckning", wide: true },
];
const dim = { color: "var(--muted)", fontSize: 13 };
const contactSummary = (r) => (
  <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr) 2fr", gap: "2px 12px" }}>
    <div style={dim}>{r.role || "—"}</div>
    <div>
      <b>{[r.name, r.company].filter(Boolean).join(", ") || "—"}</b>
      {(r.phone || r.email) && (
        <span style={{ ...dim, marginLeft: 8 }}>
          {r.phone && <a href={"tel:" + r.phone} onClick={(e) => e.stopPropagation()}>{r.phone}</a>}
          {r.phone && r.email && " · "}
          {r.email && <a href={"mailto:" + r.email} onClick={(e) => e.stopPropagation()}>{r.email}</a>}
        </span>
      )}
      {r.note && <div style={dim}>{r.note}</div>}
    </div>
  </div>
);
const techSummary = (r) => (
  <div>
    <div><span style={{ ...dim, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }}>{r.area || "—"}</span>{" "}
      <b>{r.choice}</b></div>
    {r.detail && <div style={{ ...dim, marginTop: 2, lineHeight: 1.45 }}>{r.detail}</div>}
  </div>
);

export function Contacts({ space, update }) {
  return (
    <RowList rows={space.contacts || []} onChange={(contacts) => update({ contacts })}
      fields={CONTACT_FIELDS} addLabel="+ Lägg till kontakt" summary={contactSummary}
      empty="Inga kontakter än — byggherre, entreprenör, KA, konstruktör, arkitekt …" />
  );
}

const TECH_FIELDS = [
  { k: "area", label: "Område" },
  { k: "choice", label: "Val" },
  { k: "detail", label: "Beskrivning / motivering", wide: true, multi: true },
];
export function TechChoices({ space, update }) {
  return (
    <RowList rows={space.tech || []} onChange={(tech) => update({ tech })}
      fields={TECH_FIELDS} addLabel="+ Lägg till tekniskt val" summary={techSummary}
      empty="Inga tekniska val än — uppvärmning, ventilation, tak, el …" />
  );
}
