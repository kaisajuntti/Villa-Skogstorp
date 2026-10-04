import { useEffect, useState } from "react";
import { useSpace } from "../state.js";
import { planKey, spaceKey } from "../storage.js";
import { zoneById } from "../data/zones.js";
import { ColorScheme, DocList, Notes, PlanCollection, InventoryList, InspoGallery, InspoLightbox } from "../components/Spaces.jsx";
import VersionHistory from "../components/VersionHistory.jsx";
import RoomPlanner from "../planner/RoomPlanner.jsx";

const TABS = [
  ["plan", "Planritning"],
  ["farger", "Färger"],
  ["dokument", "Dokument"],
  ["anteckningar", "Anteckningar"],
];

// Inspiration images in a column beside the plan (strip above it on narrow screens).
function InspoPanel({ items, narrow }) {
  const [big, setBig] = useState(null);
  return (
    <div style={narrow
      ? { display: "flex", gap: 8, overflowX: "auto", padding: "0 12px 8px", flex: "0 0 auto" }
      : { width: "min(30%, 420px)", minWidth: 200, overflowY: "auto", padding: "0 6px 12px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it, i) => (
        <figure key={it.id || i} style={{ margin: 0, flex: narrow ? "0 0 auto" : undefined }}>
          <img src={it.photo} alt={it.title} loading="lazy" onClick={() => setBig(i)}
            style={{ display: "block", width: narrow ? "auto" : "100%", height: narrow ? 110 : "auto", borderRadius: 8,
              border: "1px solid var(--line)", cursor: "zoom-in", background: "#fff" }} />
          {!narrow && it.title && <figcaption className="sub" style={{ margin: "4px 0 0", fontSize: 12 }}>{it.title}</figcaption>}
        </figure>
      ))}
      {big != null && <InspoLightbox items={items} index={big} onClose={() => setBig(null)} />}
    </div>
  );
}
const INSPO_KEY = "vs:v1:ui:inspoPanel";

export default function Room({ roomId, roomsApi }) {
  const { rooms } = roomsApi;
  const [tab, setTab] = useState("plan");
  const [space, update] = useSpace(roomId);
  const [showInspo, setShowInspo] = useState(() => { try { return localStorage.getItem(INSPO_KEY) !== "0"; } catch { return true; } });
  const [narrow, setNarrow] = useState(() => window.innerWidth < 760);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < 760); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  const toggleInspo = () => setShowInspo((v) => { try { localStorage.setItem(INSPO_KEY, v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  const inspo = space?.inspo || [];

  if (rooms === null) return <div className="page"><p className="sub">Laddar …</p></div>;
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return <div className="page"><p>Rummet finns inte. <a href="#/">Till översikten</a></p></div>;
  const zone = zoneById(room.zone);

  return (
    <>
      <div style={{ padding: "10px 18px 0" }}>
        <div className="crumb">
          <a href="#/">Översikt</a> / <a href={"#/omrade/" + room.zone}>{zone?.name}</a> / {room.name}
        </div>
      </div>
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={"btn" + (tab === id ? " primary" : "")} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        {tab === "plan" && inspo.length > 0 && (
          <button className={"btn" + (showInspo ? " primary" : "")} style={{ marginLeft: "auto" }} onClick={toggleInspo}>
            ✨ Inspo ({inspo.length})
          </button>
        )}
      </div>
      {tab === "plan" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: narrow ? "column" : "row" }}>
          {showInspo && inspo.length > 0 && <InspoPanel items={inspo} narrow={narrow} />}
          <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
            <RoomPlanner key={room.id} storageKey={planKey(room.id)} title={room.name.toUpperCase()} />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div className="page" style={{ paddingTop: 6 }}>
            {!space ? (
              <p className="sub">Laddar …</p>
            ) : (
              <>
                {tab === "farger" && (<><h2>Färger & material — {room.name}</h2><ColorScheme space={space} update={update} /></>)}
                {tab === "dokument" && (<><h2>Dokument & länkar — {room.name}</h2><InspoGallery space={space} update={update} /><DocList space={space} update={update} /><InventoryList roomId={room.id} space={space} update={update} /><PlanCollection roomId={room.id} /></>)}
                {tab === "anteckningar" && (<><h2>Anteckningar — {room.name}</h2><p className="sub" style={{ marginTop: -4 }}>Kladdanteckningar — snabba, tillfälliga noteringar. För en samlad beskrivning, använd “Beskrivning” under Dokument.</p><Notes space={space} update={update} placeholder={`Kladd för ${room.name} …`} /></>)}
                <VersionHistory storageKey={spaceKey(room.id)} />
                {tab === "anteckningar" && (
                  <><h2>Planritningens historik</h2><VersionHistory storageKey={planKey(room.id)} /></>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
