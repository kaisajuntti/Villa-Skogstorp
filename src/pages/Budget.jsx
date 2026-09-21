import { Fragment, useMemo, useState } from "react";
import { useSpace, useRooms } from "../state.js";
import { spaceKey } from "../storage.js";
import { canEdit } from "../config.js";
import VersionHistory from "../components/VersionHistory.jsx";

// Budget lives in its own space record (space:budget) → syncs + versions like the rest.
// Shape: { phases: [{id,name,start,end}], items: [{id,desc,phaseId,roomId,category,entreprenor,del,qty,unit,estUnit}] }
// One value per row: belopp = mängd × á-pris (estUnit), or estUnit as a lump sum when qty is blank.
const DEFAULT_PHASES = [
  "Markarbeten", "Rivning", "Grund tillbyggnad / källare", "Tillbyggnad",
  "Renovering befintlig", "Takomläggning befintligt", "Terrass (utomhus)", "Friggebod", "Garage",
];
const CATS = ["Material", "Arbete", "Övrigt"];
const CAT_SHORT = { "Material": "Material", "Arbete": "Arbete", "Övrigt": "Övrigt" };
const OVERGRIP = "Övergripande";
// "Del" = byggdel/moment (free text). These are just suggestions in a datalist —
// you can type anything ("Kök", "Trädäck", …). Used for sub-headers within a group.
const DELAR = ["Mark", "Stomme", "Golv", "Dränering", "Yttervägg", "Innervägg", "Trappa", "Fönster", "Dörrar", "Fasad", "Tak", "Golvbeklädnad", "Väggbeklädnad", "VVS", "Ventilation", "El", "Övrigt"];
const NODEL = "Ej angiven del";
const delOrder = (d) => { const i = DELAR.indexOf(d); return i < 0 ? DELAR.length : i; };

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const parseNum = (v) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const kr = (n) => new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(Math.round(n)) + " kr";
const est = (it) => { const q = parseNum(it.qty); return q ? q * parseNum(it.estUnit) : parseNum(it.estUnit); };
// One value per row: what's entered (mängd × á-pris, or á-pris as a lump sum) is what counts.
const current = (it) => est(it);
// Arbetstimmar: labour rows measured in hours (for the time plan).
const hoursOf = (it) => (it.category === "Arbete" && /tim/i.test(it.unit || "") ? parseNum(it.qty) : 0);
const hFmt = (h) => (Math.round(h) + " h");

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
    entreprenor: "", del: "", qty: "", unit: "", estUnit: "", ...preset,
  }]);

  // ---- totals ----
  let sumCur = 0, sumHours = 0; const byCat = {}; const byDel = {}; const byDelH = {};
  for (const it of items) {
    const c = current(it); sumCur += c;
    byCat[it.category || "Övrigt"] = (byCat[it.category || "Övrigt"] || 0) + c;
    const h = hoursOf(it); sumHours += h;
    const d = (it.del || "").trim();
    if (d) { byDel[d] = (byDel[d] || 0) + c; if (h) byDelH[d] = (byDelH[d] || 0) + h; }
  }
  const delKeys = Object.keys(byDel).sort((a, b) => (delOrder(a) - delOrder(b)) || a.localeCompare(b, "sv"));
  const hourDelKeys = Object.keys(byDelH).sort((a, b) => (delOrder(a) - delOrder(b)) || a.localeCompare(b, "sv"));

  // ---- grouping ----
  const phaseIds = new Set(phases.map((p) => p.id));
  let groups;
  if (groupBy === "category") {
    groups = CATS.map((c) => ({ key: c, label: c, preset: { category: c }, items: items.filter((i) => (i.category || "Övrigt") === c) }));
  } else if (groupBy === "del") {
    const names = [];
    for (const it of items) { const n = (it.del || "").trim(); if (n && !names.includes(n)) names.push(n); }
    names.sort((a, b) => (delOrder(a) - delOrder(b)) || a.localeCompare(b, "sv"));
    groups = names.map((n) => ({ key: n, label: n, preset: { del: n }, items: items.filter((i) => (i.del || "").trim() === n) }));
    const none = items.filter((i) => !(i.del || "").trim());
    if (none.length || !names.length) groups.push({ key: "_none", label: NODEL, preset: { del: "" }, items: none });
  } else if (groupBy === "ent") {
    const names = [];
    for (const it of items) { const n = (it.entreprenor || "").trim(); if (n && !names.includes(n)) names.push(n); }
    names.sort((a, b) => a.localeCompare(b, "sv"));
    groups = names.map((n) => ({ key: n, label: n, preset: { entreprenor: n }, items: items.filter((i) => (i.entreprenor || "").trim() === n) }));
    const none = items.filter((i) => !(i.entreprenor || "").trim());
    if (none.length || !names.length) groups.push({ key: "_none", label: "Ej angiven entreprenör", preset: { entreprenor: "" }, items: none });
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

  // One item row — shared by the flat and the del-clustered rendering.
  const renderRow = (it) => (
    <tr key={it.id} style={{ borderTop: "1px solid var(--line)" }}>
      <td style={td()}>{ro ? (it.desc || "—") : <input type="text" value={it.desc} placeholder="Beskrivning" title={it.desc || ""} onChange={(e) => patchItem(it.id, { desc: e.target.value })} style={{ ...cell, minWidth: 220 }} />}</td>
      {groupBy !== "phase" && <td style={td()}>{ro ? (phases.find((p) => p.id === it.phaseId)?.name || "—") : (
        <select value={it.phaseId || ""} onChange={(e) => patchItem(it.id, { phaseId: e.target.value })} style={sel}>
          <option value="">—</option>
          {phases.map((p, i) => <option key={p.id} value={p.id}>{i + 1}. {p.name}</option>)}
        </select>)}</td>}
      {groupBy !== "del" && <td style={td()}>{ro ? (it.del || "—") : (
        <>
          <input type="text" list="budget-delar" value={it.del || ""} placeholder="t.ex. Golv" title={it.del || ""} onChange={(e) => patchItem(it.id, { del: e.target.value })} style={{ ...cell, minWidth: 110 }} />
        </>)}</td>}
      {groupBy !== "room" && <td style={td()}>{ro ? roomName(it.roomId) : (
        <select value={it.roomId || ""} onChange={(e) => patchItem(it.id, { roomId: e.target.value })} style={sel}>
          <option value="">{OVERGRIP}</option>
          {(rooms || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>)}</td>}
      {groupBy !== "category" && <td style={td()}>{ro ? (CAT_SHORT[it.category] || it.category) : (
        <select value={CATS.includes(it.category) ? it.category : (it.category || "Material")} onChange={(e) => patchItem(it.id, { category: e.target.value })} style={sel}>
          {CATS.map((c) => <option key={c} value={c}>{CAT_SHORT[c]}</option>)}
          {it.category && !CATS.includes(it.category) && <option value={it.category}>{it.category}</option>}
        </select>)}</td>}
      {groupBy !== "ent" && <td style={td()}>{ro ? (it.entreprenor || "—") : <input type="text" value={it.entreprenor || ""} placeholder="t.ex. Pelle snickare" title={it.entreprenor || ""} onChange={(e) => patchItem(it.id, { entreprenor: e.target.value })} style={{ ...cell, minWidth: 120 }} />}</td>}
      <td style={td("right")}>{ro ? it.qty : <input type="text" inputMode="decimal" value={it.qty} onChange={(e) => patchItem(it.id, { qty: e.target.value })} style={{ ...cell, width: 58, textAlign: "right" }} />}</td>
      <td style={td()}>{ro ? it.unit : <input type="text" value={it.unit} placeholder="m²…" onChange={(e) => patchItem(it.id, { unit: e.target.value })} style={{ ...cell, width: 56 }} />}</td>
      <td style={td("right")}>{ro ? it.estUnit : <input type="text" inputMode="decimal" value={it.estUnit} onChange={(e) => patchItem(it.id, { estUnit: e.target.value })} style={{ ...cell, width: 78, textAlign: "right" }} />}</td>
      <td style={{ ...td("right"), fontFamily: "var(--mono)", whiteSpace: "nowrap", fontWeight: 600 }}>{kr(est(it))}</td>
      {!ro && <td style={td("right")}><button className="btn small danger" style={{ padding: "2px 6px" }} onClick={() => delItem(it.id)}>✕</button></td>}
    </tr>
  );

  // Render a group's rows: flat, or clustered under del sub-headers.
  const renderBody = (g) => {
    const useSub = groupBy !== "del" && g.items.some((it) => (it.del || "").trim());
    if (!useSub) {
      return (
        <>
          {g.items.map(renderRow)}
          {g.items.length === 0 && <tr><td colSpan={11} style={{ ...td(), color: "var(--muted)", fontStyle: "italic" }}>Inga poster.</td></tr>}
        </>
      );
    }
    const map = new Map();
    for (const it of g.items) { const d = (it.del || "").trim(); if (!map.has(d)) map.set(d, []); map.get(d).push(it); }
    const keys = [...map.keys()].sort((a, b) => {
      if (a === "") return 1; if (b === "") return -1;
      return (delOrder(a) - delOrder(b)) || a.localeCompare(b, "sv");
    });
    return keys.map((k) => {
      const arr = map.get(k);
      const cCur = arr.reduce((s, it) => s + current(it), 0);
      const cH = arr.reduce((s, it) => s + hoursOf(it), 0);
      return (
        <Fragment key={k || "_none"}>
          <tr>
            <td colSpan={11} style={{ padding: "6px 6px 4px", background: "var(--line)", borderTop: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.5 }}>{k || NODEL}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>{kr(cCur)}{cH > 0 && <span style={{ color: "var(--muted)" }}> · {hFmt(cH)}</span>}</span>
              </div>
            </td>
          </tr>
          {arr.map(renderRow)}
        </Fragment>
      );
    });
  };

  return (
    <div className="page">
      <h1>BUDGET &amp; TIDSPLAN</h1>
      <p className="sub">Ett belopp per post = mängd × á-pris (eller á-pris som klumpsumma om mängd lämnas tom) — det du skriver in är det som gäller, oavsett gissning eller känt. Arbete skattas i timmar. Tagga varje post med fas, rum, kategori, entreprenör (fritext, t.ex. "Pelle snickare") och del/byggdel (Golv, Yttervägg, Ytskikt … — grupperas i underrubriker). Alla priser ex moms.</p>

      {/* summary */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Total</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{kr(sumCur)}</div>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 16, fontSize: 12, color: "var(--muted)" }}>
          {CATS.map((c) => <span key={c}>{CAT_SHORT[c]}: <span className="mono" style={{ color: "var(--ink)" }}>{kr(byCat[c] || 0)}</span></span>)}
          <span>Arbete: <span className="mono" style={{ color: "var(--ink)" }}>{hFmt(sumHours)}</span> (~{Math.round(sumHours / 8)} dagar)</span>
        </div>
        {delKeys.length > 0 && (
          <div className="row" style={{ marginTop: 6, gap: 16, fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
            {delKeys.map((d) => <span key={d}>{d}: <span className="mono" style={{ color: "var(--ink)" }}>{kr(byDel[d])}</span></span>)}
          </div>
        )}
        {hourDelKeys.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted)", marginBottom: 4 }}>Arbetstimmar per del (tidsplan)</div>
            <div className="row" style={{ gap: 16, fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
              {hourDelKeys.map((d) => <span key={d}>{d}: <span className="mono" style={{ color: "var(--ink)" }}>{hFmt(byDelH[d])}</span></span>)}
            </div>
          </div>
        )}
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
        {[["phase", "Fas"], ["del", "Del"], ["room", "Rum"], ["category", "Kategori"], ["ent", "Entreprenör"]].map(([k, l]) => (
          <button key={k} className={"btn small" + (groupBy === k ? " primary" : "")} onClick={() => setGroupBy(k)}>{l}</button>
        ))}
      </div>

      <datalist id="budget-delar">
        {DELAR.map((d) => <option key={d} value={d} />)}
      </datalist>

      {groups.map((g) => {
        const gCur = g.items.reduce((s, it) => s + current(it), 0);
        const gH = g.items.reduce((s, it) => s + hoursOf(it), 0);
        return (
          <div key={g.key} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 600 }}>{g.label}</div>
              <div className="mono" style={{ fontWeight: 700 }}>{kr(gCur)}{gH > 0 && <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}> · {hFmt(gH)}</span>}</div>
            </div>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={th()}>Post</th>
                    {groupBy !== "phase" && <th style={th()}>Fas</th>}
                    {groupBy !== "del" && <th style={th()}>Del</th>}
                    {groupBy !== "room" && <th style={th()}>Rum</th>}
                    {groupBy !== "category" && <th style={th()}>Kat.</th>}
                    {groupBy !== "ent" && <th style={th()}>Entreprenör</th>}
                    <th style={th("right")}>Mängd</th>
                    <th style={th()}>Enhet</th>
                    <th style={th("right")}>Á-pris</th>
                    <th style={th("right")}>Summa</th>
                    {!ro && <th style={{ width: 26 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {renderBody(g)}
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
