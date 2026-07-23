import { useState } from "react";
import { canEdit } from "../config.js";

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
  const docs = space.docs || [];
  const add = () => {
    if (!title.trim() && !url.trim()) return;
    update({ docs: [...docs, { title: title.trim() || url.trim(), url: url.trim(), note: "" }] });
    setTitle(""); setUrl("");
  };
  const setNote = (i, note) => update({ docs: docs.map((d, j) => (j === i ? { ...d, note } : d)) });
  const remove = (i) => update({ docs: docs.filter((_, j) => j !== i) });

  return (
    <div>
      <p className="sub">
        Länkar till dokument, offerter, produktblad m.m. (Google Drive, leverantörssidor …).
      </p>
      {!ro && (
        <div className="row" style={{ marginBottom: 14 }}>
          <input type="text" className="grow" placeholder="Titel" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="url" className="grow" placeholder="https:// (valfritt)" value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn primary" onClick={add}>+ Dokument</button>
        </div>
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
