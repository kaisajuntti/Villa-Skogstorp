import { useState } from "react";
import { useSpace } from "../state.js";
import { planKey, spaceKey } from "../storage.js";
import { zoneById } from "../data/zones.js";
import { ColorScheme, DocList, Notes } from "../components/Spaces.jsx";
import VersionHistory from "../components/VersionHistory.jsx";
import RoomPlanner from "../planner/RoomPlanner.jsx";

const TABS = [
  ["plan", "Planritning"],
  ["farger", "Färger"],
  ["dokument", "Dokument"],
  ["anteckningar", "Anteckningar"],
];

export default function Room({ roomId, roomsApi }) {
  const { rooms } = roomsApi;
  const [tab, setTab] = useState("plan");
  const [space, update] = useSpace(roomId);

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
      </div>
      {tab === "plan" ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <RoomPlanner key={room.id} storageKey={planKey(room.id)} title={room.name.toUpperCase()} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div className="page" style={{ paddingTop: 6 }}>
            {!space ? (
              <p className="sub">Laddar …</p>
            ) : (
              <>
                {tab === "farger" && (<><h2>Färger & material — {room.name}</h2><ColorScheme space={space} update={update} /></>)}
                {tab === "dokument" && (<><h2>Dokument & länkar — {room.name}</h2><DocList space={space} update={update} /></>)}
                {tab === "anteckningar" && (<><h2>Anteckningar — {room.name}</h2><Notes space={space} update={update} placeholder={`Anteckningar för ${room.name} …`} /></>)}
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
