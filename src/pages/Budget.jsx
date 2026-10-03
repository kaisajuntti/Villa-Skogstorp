import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSpace, useRooms } from "../state.js";
import { spaceKey } from "../storage.js";
import { canEdit } from "../config.js";
import VersionHistory from "../components/VersionHistory.jsx";

// Budget lives in its own space record → syncs + versions like the rest.
// Etapp 1 (huset, fram till inflytt) = space:budget · Etapp 2 (efter inflytt) = space:budget2.
// Shape: { phases: [{id,name,start,end}], items: [{id,desc,phaseId,roomId,category,entreprenor,del,qty,unit,estUnit}] }
// One value per row: belopp = mängd × á-pris (estUnit), or estUnit as a lump sum when qty is blank.
const DEFAULT_PHASES = [
  "Markarbeten", "Rivning", "Grund tillbyggnad / källare", "Tillbyggnad",
  "Renovering befintlig", "Takomläggning befintligt", "Terrass (utomhus)", "Friggebod", "Garage",
];
// A row = Material (qty × estUnit, or estUnit as lump) + Extern (`ext`, UE/tjänst lump)
// + Arbete (`work`: yrken × timmar × timpris). `category` is legacy and no longer used.
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
// Legacy labour rows (category Arbete, unit "timmar", á-pris = kr/h) count as Snickare hours.
const legacyH = (it) => (it.category === "Arbete" && /tim/i.test(it.unit || "") ? parseNum(it.qty) : 0);
const hFmt = (h) => (Math.round(h) + " h");
// Yrken: timpris + bemanning (antal personer). Stored on the record as `rates`.
const DEFAULT_RATES = [
  { typ: "Snickare", rate: "580", crew: "3" },
  { typ: "Maskinist", rate: "1000", crew: "1" },
  { typ: "Elektriker", rate: "625", crew: "1" },
  { typ: "VVS", rate: "625", crew: "1" },
];
const LEGACY_TYP = "Snickare";
// Working days: Mon–Fri, skipping jullov 22 Dec – 4 Jan.
const isWork = (d) => { const w = d.getDay(), m = d.getMonth(), day = d.getDate(); return w > 0 && w < 6 && !((m === 11 && day >= 22) || (m === 0 && day <= 4)); };
const addWorkdays = (start, n) => { const d = new Date(start); while (!isWork(d)) d.setDate(d.getDate() + 1); for (let i = 1; i < n; i++) { d.setDate(d.getDate() + 1); while (!isWork(d)) d.setDate(d.getDate() + 1); } return d; };
const TYP_COLORS = ["#5A7A8C", "#8C6A3F", "#5E8C5A", "#9a4a3a", "#7A5A8C", "#3F7F8C", "#8C8C3F"];

const cell = { padding: "4px 6px", fontSize: 12.5 };
const OKLART_BG = "#FBF3E4";
const TAG = { fontSize: 11, padding: "1px 5px", border: "1px solid var(--line)", borderRadius: 10, background: "#fff", fontFamily: "inherit", color: "var(--ink)", minHeight: 0 };
const TAG_EMPTY = { borderColor: "#c9a08f", background: "#fbefe9" };
const OKLART_TAG = { display: "inline-block", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: "#9a4a3a", border: "1px solid #9a4a3a", borderRadius: 4, padding: "0 4px", marginBottom: 3 };

// Description cell: a textarea that wraps long text and grows to fit it (instead of a
// one-line input that cuts the text off). Enter doesn't add line breaks.
function AutoText({ value, onChange, placeholder }) {
  const ref = useRef(null);
  const fit = () => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea ref={ref} rows={1} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      style={{ ...cell, minWidth: 185, width: "100%", minHeight: 0, resize: "none", overflow: "hidden", lineHeight: 1.35, display: "block" }} />
  );
}
const sel = { ...cell, border: "1.5px solid var(--ink)", borderRadius: 7, background: "#fff", fontFamily: "inherit" };
const th = (align = "left") => ({ padding: "4px 6px", fontWeight: 600, whiteSpace: "nowrap", textAlign: align, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)" });
const td = (align = "left") => ({ padding: "3px 4px", verticalAlign: "middle", textAlign: align });

// Arbete per rad: flera yrken, var och ett med timmar.
function WorkCell({ work, typs, ro, onChange }) {
  const list = work || [];
  if (ro) return <span style={{ whiteSpace: "nowrap" }}>{list.length ? list.map((w) => w.typ + " " + (w.h || 0) + " h").join(" · ") : "—"}</span>;
  const set = (i, p) => onChange(list.map((w, j) => (j === i ? { ...w, ...p } : w)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 140 }}>
      {list.map((w, i) => (
        <div key={i} style={{ display: "flex", gap: 3, alignItems: "center" }}>
          <select value={w.typ} onChange={(e) => set(i, { typ: e.target.value })} style={{ ...sel, padding: "3px 2px", maxWidth: 86 }}>
            {typs.map((t) => <option key={t} value={t}>{t}</option>)}
            {!typs.includes(w.typ) && <option value={w.typ}>{w.typ}</option>}
          </select>
          <input type="text" inputMode="decimal" value={w.h ?? ""} onChange={(e) => set(i, { h: e.target.value })} style={{ ...cell, width: 40, textAlign: "right", padding: "3px 4px" }} />
          <span style={{ color: "var(--muted)", fontSize: 11 }}>h</span>
          <button className="btn small" style={{ padding: "0 5px", border: "none" }} title="Ta bort" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn small" style={{ padding: "1px 6px", alignSelf: "flex-start", fontSize: 11 }} onClick={() => onChange([...list, { typ: typs[0] || "Snickare", h: "" }])}>+ yrke</button>
    </div>
  );
}

const ETAPPER = [
  { id: "budget", href: "#/budget", label: "Etapp 1 – huset (till inflytt)" },
  { id: "budget2", href: "#/budget/etapp2", label: "Etapp 2 – efter inflytt" },
];

export default function Budget({ id = "budget" }) {
  const ro = !canEdit();
  const [space, update] = useSpace(id);
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
  const rates = space.rates && space.rates.length ? space.rates : DEFAULT_RATES;
  const typs = rates.map((r) => r.typ);
  const rateOf = (typ) => parseNum(rates.find((r) => r.typ === typ)?.rate);
  const crewOf = (typ) => Math.max(1, parseNum(rates.find((r) => r.typ === typ)?.crew) || 1);
  const setRates = (next) => update({ rates: next });
  // Per row: material/UE part (mängd × á-pris) + arbete (yrke × timmar × timpris).
  const workOf = (it) => (Array.isArray(it.work) ? it.work : []);
  const laborCost = (it) => workOf(it).reduce((s, w) => s + parseNum(w.h) * rateOf(w.typ), 0);
  const extOf = (it) => parseNum(it.ext);
  const current = (it) => est(it) + extOf(it) + laborCost(it);
  const hoursOf = (it) => legacyH(it) + workOf(it).reduce((s, w) => s + parseNum(w.h), 0);
  const hoursByTyp = (it) => {
    const o = {}; const lh = legacyH(it); if (lh) o[LEGACY_TYP] = lh;
    for (const w of workOf(it)) { const h = parseNum(w.h); if (h) o[w.typ] = (o[w.typ] || 0) + h; }
    return o;
  };
  // "Maskinist 56 h · Snickare 52 h" for a set of rows
  const typSummary = (arr) => {
    const o = {};
    for (const it of arr) for (const [t, h] of Object.entries(hoursByTyp(it))) o[t] = (o[t] || 0) + h;
    const keys = [...typs.filter((t) => o[t]), ...Object.keys(o).filter((t) => !typs.includes(t))];
    return keys.map((t) => t + " " + hFmt(o[t])).join(" · ");
  };
  const fmtD = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" }).replace(".", "");
  const phaseWhen = (p) => (p && p.start && p.end ? fmtD(p.start) + " – " + fmtD(p.end) + " " + p.end.slice(0, 4) : "");
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
    id: uid(), desc: "", phaseId: phases[0]?.id || "", roomId: "",
    entreprenor: "Pelle", del: "", qty: "", unit: "", estUnit: "", ext: "", work: [], ...preset,
  }]);

  // ---- totals ----
  // Cost split by building, from the phase name (Garage / Friggebod / Terrass / Trädgård+gårdsplan, else Huvudbostad).
  const phaseName = (pid) => phases.find((p) => p.id === pid)?.name || "";
  const buildOf = (pid) => {
    const n = phaseName(pid);
    return /garage/i.test(n) ? "Garage" : /friggebod/i.test(n) ? "Friggebod" : /terrass/i.test(n) ? "Terrass"
      : /trädgård|gårdsplan/i.test(n) ? "Trädgård" : "Huvudbostad";
  };
  let sumCur = 0, sumHours = 0, sumOklart = 0; const byCat = {}; const byDel = {}; const byDelH = {}; const byBuild = {}; const byTypH = {};
  for (const it of items) {
    const c = current(it); sumCur += c;
    if (it.oklart) sumOklart += c;
    // Material = mängd × á-pris · Extern = UE/tjänst-belopp · Arbete = yrken × timmar (+ ev. gamla arbetsrader)
    byCat[legacyH(it) ? "Arbete" : "Material"] = (byCat[legacyH(it) ? "Arbete" : "Material"] || 0) + est(it);
    byCat["Extern"] = (byCat["Extern"] || 0) + extOf(it);
    if (laborCost(it)) byCat["Arbete"] = (byCat["Arbete"] || 0) + laborCost(it);
    for (const [t, h] of Object.entries(hoursByTyp(it))) byTypH[t] = (byTypH[t] || 0) + h;
    byBuild[buildOf(it.phaseId)] = (byBuild[buildOf(it.phaseId)] || 0) + c;
    const h = hoursOf(it); sumHours += h;
    const d = (it.del || "").trim();
    if (d) { byDel[d] = (byDel[d] || 0) + c; if (h) byDelH[d] = (byDelH[d] || 0) + h; }
  }
  const delKeys = Object.keys(byDel).sort((a, b) => (delOrder(a) - delOrder(b)) || a.localeCompare(b, "sv"));
  const hourDelKeys = Object.keys(byDelH).sort((a, b) => (delOrder(a) - delOrder(b)) || a.localeCompare(b, "sv"));
  // per-phase cost + labour hours (for the time plan)
  const phaseCost = {}; const phaseHrs = {};
  for (const it of items) { phaseCost[it.phaseId] = (phaseCost[it.phaseId] || 0) + current(it); phaseHrs[it.phaseId] = (phaseHrs[it.phaseId] || 0) + hoursOf(it); }
  const BUILDS = ["Huvudbostad", "Garage", "Friggebod", "Terrass", "Trädgård"];

  // ---- grouping ----
  const phaseIds = new Set(phases.map((p) => p.id));
  let groups;
  if (groupBy === "del") {
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
    if (none.length || !names.length) groups.push({ key: "_none", label: "Ej angiven ansvarig", preset: { entreprenor: "" }, items: none });
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

  // ---- gantt: per yrke + leveranser ----
  const dated = phases.filter((p) => p.start && p.end);
  // Each yrke works in a phase from its start for ceil(h / (bemanning × 7)) working days.
  // A bar that runs past the phase end (red) means that yrke is the bottleneck.
  const typSegs = {};
  for (const p of dated) {
    const ph = {};
    for (const it of items) if (it.phaseId === p.id) for (const [t, h] of Object.entries(hoursByTyp(it))) ph[t] = (ph[t] || 0) + h;
    for (const [t, h] of Object.entries(ph)) {
      const days = Math.ceil(h / (crewOf(t) * 7));
      const end = addWorkdays(p.start + "T00:00:00", days);
      (typSegs[t] = typSegs[t] || []).push({ phase: p, h, days, start: +new Date(p.start + "T00:00:00"), end: +end, over: +end > +new Date(p.end + "T23:59:59") });
    }
  }
  const typRows = [...typs.filter((t) => typSegs[t]), ...Object.keys(typSegs).filter((t) => !typs.includes(t))];
  const deliveries = items.filter((it) => it.leverans).map((it) => ({ t: +new Date(it.leverans + "T00:00:00"), it })).sort((a, b) => a.t - b.t);
  const allT = [...dated.flatMap((p) => [+new Date(p.start), +new Date(p.end)]), ...Object.values(typSegs).flat().map((x) => x.end), ...deliveries.map((d) => d.t)];
  const minT = allT.length ? Math.min(...allT) : 0;
  const maxT = allT.length ? Math.max(...allT) : 0;
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

  const NCOLS = 13 - ["phase", "ent"].filter((k) => k === groupBy).length - (ro ? 1 : 0);

  // One item row — shared by the flat and the del-clustered rendering.
  const renderRow = (it) => (
    <tr key={it.id} style={{ borderTop: "1px solid var(--line)", background: it.oklart ? OKLART_BG : undefined }}>
      <td style={{ ...td(), minWidth: 200, whiteSpace: "normal" }}>
        {it.oklart && <span style={OKLART_TAG}>OKLART</span>}
        {ro ? (it.desc || "—") : <AutoText value={it.desc} placeholder="Beskrivning" onChange={(v) => patchItem(it.id, { desc: v })} />}
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 3, fontSize: 11 }}>
          {ro ? <span style={{ color: it.del ? "var(--ink)" : "var(--muted)" }}>{it.del || "—"}</span> : (
            <input type="text" list="budget-delar" value={it.del || ""} placeholder="+ del" title="Del/byggdel"
              onChange={(e) => patchItem(it.id, { del: e.target.value })} style={{ ...TAG, width: 86, ...(it.del ? {} : TAG_EMPTY) }} />
          )}
          <span style={{ color: "var(--muted)" }}>·</span>
          {ro ? <span style={{ color: it.roomId ? "var(--ink)" : "var(--muted)" }}>{roomName(it.roomId)}</span> : (
            <select value={it.roomId || ""} title="Rum" onChange={(e) => patchItem(it.id, { roomId: e.target.value })} style={{ ...TAG, maxWidth: 120, color: it.roomId ? "var(--ink)" : "var(--muted)" }}>
              <option value="">{OVERGRIP}</option>
              {(rooms || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
        </div>
      </td>
      {groupBy !== "phase" && <td style={td()}>{ro ? (phases.find((p) => p.id === it.phaseId)?.name || "—") : (
        <select value={it.phaseId || ""} onChange={(e) => patchItem(it.id, { phaseId: e.target.value })} style={{ ...sel, maxWidth: 120 }}>
          <option value="">—</option>
          {phases.map((p, i) => <option key={p.id} value={p.id}>{i + 1}. {p.name}</option>)}
        </select>)}</td>}
      {groupBy !== "ent" && <td style={td()}>{ro ? (it.entreprenor || "—") : <input type="text" value={it.entreprenor || ""} placeholder="t.ex. Pelle" title={it.entreprenor || ""} onChange={(e) => patchItem(it.id, { entreprenor: e.target.value })} style={{ ...cell, width: 80 }} />}</td>}
      <td style={{ ...td("right"), borderLeft: "1px solid var(--line)" }}>{ro ? it.qty : <input type="text" inputMode="decimal" value={it.qty} onChange={(e) => patchItem(it.id, { qty: e.target.value })} style={{ ...cell, width: 48, textAlign: "right" }} />}</td>
      <td style={td()}>{ro ? it.unit : <input type="text" value={it.unit} placeholder="m²…" onChange={(e) => patchItem(it.id, { unit: e.target.value })} style={{ ...cell, width: 46 }} />}</td>
      <td style={td("right")}>{ro ? it.estUnit : <input type="text" inputMode="decimal" value={it.estUnit} onChange={(e) => patchItem(it.id, { estUnit: e.target.value })} style={{ ...cell, width: 64, textAlign: "right" }} />}</td>
      <td style={{ ...td("right"), borderLeft: "1px solid var(--line)" }}>{ro ? (it.ext ? kr(extOf(it)) : "—") : <input type="text" inputMode="decimal" value={it.ext || ""} placeholder="kr" title="Extern: UE/tjänst, fast pris" onChange={(e) => patchItem(it.id, { ext: e.target.value })} style={{ ...cell, width: 70, textAlign: "right" }} />}</td>
      <td style={{ ...td(), borderLeft: "1px solid var(--line)" }}><WorkCell work={it.work} typs={typs} ro={ro} onChange={(w) => patchItem(it.id, { work: w })} /></td>
      <td style={td()}>{ro ? (it.leverans || "—") : <input type="date" value={it.leverans || ""} title="Datum för materialleverans (extern leverans)" onChange={(e) => patchItem(it.id, { leverans: e.target.value })} style={{ ...sel, padding: "3px 1px", width: 98, fontSize: 11 }} />}</td>
      <td style={{ ...td("center"), padding: "3px 2px" }}>{ro ? (it.oklart ? "✓" : "") : <input type="checkbox" checked={!!it.oklart} title="Oklart om posten behövs" onChange={(e) => patchItem(it.id, { oklart: e.target.checked })} />}</td>
      <td style={{ ...td("right"), fontFamily: "var(--mono)", whiteSpace: "nowrap", fontWeight: 600 }} title={"Material " + kr(est(it)) + " + extern " + kr(extOf(it)) + " + arbete " + kr(laborCost(it))}>{kr(current(it))}</td>
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
          {g.items.length === 0 && <tr><td colSpan={NCOLS} style={{ ...td(), color: "var(--muted)", fontStyle: "italic" }}>Inga poster.</td></tr>}
        </>
      );
    }
    // Per fas: behåll radernas ordning (kronologisk) – ny underrubrik varje gång del byter.
    // Övriga vyer: klustra per del i DELAR-ordning.
    let runs;
    if (groupBy === "phase") {
      runs = [];
      for (const it of g.items) { const d = (it.del || "").trim(); const last = runs[runs.length - 1]; if (last && last.k === d) last.arr.push(it); else runs.push({ k: d, arr: [it] }); }
    } else {
      const map = new Map();
      for (const it of g.items) { const d = (it.del || "").trim(); if (!map.has(d)) map.set(d, []); map.get(d).push(it); }
      runs = [...map.keys()].sort((a, b) => {
        if (a === "") return 1; if (b === "") return -1;
        return (delOrder(a) - delOrder(b)) || a.localeCompare(b, "sv");
      }).map((k) => ({ k, arr: map.get(k) }));
    }
    return runs.map(({ k, arr }, ri) => {
      const cCur = arr.reduce((s, it) => s + current(it), 0);
      const cH = arr.reduce((s, it) => s + hoursOf(it), 0);
      return (
        <Fragment key={ri + ":" + (k || "_none")}>
          <tr>
            <td colSpan={NCOLS} style={{ padding: "6px 6px 4px", background: "var(--line)", borderTop: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.5 }}>{k || NODEL}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>{kr(cCur)}{cH > 0 && <span style={{ color: "var(--muted)" }}> · {typSummary(arr)}</span>}</span>
              </div>
            </td>
          </tr>
          {arr.map(renderRow)}
        </Fragment>
      );
    });
  };

  return (
    <div className="page wide">
      <h1>BUDGET &amp; TIDSPLAN</h1>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        {ETAPPER.map((e) => (
          <a key={e.id} href={e.href} className={"btn small" + (e.id === id ? " primary" : "")}>{e.label}</a>
        ))}
      </div>
      <p className="sub">Varje post = Material (det ni köper: mängd × á-pris, eller á-pris som klumpsumma) + Extern (UE/tjänst – någon annan gör det till fast pris) + Arbete (ett eller flera yrken × timmar × timpris). Ansvarig = vem som ansvarar (oftast Pelle). Markera "Oklart" om det är osäkert om posten behövs. Datum för materialleverans (extern leverans, t.ex. fönster) visas i tidslinjen. Alla priser ex moms.</p>

      {/* summary */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Total</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{kr(sumCur)}</div>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 18, fontSize: 12.5, color: "var(--muted)" }}>
          <span>Material: <span className="mono" style={{ color: "var(--ink)" }}>{kr(byCat["Material"] || 0)}</span></span>
          <span>Extern (UE/tjänster): <span className="mono" style={{ color: "var(--ink)" }}>{kr(byCat["Extern"] || 0)}</span></span>
          <span>Arbete (egna hantverkare): <span className="mono" style={{ color: "var(--ink)" }}>{kr(byCat["Arbete"] || 0)}</span></span>
        </div>
        {sumOklart !== 0 && (
          <div style={{ marginTop: 6, fontSize: 12.5, color: "#9a4a3a" }}>varav oklart: <span className="mono">{kr(sumOklart)}</span></div>
        )}
        <div className="row" style={{ marginTop: 6, gap: 18, fontSize: 12.5, color: "var(--muted)", flexWrap: "wrap" }}>
          {Object.entries(byTypH).map(([t, h]) => (
            <span key={t}>{t}: <span className="mono" style={{ color: "var(--ink)" }}>{hFmt(h)}</span></span>
          ))}
        </div>
        <div className="row" style={{ marginTop: 6, gap: 18, fontSize: 12.5, color: "var(--muted)", flexWrap: "wrap" }}>
          {BUILDS.filter((buildName) => byBuild[buildName]).map((buildName) => (
            <span key={buildName}>{buildName}: <span className="mono" style={{ color: "var(--ink)" }}>{kr(byBuild[buildName])}</span></span>
          ))}
        </div>
      </div>

      {/* yrken: timpris + bemanning */}
      <h2>Yrken – timpris &amp; bemanning</h2>
      <div className="card" style={{ marginBottom: 18 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr><th style={th()}>Yrke</th><th style={th("right")}>kr/h</th><th style={th("right")}>Personer</th><th style={th("right")}>Timmar</th>{!ro && <th></th>}</tr></thead>
          <tbody>
            {rates.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={td()}>{ro ? r.typ : <input type="text" value={r.typ} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, typ: e.target.value } : x)))} style={{ ...cell, width: 120 }} />}</td>
                <td style={td("right")}>{ro ? r.rate : <input type="text" inputMode="decimal" value={r.rate} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} style={{ ...cell, width: 64, textAlign: "right" }} />}</td>
                <td style={td("right")}>{ro ? r.crew : <input type="text" inputMode="decimal" value={r.crew} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, crew: e.target.value } : x)))} style={{ ...cell, width: 44, textAlign: "right" }} />}</td>
                <td style={{ ...td("right"), fontFamily: "var(--mono)" }}>{hFmt(byTypH[r.typ] || 0)}</td>
                {!ro && <td style={td()}><button className="btn small danger" style={{ padding: "2px 6px" }} onClick={() => setRates(rates.filter((_, j) => j !== i))}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!ro && <button className="btn small" style={{ marginTop: 6 }} onClick={() => setRates([...rates, { typ: "Nytt yrke", rate: "", crew: "1" }])}>+ Yrke</button>}
        <p className="sub" style={{ margin: "8px 0 0" }}>Gamla arbetsrader (kategori Arbete, enhet timmar) räknas som {LEGACY_TYP}. Arbetsdag = 7 h per person (mot normala 8 h ≈ 10 % slack inbakat i tidsplanen).</p>
      </div>

      {/* phases + timeline */}
      <h2>Faser &amp; tidsplan</h2>
      <div className="card" style={{ marginBottom: 18 }}>
        {phases.map((p, i) => (
          <div key={p.id} className="row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
            <span className="mono" style={{ color: "var(--muted)", width: 16 }}>{i + 1}</span>
            {ro ? <div style={{ flex: "1 1 180px", fontWeight: 600 }}>{p.name}</div>
              : <input type="text" value={p.name} onChange={(e) => patchPhase(p.id, { name: e.target.value })} style={{ flex: "1 1 180px", fontWeight: 600 }} />}
            <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", minWidth: 150, textAlign: "right" }}>
              {kr(phaseCost[p.id] || 0)}{phaseHrs[p.id] ? " · " + hFmt(phaseHrs[p.id]) : ""}
            </span>
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
        <div className="row" style={{ gap: 16, marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--line)", fontSize: 12.5, fontWeight: 600, flexWrap: "wrap" }}>
          <span>Totalt:</span>
          <span className="mono">{kr(sumCur)}</span>
          <span className="mono">{hFmt(sumHours)} arbete</span>
          <span style={{ fontWeight: 400, color: "var(--muted)" }}>≈ {Math.ceil(sumHours / 105)} veckor (3 pers × 35 h/v) · ~{Math.round(sumHours / 21)} arbetsdagar</span>
        </div>
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
              {typRows.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 6, borderTop: "1px dashed var(--line)" }}>
                  <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 2 }}>Per yrke</div>
                  {typRows.map((t, k) => (
                    <div key={t} style={{ display: "flex", alignItems: "center", height: 22 }}>
                      <div style={{ width: LABELW, fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 6 }}>{t} <span style={{ color: "var(--muted)" }}>({crewOf(t)})</span></div>
                      <div style={{ position: "relative", flex: 1, height: 12, background: "var(--line)", borderRadius: 4 }}>
                        {typSegs[t].map((sg, j) => (
                          <div key={j} title={t + " · " + sg.phase.name + ": " + Math.round(sg.h) + " h ≈ " + sg.days + " dagar" + (sg.over ? " – längre än fasen!" : "")}
                            style={{ position: "absolute", left: ((sg.start - minT) / span) * 100 + "%", width: Math.max(0.6, ((sg.end - sg.start) / span) * 100) + "%", height: "100%", background: sg.over ? "#9a4a3a" : TYP_COLORS[k % TYP_COLORS.length], borderRadius: 3, opacity: 0.9, borderRight: "1px solid #fff" }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {deliveries.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", height: 22, marginTop: 4 }}>
                  <div style={{ width: LABELW, fontSize: 11.5, paddingRight: 6 }}>Materialleveranser</div>
                  <div style={{ position: "relative", flex: 1, height: 14 }}>
                    {deliveries.map((d, j) => (
                      <div key={j} title={d.it.leverans + ": " + d.it.desc} style={{ position: "absolute", left: ((d.t - minT) / span) * 100 + "%", top: 1, width: 10, height: 10, background: "var(--ink)", transform: "translateX(-5px) rotate(45deg)" }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {deliveries.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Materialleveranser</div>
            {deliveries.map((d, j) => (
              <div key={j} style={{ display: "flex", gap: 10, borderTop: "1px solid var(--line)", padding: "3px 0" }}>
                <span className="mono" style={{ whiteSpace: "nowrap" }}>{d.it.leverans}</span>
                <span>{d.it.desc}</span>
                <span style={{ marginLeft: "auto", color: "var(--muted)", whiteSpace: "nowrap" }}>{phaseName(d.it.phaseId)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* items */}
      <h2>Poster</h2>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <span className="sub" style={{ margin: 0 }}>Visa efter:</span>
        {[["phase", "Fas"], ["del", "Del"], ["room", "Rum"], ["ent", "Ansvarig"], ["material", "Material totalt"]].map(([k, l]) => (
          <button key={k} className={"btn small" + (groupBy === k ? " primary" : "")} onClick={() => setGroupBy(k)}>{l}</button>
        ))}
      </div>

      <datalist id="budget-delar">
        {DELAR.map((d) => <option key={d} value={d} />)}
      </datalist>

      {groupBy === "material" && (() => {
        // Aggregate all Material rows by (desc + unit) across every room/phase.
        const agg = {};
        for (const it of items) {
          if (!est(it) || legacyH(it)) continue;
          const key = (it.desc || "—").trim() + " | " + (it.unit || "");
          if (!agg[key]) agg[key] = { desc: (it.desc || "—").trim(), unit: it.unit || "", qty: 0, sum: 0 };
          agg[key].qty += parseNum(it.qty); agg[key].sum += est(it);
        }
        const rowsA = Object.values(agg).sort((a, b) => b.sum - a.sum);
        const matTot = rowsA.reduce((s, r) => s + r.sum, 0);
        return (
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 600 }}>Material totalt (över alla rum &amp; faser)</div>
              <div className="mono" style={{ fontWeight: 700 }}>{kr(matTot)}</div>
            </div>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: 12.5 }}>
                <thead><tr>
                  <th style={th()}>Material</th>
                  <th style={th("right")}>Total mängd</th>
                  <th style={th()}>Enhet</th>
                  <th style={th("right")}>Summa</th>
                </tr></thead>
                <tbody>
                  {rowsA.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={td()}>{r.desc}</td>
                      <td style={{ ...td("right"), fontFamily: "var(--mono)" }}>{r.qty ? new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 }).format(r.qty) : "—"}</td>
                      <td style={td()}>{r.unit}</td>
                      <td style={{ ...td("right"), fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>{kr(r.sum)}</td>
                    </tr>
                  ))}
                  {rowsA.length === 0 && <tr><td colSpan={4} style={{ ...td(), color: "var(--muted)", fontStyle: "italic" }}>Inga materialrader.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="sub" style={{ margin: "8px 0 0" }}>Lika materialrader (samma benämning + enhet) summeras oavsett rum/fas. Kompositrader (t.ex. "Yttervägg: regel + isolering + gips") summeras som helhet.</p>
          </div>
        );
      })()}

      {groupBy !== "material" && groups.map((g) => {
        const gCur = g.items.reduce((s, it) => s + current(it), 0);
        const gH = g.items.reduce((s, it) => s + hoursOf(it), 0);
        return (
          <div key={g.key} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 600 }}>{g.label}</div>
              <div className="mono" style={{ fontWeight: 700 }}>{kr(gCur)}</div>
            </div>
            {(() => {
              const when = groupBy === "phase" ? phaseWhen(phases.find((p) => p.id === g.key)) : "";
              const who = gH > 0 ? typSummary(g.items) : "";
              return (when || who) ? (
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, marginTop: 3 }}>
                  {when && <span><span style={{ color: "var(--muted)" }}>När: </span><b>{when}</b></span>}
                  {who && <span><span style={{ color: "var(--muted)" }}>Arbete: </span><span className="mono">{who}</span></span>}
                </div>
              ) : null;
            })()}
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1080, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={th()}>Post</th>
                    {groupBy !== "phase" && <th style={th()}>Fas</th>}
                    {groupBy !== "ent" && <th style={th()}>Ansvarig</th>}
                    <th colSpan={3} style={{ ...th("center"), borderLeft: "1px solid var(--line)" }} title="Det ni köper: mängd × á-pris (eller á-pris som klumpsumma)">Material <span style={{ fontWeight: 400, textTransform: "none" }}>(mängd · enhet · á-pris)</span></th>
                    <th style={{ ...th("right"), borderLeft: "1px solid var(--line)" }} title="UE/tjänst – någon annan gör det eller tar betalt, fast pris">Extern</th>
                    <th style={{ ...th(), borderLeft: "1px solid var(--line)" }} title="Egna hantverkare: yrke × timmar">Arbete</th>
                    <th style={{ ...th(), whiteSpace: "normal", lineHeight: 1.15 }}>Material&shy;leverans</th>
                    <th style={{ ...th("center"), padding: "4px 2px" }} title="Oklart om posten behövs">?</th>
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

      <VersionHistory storageKey={spaceKey(id)} />
    </div>
  );
}
