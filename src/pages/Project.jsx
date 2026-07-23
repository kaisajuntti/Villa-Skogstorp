import { useRef, useState } from "react";
import { useSpace, exportAll, importAll } from "../state.js";
import { spaceKey } from "../storage.js";
import { canEdit } from "../config.js";
import { ColorScheme, DocList, Notes } from "../components/Spaces.jsx";
import VersionHistory from "../components/VersionHistory.jsx";
import fullPlan from "../assets/situationsplan_full.jpg";

export default function Project() {
  const [space, update] = useSpace("project");
  const [status, setStatus] = useState("");
  const fileRef = useRef(null);

  const doExport = async () => {
    const json = await exportAll();
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "villa-skogstorp-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("Export klar");
  };
  const doImport = async (file) => {
    try {
      const n = await importAll(await file.text());
      setStatus(`Import klar (${n} poster) — laddar om …`);
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setStatus("Import misslyckades: " + e.message);
    }
  };

  if (!space) return <div className="page"><p className="sub">Laddar …</p></div>;

  return (
    <div className="page">
      <h1>PROJEKT</h1>
      <p className="sub">
        Om- och tillbyggnad av enbostadshus · Villa Skogstorp, Karlshamn 5:1 ·
        Bygglovshandling Bjartmar och Hylta, situationsplan rev 2026-06-24, skala 1:200 (A1).
      </p>

      <h2>Situationsplan</h2>
      <a href={fullPlan} target="_blank" rel="noreferrer">
        <img src={fullPlan} alt="Situationsplan v3 — hela planen"
          style={{ width: "100%", height: "auto", border: "1.5px solid var(--ink)", borderRadius: 10 }} />
      </a>
      <p className="sub">
        Tryck på planen för full upplösning. Lägg gärna till original-PDF:en som
        dokument nedan (eller ladda upp den till <span className="mono">public/plans/</span> i repot).
      </p>

      <h2>Färgschema — hela projektet</h2>
      <ColorScheme space={space} update={update} />

      <h2>Dokument & länkar</h2>
      <DocList space={space} update={update} />

      <h2>Anteckningar</h2>
      <Notes space={space} update={update} placeholder="Övergripande anteckningar: beslut, kontakter, tidplan …" />

      <VersionHistory storageKey={spaceKey("project")} />

      <h2>Backup</h2>
      <p className="sub">
        All data sparas lokalt i den här webbläsaren. Exportera regelbundet som backup
        och för att flytta mellan enheter (t.ex. iPad ↔ dator).
      </p>
      <div className="row">
        <button className="btn primary" onClick={doExport}>Exportera allt (JSON)</button>
        {canEdit() && <button className="btn" onClick={() => fileRef.current?.click()}>Importera …</button>}
        <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        <span className="sub" style={{ margin: 0 }}>{status}</span>
      </div>
    </div>
  );
}
