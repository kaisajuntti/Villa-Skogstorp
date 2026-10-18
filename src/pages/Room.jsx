import { useEffect, useState } from "react";
import { useSpace } from "../state.js";
import { planKey, spaceKey } from "../storage.js";
import { zoneById } from "../data/zones.js";
import { ColorScheme, DocList, Notes, PlanCollection, InventoryList, InspoGallery, InspoLightbox } from "../components/Spaces.jsx";
import VersionHistory from "../components/VersionHistory.jsx";
import RoomPlanner from "../planner/RoomPlanner.jsx";
import { PLAN_FLOOR, parseAreaRoomId, useFloorPlan, areaNames } from "../floorRooms.js";

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
const OWN_KEY = "vs:v1:ui:ownPlan"; // per device: utrymmen showing their own (archived) drawing instead of the floor crop

export default function Room({ roomId, roomsApi }) {
  const { rooms } = roomsApi;
  const [tab, setTab] = useState("plan");
  const [space, update] = useSpace(roomId);
  const [showInspo, setShowInspo] = useState(() => { try { return localStorage.getItem(INSPO_KEY) !== "0"; } catch { return true; } });
  const [narrow, setNarrow] = useState(() => window.innerWidth < 760);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < 760); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  const toggleInspo = () => setShowInspo((v) => { try { localStorage.setItem(INSPO_KEY, v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  const inspo = space?.inspo || [];
  // A room on a whole-floor plan ("<planId>:<areaId>") or an utrymme grouping some of them ({ plan, areas })
  const virt = parseAreaRoomId(roomId);
  const listed = (rooms || []).find((r) => r.id === roomId);
  const floorPlanId = virt?.planId || listed?.plan || null;
  const floorPlan = useFloorPlan(floorPlanId);
  const [own, setOwn] = useState(() => { try { return (JSON.parse(localStorage.getItem(OWN_KEY)) || []).includes(roomId); } catch { return false; } });
  const toggleOwn = () => setOwn((v) => {
    try { const l = (JSON.parse(localStorage.getItem(OWN_KEY)) || []).filter((x) => x !== roomId); localStorage.setItem(OWN_KEY, JSON.stringify(v ? l : [...l, roomId])); } catch { /* ignore */ }
    return !v;
  });

  if (rooms === null || (virt && floorPlan === null)) return <div className="page"><p className="sub">Laddar …</p></div>;
  let room = listed;
  if (virt) {
    const ar = (floorPlan.areas || []).find((a) => a.id === virt.areaId);
    if (ar) room = { id: roomId, name: (PLAN_FLOOR[virt.planId]?.short || "") + " · " + areaNames(floorPlan.areas)[ar.id], plan: virt.planId, areas: [ar.id], virtual: true };
  }
  if (!room) return <div className="page"><p>Rummet finns inte. <a href="#/">Till översikten</a></p></div>;
  const zone = zoneById(room.zone);
  const fl = PLAN_FLOOR[room.plan];
  const crop = room.plan && room.areas?.length && !(own && !room.virtual);

  return (
    <>
      <div className="room-crumb" style={{ padding: "10px 18px 0" }}>
        <div className="crumb">
          {room.virtual
            ? <><a href={"#/vaning/" + fl?.floor}>Våningar</a> / <a href={"#/vaning/" + fl?.floor}>{fl?.title}</a> / {room.name}</>
            : <><a href="#/">Översikt</a> / <a href={"#/omrade/" + room.zone}>{zone?.name}</a> / {room.name}</>}
        </div>
      </div>
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={"btn" + (tab === id ? " primary" : "")} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        {tab === "plan" && room.plan && !room.virtual && (
          <button className={"btn" + (own ? " primary" : "")} style={{ marginLeft: "auto" }} onClick={toggleOwn}
            title="Utrymmets egen, äldre ritning (arkiv) i stället för utsnittet av hela planet">{own ? "Visa utsnitt av planet" : "Egen ritning (arkiv)"}</button>
        )}
        {tab === "plan" && inspo.length > 0 && (
          <button className={"btn" + (showInspo ? " primary" : "")} style={{ marginLeft: room.plan && !room.virtual ? 0 : "auto" }} onClick={toggleInspo}>
            ✨ Inspo ({inspo.length})
          </button>
        )}
      </div>
      {tab === "plan" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: narrow ? "column" : "row" }}>
          {showInspo && inspo.length > 0 && <InspoPanel items={inspo} narrow={narrow} />}
          <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
            {crop
              ? <RoomPlanner key={room.id + ":crop"} storageKey={planKey(room.plan)} focus={room.areas} title={room.name.toUpperCase()} />
              : <RoomPlanner key={room.id} storageKey={planKey(room.id)} title={room.name.toUpperCase() + (room.plan ? " (ARKIV)" : "")} />}
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
                  <><h2>Planritningens historik</h2><VersionHistory storageKey={planKey(crop ? room.plan : room.id)} /></>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
