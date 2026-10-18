// Projekt → "<Lager> – underlag till …" (Ventilation, El, Vatten & avlopp, Värme): förutsättningar (decisions whose
// area is one of the layer's topics), the questions to the installer (todos, numbered V1/E1/VA1/VÄ1 …, pinned on the
// floor plans) and the per-room table of all floors. Everything is edited where it lives: decisions/todos in
// Beslutslogg, the drawing in the floor plans (🔧 Installationer).
import { useSpace } from "../state.js";
import { useFloorPlan, PLAN_FLOOR } from "../floorRooms.js";
import { LAYERS, layerQuestions, hasLayer, isTopic } from "../planner/inst.js";
import VentTable from "./VentTable.jsx";
import InstTable, { InstLegend } from "./InstTable.jsx";

export function useFloorPlans() {
  const [floorsRec] = useSpace("floors");
  const ids = (floorsRec?.floors || []).map((f) => f.plan).filter(Boolean);
  const k = useFloorPlan(ids[0]), p1 = useFloorPlan(ids[1]), p2 = useFloorPlan(ids[2]);
  return (floorsRec?.floors || []).filter((f) => f.plan).map((f, i) => ({ title: f.title, id: f.id, planId: f.plan, plan: [k, p1, p2][i] }));
}

export const layerSummary = (space, layer) =>
  `${layerQuestions(space.todos, layer).filter((t) => (t.status || "Öppen") !== "Klar").length} öppna frågor · ${(space.decisions || []).filter((d) => isTopic(layer, d.area)).length} förutsättningar`;

export default function InstSection({ space, layer, floors }) {
  const L = LAYERS[layer];
  const decisions = (space.decisions || []).filter((d) => isTopic(layer, d.area));
  const qs = layerQuestions(space.todos, layer);
  const withPlan = floors.filter((f) => f.plan?.room);
  const drawn = floors.filter((f) => hasLayer(f.plan, layer));
  return (
    <div>
      <p className="sub" style={{ marginTop: 0 }}>
        Underlaget byggs live ur planerna: ritas under Våningar → öppna ett rum → <b>🔧 Installationer</b> → {L.icon} {L.label}.
        Förutsättningar och frågor redigeras i Beslutslogg & att göra (område <i>{L.topics[0]}</i>) – frågorna kan också sättas ut
        och besvaras direkt i ritningen (❓).
      </p>
      <h3 style={{ margin: "14px 0 6px" }}>Förutsättningar</h3>
      {decisions.length ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {decisions.map((d) => <li key={d.id} style={{ marginBottom: 4 }}><b>{d.decision}</b>{d.why ? <span className="sub"> – {d.why}</span> : null}</li>)}
        </ul>
      ) : <p className="sub">Inga beslut med område {L.topics[0]} än.</p>}
      <h3 style={{ margin: "16px 0 6px" }}>Frågor till {L.who}</h3>
      {qs.length ? (
        <div className="cardlist">
          {qs.map((q) => (
            <div key={q.id} className="card" style={{ opacity: q.status === "Klar" ? 0.6 : 1 }}>
              <div><b>{q.tag}</b> · {q.item} <span className="zonechip" style={{ marginLeft: 6 }}>{q.status || "Öppen"}</span>
                {(q.pins || []).length > 0 && <span className="sub" style={{ marginLeft: 8 }}>📍 {(q.pins || []).map((p) => PLAN_FLOOR[p.plan]?.short || "?").join(", ")}</span>}
              </div>
              {q.detail ? <div className="sub" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{q.detail}</div> : null}
            </div>
          ))}
        </div>
      ) : <p className="sub">Inga frågor än.</p>}
      <h3 style={{ margin: "16px 0 6px" }}>{layer === "vent" ? "Flöden per rum" : "Per rum"}</h3>
      {drawn.length > 0 && <InstLegend layer={layer} plans={drawn.map((f) => f.plan)} />}
      {layer === "vent" ? <VentTable floors={withPlan} /> : <InstTable layer={layer} floors={withPlan} />}
      <p className="sub">Ritat: {drawn.length ? drawn.map((f) => f.title).join(", ") : "inget än"}.</p>
    </div>
  );
}
