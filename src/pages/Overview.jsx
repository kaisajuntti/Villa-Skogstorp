import { useState } from "react";
import cluster from "../assets/cluster.jpg";
import { ZONES, HOTSPOTS, LABELS } from "../data/zones.js";

export default function Overview({ rooms }) {
  const [hover, setHover] = useState(null);
  const go = (id) => { window.location.hash = "#/omrade/" + id; };
  const count = (zoneId) => (rooms || []).filter((r) => r.zone === zoneId).length;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>ÖVERSIKT</h1>
      <p className="sub">
        Om- och tillbyggnad av enbostadshus · Karlshamn 5:1 · Situationsplan rev 2026-06-24
        (Bjartmar och Hylta). Tryck på en byggnad eller yta för att öppna den.
      </p>

      <div className="overviewwrap">
        <img src={cluster} alt="Situationsplan — byggnaderna på Villa Skogstorp" />
        <svg viewBox="0 0 1320 1193" role="navigation">
          {ZONES.map((z) => (
            <polygon
              key={z.id}
              className={"hotspot" + (hover === z.id ? " active" : "")}
              points={HOTSPOTS[z.id].map((p) => p.join(",")).join(" ")}
              onPointerEnter={() => setHover(z.id)}
              onPointerLeave={() => setHover(null)}
              onClick={() => go(z.id)}
            />
          ))}
          {hover && (
            <text className="hotlabel" x={LABELS[hover][0]} y={LABELS[hover][1] - 14} textAnchor="middle">
              {ZONES.find((z) => z.id === hover)?.name.toUpperCase()}
            </text>
          )}
        </svg>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        Hela situationsplanen: <a href="#/projekt">projektsidan</a> ·{" "}
        <a href={cluster} target="_blank" rel="noreferrer">öppna bild</a>
      </p>

      <h2>Zoner</h2>
      <div className="cardlist">
        {ZONES.map((z) => (
          <a key={z.id} className="roomlink" href={"#/omrade/" + z.id}
             onPointerEnter={() => setHover(z.id)} onPointerLeave={() => setHover(null)}>
            <span>
              {z.name}{" "}
              <span className="zonechip" style={{ marginLeft: 8 }}>{z.status}</span>
            </span>
            <span className="meta">{count(z.id)} rum →</span>
          </a>
        ))}
      </div>
    </div>
  );
}
