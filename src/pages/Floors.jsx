// Våningar: the architect's floor plans (Källare · Plan 1 · Plan 2) with the
// befintligt / tillbyggnad split tinted and every utrymme clickable.
// Data lives behind the login: space record `floors` = { floors:[{ id, title, w, h,
// till:[[x,y]…], bef:[[x,y]…], areas:[{ roomId, poly:[[x,y]…] }] }] } (image px),
// floor image in `vs:v1:bg:floor-<id>` ({ dataUrl, w, h }).
import { useEffect, useState } from "react";
import { useSpace } from "../state.js";
import { storage, bgKey } from "../storage.js";

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

export default function Floors({ floorId, rooms }) {
  const [space] = useSpace("floors");
  const floors = space?.floors || [];
  const floor = floors.find((f) => f.id === floorId) || floors.find((f) => f.id === "plan1") || floors[0];
  const img = useFloorImage(floor?.id || "none");
  const [hover, setHover] = useState(null);
  const roomById = Object.fromEntries((rooms || []).map((r) => [r.id, r]));

  if (!space) return <div className="page"><p className="sub">Laddar …</p></div>;
  if (!floor) return <div className="page"><h1>VÅNINGAR</h1><p className="sub">Inga våningsritningar inlagda än.</p></div>;

  const go = (id) => { window.location.hash = "#/rum/" + id; };
  const areas = floor.areas.filter((a) => roomById[a.roomId]);
  const fs = Math.round(floor.w / 50); // label size relative to the drawing

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>VÅNINGAR</h1>
      <div className="row" style={{ margin: "0 0 10px" }}>
        {floors.map((f) => (
          <a key={f.id} href={"#/vaning/" + f.id} className={"btn small" + (f.id === floor.id ? " primary" : "")}>{f.title}</a>
        ))}
      </div>
      <p className="sub">
        Tryck på ett utrymme för att öppna det. <span style={{ background: "rgba(214,160,70,0.35)", padding: "0 6px", borderRadius: 4 }}>Tillbyggnad</span>{" "}
        <span style={{ background: "rgba(90,122,140,0.3)", padding: "0 6px", borderRadius: 4 }}>Befintligt</span>
        {space.source ? <> · {space.source}</> : null}
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

      <h2>Utrymmen – {floor.title}</h2>
      <div className="cardlist">
        {areas.map((a) => {
          const r = roomById[a.roomId];
          return (
            <a key={a.roomId} className="roomlink" href={"#/rum/" + a.roomId}
               onPointerEnter={() => setHover(a.roomId)} onPointerLeave={() => setHover(null)}>
              <span>{short(r.name)} <span className="zonechip" style={{ marginLeft: 8 }}>{r.zone === "tillbyggnad" ? "Tillbyggnad" : "Befintligt"}</span></span>
              <span className="meta">öppna →</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
