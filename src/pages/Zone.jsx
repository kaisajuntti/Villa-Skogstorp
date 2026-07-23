import { useState } from "react";
import { zoneById } from "../data/zones.js";
import { canEdit } from "../config.js";

export default function Zone({ zoneId, roomsApi }) {
  const ro = !canEdit();
  const zone = zoneById(zoneId);
  const { rooms, addRoom, renameRoom, deleteRoom, copyRoom } = roomsApi;
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(null); // roomId
  const [editName, setEditName] = useState("");

  if (!zone) return <div className="page"><p>Okänd zon. <a href="#/">Till översikten</a></p></div>;
  const zoneRooms = (rooms || []).filter((r) => r.zone === zoneId);

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const room = addRoom(zoneId, name);
    setNewName("");
    window.location.hash = "#/rum/" + room.id;
  };

  return (
    <div className="page">
      <div className="crumb"><a href="#/">Översikt</a> / {zone.name}</div>
      <h1>{zone.name.toUpperCase()} <span className="zonechip" style={{ verticalAlign: "middle" }}>{zone.status}</span></h1>
      <p className="sub">{zone.desc}</p>

      <h2>Rum</h2>
      {rooms === null ? (
        <p className="sub">Laddar …</p>
      ) : (
        <div className="cardlist">
          {zoneRooms.map((r) =>
            editing === r.id ? (
              <div key={r.id} className="card row">
                <input type="text" className="grow" value={editName} autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (renameRoom(r.id, editName.trim() || r.name), setEditing(null))} />
                <button className="btn small primary" onClick={() => { renameRoom(r.id, editName.trim() || r.name); setEditing(null); }}>Spara</button>
                <button className="btn small" onClick={() => setEditing(null)}>Avbryt</button>
                <button className="btn small danger" onClick={() => {
                  if (confirm(`Ta bort rummet "${r.name}"? Planritning och anteckningar för rummet raderas.`)) {
                    deleteRoom(r.id); setEditing(null);
                  }
                }}>Ta bort</button>
              </div>
            ) : (
              <div key={r.id} className="row">
                <a className="roomlink grow" href={"#/rum/" + r.id}>
                  <span>{r.name}</span><span className="meta">{ro ? "öppna →" : "planera →"}</span>
                </a>
                {!ro && <button className="btn small" onClick={() => { setEditing(r.id); setEditName(r.name); }}>Ändra</button>}
                {!ro && <button className="btn small" onClick={async () => {
                  const name = prompt("Namn på kopian:", r.name + " v2");
                  if (name === null) return;
                  const room = await copyRoom(r.id, name.trim() || r.name + " (kopia)");
                  if (room) window.location.hash = "#/rum/" + room.id;
                }}>Kopiera</button>}
              </div>
            )
          )}
          {zoneRooms.length === 0 && <p className="sub">{ro ? "Inga rum ännu." : "Inga rum ännu — lägg till det första."}</p>}
        </div>
      )}

      {!ro && (
        <div className="row" style={{ marginTop: 14 }}>
          <input type="text" className="grow" placeholder="Nytt rum, t.ex. Kök"
            value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn primary" onClick={add}>+ Lägg till rum</button>
        </div>
      )}
    </div>
  );
}
