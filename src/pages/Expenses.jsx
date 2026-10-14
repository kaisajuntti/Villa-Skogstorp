// Utgifter: register invoices/receipts as they come, with the file attached (private bucket vs-docs),
// and follow them up against the budget per fas and byggdel.
// Record space:expenses = { items: [{ id, date, supplier, what, amount (inkl. moms), vat?, paidBy,
//   status: "Obetald"|"Betald", due, etapp: "budget"|"budget2", phaseId, part, files:[{path,name,type,size}], note }] }
// amount is what the invoice says (inkl. moms); exkl. = amount − vat, vat defaults to 20 % of amount (= 25 % on exkl.).
import { useMemo, useRef, useState } from "react";
import { useSpace } from "../state.js";
import { canEdit } from "../config.js";
import { uploadDoc, signedDocUrl, deleteDoc } from "../photos.js";
import { computeBudget, parseNum, PARTS, PART_SHORT } from "../budgetCalc.js";

const PAYERS = ["Pelle", "Linus", "Emma"];
const STATUS = ["Obetald", "Betald"];
const SUPPLIERS = ["Olle Svenssons Bygg", "Beijer Bygg", "Snickarglädje", "Ballingslöv", "Elektriker", "VVS", "Plåtslagare", "Borrfirma", "Karlshamns kommun"];
const ETAPP = { budget: "Etapp 1", budget2: "Etapp 2" };
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);
const vatOf = (e) => (String(e.vat ?? "").trim() !== "" ? parseNum(e.vat) : parseNum(e.amount) * 0.2);
const exOf = (e) => parseNum(e.amount) - vatOf(e);
const muted = { color: "var(--muted)", fontSize: 12.5 };
const lbl = { fontSize: 12 };
const cap = { margin: "0 0 3px", fontSize: 11.5, color: "var(--muted)" };

export default function Expenses() {
  const ro = !canEdit();
  const [space, update] = useSpace("expenses");
  const [b1] = useSpace("budget");
  const [b2] = useSpace("budget2");
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ status: "", payer: "", phase: "", part: "", q: "" });
  const [moms, setMoms] = useState(() => { try { return localStorage.getItem("vs:v1:ui:moms") === "1"; } catch { return false; } });
  const setMomsPersist = (v) => { setMoms(v); try { localStorage.setItem("vs:v1:ui:moms", v ? "1" : "0"); } catch { /* ignore */ } };
  const [busy, setBusy] = useState(null);
  const fileRef = useRef({});

  const budgets = useMemo(() => ({ budget: b1 ? computeBudget(b1) : null, budget2: b2 ? computeBudget(b2) : null }), [b1, b2]);
  if (!space) return <div className="page"><p className="sub">Laddar …</p></div>;

  const items = space.items || [];
  const set = (next) => update({ items: next });
  const patch = (id, p) => set(items.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const add = () => {
    const e = { id: rid(), date: today(), supplier: "", what: "", amount: "", paidBy: "Pelle", status: "Obetald", due: "", etapp: "budget", phaseId: "", part: "", files: [], note: "" };
    set([e, ...items]); setOpen(e.id);
  };
  const remove = (e) => {
    if (!confirm("Ta bort utgiften " + (e.supplier || "") + " " + (e.what || "") + "? Bifogade filer raderas.")) return;
    (e.files || []).forEach((x) => deleteDoc(x.path));
    set(items.filter((x) => x.id !== e.id)); setOpen(null);
  };
  const upload = async (e, files) => {
    setBusy(e.id);
    try {
      const added = [];
      for (const file of files) { const r = await uploadDoc(file); added.push({ ...r, name: file.name || "fil" }); }
      patch(e.id, { files: [...(e.files || []), ...added] });
    } catch (err) { alert(err.message); }
    setBusy(null);
  };
  const openFile = async (x) => { const w = window.open("", "_blank"); try { const u = await signedDocUrl(x.path); if (w) w.location = u; else window.location = u; } catch (err) { w?.close(); alert(err.message); } };
  const removeFile = (e, k) => { if (!confirm("Ta bort filen?")) return; deleteDoc(e.files[k].path); patch(e.id, { files: e.files.filter((_, j) => j !== k) }); };

  const shown = (e) => (moms ? parseNum(e.amount) : exOf(e));
  const kr = (n) => new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(Math.round(n)) + " kr";
  const bud = (n) => n * (moms ? 1.25 : 1); // budget is stored exkl. moms
  const phaseName = (e) => budgets[e.etapp || "budget"]?.phases.find((p) => p.id === e.phaseId)?.name || "";
  const overdue = (e) => e.status !== "Betald" && e.due && e.due < today();

  // ---- filter + sort ----
  const q = f.q.trim().toLowerCase();
  const list = items.filter((e) =>
    (!f.status || (e.status || "Obetald") === f.status) && (!f.payer || e.paidBy === f.payer) &&
    (!f.phase || (e.etapp || "budget") + ":" + e.phaseId === f.phase) && (!f.part || (e.part || "") === f.part) &&
    (!q || [e.supplier, e.what, e.note].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => (overdue(b) - overdue(a)) || ((a.status === "Betald") - (b.status === "Betald")) || String(b.date).localeCompare(String(a.date)));

  // ---- summary ----
  const sum = (arr) => arr.reduce((s, e) => s + shown(e), 0);
  const unpaid = items.filter((e) => e.status !== "Betald");
  const byPayer = PAYERS.map((p) => [p, sum(items.filter((e) => e.paidBy === p))]).filter(([, v]) => v);
  const phaseRows = [];
  for (const et of ["budget", "budget2"]) {
    const B = budgets[et]; if (!B) continue;
    for (const p of B.phases) {
      const spent = sum(items.filter((e) => (e.etapp || "budget") === et && e.phaseId === p.id));
      if (spent) phaseRows.push({ key: et + p.id, label: ETAPP[et] + " · " + p.name, budget: bud(B.phaseCost[p.id] || 0), spent });
    }
  }
  const noPhase = sum(items.filter((e) => !e.phaseId));
  const partBudget = (k) => ["budget", "budget2"].reduce((s, et) => { const sp = budgets[et]?.split?.[k]; return s + (sp ? Object.values(sp).reduce((a, o) => a + o.Material + o.Extern + o.Arbete, 0) : 0); }, 0);
  const partRows = [...PARTS, ["", "Ej angiven byggdel"]].map(([k, label]) => ({ k, label, budget: k ? bud(partBudget(k)) : 0, spent: sum(items.filter((e) => (e.part || "") === k)) })).filter((r) => r.spent || (r.k && r.budget));
  const totBudget = bud((budgets.budget?.total || 0) + (budgets.budget2?.total || 0));

  const Bar = ({ spent, budget }) => {
    const pct = budget ? spent / budget : 0;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, height: 7, background: "var(--line)", borderRadius: 4, minWidth: 60 }}>
          <div style={{ width: Math.min(100, pct * 100) + "%", height: "100%", borderRadius: 4, background: pct > 1 ? "#9a4a3a" : "var(--blue)" }} />
        </div>
        <span className="mono" style={{ fontSize: 11, width: 38, textAlign: "right", color: pct > 1 ? "#9a4a3a" : "var(--muted)" }}>{budget ? Math.round(pct * 100) + " %" : "–"}</span>
      </div>
    );
  };
  const th = { textAlign: "left", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)", padding: "4px 6px", fontWeight: 600 };
  const td = { padding: "4px 6px", fontSize: 12.5, borderTop: "1px solid var(--line)" };
  const sel = { width: "auto", padding: "4px 6px", fontSize: 12.5 };
  const allPhases = ["budget", "budget2"].flatMap((et) => (budgets[et]?.phases || []).map((p, i) => ({ v: et + ":" + p.id, et, id: p.id, label: (i + 1) + ". " + p.name })));

  return (
    <div className="page wide">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h1>UTGIFTER</h1>
        <div className="row" style={{ gap: 0 }} title="Fakturabeloppet skrivs alltid in inkl. moms; här väljer du hur summorna visas.">
          {[[false, "Exkl. moms"], [true, "Inkl. moms"]].map(([v, l], i) => (
            <button key={l} className={"btn small" + (moms === v ? " primary" : "")} onClick={() => setMomsPersist(v)}
              style={i === 0 ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : { borderTopLeftRadius: 0, borderBottomLeftRadius: 0, marginLeft: -1 }}>{l}</button>
          ))}
        </div>
      </div>
      <p className="sub">Lägg in fakturor och kvitton när de kommer – belopp <b>inkl. moms</b> som det står på fakturan, och bifoga filen (PDF eller foto). Koppla till fas och byggdel så syns utfallet mot budgeten. Filerna sparas privat och öppnas bara inloggad.</p>

      {/* summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "baseline" }}>
          <div><div style={muted}>SPENDERAT ({moms ? "inkl." : "exkl."} moms)</div><div className="mono" style={{ fontSize: 24, fontWeight: 700 }}>{kr(sum(items))}</div></div>
          <div><div style={muted}>av total budget</div><div className="mono" style={{ fontSize: 15 }}>{kr(totBudget)} <span style={muted}>({totBudget ? Math.round((sum(items) / totBudget) * 100) : 0} %)</span></div></div>
          <div><div style={muted}>OBETALT</div><div className="mono" style={{ fontSize: 15, color: unpaid.some(overdue) ? "#9a4a3a" : undefined }}>{kr(sum(unpaid))} <span style={muted}>({unpaid.length} st{unpaid.filter(overdue).length ? ", " + unpaid.filter(overdue).length + " förfallna" : ""})</span></div></div>
          {byPayer.map(([p, v]) => <div key={p}><div style={muted}>BETALT AV {p.toUpperCase()}</div><div className="mono" style={{ fontSize: 15 }}>{kr(v)}</div></div>)}
        </div>
        {(phaseRows.length > 0 || partRows.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 18, marginTop: 14 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={th}>Utfall per fas</th><th style={{ ...th, textAlign: "right" }}>Utfall</th><th style={{ ...th, textAlign: "right" }}>Budget</th><th style={{ ...th, width: 110 }}></th></tr></thead>
              <tbody>
                {phaseRows.map((r) => (
                  <tr key={r.key}><td style={td}>{r.label}</td><td style={{ ...td, textAlign: "right" }} className="mono">{kr(r.spent)}</td><td style={{ ...td, textAlign: "right", color: "var(--muted)" }} className="mono">{kr(r.budget)}</td><td style={td}><Bar spent={r.spent} budget={r.budget} /></td></tr>
                ))}
                {noPhase > 0 && <tr><td style={{ ...td, color: "var(--muted)" }}>Ingen fas angiven</td><td style={{ ...td, textAlign: "right" }} className="mono">{kr(noPhase)}</td><td style={td}></td><td style={td}></td></tr>}
              </tbody>
            </table>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={th}>Utfall per byggdel</th><th style={{ ...th, textAlign: "right" }}>Utfall</th><th style={{ ...th, textAlign: "right" }}>Budget</th><th style={{ ...th, width: 110 }}></th></tr></thead>
              <tbody>
                {partRows.map((r) => (
                  <tr key={r.k}><td style={{ ...td, color: r.k ? undefined : "var(--muted)" }}>{r.label}</td><td style={{ ...td, textAlign: "right" }} className="mono">{kr(r.spent)}</td><td style={{ ...td, textAlign: "right", color: "var(--muted)" }} className="mono">{r.k ? kr(r.budget) : ""}</td><td style={td}>{r.k && <Bar spent={r.spent} budget={r.budget} />}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* toolbar */}
      <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {!ro && <button className="btn primary" onClick={add}>+ Ny utgift</button>}
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} style={sel}><option value="">Alla</option>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={f.payer} onChange={(e) => setF({ ...f, payer: e.target.value })} style={sel}><option value="">Alla betalare</option>{PAYERS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })} style={{ ...sel, maxWidth: 220 }}>
          <option value="">Alla faser</option>
          {["budget", "budget2"].map((et) => <optgroup key={et} label={ETAPP[et]}>{allPhases.filter((p) => p.et === et).map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}</optgroup>)}
        </select>
        <select value={f.part} onChange={(e) => setF({ ...f, part: e.target.value })} style={sel}><option value="">Alla byggdelar</option>{PARTS.map(([k]) => <option key={k} value={k}>{PART_SHORT[k]}</option>)}</select>
        <input type="search" placeholder="Sök leverantör/vad …" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ width: 180, padding: "5px 8px", fontSize: 13 }} />
        <span style={{ ...muted, marginLeft: "auto" }}>{list.length} st · {kr(sum(list))}</span>
      </div>

      <datalist id="exp-suppliers">{[...new Set([...SUPPLIERS, ...items.map((e) => e.supplier).filter(Boolean)])].map((s) => <option key={s} value={s} />)}</datalist>

      {!items.length && <p className="sub">Inga utgifter ännu. Tryck på "+ Ny utgift" för att lägga in den första fakturan.</p>}
      <div className="card" style={{ padding: 0 }}>
        {list.map((e) => open !== e.id ? (
          <div key={e.id} onClick={() => setOpen(e.id)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 12px", borderBottom: "1px solid var(--line)", cursor: "pointer", flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 12, width: 82, color: "var(--muted)" }}>{e.date}</span>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <b>{e.supplier || "—"}</b>{e.what && <span> · {e.what}</span>}
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                {[e.phaseId ? ETAPP[e.etapp || "budget"] + " · " + phaseName(e) : "ingen fas", e.part ? PART_SHORT[e.part] : "", e.paidBy].filter(Boolean).join(" · ")}
              </div>
            </div>
            {(e.files || []).length > 0 && <span title="Bifogade filer" style={{ fontSize: 13 }}>📎{e.files.length > 1 ? e.files.length : ""}</span>}
            <span style={{ fontSize: 10.5, fontWeight: 700, border: "1px solid", borderRadius: 4, padding: "0 5px",
              color: e.status === "Betald" ? "#5E8C5A" : overdue(e) ? "#9a4a3a" : "#8C6A3F" }}>
              {e.status === "Betald" ? "BETALD" : overdue(e) ? "FÖRFALLEN " + e.due : "OBETALD" + (e.due ? " · " + e.due : "")}
            </span>
            <span className="mono" style={{ fontWeight: 700, width: 110, textAlign: "right" }}>{kr(shown(e))}</span>
          </div>
        ) : (
          <div key={e.id} style={{ padding: 12, borderBottom: "1px solid var(--line)", background: "#fff" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, minWidth: 0 }}>
              <label style={lbl}><div style={cap}>Datum</div><input type="date" value={e.date || ""} disabled={ro} onChange={(x) => patch(e.id, { date: x.target.value })} /></label>
              <label style={lbl}><div style={cap}>Leverantör</div><input type="text" list="exp-suppliers" value={e.supplier || ""} readOnly={ro} onChange={(x) => patch(e.id, { supplier: x.target.value })} /></label>
              <label style={{ ...lbl, gridColumn: "span 2" }}><div style={cap}>Vad</div><input type="text" value={e.what || ""} readOnly={ro} placeholder="t.ex. Finja Exakt + murbruk" onChange={(x) => patch(e.id, { what: x.target.value })} /></label>
              <label style={lbl}><div style={cap}>Belopp inkl. moms (kr)</div><input type="text" inputMode="decimal" value={e.amount || ""} readOnly={ro} onChange={(x) => patch(e.id, { amount: x.target.value })} /></label>
              <label style={lbl}><div style={cap}>varav moms (tomt = 20 %)</div><input type="text" inputMode="decimal" value={e.vat ?? ""} readOnly={ro} placeholder={String(Math.round(parseNum(e.amount) * 0.2))} onChange={(x) => patch(e.id, { vat: x.target.value })} /></label>
              <div style={lbl}><div style={cap}>Exkl. moms</div><div className="mono" style={{ padding: "7px 0" }}>{kr(exOf(e))}</div></div>
              <label style={lbl}><div style={cap}>Betald av</div><select value={e.paidBy || "Pelle"} disabled={ro} style={{ width: "100%", maxWidth: "100%" }} onChange={(x) => patch(e.id, { paidBy: x.target.value })}>{PAYERS.map((p) => <option key={p}>{p}</option>)}</select></label>
              <label style={lbl}><div style={cap}>Status</div><select value={e.status || "Obetald"} disabled={ro} style={{ width: "100%", maxWidth: "100%" }} onChange={(x) => patch(e.id, { status: x.target.value })}>{STATUS.map((p) => <option key={p}>{p}</option>)}</select></label>
              <label style={lbl}><div style={cap}>Förfallodag</div><input type="date" value={e.due || ""} disabled={ro} onChange={(x) => patch(e.id, { due: x.target.value })} /></label>
              <label style={{ ...lbl, gridColumn: "span 2" }}><div style={cap}>Fas (budget)</div>
                <select value={e.phaseId ? (e.etapp || "budget") + ":" + e.phaseId : ""} disabled={ro} style={{ width: "100%", maxWidth: "100%" }}
                  onChange={(x) => { const [et, id] = x.target.value.split(":"); patch(e.id, { etapp: et || "budget", phaseId: id || "" }); }}>
                  <option value="">— ingen fas —</option>
                  {["budget", "budget2"].map((et) => <optgroup key={et} label={ETAPP[et]}>{allPhases.filter((p) => p.et === et).map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}</optgroup>)}
                </select></label>
              <label style={lbl}><div style={cap}>Byggdel</div>
                <select value={e.part || ""} disabled={ro} style={{ width: "100%", maxWidth: "100%" }} onChange={(x) => patch(e.id, { part: x.target.value })}>
                  <option value="">—</option>{PARTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <label style={{ ...lbl, gridColumn: "1 / -1" }}><div style={cap}>Anteckning</div><input type="text" value={e.note || ""} readOnly={ro} onChange={(x) => patch(e.id, { note: x.target.value })} /></label>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={cap}>Faktura / kvitto</div>
              {(e.files || []).map((x, k) => (
                <div key={x.path} className="row" style={{ gap: 6, padding: "3px 0" }}>
                  <span>📎</span><span style={{ flex: 1, minWidth: 120, fontSize: 13 }}>{x.name}</span>
                  <button className="btn small" onClick={() => openFile(x)}>Öppna</button>
                  {!ro && <button className="btn small danger" onClick={() => removeFile(e, k)}>✕</button>}
                </div>
              ))}
              {!ro && <>
                <input type="file" accept="application/pdf,image/*" multiple style={{ display: "none" }} ref={(el) => { fileRef.current[e.id] = el; }}
                  onChange={(x) => { const fs = Array.from(x.target.files || []); x.target.value = ""; if (fs.length) upload(e, fs); }} />
                <button className="btn small" disabled={busy === e.id} onClick={() => fileRef.current[e.id]?.click()}>{busy === e.id ? "Laddar upp …" : "📎 Ladda upp faktura / foto"}</button>
              </>}
            </div>
            <div className="row" style={{ gap: 6, marginTop: 12 }}>
              {!ro && <button className="btn small danger" onClick={() => remove(e)}>Ta bort</button>}
              {!ro && e.status !== "Betald" && <button className="btn small" onClick={() => patch(e.id, { status: "Betald" })}>✓ Markera betald</button>}
              <button className="btn small primary" style={{ marginLeft: "auto" }} onClick={() => setOpen(null)}>Klar</button>
            </div>
          </div>
        ))}
        {items.length > 0 && !list.length && <p className="sub" style={{ padding: 12 }}>Inga utgifter matchar filtret.</p>}
      </div>
    </div>
  );
}
