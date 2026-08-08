import { useEffect, useState } from "react";
import { useRooms } from "./state.js";
import { gateEnabled, isUnlocked, canEdit, clearAccess } from "./config.js";
import { syncPull } from "./storage.js";
import Overview from "./pages/Overview.jsx";
import Project from "./pages/Project.jsx";
import Zone from "./pages/Zone.jsx";
import Room from "./pages/Room.jsx";
import Lock from "./pages/Lock.jsx";

// Tiny hash router: #/ · #/projekt · #/omrade/<id> · #/rum/<id>
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [seg, id] = h.split("/");
  if (seg === "projekt") return { page: "projekt" };
  if (seg === "omrade" && id) return { page: "omrade", id };
  if (seg === "rum" && id) return { page: "rum", id };
  return { page: "hem" };
}

export default function App() {
  const [unlocked, setUnlockedState] = useState(isUnlocked());
  useEffect(() => {
    const onCfg = () => setUnlockedState(isUnlocked());
    window.addEventListener("vs-config", onCfg);
    return () => window.removeEventListener("vs-config", onCfg);
  }, []);
  if (!unlocked) return <Lock onUnlocked={() => setUnlockedState(true)} />;
  return <AppInner />;
}

function AppInner() {
  const [route, setRoute] = useState(parseHash());
  const roomsApi = useRooms();

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (route.page !== "rum") window.scrollTo(0, 0);
  }, [route]);

  // Pull on load and whenever the app regains focus.
  useEffect(() => {
    const pull = () => { if (document.visibilityState === "visible") syncPull(); };
    pull();
    document.addEventListener("visibilitychange", pull);
    window.addEventListener("focus", pull);
    return () => {
      document.removeEventListener("visibilitychange", pull);
      window.removeEventListener("focus", pull);
    };
  }, []);

  const isRoom = route.page === "rum";

  return (
    <div className="app">
      <nav className="nav">
        <a className="brand" href="#/">VILLA SKOGSTORP</a>
        <a className={"navlink" + (route.page === "hem" ? " active" : "")} href="#/">Översikt</a>
        <a className={"navlink" + (route.page === "projekt" ? " active" : "")} href="#/projekt">Projekt</a>
        {gateEnabled && (
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {!canEdit() && <span className="zonechip" title="Skrivskyddad – ange redigeringslösenord för att ändra">Skrivskyddad</span>}
            <button className="navlink" style={{ background: "none", border: "none", cursor: "pointer" }}
              title="Lås appen" onClick={() => { if (confirm("Lås appen på den här enheten?")) clearAccess(); }}>Lås 🔒</button>
          </span>
        )}
      </nav>
      <div className={"main" + (isRoom ? " noscroll" : "")}>
        {route.page === "hem" && <Overview rooms={roomsApi.rooms} />}
        {route.page === "projekt" && <Project />}
        {route.page === "omrade" && <Zone zoneId={route.id} roomsApi={roomsApi} />}
        {route.page === "rum" && <Room roomId={route.id} roomsApi={roomsApi} />}
      </div>
    </div>
  );
}
