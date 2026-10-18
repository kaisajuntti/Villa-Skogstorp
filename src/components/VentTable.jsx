// Ventilation flow table (BBR 0,35 l/s per m²) per room, live from the floor plans' walls, room labels and
// ventilation layer – used on Våningar (one floor) and in Projekt (all floors).
import { VENT_SYS, ventFlowRows, fmtLs, ventColor } from "../planner/vent.js";

const th = { textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", padding: "4px 8px", borderBottom: "1px solid var(--line)" };
const td = { fontSize: 13, padding: "4px 8px", borderBottom: "1px solid var(--line)", verticalAlign: "top" };

export function ventTotals(rows) {
  const req = rows.reduce((s, r) => s + r.req, 0);
  const bySys = {};
  for (const r of rows) for (const t of r.terms) { const b = (bySys[t.sys] ||= { n: 0, flow: 0, open: 0 }); b.n++; if (t.flow != null) b.flow += t.flow; else b.open++; }
  return { req, bySys };
}

export default function VentTable({ floors }) {
  // floors: [{ title, plan }]
  const rows = floors.flatMap((f) => ventFlowRows(f.plan, f.title));
  if (!rows.length) return null;
  const tot = ventTotals(rows);
  const multi = floors.length > 1;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", background: "#fff", border: "1px solid var(--line)", borderRadius: 8 }}>
        <thead><tr>
          {multi && <th style={th}>Våning</th>}<th style={th}>Rum</th><th style={{ ...th, textAlign: "right" }}>m²</th>
          <th style={{ ...th, textAlign: "right" }}>Krav l/s</th><th style={th}>Frånluft i rummet</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.floor + r.id} style={{ color: r.req ? undefined : "var(--muted)" }}>
              {multi && <td style={td}>{r.floor}</td>}
              <td style={td}>{r.name}{r.novent ? " (ingår ej)" : r.kind === "ej" ? " (räknas ej)" : ""}</td>
              <td style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{r.m2 == null ? "–" : r.m2.toFixed(1).replace(".", ",")}</td>
              <td style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{r.req ? fmtLs(r.req) : "–"}</td>
              <td style={td}>{r.terms.map((t, i) => (
                <span key={i} style={{ color: ventColor(t.sys), marginRight: 10, whiteSpace: "nowrap" }}>
                  ● {t.kind === "flakt" ? "takfläkt" : "don"} {VENT_SYS[t.sys]?.label.split(" ")[0]}{t.flow != null ? ` ${fmtLs(t.flow)} l/s` : ""}
                </span>
              ))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub" style={{ marginTop: 6 }}>
        Grundkrav enligt BBR 0,35 l/s per m² golvyta: <b>{fmtLs(tot.req)} l/s</b>
        {Object.entries(tot.bySys).map(([k, b]) => <span key={k}> · <span style={{ color: ventColor(k) }}>{VENT_SYS[k]?.label}</span>: {b.n} don{b.flow ? `, ${fmtLs(b.flow)} l/s angivet` : ""}{b.open ? ` (${b.open} utan flöde)` : ""}</span>)}
      </p>
    </div>
  );
}
