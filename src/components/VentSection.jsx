// Projekt → "Ventilation – underlag till VVS": förutsättningar (decisions, area Ventilation), the questions to the
// VVS (todos, area Ventilation, numbered V1 …, pinned on the floor plans) and the flow table of all floors.
// Everything is edited where it lives: decisions/todos in Beslutslogg, the drawing in the floor plans (🌬 Ventilation).
import { useSpace } from "../state.js";
import { useFloorPlan, PLAN_FLOOR } from "../floorRooms.js";
import { ventQuestions, hasVent, VENT_TOPIC } from "../planner/vent.js";
import VentTable from "./VentTable.jsx";

function useFloorPlans() {
  const [floorsRec] = useSpace("floors");
  const ids = (floorsRec?.floors || []).map((f) => f.plan).filter(Boolean);
  const k = useFloorPlan(ids[0]), p1 = useFloorPlan(ids[1]), p2 = useFloorPlan(ids[2]);
  return (floorsRec?.floors || []).filter((f) => f.plan).map((f, i) => ({ title: f.title, id: f.id, planId: f.plan, plan: [k, p1, p2][i] }));
}

export default function VentSection({ space }) {
  const floors = useFloorPlans();
  const decisions = (space.decisions || []).filter((d) => d.area === VENT_TOPIC);
  const qs = ventQuestions(space.todos);
  const drawn = floors.filter((f) => hasVent(f.plan));
  return (
    <div>
      <p className="sub" style={{ marginTop: 0 }}>
        Underlaget byggs live ur planerna: ritas under Våningar → öppna ett rum → <b>🌬 Ventilation</b>. Förutsättningar och frågor
        redigeras i Beslutslogg & att göra (område <i>Ventilation</i>) – frågorna kan också sättas ut och besvaras direkt i ritningen (❓).
      </p>
      <h3 style={{ margin: "14px 0 6px" }}>Förutsättningar</h3>
      {decisions.length ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {decisions.map((d) => <li key={d.id} style={{ marginBottom: 4 }}><b>{d.decision}</b>{d.why ? <span className="sub"> – {d.why}</span> : null}</li>)}
        </ul>
      ) : <p className="sub">Inga beslut med område Ventilation än.</p>}
      <h3 style={{ margin: "16px 0 6px" }}>Frågor till VVS</h3>
      {qs.length ? (
        <div className="cardlist">
          {qs.map((q) => (
            <div key={q.id} className="card" style={{ opacity: q.status === "Klar" ? 0.6 : 1 }}>
              <div><b>V{q.vnum}</b> · {q.item} <span className="zonechip" style={{ marginLeft: 6 }}>{q.status || "Öppen"}</span>
                {(q.pins || []).length > 0 && <span className="sub" style={{ marginLeft: 8 }}>📍 {(q.pins || []).map((p) => PLAN_FLOOR[p.plan]?.short || "?").join(", ")}</span>}
              </div>
              {q.detail ? <div className="sub" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{q.detail}</div> : null}
            </div>
          ))}
        </div>
      ) : <p className="sub">Inga frågor än.</p>}
      <h3 style={{ margin: "16px 0 6px" }}>Flöden per rum</h3>
      <VentTable floors={floors.filter((f) => f.plan?.room)} />
      <p className="sub">Ritat: {drawn.length ? drawn.map((f) => f.title).join(", ") : "inget än"}.</p>
    </div>
  );
}
