import { useMemo } from "react";
import { useSpace } from "../state.js";
import { spaceKey } from "../storage.js";
import { canEdit } from "../config.js";
import VersionHistory from "../components/VersionHistory.jsx";

// Budget lives in its own "space" record (space:budget) so it syncs + versions
// like everything else, with no extra plumbing. Shape: { phases: [...] }.
const DEFAULT_PHASES = [
  "Markarbeten",
  "Rivning",
  "Grund tillbyggnad / källare",
  "Tillbyggnad",
  "Renovering befintlig",
  "Takomläggning befintligt",
  "Terrass (utomhus)",
  "Friggebod",
  "Garage",
];
const STATUS = ["Uppskattad", "Offert", "Faktisk"];
const STATUS_COLOR = { Uppskattad: "#9a4a3a", Offert: "#5a7a8c", Faktisk: "#3a7a4a" };

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const parseNum = (v) => {
  const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const kr = (n) => new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(Math.round(n)) + " kr";

const cell = { padding: "5px 7px", fontSize: 13 };
const th = { padding: "4px 6px", fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "3px 4px", verticalAlign: "middle" };

export default function Budget() {
  const ro = !canEdit();
  const [space, update] = useSpace("budget");
  const phases = useMemo(
    () => (space && space.phases && space.phases.length
      ? space.phases
      : DEFAULT_PHASES.map((n, i) => ({ id: "p" + i, name: n, period: "", items: [] }))),
    [space]
  );

  if (!space) return <div className="page"><p className="sub">Laddar …</p></div>;

  const setPhases = (next) => update({ phases: next });
  const patchPhase = (pid, patch) => setPhases(phases.map((p) => (p.id === pid ? { ...p, ...patch } : p)));
  const patchItem = (pid, iid, patch) => setPhases(phases.map((p) => (p.id !== pid ? p : { ...p, items: (p.items || []).map((it) => (it.id === iid ? { ...it, ...patch } : it)) })));
  const addItem = (pid) => setPhases(phases.map((p) => (p.id !== pid ? p : { ...p, items: [...(p.items || []), { id: uid(), desc: "", qty: "", unit: "", price: "", status: "Uppskattad" }] })));
  const delItem = (pid, iid) => setPhases(phases.map((p) => (p.id !== pid ? p : { ...p, items: (p.items || []).filter((it) => it.id !== iid) })));
  const addPhase = () => setPhases([...phases, { id: uid(), name: "Ny fas", period: "", items: [] }]);
  const delPhase = (pid) => { if (confirm("Ta bort hela fasen?")) setPhases(phases.filter((p) => p.id !== pid)); };
  const movePhase = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= phases.length) return;
    const a = phases.slice(); [a[idx], a[j]] = [a[j], a[idx]]; setPhases(a);
  };

  const phaseTotal = (p) => (p.items || []).reduce((s, it) => s + parseNum(it.qty) * parseNum(it.price), 0);
  const grand = phases.reduce((s, p) => s + phaseTotal(p), 0);
  const byStatus = {};
  for (const p of phases) for (const it of (p.items || [])) {
    const k = it.status || "Uppskattad";
    byStatus[k] = (byStatus[k] || 0) + parseNum(it.qty) * parseNum(it.price);
  }

  return (
    <div className="page">
      <h1>BUDGET &amp; TIDSPLAN</h1>
      <p className="sub">Grova uppskattningar i kronologisk ordning — fyll i mängd och á-pris så räknas summan ut. Förfina efter hand och sätt status när du fått offert eller faktisk kostnad.</p>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Totalsumma</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{kr(grand)}</div>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 16 }}>
          {STATUS.map((s) => (
            <span key={s} style={{ fontSize: 12, color: "var(--muted)" }}>
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: STATUS_COLOR[s], marginRight: 5 }} />
              {s}: <span className="mono" style={{ color: "var(--ink)" }}>{kr(byStatus[s] || 0)}</span>
            </span>
          ))}
        </div>
      </div>

      {phases.map((p, idx) => {
        const total = phaseTotal(p);
        const share = grand > 0 ? total / grand : 0;
        return (
          <div key={p.id} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div className="mono" style={{ color: "var(--muted)", fontSize: 13, width: 16 }}>{idx + 1}</div>
              {ro
                ? <div style={{ fontWeight: 600, flex: "1 1 200px" }}>{p.name}</div>
                : <input type="text" value={p.name} onChange={(e) => patchPhase(p.id, { name: e.target.value })} style={{ flex: "1 1 200px", fontWeight: 600 }} />}
              {ro
                ? (p.period ? <span className="zonechip">{p.period}</span> : null)
                : <input type="text" placeholder="Tidplan, t.ex. Vår 2027" value={p.period || ""} onChange={(e) => patchPhase(p.id, { period: e.target.value })} style={{ flex: "0 0 170px" }} />}
              <div className="mono" style={{ fontWeight: 700, marginLeft: "auto", whiteSpace: "nowrap" }}>{kr(total)}</div>
              {!ro && (
                <>
                  <button className="btn small" title="Flytta upp" onClick={() => movePhase(idx, -1)}>↑</button>
                  <button className="btn small" title="Flytta ner" onClick={() => movePhase(idx, 1)}>↓</button>
                  <button className="btn small danger" title="Ta bort fas" onClick={() => delPhase(p.id)}>✕</button>
                </>
              )}
            </div>

            <div style={{ height: 4, background: "var(--line)", borderRadius: 4, marginTop: 8 }}>
              <div style={{ height: "100%", width: (share * 100).toFixed(1) + "%", background: "var(--blue)", borderRadius: 4 }} />
            </div>

            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: 13 }}>
                <thead>
                  <tr style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    <th style={{ ...th, textAlign: "left" }}>Post</th>
                    <th style={{ ...th, textAlign: "right" }}>Mängd</th>
                    <th style={{ ...th, textAlign: "left" }}>Enhet</th>
                    <th style={{ ...th, textAlign: "right" }}>Á-pris</th>
                    <th style={{ ...th, textAlign: "right" }}>Summa</th>
                    <th style={{ ...th, textAlign: "left" }}>Status</th>
                    {!ro && <th style={{ width: 30 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {(p.items || []).map((it) => {
                    const line = parseNum(it.qty) * parseNum(it.price);
                    return (
                      <tr key={it.id} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={td}>{ro ? (it.desc || "—") : <input type="text" value={it.desc} placeholder="Beskrivning" onChange={(e) => patchItem(p.id, it.id, { desc: e.target.value })} style={cell} />}</td>
                        <td style={{ ...td, textAlign: "right" }}>{ro ? it.qty : <input type="text" inputMode="decimal" value={it.qty} onChange={(e) => patchItem(p.id, it.id, { qty: e.target.value })} style={{ ...cell, textAlign: "right", width: 68 }} />}</td>
                        <td style={td}>{ro ? it.unit : <input type="text" value={it.unit} placeholder="m², st…" onChange={(e) => patchItem(p.id, it.id, { unit: e.target.value })} style={{ ...cell, width: 72 }} />}</td>
                        <td style={{ ...td, textAlign: "right" }}>{ro ? it.price : <input type="text" inputMode="decimal" value={it.price} onChange={(e) => patchItem(p.id, it.id, { price: e.target.value })} style={{ ...cell, textAlign: "right", width: 90 }} />}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>{kr(line)}</td>
                        <td style={td}>
                          {ro ? (
                            <span style={{ fontSize: 12 }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: STATUS_COLOR[it.status] || STATUS_COLOR.Uppskattad, marginRight: 5 }} />{it.status || "Uppskattad"}</span>
                          ) : (
                            <select value={it.status || "Uppskattad"} onChange={(e) => patchItem(p.id, it.id, { status: e.target.value })}
                              style={{ ...cell, border: "1.5px solid var(--ink)", borderRadius: 8, background: "#fff", fontFamily: "inherit" }}>
                              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          )}
                        </td>
                        {!ro && <td style={{ ...td, textAlign: "right" }}><button className="btn small danger" style={{ padding: "2px 7px" }} onClick={() => delItem(p.id, it.id)}>✕</button></td>}
                      </tr>
                    );
                  })}
                  {(p.items || []).length === 0 && (
                    <tr><td colSpan={ro ? 6 : 7} style={{ ...td, color: "var(--muted)", fontStyle: "italic" }}>Inga poster ännu.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {!ro && <button className="btn small" style={{ marginTop: 10 }} onClick={() => addItem(p.id)}>+ Rad</button>}
          </div>
        );
      })}

      {!ro && <button className="btn" onClick={addPhase}>+ Lägg till fas</button>}

      <VersionHistory storageKey={spaceKey("budget")} />
    </div>
  );
}
