// Projekt = the project PDF, section by section (same order, same numbering).
// Own-data sections (1–5, 8, 9) are written here; linked sections (6 Budget, 7 Våningar &
// utrymmen) show a summary + PDF options, their content is edited on their own pages.
// Things that are not part of the PDF live under "Övrigt" at the bottom.
import { useRef, useState } from "react";
import { useSpace, useRooms, exportAll, importAll } from "../state.js";
import { spaceKey } from "../storage.js";
import { canEdit } from "../config.js";
import { ColorScheme, DocList, Notes, RoomsCommentBrowser, CoverInfo, InspoGallery } from "../components/Spaces.jsx";
import { Contacts, TechChoices } from "../components/ProjectInfo.jsx";
import {
  Section, usePdfOpts, Chapters, Decisions, Attachments, BudgetOptions, useBudgetSummary,
  FloorsRoomsOptions, PdfBuilder, CoverImagePicker,
} from "../components/ProjectSections.jsx";
import VersionHistory from "../components/VersionHistory.jsx";
import fullPlan from "../assets/situationsplan_full.jpg";

// [id, nr, title] — the PDF's table of contents.
export const PDF_SECTIONS = [
  ["cover", 1, "Försättsblad"],
  ["contacts", 2, "Kontakter & roller"],
  ["chapters", 3, "Projektbeskrivning"],
  ["tech", 4, "Tekniska val"],
  ["decisions", 5, "Beslutslogg"],
  ["budget", 6, "Arbetsplan & budget"],
  ["floors", 7, "Våningar & utrymmen"],
  ["colors", 8, "Färgschema"],
  ["attachments", 9, "Bilagor"],
];

export default function Project() {
  const [space, update] = useSpace("project");
  const { rooms } = useRooms();
  const sum = useBudgetSummary();
  const [status, setStatus] = useState("");
  const [showOther, setShowOther] = useState(false);
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
  const opts = usePdfOptsSafe(space, update);
  const T = Object.fromEntries(PDF_SECTIONS.map(([id, n, t]) => [id, { n, t }]));
  const S = (id, summary, children, extra = {}) => (
    <Section key={id} id={id} n={T[id].n} title={T[id].t} summary={summary} opts={opts} {...extra}>{children}</Section>
  );
  const cover = space.cover || {};
  const chapters = space.chapters || [];
  const offCh = opts.sec("chapters").off || [];
  const atts = space.attachments || [];
  const floorOpts = opts.sec("floors");
  const roomsOn = (rooms || []).filter((r) => (floorOpts.rooms?.[r.id]?.on ?? true)).length;
  const budgetOpts = opts.sec("budget");

  return (
    <div className="page">
      <h1>PROJEKT</h1>
      <p className="sub">
        Sidan är uppbyggd som projekt-PDF:en – samma avsnitt i samma ordning. Text och bilder i avsnitt 1–5, 8 och 9
        skrivs här; budget och utrymmen hämtas från sina egna sidor och här väljer du bara vad som ska med.
      </p>

      <PdfBuilder opts={opts} sections={PDF_SECTIONS} />

      {S("cover", [cover.projectName, cover.officialName, cover.houseAddress].filter(Boolean).join(" · ") || "Ej ifyllt",
        <><CoverInfo space={space} update={update} /><CoverImagePicker space={space} opts={opts} /></>)}

      {S("contacts", `${(space.contacts || []).length} kontakter`, <>
        <Contacts space={space} update={update} />
        <label style={{ fontSize: 13, display: "block", marginTop: 10 }}>
          <input type="checkbox" disabled={!canEdit()} checked={opts.sec("contacts").details !== false}
            onChange={(e) => opts.setSec("contacts", { details: e.target.checked })} /> Visa telefon och e-post i PDF:en
        </label>
      </>)}

      {S("chapters", `${chapters.length} kapitel${offCh.length ? ` (${offCh.length} ej i PDF)` : ""} · ${chapters.reduce((s, c) => s + (c.photos || []).length, 0)} bilder · ${(space.inspo || []).length} inspirationsbilder`, <>
        <Chapters space={space} update={update} opts={opts} />
        <div style={{ marginTop: 18 }}><InspoGallery space={space} update={update} /></div>
      </>, { defaultOpen: true })}

      {S("tech", `${(space.tech || []).length} val`, <TechChoices space={space} update={update} />)}

      {S("decisions", `${(space.decisions || []).length} beslut`, <Decisions space={space} update={update} />)}

      {S("budget", `Länkad från Budget · ${(budgetOpts.etapper || ["budget"]).map((e) => (e === "budget" ? "Etapp 1" : "Etapp 2")).join(" + ")} · ${(budgetOpts.views || ["summary", "gantt", "phases"]).length} vyer${budgetOpts.prices === false ? " · utan belopp" : ""}`,
        <BudgetOptions opts={opts} sum={sum} />)}

      {S("floors", `Länkad från Våningar och utrymmena · ${roomsOn} av ${(rooms || []).length} utrymmen med`,
        <FloorsRoomsOptions opts={opts} rooms={rooms} />)}

      {S("colors", `${(space.colors || []).length} kulörer`, <ColorScheme space={space} update={update} />)}

      {S("attachments", `${atts.filter((a) => a.on !== false).length} av ${atts.length} bilagor med`, <Attachments space={space} update={update} />)}

      <h2 style={{ marginTop: 34, cursor: "pointer" }} onClick={() => setShowOther((v) => !v)}>
        Övrigt (ingår inte i PDF:en) {showOther ? "▾" : "▸"}
      </h2>
      {showOther && <>
        <h3>Situationsplan</h3>
        <a href={fullPlan} target="_blank" rel="noreferrer">
          <img src={fullPlan} alt="Situationsplan v3 — hela planen"
            style={{ width: "100%", height: "auto", border: "1.5px solid var(--ink)", borderRadius: 10 }} />
        </a>

        <h3>Dokument & länkar</h3>
        <DocList space={space} update={update} />

        <h3>Kommentarer & bilder per rum</h3>
        <p className="sub">Allt som placerats på utrymmenas planritningar, samlat per utrymme. Här finns även den gamla PDF-funktionen tills den nya är klar.</p>
        <RoomsCommentBrowser cover={space.cover} colors={space.colors} />

        <h3>Anteckningar</h3>
        <Notes space={space} update={update} placeholder="Kladd: beslut, kontakter, tidplan, att-göra …" />

        <VersionHistory storageKey={spaceKey("project")} />

        <h3>Backup</h3>
        <p className="sub">Exportera allt som JSON (backup). Bilder och bilagor ligger i molnet och följer inte med i filen.</p>
        <div className="row">
          <button className="btn primary" onClick={doExport}>Exportera allt (JSON)</button>
          {canEdit() && <button className="btn" onClick={() => fileRef.current?.click()}>Importera …</button>}
          <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          <span className="sub" style={{ margin: 0 }}>{status}</span>
        </div>
      </>}
    </div>
  );
}
// usePdfOpts has no hooks inside, so it is safe to call after the loading guard.
const usePdfOptsSafe = usePdfOpts;
