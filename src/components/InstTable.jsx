// Installation layers outside the planner: legend (systems + symbol key) and the per-room list
// ("Förteckning per rum") – live from the floor plans; used on Våningar and in Projekt.
import { LAYERS, layerSvg, systemsUsed, kindsUsed, layerRoomRows, itemText, sysColor, fmtNum } from "../planner/inst.js";

const th = { textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", padding: "4px 8px", borderBottom: "1px solid var(--line)" };
const td = { fontSize: 13, padding: "4px 8px", borderBottom: "1px solid var(--line)", verticalAlign: "top" };

// A kind's symbol as a small inline SVG.
export function KindIcon({ layer, d, size = 22 }) {
  const sys = d.sys || LAYERS[layer].defSys;
  const p = { id: "i", kind: d.k, sys, x: 0, y: 0, ...(d.shape === "rect" ? { w: 560, h: 380, label: d.def ? d.def(sys) : "" } : d.shape === "bar" ? { w: 560, h: 120 } : d.shape === "zone" ? { label: " " } : {}) };
  const body = d.shape === "zone" ? `<rect x="-280" y="-280" width="560" height="560" fill="${sysColor(layer, sys)}" opacity="0.25"/>` : layerSvg(layer, { lines: [], pts: [p] });
  return <svg viewBox="-300 -300 600 600" width={size} height={size} style={{ verticalAlign: "middle", marginRight: 4 }} dangerouslySetInnerHTML={{ __html: body }} />;
}

export function InstLegend({ layer, plans }) {
  const L = LAYERS[layer];
  return (
    <p className="sub" style={{ marginTop: 2 }}>
      {systemsUsed(layer, plans).map((k) => (
        <span key={k} style={{ marginRight: 12, whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-block", width: 18, height: 4, background: L.sys[k].color, verticalAlign: "middle", marginRight: 5 }} />{L.sys[k].label}
        </span>
      ))}
      <br />
      {kindsUsed(layer, plans).map((d) => <span key={d.k} style={{ marginRight: 12, whiteSpace: "nowrap" }}><KindIcon layer={layer} d={d} />{d.label}</span>)}
      <span style={{ whiteSpace: "nowrap" }}><b style={{ color: "#9a4a3a" }}>{L.pre}1</b> = fråga till {L.who}</span>
    </p>
  );
}

export default function InstTable({ layer, floors }) {
  // floors: [{ title, plan }]
  const rows = floors.flatMap((f) => layerRoomRows(f.plan, layer, f.title));
  if (!rows.some((r) => r.items.length)) return <p className="sub">Inget ritat än.</p>;
  const multi = floors.length > 1;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", background: "#fff", border: "1px solid var(--line)", borderRadius: 8 }}>
        <thead><tr>
          {multi && <th style={th}>Våning</th>}<th style={th}>Rum</th><th style={{ ...th, textAlign: "right" }}>m²</th><th style={th}>I rummet</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.floor + r.id} style={{ color: r.items.length ? undefined : "var(--muted)" }}>
              {multi && <td style={td}>{r.floor}</td>}
              <td style={td}>{r.name}</td>
              <td style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{r.m2 == null ? "–" : fmtNum(r.m2)}</td>
              <td style={td}>{r.items.length ? r.items.map((e, i) => (
                <span key={i} style={{ color: sysColor(layer, e.sys), marginRight: 10, whiteSpace: "nowrap" }}>● {itemText(e)}</span>
              )) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
