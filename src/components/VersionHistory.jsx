import { useEffect, useState } from "react";
import { getConfig, canEdit } from "../config.js";
import * as sync from "../sync.js";
import { restoreValue } from "../storage.js";

function summarize(kind, data) {
  try {
    if (kind === "plan")
      return `${data.items?.length || 0} möbler · ${data.openings?.length || 0} öppningar · ${data.room?.w}×${data.room?.l} mm`;
    if (kind === "space")
      return `${data.colors?.length || 0} färger · ${data.docs?.length || 0} dokument · ${(data.notes || "").length} tecken anteckn.`;
    if (kind === "rooms") return `${Array.isArray(data) ? data.length : 0} rum`;
  } catch { /* ignore */ }
  return "";
}

const fmt = (iso) => {
  try { return new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
};

export default function VersionHistory({ storageKey, onRestored }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const cfg = getConfig();
  const parts = sync.keyParts(storageKey);

  const load = async () => {
    setErr(""); setRows(null);
    try { setRows(await sync.fetchVersions(cfg, parts.kind, parts.key)); }
    catch (e) { setErr(e.message); setRows([]); }
  };
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open]);

  if (!cfg) return null; // versions live in the shared backend only

  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn small" onClick={() => setOpen((o) => !o)}>
        {open ? "Dölj historik" : "Historik"}
      </button>
      {open && (
        <div className="card" style={{ marginTop: 8 }}>
          {rows === null && <p className="sub" style={{ margin: 0 }}>Laddar …</p>}
          {err && <p className="sub" style={{ margin: 0, color: "var(--red)" }}>Kunde inte hämta: {err}</p>}
          {rows && rows.length === 0 && !err && <p className="sub" style={{ margin: 0 }}>Inga tidigare versioner ännu.</p>}
          <div className="cardlist" style={{ gap: 6 }}>
            {(rows || []).map((v) => (
              <div key={v.id} className="row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontSize: 13 }}>
                  <span className="mono">{fmt(v.created_at)}</span>
                  {v.updated_by ? ` · ${v.updated_by}` : ""}
                  <br /><span className="sub" style={{ margin: 0 }}>{summarize(parts.kind, v.data)}</span>
                </span>
                {canEdit() && (
                  <button className="btn small" onClick={async () => {
                    if (!confirm("Återställ den här versionen? Nuvarande sparas i historiken.")) return;
                    await restoreValue(storageKey, v.data);
                    onRestored?.();
                    load();
                  }}>Återställ</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
