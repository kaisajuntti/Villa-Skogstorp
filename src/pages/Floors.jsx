// Våningar: the live whole-floor plans (Källare · Plan 1 · Plan 2, drawn in the planner) with every room
// clickable → a focus crop of that room (#/rum/<planId>:<areaId>), plus the utrymme groups.
// The older view – the architect's floor image with the befintligt / tillbyggnad split tinted and every
// utrymme clickable – stays as "Arkitektens ritning".
// floors[].plan = id of the whole-floor plan (u-k-hela …).
// Data lives behind the login: space record `floors` = { floors:[{ id, title, w, h,
// till:[[x,y]…], bef:[[x,y]…], areas:[{ roomId, poly:[[x,y]…] }] }] } (image px),
// floor image in `vs:v1:bg:floor-<id>` ({ dataUrl, w, h }).
import { useEffect, useMemo, useRef, useState } from "react";
import { useSpace } from "../state.js";
import { storage, bgKey } from "../storage.js";
import { buildPlanSvg } from "../planner/planSvg.js";
import { areaGrid, areaSummary, regionAt, regionRects, kindTag, fmtM2 } from "../planner/geom.js";
import { useFloorPlan, areaNames, areaRoomId } from "../floorRooms.js";
import { ventPinsFor, hasVent, VENT_SYS, ventSystemsUsed } from "../planner/vent.js";
import VentTable from "../components/VentTable.jsx";

const short = (name) => (name || "").replace(/^(K|P1|P2)\s*·\s*/, "");
const centroid = (poly) => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    const f = x0 * y1 - x1 * y0; a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (!a) return poly[0];
  return [cx / (3 * a), cy / (3 * a)];
};
const pts = (poly) => poly.map((p) => p.join(",")).join(" ");

function useFloorImage(id) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await storage.get(bgKey("floor-" + id));
      if (alive) setImg(r?.value ? JSON.parse(r.value) : null);
    };
    setImg(null); load();
    window.addEventListener("vs-sync", load);
    return () => { alive = false; window.removeEventListener("vs-sync", load); };
  }, [id]);
  return img;
}

function RoomLink({ r, hover }) {
  return (
    <a className="roomlink" href={"#/rum/" + r.id}
      onPointerEnter={hover ? () => hover(r.id) : undefined} onPointerLeave={hover ? () => hover(null) : undefined}>
      <span>{short(r.name)} <span className="zonechip" style={{ marginLeft: 8 }}>{r.zone === "tillbyggnad" ? "Tillbyggnad" : "Befintligt"}</span></span>
      <span className="meta">öppna →</span>
    </a>
  );
}

const VIEW_KEY = "vs:v1:ui:floorView";

// The live floor plan: drawn from the plan record; tap a room to open it, hover highlights it.
function LivePlan({ planId, rooms, floor }) {
  const plan = useFloorPlan(planId);
  const [hover, setHover] = useState(null); // { regs:[…] } highlighted from the plan or the lists
  const [showDims, setShowDims] = useState(false);
  const [project] = useSpace("project");
  const [showVent, setShowVent] = useState(() => { try { return localStorage.getItem("vs:v1:ui:floorVent") === "1"; } catch { return false; } });
  const toggleVent = (v) => { setShowVent(v); try { localStorage.setItem("vs:v1:ui:floorVent", v ? "1" : "0"); } catch { /* ignore */ } };
  const pins = useMemo(() => ventPinsFor(project?.todos, planId), [project, planId]);
  const overlay = useRef(null);
  const live = useMemo(() => {
    if (!plan?.room) return null;
    const walls = plan.walls || [], areas = plan.areas || [];
    const grid = areaGrid(plan.room, walls), summary = areaSummary(grid, areas);
    const reg = Object.fromEntries(areas.map((a) => [a.id, regionAt(grid, a.x, a.y)]));
    return { grid, summary, reg, areas, names: areaNames(areas) };
  }, [plan]);
  const ventOn = showVent && (hasVent(plan) || pins.length > 0);
  const svg = useMemo(() => (plan?.room ? buildPlanSvg({ ...plan, dims: showDims ? plan.dims || [] : [], comments: [], embedBg: false,
    vent: ventOn ? { ventLines: plan.ventLines, ventPts: plan.ventPts, pins } : null }) : ""), [plan, showDims, ventOn, pins]);
  if (plan === null) return <p className="sub">Laddar planen …</p>;
  if (!live) return <p className="sub">Planen för våningen saknas.</p>;
  const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1] || "0 0 1 1";
  const [, , vw, vh] = vb.split(" ").map(Number);
  const regOfEvent = (e) => {
    const el = overlay.current, m = el?.getScreenCTM();
    if (!m) return -1;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return regionAt(live.grid, p.x, p.y);
  };
  const areaOfReg = (r) => (r < 0 ? null : live.areas.find((a) => live.reg[a.id] === r));
  const hl = hover ? regionRects(live.grid, hover.regs, 0) : [];
  const groups = (rooms || []).filter((r) => r.plan === planId && r.areas?.length);
  const regsOf = (ids) => ids.map((id) => live.reg[id]).filter((r) => r >= 0);
  const sm = live.summary;
  const f1 = (v) => v.toFixed(1).replace(".", ",");

  return (
    <>
      <p className="sub">
        Tryck på ett rum för att öppna det (utsnitt av planen – allt går att redigera där).{" "}
        <label style={{ whiteSpace: "nowrap" }}><input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} /> Visa mått</label>{" "}
        {(hasVent(plan) || pins.length > 0) && <><label style={{ whiteSpace: "nowrap" }}><input type="checkbox" checked={showVent} onChange={(e) => toggleVent(e.target.checked)} /> 🌬 Ventilation</label>{" "}</>}
        · <a href={"#/rum/" + planId}>✏️ Redigera hela planet</a>
      </p>
      <div style={{ position: "relative", aspectRatio: `${vw} / ${vh}`, width: `min(100%, calc(78vh * ${(vw / vh).toFixed(4)}))`, margin: "0 auto", background: "#FAF8F3", border: "1.5px solid var(--ink)", borderRadius: 10, overflow: "hidden" }}>
        <div className="liveplan" style={{ position: "absolute", inset: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />
        <svg ref={overlay} viewBox={vb} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: hover ? "pointer" : "default" }}
          onPointerMove={(e) => { if (e.pointerType !== "mouse") return; const r = regOfEvent(e); setHover(areaOfReg(r) ? { regs: [r] } : null); }}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => { const a = areaOfReg(regOfEvent(e)); if (a) window.location.hash = "#/rum/" + areaRoomId(planId, a.id); }}>
          {hl.map((r, i) => <rect key={i} x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} fill="rgba(90,122,140,0.22)" />)}
        </svg>
      </div>
      {sm && (
        <p className="sub" style={{ marginTop: 6 }}>
          <b>BOA {f1(sm.sum.boa)} m²</b>{sm.sum.bia > 0.05 && <> · <b>BIA {f1(sm.sum.bia)} m²</b></>} · enligt SS 21054, räknat från väggarna
        </p>
      )}

      {ventOn && (
        <>
          <p className="sub" style={{ marginTop: 2 }}>
            {ventSystemsUsed([plan]).map((k) => <span key={k} style={{ marginRight: 12, whiteSpace: "nowrap" }}><span style={{ display: "inline-block", width: 18, height: 4, background: VENT_SYS[k].color, verticalAlign: "middle", marginRight: 5 }} />{VENT_SYS[k].label}</span>)}
            <span style={{ whiteSpace: "nowrap" }}>Fyrkant = stam · cirkel = frånluftsdon · cirkel med kryss = takfläkt · V = fråga till VVS</span>
          </p>
          <h2>Ventilation – flöden {floor.title}</h2>
          <VentTable floors={[{ title: floor.title, plan }]} />
        </>
      )}

      <h2>Rum – {floor.title}</h2>
      <div className="cardlist">
        {live.areas.map((a) => (
          <a key={a.id} className="roomlink" href={"#/rum/" + areaRoomId(planId, a.id)}
            onPointerEnter={() => setHover({ regs: regsOf([a.id]) })} onPointerLeave={() => setHover(null)}>
            <span>{live.names[a.id]}</span>
            <span className="meta">{fmtM2(sm?.byArea[a.id])}{kindTag(a.kind)} →</span>
          </a>
        ))}
      </div>
      {groups.length > 0 && (
        <>
          <h2>Utrymmen – {floor.title}</h2>
          <p className="sub" style={{ marginTop: -4 }}>Grupper av rum (som i budgeten). Öppnar samma plan, utsnitt kring hela gruppen.</p>
          <div className="cardlist">
            {groups.map((r) => (
              <a key={r.id} className="roomlink" href={"#/rum/" + r.id}
                onPointerEnter={() => setHover({ regs: regsOf(r.areas) })} onPointerLeave={() => setHover(null)}>
                <span>{short(r.name)} <span className="zonechip" style={{ marginLeft: 8 }}>{r.zone === "tillbyggnad" ? "Tillbyggnad" : "Befintligt"}</span></span>
                <span className="meta">{r.areas.map((id) => live.names[id]).filter(Boolean).join(" · ")} →</span>
              </a>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function Floors({ floorId, rooms }) {
  const [space] = useSpace("floors");
  const floors = space?.floors || [];
  const floor = floors.find((f) => f.id === floorId) || floors.find((f) => f.id === "plan1") || floors[0];
  const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_KEY) || "live"; } catch { return "live"; } });
  const pickView = (v) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };

  if (!space) return <div className="page"><p className="sub">Laddar …</p></div>;
  if (!floor) return <div className="page"><h1>VÅNINGAR</h1><p className="sub">Inga våningsritningar inlagda än.</p></div>;
  const live = view === "live" && floor.plan;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>VÅNINGAR</h1>
      <div className="row" style={{ margin: "0 0 10px" }}>
        {floors.map((f) => (
          <a key={f.id} href={"#/vaning/" + f.id} className={"btn small" + (f.id === floor.id ? " primary" : "")}>{f.title}</a>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className={"btn small" + (view === "live" ? " primary" : "")} onClick={() => pickView("live")}>Planen</button>
          <button className={"btn small" + (view !== "live" ? " primary" : "")} onClick={() => pickView("arch")}>Arkitektens ritning</button>
        </span>
      </div>
      {live
        ? <LivePlan key={floor.plan} planId={floor.plan} rooms={rooms} floor={floor} />
        : <ArchView floor={floor} floors={floors} rooms={rooms} source={space.source} />}
    </div>
  );
}

// The architect's floor image with the befintligt / tillbyggnad split and the old utrymme polygons.
function ArchView({ floor, floors, rooms, source }) {
  const img = useFloorImage(floor?.id || "none");
  const [hover, setHover] = useState(null);
  const roomById = Object.fromEntries((rooms || []).map((r) => [r.id, r]));
  const go = (id) => { window.location.hash = "#/rum/" + id; };
  const areas = floor.areas.filter((a) => roomById[a.roomId]);
  const fs = Math.round(floor.w / 50); // label size relative to the drawing

  return (
    <>
      <p className="sub">
        Tryck på ett utrymme för att öppna det. <span style={{ background: "rgba(214,160,70,0.35)", padding: "0 6px", borderRadius: 4 }}>Tillbyggnad</span>{" "}
        <span style={{ background: "rgba(90,122,140,0.3)", padding: "0 6px", borderRadius: 4 }}>Befintligt</span>
        {source ? <> · {source}</> : null}
      </p>

      <div className="overviewwrap" style={{ aspectRatio: `${floor.w} / ${floor.h}`, background: "#fff", border: "1.5px solid var(--ink)", borderRadius: 10, overflow: "hidden" }}>
        <svg viewBox={`0 0 ${floor.w} ${floor.h}`} role="navigation">
          {img && <image href={img.dataUrl} x="0" y="0" width={floor.w} height={floor.h} />}
          {!img && <text x={floor.w / 2} y={floor.h / 2} textAnchor="middle" fontSize={fs} fill="#7A756E">Laddar ritning …</text>}
          <polygon points={pts(floor.bef)} fill="rgba(90,122,140,0.22)" style={{ pointerEvents: "none" }} />
          <polygon points={pts(floor.till)} fill="rgba(214,160,70,0.28)" style={{ pointerEvents: "none" }} />
          {areas.map((a) => (
            <polygon key={a.roomId} points={pts(a.poly)}
              className={"hotspot" + (hover === a.roomId ? " active" : "")}
              onPointerEnter={() => setHover(a.roomId)} onPointerLeave={() => setHover(null)}
              onClick={() => go(a.roomId)} />
          ))}
          {areas.map((a) => {
            const [x, y] = centroid(a.poly);
            return (
              <text key={"t" + a.roomId} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                className="hotlabel" style={{ fontSize: hover === a.roomId ? fs * 1.15 : fs, letterSpacing: 0.5 }}>
                {short(roomById[a.roomId].name)}
              </text>
            );
          })}
        </svg>
      </div>

      {/* All utrymmen, grouped per floor (the shown floor first), + those not drawn on any floor */}
      {[floor, ...floors.filter((x) => x.id !== floor.id)].map((fl) => {
        const list = fl.areas.map((a) => roomById[a.roomId]).filter(Boolean);
        if (!list.length) return null;
        const cur = fl.id === floor.id;
        return (
          <div key={fl.id}>
            <h2>Utrymmen – {fl.title}{!cur && <a href={"#/vaning/" + fl.id} style={{ fontSize: 12, marginLeft: 10, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>visa våningen →</a>}</h2>
            <div className="cardlist">{list.map((r) => <RoomLink key={r.id} r={r} hover={cur ? setHover : null} />)}</div>
          </div>
        );
      })}
      {(() => {
        const placed = new Set(floors.flatMap((x) => x.areas.map((a) => a.roomId)));
        const loose = (rooms || []).filter((r) => !placed.has(r.id));
        return loose.length ? (
          <div>
            <h2>Övriga utrymmen</h2>
            <p className="sub" style={{ marginTop: -4 }}>Finns i listan men är inte inritade på våningsplanen (t.ex. kopior/varianter).</p>
            <div className="cardlist">{loose.map((r) => <RoomLink key={r.id} r={r} />)}</div>
          </div>
        ) : null;
      })()}
    </>
  );
}
