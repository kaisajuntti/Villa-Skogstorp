// Pure budget arithmetic, shared by the Budget page, the Projekt summary and the project PDF.
// A row = Material (`mat` lines, or qty × estUnit / estUnit as lump) + Extern (`ext`)
// + Arbete (`work`: yrke × timmar × timpris). Legacy rows (category Arbete, unit timmar)
// count as Snickare hours.
export const DELAR = ["Mark", "Stomme", "Golv", "Dränering", "Yttervägg", "Innervägg", "Trappa", "Fönster", "Dörrar", "Fasad", "Tak", "Golvbeklädnad", "Väggbeklädnad", "VVS", "Ventilation", "El", "Övrigt"];
export const delOrder = (d) => { const i = DELAR.indexOf(d); return i < 0 ? DELAR.length : i; };
export const DEFAULT_RATES = [
  { typ: "Snickare", rate: "580", crew: "3" },
  { typ: "Maskinist", rate: "1000", crew: "1" },
  { typ: "Elektriker", rate: "625", crew: "1" },
  { typ: "VVS", rate: "625", crew: "1" },
];
export const LEGACY_TYP = "Snickare";
export const BUILDS = ["Huvudbostad", "Garage", "Friggebod", "Terrass", "Trädgård"];

export const parseNum = (v) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
// Material line: mängd × á-pris (or á-pris as lump when mängd is blank).
export const lineAmt = (l) => { const q = parseNum(l.qty); return q ? q * parseNum(l.price) : parseNum(l.price); };
export const matLines = (it) => (Array.isArray(it.mat) && it.mat.length ? it.mat : null);
// Material for a row: sum of its material lines (`mat`), else the single qty × estUnit.
export const est = (it) => { const m = matLines(it); if (m) return m.reduce((s, l) => s + lineAmt(l), 0); const q = parseNum(it.qty); return q ? q * parseNum(it.estUnit) : parseNum(it.estUnit); };
export const legacyH = (it) => (it.category === "Arbete" && /tim/i.test(it.unit || "") ? parseNum(it.qty) : 0);

// Working days: Mon–Fri, skipping jullov 22 Dec – 4 Jan.
export const isWork = (d) => { const w = d.getDay(), m = d.getMonth(), day = d.getDate(); return w > 0 && w < 6 && !((m === 11 && day >= 22) || (m === 0 && day <= 4)); };
export const addWorkdays = (start, n) => { const d = new Date(start); while (!isWork(d)) d.setDate(d.getDate() + 1); for (let i = 1; i < n; i++) { d.setDate(d.getDate() + 1); while (!isWork(d)) d.setDate(d.getDate() + 1); } return d; };

// Cost split by building, from the phase name.
export const buildOfName = (n) => (/garage/i.test(n) ? "Garage" : /friggebod/i.test(n) ? "Friggebod" : /terrass/i.test(n) ? "Terrass"
  : /trädgård|gårdsplan/i.test(n) ? "Trädgård" : "Huvudbostad");

// Everything derived from one budget record (space:budget / space:budget2).
export function computeBudget(b) {
  const phases = b?.phases || [];
  const items = b?.items || [];
  const rates = b?.rates?.length ? b.rates : DEFAULT_RATES;
  const typs = rates.map((r) => r.typ);
  const rateOf = (typ) => parseNum(rates.find((r) => r.typ === typ)?.rate);
  const crewOf = (typ) => Math.max(1, parseNum(rates.find((r) => r.typ === typ)?.crew) || 1);
  const workOf = (it) => (Array.isArray(it.work) ? it.work : []);
  const laborCost = (it) => workOf(it).reduce((s, w) => s + parseNum(w.h) * rateOf(w.typ), 0);
  const extOf = (it) => parseNum(it.ext);
  const current = (it) => est(it) + extOf(it) + laborCost(it);
  const hoursByTyp = (it) => {
    const o = {}; const lh = legacyH(it); if (lh) o[LEGACY_TYP] = lh;
    for (const w of workOf(it)) { const h = parseNum(w.h); if (h) o[w.typ] = (o[w.typ] || 0) + h; }
    return o;
  };
  const hoursOf = (it) => Object.values(hoursByTyp(it)).reduce((s, h) => s + h, 0);
  const phaseName = (pid) => phases.find((p) => p.id === pid)?.name || "";

  let total = 0, hours = 0, oklart = 0;
  const byCat = { Material: 0, Extern: 0, Arbete: 0 }, byBuild = {}, byTypH = {}, phaseCost = {}, phaseHrs = {};
  for (const it of items) {
    const c = current(it); total += c;
    if (it.oklart) oklart += c;
    byCat[legacyH(it) ? "Arbete" : "Material"] += est(it);
    byCat.Extern += extOf(it);
    byCat.Arbete += laborCost(it);
    for (const [t, h] of Object.entries(hoursByTyp(it))) byTypH[t] = (byTypH[t] || 0) + h;
    const bld = buildOfName(phaseName(it.phaseId));
    byBuild[bld] = (byBuild[bld] || 0) + c;
    const h = hoursOf(it); hours += h;
    phaseCost[it.phaseId] = (phaseCost[it.phaseId] || 0) + c;
    phaseHrs[it.phaseId] = (phaseHrs[it.phaseId] || 0) + h;
  }

  // Per yrke within each dated phase: works from phase start for ceil(h / (crew × 7)) workdays.
  const dated = phases.filter((p) => p.start && p.end);
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
  const deliveries = [
    ...items.filter((it) => it.leverans).map((it) => ({ date: it.leverans, desc: it.desc, it })),
    ...items.flatMap((it) => (matLines(it) || []).filter((l) => l.leverans).map((l) => ({ date: l.leverans, desc: (l.desc || "Material") + " – " + it.desc, it }))),
  ].map((d) => ({ ...d, t: +new Date(d.date + "T00:00:00") })).sort((a, b) => a.t - b.t);

  // Material totalt: all material lines aggregated by (benämning + enhet).
  const agg = {};
  for (const x of items) {
    if (legacyH(x)) continue;
    const lines = matLines(x) ? matLines(x).map((l) => ({ desc: l.desc || x.desc, unit: l.unit, qty: l.qty, sum: lineAmt(l) }))
      : [{ desc: x.desc, unit: x.unit, qty: x.qty, sum: est(x) }];
    for (const l of lines) {
      if (!l.sum) continue;
      const key = (l.desc || "—").trim() + " | " + (l.unit || "");
      if (!agg[key]) agg[key] = { desc: (l.desc || "—").trim(), unit: l.unit || "", qty: 0, sum: 0 };
      agg[key].qty += parseNum(l.qty); agg[key].sum += l.sum;
    }
  }
  const materials = Object.values(agg).sort((a, b) => b.sum - a.sum);

  return {
    phases, items, rates, typs, rateOf, crewOf, workOf, laborCost, extOf, current, hoursByTyp, hoursOf, phaseName,
    total, hours, oklart, byCat, byBuild, byTypH, phaseCost, phaseHrs, dated, typSegs, typRows, deliveries, materials,
  };
}
