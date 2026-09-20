import { useMemo, useState } from "react";
import { useSpace, useRooms } from "../state.js";
import { spaceKey } from "../storage.js";
import { canEdit } from "../config.js";
import VersionHistory from "../components/VersionHistory.jsx";

// Budget lives in its own space record (space:budget) → syncs + versions like the rest.
// Shape: { phases: [{id,name,start,end}], items: [{id,desc,phaseId,roomId,category,qty,unit,estUnit,quote,actual}] }
const DEFAULT_PHASES = [
  "Markarbeten", "Rivning", "Grund tillbyggnad / källare", "Tillbyggnad",
  "Renovering befintlig", "Takomläggning befintligt", "Terrass (utomhus)", "Friggebod", "Garage",
];
const CATS = ["Material", "Arbete", "Underentreprenör", "Övrigt"];
const CAT_SHORT = { "Material": "Material", "Arbete": "Arbete", "Underentreprenör": "UE", "Övrigt": "Övrigt" };
const OVERGRIP = "Övergripande";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const parseNum = (v) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const hasVal = (v) => v != null && String(v).trim() !== "";
const kr = (n) => new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(Math.round(n)) + " kr";
const est = (it) => { const q = parseNum(it.qty); return q ? q * parseNum(it.estUnit) : parseNum(it.estUnit); };
const current = (it) => (hasVal(it.actual) ? parseNum(it.actual) : hasVal(it.quote) ? parseNum(it.quote) : est(it));

const cell = { padding: "4px 6px", fontSize: 12.5 };
const sel = { ...cell, border: "1.5px solid var(--ink)", borderRadius: 7, background: "#fff", fontFamily: "inherit" };
const th = (align = "left") => ({ padding: "4px 6px", fontWeight: 600, whiteSpace: "nowrap", textAlign: align, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)" });
const td = (align = "left") => ({ padding: "3px 4px", verticalAlign: "middle", textAlign: align });

export default function Budget() {
  const ro = !canEdit();
  const [space, update] = useSpace("budget");
  const { rooms } = useRooms();
  const [groupBy, setGroupBy] = useState("phase");

  const phases = useMemo(
    () => (space && space.phases && space.phases.length
      ? space.phases
      : DEFAULT_PHASES.map((n, i) => ({ id: "p" + i, name: n, start: "", end: "" }))),
    [space]
  );

  if (!space) return <div className="page"><p className="sub">Laddar …</p></div>;

  const items = space.items || [];
  const roomName = (id) => (rooms || []).find((r) => r.id === id)?.name || (id ? "(borttaget rum)" : OVERGRIP);

  const setPhases = (next) => update({ phases: next });
  const setItems = (next) => update({ items: next });
  const patchPhase = (id, p) => setPhases(phases.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const addPhase = () => setPhases([...phases, { id: uid(), name: "Ny fas", start: "", end: "" }]);
  const delPhase = (id) => { if (confirm("Ta bort fasen? (poster i den blir kvar men utan fas)")) setPhases(phases.filter((x) => x.id !== id)); };
  const movePhase = (i, d) => { const j = i + d; if (j < 0 || j >= phases.length) return; const a = phases.slice(); [a[i], a[j]] = [a[j], a[i]]; setPhases(a); };
  const patchItem = (id, p) => setItems(items.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const delItem = (id) => setItems(items.filter((x) => x.id !== id));
  const addItem = (preset) => setItems([...items, {
    id: uid(), desc: "", phaseId: phases[0]?.id || "", roomId: "", category: "Material",
    qty: "", unit: "", estUnit: "", quote: "", actual: "", ...preset,
  }]);

  // ---- totals ----
  let sumEst = 0, sumQuote = 0, sumActual = 0, sumCur = 0; const byCat = {};
  for (const it of items) {
    sumEst += est(it);
    if (hasVal(it.quote)) sumQuote += parseNum(it.quote);
    if (hasVal(it.actual)) sumActual += parseNum(it.actual);
    const c = current(it); sumCur += c;
    byCat[it.category || "Övrigt"] = (byCat[it.category || "Övrigt"] || 0) + c;
  }
  const dev = sumCur - sumEst;

  // ---- grouping ----
  const phaseIds = new Set(phases.map((p) => p.id));
  let groups;
  if (groupBy === "category") {
    groups = CATS.map((c) => ({ key: c, label: c, preset: { category: c }, items: items.filter((i) => (i.category || "Övrigt") === c) }));
  } else if (groupBy === "room") {
    groups = [
      { key: "", label: OVERGRIP, preset: { roomId: "" }, items: items.filter((i) => !i.roomId) },
      ...(rooms || []).map((r) => ({ key: r.id, label: r.name, preset: { roomId: r.id }, items: items.filter((i) => i.roomId === r.id) })),
    ];
    const known = new Set((rooms || []).map((r) => r.id));
    const orphan = items.filter((i) => i.roomId && !known.has(i.roomId));
    if (orphan.length) groups.push({ key: "_o", label: "(borttagna rum)", preset: {}, items: orphan });
  } else {
    groups = phases.map((p, i) => ({ key: p.id, label: (i + 1) + ". " + p.name, preset: { phaseId: p.id }, items: items.filter((it) => it.phaseId === p.id) }));
    const orphan = items.filter((it) => !phaseIds.has(it.phaseId));
    if (orphan.length) groups.push({ key: "_o", label: "Ej tilldelad fas", preset: {}, items: orphan });
  }

  // ---- gantt range ----
  const dated = phases.filter((p) => p.start && p.end);
  const minT = dated.length ? Math.min(...dated.map((p) => +new Date(p.start))) : 0;
  const maxT = dated.length ? Math.max(...dated.map((p) => +new Date(p.end))) : 0;
  const span = maxT - minT || 1;
  const ticks = [];
  if (dated.length) {
    const d = new Date(minT); d.setDate(1);
    const end = new Date(maxT);
    while (d <= end) {
      ticks.push({ left: ((+d - minT) / span) * 100, label: d.toLocaleDateString("sv-SE", { month: "short" }).replace(".", "") + " " + String(d.getFullYear()).slice(2) });
      d.setMonth(d.getMonth() + 1);
    }
  }
  const LABELW = 140;

  return (
    <div className="page">
      <h1>BUDGET &amp; TIDSPLAN</h1>
      <p className="sub">Grova uppskattningar i kronologisk ordning — fyll i mängd och á-pris så räknas summan ut. Lägg till offert och faktisk kostnad efter hand; tagga varje post med fas, rum och kategori.</p>

      {/* summary */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Gällande total</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{kr(sumCur)}</div>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 18, fontSize: 12.5, color: "var(--muted)" }}>
          <span>Uppskattat: <span className="mono" style={{ color: "var(--ink)" }}>{kr(sumEst)}</span></span>
          <span>Offert: <span className="mono" style={{ color: "var(--ink)" }}>{kr(sumQuote)}</span></span>
          <span>Faktiskt: <span className="mono" style={{ color: "var(--ink)" }}>{kr(sumActual)}</span></span>
          <span>Avvikelse mot uppskattat: <span className="mono" style={{ color: dev > 0 ? "var(--red)" : "var(--ink)" }}>{dev > 0 ? "+" : ""}{kr(dev)}</span></span>
        </div>
        <div className="row" style={{ marginTop: 6, gap: 16, fontSize: 12, color: "var(--muted)" }}>
          {CATS.map((c) => <span key={c}>{CAT_SHORT[c]}: <span className="mono" style={{ color: "var(--ink)" }}>{kr(byCat[c] || 0)}</span></span>)}
        </div>
      </div>

      {/* phases + timeline */}
      <h2>Faser &amp; tidsplan</h2>
      <div className="card" style={{ marginBottom: 18 }}>
        {phases.map((p, i) => (
          <div key={p.id} className="row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
            <span className="mono" style={{ color: "var(--muted)", width: 16 }}>{i + 1}</span>
            {ro ? <div style={{ flex: "1 1 180px", fontWeight: 600 }}>{p.name}</div>
              : <input type="text" value={p.name} onChange={(e) => patchPhase(p.id, { name: e.target.value })} style={{ flex: "1 1 180px", fontWeight: 600 }} />}
            {ro ? <span className="sub" style={{ margin: 0 }}>{p.start || "?"} – {p.end || "?"}</span> : (
              <>
                <input type="date" value={p.start || ""} onChange={(e) => patchPhase(p.id, { start: e.target.value })} style={sel} />
                <span style={{ color: "var(--muted)" }}>–</span>
                <input type="date" value={p.end || ""} onChange={(e) => patchPhase(p.id, { end: e.target.value })} style={sel} />
                <button className="btn small" onClick={() => movePhase(i, -1)}>↑</button>
                <button className="btn small" onClick={() => movePhase(i, 1)}>↓</button>
                <button className="btn small danger" onClick={() => delPhase(p.id)}>✕</button>
              </>
            )}
          </div>
        ))}
        {!ro && <button className="btn small" style={{ marginTop: 4 }} onClick={addPhase}>+ Fas</button>}

        {dated.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <div style={{ minWidth: 520 }}>
              <div style={{ position: "relative", height: 16, marginLeft: LABELW, borderBottom: "1px solid var(--line)" }}>
                {ticks.map((t, k) => <div key={k} style={{ position: "absolute", left: t.left + "%", fontSize: 9.5, color: "var(--muted)", transform: "translateX(-2px)" }}>{t.label}</div>)}
              </div>
              {phases.map((p, i) => {
                const has = p.start && p.end;
                const left = has ? ((+new Date(p.start) - minT) / span) * 100 : 0;
                const width = has ? Math.max(1.5, ((+new Date(p.end) - +new Date(p.start)) / span) * 100) : 0;
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", height: 22 }}>
                    <div style={{ width: LABELW, fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 6 }}>{i + 1}. {p.name}</div>
                    <div style={{ position: "relative", flex: 1, height: 12, background: "var(--line)", borderRadius: 4 }}>
                      {has && <div title={p.start + " – " + p.end} style={{ position: "absolute", left: left + "%", width: width + "%", height: "100%", background: "var(--blue)", borderRadius: 4 }} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* items */}
      <h2>Poster</h2>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <span className="sub" style={{ margin: 0 }}>Visa efter:</span>
        {[["phase", "Fas"], ["room", "Rum"], ["category", "Kategori"]].map(([k, l]) => (
          <button key={k} className={"btn small" + (groupBy === k ? " primary" : "")} onClick={() => setGroupBy(k)}>{l}</button>
        ))}
      </div>

      {groups.map((g) => {
        const gEst = g.items.reduce((s, it) => s + est(it), 0);
        const gCur = g.items.reduce((s, it) => s + current(it), 0);
        return (
          <div key={g.key} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 600 }}>{g.label}</div>
              <div className="mono" style={{ fontWeight: 700 }}>{kr(gCur)} <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>(uppsk. {kr(gEst)})</span></div>
            </div>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 860, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={th()}>Post</th>
                    {groupBy !== "phase" && <th style={th()}>Fas</th>}
                    {groupBy !== "room" && <th style={th()}>Rum</th>}
                    {groupBy !== "category" && <th style={th()}>Kat.</th>}
                    <th style={th("right")}>Mängd</th>
                    <th style={th()}>Enhet</th>
                    <th style={th("right")}>Á-pris</th>
                    <th style={th("right")}>Uppskattat</th>
                    <th style={th("right")}>Offert</th>
                    <th style={th("right")}>Faktiskt</th>
                    {!ro && <th style={{ width: 26 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it) => (
                    <tr key={it.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={td()}>{ro ? (it.desc || "—") : <input type="text" value={it.desc} placeholder="Beskrivning" onChange={(e) => patchItem(it.id, { desc: e.target.value })} style={{ ...cell, minWidth: 130 }} />}</td>
                      {groupBy !== "phase" && <td style={td()}>{ro ? (phases.find((p) => p.id === it.phaseId)?.name || "—") : (
                        <select value={it.phaseId || ""} onChange={(e) => patchItem(it.id, { phaseId: e.target.value })} style={sel}>
                          <option value="">—</option>
                          {phases.map((p, i) => <option key={p.id} value={p.id}>{i + 1}. {p.name}</option>)}
                        </select>)}</td>}
                      {groupBy !== "room" && <td style={td()}>{ro ? roomName(it.roomId) : (
                        <select value={it.roomId || ""} onChange={(e) => patchItem(it.id, { roomId: e.target.value })} style={sel}>
                          <option value="">{OVERGRIP}</option>
                          {(rooms || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>)}</td>}
                      {groupBy !== "category" && <td style={td()}>{ro ? (CAT_SHORT[it.category] || it.category) : (
                        <select value={it.category || "Material"} onChange={(e) => patchItem(it.id, { category: e.target.value })} style={sel}>
                          {CATS.map((c) => <option key={c} value={c}>{CAT_SHORT[c]}</option>)}
                        </select>)}</td>}
                      <td style={td("right")}>{ro ? it.qty : <input type="text" inputMode="decimal" value={it.qty} onChange={(e) => patchItem(it.id, { qty: e.target.value })} style={{ ...cell, width: 58, textAlign: "right" }} />}</td>
                      <td style={td()}>{ro ? it.unit : <input type="text" value={it.unit} placeholder="m²…" onChange={(e) => patchItem(it.id, { unit: e.target.value })} style={{ ...cell, width: 56 }} />}</td>
                      <td style={td("right")}>{ro ? it.estUnit : <input type="text" inputMode="decimal" value={it.estUnit} onChange={(e) => patchItem(it.id, { estUnit: e.target.value })} style={{ ...cell, width: 78, textAlign: "right" }} />}</td>
                      <td style={{ ...td("right"), fontFamily: "var(--mono)", whiteSpace: "nowrap", color: "var(--muted)" }}>{kr(est(it))}</td>
                      <td style={td("right")}>{ro ? (hasVal(it.quote) ? kr(parseNum(it.quote)) : "—") : <input type="text" inputMode="decimal" value={it.quote} placeholder="kr" onChange={(e) => patchItem(it.id, { quote: e.target.value })} style={{ ...cell, width: 82, textAlign: "right" }} />}</td>
                      <td style={td("right")}>{ro ? (hasVal(it.actual) ? kr(parseNum(it.actual)) : "—") : <input type="text" inputMode="decimal" value={it.actual} placeholder="kr" onChange={(e) => patchItem(it.id, { actual: e.target.value })} style={{ ...cell, width: 82, textAlign: "right" }} />}</td>
                      {!ro && <td style={td("right")}><button className="btn small danger" style={{ padding: "2px 6px" }} onClick={() => delItem(it.id)}>✕</button></td>}
                    </tr>
                  ))}
                  {g.items.length === 0 && <tr><td colSpan={11} style={{ ...td(), color: "var(--muted)", fontStyle: "italic" }}>Inga poster.</td></tr>}
                </tbody>
              </table>
            </div>
            {!ro && g.key !== "_o" && <button className="btn small" style={{ marginTop: 8 }} onClick={() => addItem(g.preset)}>+ Rad</button>}
          </div>
        );
      })}

      <VersionHistory storageKey={spaceKey("budget")} />
    </div>
  );
}
