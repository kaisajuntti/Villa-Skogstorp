# CLAUDE.md — Villa Skogstorp

Living context file. Update this whenever a design decision is made or reversed.
Pattern mirrors the Toll project: Claude.ai chat = planning/design, Claude Code = execution,
GitHub = source of truth, this file = shared memory.

## What this is

The digital hub for the renovation and expansion of **Villa Skogstorp** (Karlshamn 5:1,
om-/tillbyggnad av enbostadshus — bygglovshandling by Bjartmar och Hylta arkitekter).

One place that hosts:

1. **Översikt** — the situationsplan as the main entry point. A clickable snippet of the
   building cluster (befintlig byggnad, tillbyggnad, nytt garage, terrass, gårdsplan,
   flyttat förråd) leads into each zone.
2. **Zoner → Rum** — each zone holds a user-editable list of rooms. Each room has a
   **rumsplanerare** (the proven 2D planner born as a Claude artifact for the kitchen)
   plus its own spaces for documents, color schemes and notes.
3. **Projekt** — project-level spaces: documents (incl. the situationsplan PDF),
   overall color scheme, notes, and JSON export/import of everything.

Must work well on iPad Safari (primary device) and iPhone. Target URL:
`kaisajuntti.github.io/Villa-Skogstorp`.

## Deployment (standalone)

This is an independent repository (`kaisajuntti/Villa-Skogstorp`). Deploy is fully
self-contained: `.github/workflows/deploy.yml` builds and publishes GitHub Pages on
every push to `main`, and enables Pages itself via `configure-pages` (`enablement: true`),
so no manual Pages setting is needed. Uses the repo's built-in `GITHUB_TOKEN` only —
no personal access tokens, no external repositories, no secrets to manage.

Live URL: `https://kaisajuntti.github.io/Villa-Skogstorp/`.

## Site structure (hash routing, no backend)

```
#/                  Översikt — clickable situationsplan snippet + zone legend
#/projekt           Project-level: dokument, färgschema, anteckningar, export/import
#/budget            Budget & tidsplan — Etapp 1 (huset, till inflytt), space:budget
#/budget/etapp2     Budget & tidsplan — Etapp 2 (efter inflytt), space:budget2
#/omrade/<zoneId>   Zone: description + room list (add/rename/delete rooms)
#/rum/<roomId>      Room: tabs Planritning · Färger · Dokument · Anteckningar
```

Zones are fixed (from the situationsplan): `tillbyggnad`, `befintlig`, `garage`,
`terrass`, `gardsplan`, `forrad`. Rooms are 100 % user-owned — **never bake
room-specific geometry into code** (lesson learned in planner v1: hardcoded openings
from the architect's drawing were wrong).

## Data model & persistence (localStorage + optional Supabase sync)

```
vs:v1:rooms          [{ id, name, zone }]
vs:v1:plan:<roomId>  { room:{w,l}, openings:[...], items:[...] }   // planner schema, mm
vs:v1:space:<roomId> { colors:[{hex,name,note}], docs:[{title,url,note}], notes:"" }
vs:v1:space:project  same shape as room space
vs:v1:config         { url, key, workspace, user }   // sync config, LOCAL ONLY, never committed
vs:v1:_meta          { <storageKey>: updated_at }    // last-synced marker for merge
```

- `storage.js` is an async facade over localStorage. When a sync config is present it also
  pushes each write to Supabase and `syncPull()` merges remote rows back in.
- Debounced auto-save; save status shown in planner header.
- Export/import: JSON dump of all `vs:v1:*` keys (still available as manual backup).
- Space fields on the space record: `description` (long "Beskrivning" scene-setting) and
  `actions` ("Sammanfattning av åtgärder") at the top of DocList/Dokument; `colors`, `docs`;
  `notes` is reframed as **scrap/kladd**. The single-room PDF is a designed 3-pager:
  **p1** header ("Villa Skogstorp / <Room>") + contact card (from project `cover`) +
  Beskrivning + Åtgärder; **p2** plan drawing (boxed, upper-left ~40%) + up to 6 comment/photo
  **cards** laid out right + bottom (no overlap, text clipped per card); **p3** Färger swatches
  + clickable Länkar (`doc.textWithLink`). Built in `pdf.js` `savePlanPdf`; room data via
  `loadRoomPdfData` (planner) / `loadPlanForPrint` (Projekt per-room button). The whole-project
  PDF (`saveProjectPdf`) still uses the simpler `addRoom` per-room sections.

### Sync (Supabase, added 2026-07)
- Two people share by entering the same `url` + publishable `key` + `workspace` on each
  device (Dela/Sync page). Config lives in localStorage only — **no secrets in the repo**
  (repo is public), which is why URL/key are entered in-app, not built in.
- Supabase schema: `vs_items(workspace,kind,key,data jsonb,updated_at,updated_by)` PK
  (workspace,kind,key); `vs_versions` append-only history; a BEFORE UPDATE trigger on
  `vs_items` snapshots the OLD row into `vs_versions` so **nothing is ever lost**. RLS on,
  anon policies (gated by the private workspace code). SQL in project handoff notes.
- `sync.js` = tiny fetch/PostgREST client (no dependency, no realtime). Storage keys map
  1:1 to (kind,key): rooms→rooms/rooms, plan:<id>→plan/<id>, space:<id>→space/<id>.
- Merge = per-key newest-`updated_at` wins. Different rooms/sections never collide;
  same-key collisions are last-write-wins but the prior value is in `vs_versions`.
- Pull happens on app load and on window focus/visibility; hooks + planner listen for the
  `vs-sync` event and reload (planner skips reload mid-drag; space skips if dirty).
- **Version history UI**: `VersionHistory` (per room plan, per room space, project space)
  lists snapshots with Restore. Restore pushes the chosen data as current (which snapshots
  the current state first). Sync-only feature (versions live in Supabase).

### Photo uploads (Supabase Storage)
- Real photo uploads live in a Supabase Storage bucket **`vs-photos`** (public read),
  not in the jsonb store — see `src/photos.js` (`uploadPhoto`/`deletePhoto`/`photoUrl`).
  Images are downscaled to ~2000px JPEG before upload; the public URL + object `path`
  are stored in the record (URL for display, path for later delete).
- **Documents tab** (`DocList` in `Spaces.jsx`): "📷 Ladda upp bild" adds photos as doc
  entries `{title, photo, path, note}`, rendered as thumbnails (tap → full size).
- **Floorplan**: comments can carry a photo (`photo`,`photoPath` on the comment). The
  callout shows a thumbnail; the selection bar has 📷 Bild / 🔍 Visa / 🗑 Bild.
- Setup (one-time, in Supabase dashboard): create public bucket `vs-photos`, then add
  anon INSERT + DELETE policies on `storage.objects` for that bucket (public buckets
  serve reads automatically). The baked publishable key uploads as the anon role —
  same light-lock posture as the rest of the app (repo is public).

### Background reference image
- Per-room reference image (upload an existing floorplan/photo to trace over).
  Image stored in its own key `vs:v1:bg:<roomId>` (downscaled JPEG, ~data URL)
  so it syncs rarely; the transform `{x,y,wmm,opacity,visible,rot}` lives in the
  plan record (tiny). Rendered as an SVG <image> below walls/items. "Bakgrund"
  mode: upload/replace, opacity, scale, rotate 90, fit-width, drag to position,
  remove. Quick per-session hide/show via the corner button (bgHiddenLocal, not
  saved). New sync kind `bg`.

### Room duplication
- `copyRoom(id, name)` (state.js) duplicates a room's plan + space under a new id/name —
  "Kopiera" button in the zone room list. For quick "Kök v2 / test" variants.

### Budget & tidsplan (Budget.jsx)
- `#/budget` page, stored in its own space record **`space:budget`** (syncs + versions,
  reuses `useSpace("budget")`). Shape (flat tagged items + dated phases):
  `phases: [{ id, name, start, end }]` (start/end = YYYY-MM-DD),
  `items: [{ id, desc, phaseId, roomId, category, entreprenor, del, qty, unit, estUnit }]`.
  Seeds 9 default phases (Markarbeten → Garage) when empty; `roomId` links to `vs:v1:rooms`
  (""=Övergripande); categories = Material/Arbete/Övrigt (kostnadstyp). `entreprenor` is
  free text — name the actual craftsman ("Pelle snickare", "Jonas målare"), not a fixed list.
  `del` = byggdel/moment, also free text with datalist suggestions (`DELAR`: Golv,
  Golvbeklädnad, Yttervägg, Fasad, Innervägg, Väggbeklädnad, Dränering, Tak, VVS, El, Övrigt).
  Legacy "Underentreprenör" category values are tolerated (shown as an extra select option).
- **One value per row**: belopp (col "Summa") = `qty × estUnit` (qty blank → estUnit
  is a lump sum). No offert/faktiskt split — what you enter is what counts. Labour
  (category Arbete) is estimated in hours: qty = timmar, unit "timmar", estUnit = kr/h
  (currently 580 ex moms). Material stays quantity × á-pris. All prices ex moms.
  Numbers stored as strings, parsed comma/space-tolerant. Summary (top card): Total +
  Material/Arbete (kr) + **byggnad-split** (Huvudbostad/Garage/Friggebod/Terrass/Trädgård,
  bucketed by phase *name*). Hours (`hoursOf`) shown
  next to kr in every group header and del sub-header. Budget page uses `className="page wide"`
  (wider layout, `.page.wide` in index.css). **Faser & tidsplan**: each phase shows its
  kostnad + arbetstimmar; a total row shows kr + h + ~veckor (105 h/v = 3 pers × 35 h).
- **Material totalt**-vy (groupBy "material"): aggregates all category=Material rows by
  (desc + unit) across every room/phase into one table (Total mängd + Summa), sorted by kr.
  Composite rows (e.g. "Yttervägg: regel + isolering + gips") sum as a whole (rows are not split).
- **Gruppera efter Fas / Del / Rum / Kategori / Entreprenör** (flat items regrouped
  client-side; leftovers land in an "Ej tilldelad"/"(borttagna rum)"/"Ej angiven …" group).
  Each row edits its tags via dropdowns + free-text entreprenör/del inputs.
- **Underrubriker (`del`)**: within every group card (except when grouping *by* del), rows
  are clustered under del sub-headers (in `DELAR` order, "" last as "Ej angiven del") with a
  per-del subtotal — via `renderBody`/`renderRow`. No del values anywhere → flat table.
- **Tidslinje**: date-based Gantt from phase start/end (month ticks). Phases: rename, set
  start/end dates, reorder (↑/↓), add/remove. Read-only respects `canEdit()`.
- **Yrken, ansvarig, oklart, leverans (2026-10)**: record field `rates: [{typ, rate, crew}]`
  (default Snickare 580/3 pers, Maskinist 1000/1 inkl. maskin, Elektriker 625/1, VVS 625/1; editable
  in "Yrken – timpris & bemanning"). Per item: `work: [{typ, h}]` (several yrken per row),
  `entreprenor` = **Ansvarig** (UI label; default "Pelle" = snickare/totalentreprenör), `oklart: bool`
  (badge + "varav oklart" in summary), `leverans: YYYY-MM-DD` (diamond in Gantt + Leveranser list).
  Row sum = material/UE (`qty × estUnit` or lump) + Σ h × rate. Legacy rows (category Arbete, unit
  timmar) still work and count as **Snickare** hours. Gantt has a "Per yrke" section: each yrke works
  from phase start for ceil(h / (crew × 7)) workdays; red bar = longer than the phase (bottleneck).
  Phase view keeps row order (chronological) — del sub-header starts a new run when del changes.
  Mark is split: **p0 Markarbeten 1 – före grund** and **pMARK2 Markarbeten 2 – efter grund**
  (parallel with Stomme). Phase dates are computed (scripts) as max over yrken of ceil(h/(crew×7)).
  **Row = Material + Extern + Arbete (2026-10)**: Material = `qty × estUnit` (or estUnit as lump) —
  what you buy; **Extern** = `ext` (string kr) — UE/tjänst at a fixed price (kommun, åkeri, plåtslagare,
  borrfirma, El/VVS lumps …) + `extNote` (short "vad/vem" text shown under the amount); **Arbete** = `work` × rates. No category column any more (`category`
  removed from data; migrated UE/tjänst amounts → `ext`). Del + Rum are shown as small tags under the
  description (empty del highlighted) instead of columns. Summary: Material · Extern · Arbete.
  **Material lines (2026-10)**: optional `mat: [{desc, qty, unit, price, leverans?}]` on a row; when
  present, Material = Σ lines (qty × price, or price as lump) and qty/unit/estUnit are unused. UI: the
  row's Material cell shows the total + "▸ N rader" toggle; expanded sub-table edits lines; "+ specificera"
  converts a single-material row into lines. **Since 2026-10 every row with material uses `mat`**
  (all migrated); the cell always shows total + "▸ N rad(er)" (+ "36 lm × 150" for a single line), rows
  without material show "+ material". Line `leverans` dates feed the Gantt/Materialleveranser.
  **El and VVS are own yrken (hours × 625 + material), not Extern** — Extern is only for truly bought-in
  services (kommun, åkeri, plåtslagare, borrfirma, konstruktör …).
  **pRIVF "Rivning invändigt + murstock – löpande"** (2026-10): background phase from 15 Oct to the day
  before Renovering befintlig; done when time allows and **excluded from the critical-path chain**
  (p0∥p1 → Grund → Stomme …). p1 = only what must go day 1 (friggebod in the way of schakt, carport,
  källartrappa). Goal: **tätt hus på tillbyggnaden före jul** (Stomme ends ~17 Dec).
  **7 h/dag/person is deliberate slack** (vs 8 h ≈ 10 %) — don't add a separate buffer on top.
- **Etapp 2** (`#/budget/etapp2`, record `space:budget2`, same component via `id` prop; tabs at
  top switch etapp). Etapp 2 = after inflytt: Fokus 1 terrass (one OPLANERAD lump-sum row) +
  trädgård + gårdsplan (200 m² smågatsten), Fokus 2 grund garage/friggebod (okt 2027, före tjäle),
  friggebod + garage (jan 2028, **papptak**). Byggnad-split now derives from the phase *name*
  (Garage/Friggebod/Terrass/Trädgård|Gårdsplan, else Huvudbostad), not hardcoded phase ids.
- **Etapp 1 tidsplan (2026-10)**: Mark ∥ Rivning (4 pers, 28 h/d) → Grund ∥ Bergvärme → Stomme
  (tillbyggnad tätt med råspont+papp, papp mot befintlig papp — ingen plåt på vintern) →
  Installationer → Inredning & ytskikt → Renovering befintlig → Målning inv → Inredning →
  **pUTV Utvändigt vår** (april: all plåt, pappdelen av befintligt tak, skorsten, puts, balkonger) →
  pov slutstäd/slutbesked → **INFLYTT** → pMALUT fasadmålning + snickarglädje (efter inflytt).
  Röda dagar 2027 (6/1, 26/3, 29/3, 6/5, 25/6) räknas bort. Garage/friggebod/terrass flyttade till etapp 2;
  rivning av friggebod + carport ligger kvar i etapp 1. Matjord bakom tillbyggnaden läggs i etapp 1
  (maskin når inte dit efteråt).
- Deferred (non-breaking): moms/ROT layer, budget in PDF export, per-room budget on room page.
- **TODO (önskat 2026-10):** "Material totalt"-vyn ska sorteras kronologiskt och grupperas/markeras per fas
  (i dag aggregerad per benämning + enhet, sorterad på kr).

## Byggnadsfakta (för budget/tidsplan – bekräftat med beställaren 2026-10)

- **Tillbyggnaden** = den korsformade flygeln i **väster** (situationsplanen, 4010 × 7020 m.fl.), plan 1 + 2 + ny
  källare under. Den sträcker sig fram till tornet men **tornet ingår inte**.
- **Tornet sitter ovanför entrén mot gårdsplanen och är en del av BEFINTLIG byggnad**. Entrédörren (pardörr) hör
  till Renovering befintlig, inte till tillbyggnadens stomme.
- **Ny källare är sutteräng**: norrsidan (inkl. under trapphuset) helt under mark, väster ~50 %, söder ~0,5 m under
  mark. Synliga delar kläs med **naturstensplattor** (ska se ut som naturstenssockel) på bredare sockelplåt.
- Gamla gråstensmuren mot befintlig källare/krypgrund **rivs och ersätts** med bärande Exakt-vägg (del av grunden);
  stämpning sätts vid schakt och tas bort när väggen är uppmurad. Ingen valvöppning behövs.
- Gamla källartrappan ligger **inte** där den nya trappan kommer – ingen koppling.
- Murstocken rivs från taket ner till bjälklaget på plan 1 (krypgrund under). Tegel och gråsten sparas på tomten.
- Befintligt tak: hälften plåt, hälften papp; tillbyggnaden ansluter mot **pappdelen**.
- Gamla krypgrunden är uteluftsventilerad (otät stenfot) – **ska inte tätas**; bjälklaget ovanför ska vara tätt.
- Ansvariga: **Pelle** = snickare/totalentreprenör (default). **Linus** = fönster och dörrar.
- Fönster/dörrar från **Snickarglädje** (snickargladje.com, prislistor exkl. moms) – **25 % rabatt**.
- **Ventilation (beslutat 2026-10)**: frånluft (F) i stället för FTX. Tillbyggnaden: frånluftsmodul (NIBE FLM) mot
  bergvärmen i **teknikrum = förrådet i tillbyggnadens källare** (bekräftat; INSTALL i befintlig källare är dagens plats för installationerna – dålig plats, ska inte användas), schakt **S1** intill tvättnedkastet (WC/D plan 2 + tvätt/städ plan 1 → källarens
  undertak), dusch + bastu direkt. Befintligt: vindsfläkt för master bath + WC entré; köket = **takfläkt över ön** med
  fjärrmotor på vinden, kanal i kökets tak till schakt **S2** (garderobshörnet i walk-in closet ovanför skafferiet).
  Tilluft via fönsterventiler (beställs med fönstren) + uteluftsdon bakom radiatorer i sovrummen. Inget don i gymmet,
  ingen extern kaminluft (för nu). Ingen murstock/fundament i källaren – prefab lättskorsten. Ritningar:
  `public/plans/ventilation/*.jpg`, länkade i Projekt → Dokument.

## Rumsplanerare (ported from kok-planner-v2 artifact — behavior parity)

Core UX model — three-step flow (settled, do not change without discussion):

1. **Rum** — room rectangle w × l in mm (numeric inputs).
2. **Öppningar** — Dörr / Pardörr / Fönster; tap a wall to cut in, drag along wall,
   steppers resize. Openings live ON walls, never floating.
3. **Inredning** — palette with standard mm sizes; drag, resize/rotate/duplicate/delete.

Invariants:
- All dimensions in **mm**, integers. UI language **Swedish**. Snap grid **50 mm**.
- Wall thickness 200 mm (display only; interior coords exclude walls).
- Selected furniture shows dashed mm guides to all four walls (aisle check, target
  1100–1200 for kitchen walkways). Selected opening shows distances to both corners.
- **Mät** tool: ephemeral rulers (`measures`, not saved) plus **persistent dimension
  lines** (`dims:[{id,a,b,off}]`, saved in the plan, synced, in the PDF). Toggle "Spara
  mått" makes a completed measurement a saved dim. A dim renders as an **offset parallel
  dimension line** (extension lines + end ticks + length label) so it sits beside the
  drawing, not over it; drag the måttlinje sideways to set the perpendicular `off`
  (signed = side), "⇄ Byt sida" flips it, and it's selectable/deletable in Mät mode only.
  NOTE: `snapCandidates`/all opening code must use `openGeom(o)` (not `wallGeom(o.wall)`),
  else a freeform-wall opening makes snapping throw and Mät/Väggar taps die.
- Rotation = swap w/h. Door = leaf + quarter-arc swing, `flip` = hinge side.
- Furniture labels (`itemLabel` in planSvg.js, used by planner + PDF): default centred and
  oriented along the object's longer side, sized to fit. Manual override per item: `lx`/`ly`
  (label offset from centre) + `lrot` (flip orientation) — when a label is selected a dashed
  box appears that you drag to reposition (`kind:"label"` drag), with a leader line when it
  sits outside the object; selection bar has "⟲ Vrid text" and "↺ Text mitt" (reset).
  Objects >50% hidden under a later object get a **dashed footprint** drawn on top
  (`coveredItemIds`). Item bodies render first, then covered footprints, then labels.
- **Inventarielista** (Dokument tab, `InventoryList`): lists every drawn object (name +
  W×H) with an editable comment + link per object. Names/sizes read live from the plan
  (`usePlanItems`); notes/links stored on the space record as `inventory[itemId]={note,url}`.
  Also rendered on the room PDF's page 3.
- Walls render as segments minus sorted openings (`wallSegs`).
- Freeform walls (Väggar mode) carry a per-wall thickness `w`: **Yttervägg 300 mm**,
  **Innervägg 100 mm**, or a **custom "Bredd" input** (20–1000 mm; older walls without
  `w` fall back to 200 mm). Thickness captured when the polyline starts. Rendered as
  **per-segment butt-cap lines with square corner fillers** (sharp rectangle ends, not
  rounded), split around any openings on that segment.
- **Openings on any wall**: openings live on a room wall (`o.wall` = N/S/E/W) OR a freeform
  wall segment (`o.wallId` + `o.seg`, pos measured along that segment). `openGeom(o)` returns
  a unified `{A,along,inward,L,T,free}`; placement, drag (projection-based), rendering, and
  the static print renderer all use it. Wall thickness `T` = 200 (room) or the wall's `w`
  (freeform). Freeform openings are skipped by `setRoomDim` (not tied to room size).
- **Kommentarer**: note callouts stored as `comments:[{id,x,y,tx,ty,text,photo?,photoPath?}]`
  (plus `dir` on photos) in the plan record (so they sync). Every marker shows a **number**
  (1-based index, identical in the plan and the Documents collection). Two visual types by
  whether a photo is attached: a text **comment = numbered dot**; a **photo = numbered dot +
  a rotatable arrow** (shaft+head) pointing in the photo's direction — aim it by dragging the
  arrowhead (snaps to 15°) or "⟳ Vrid pil" (45° steps), stored as `dir` degrees. The content
  card (photo + text) is hidden by default and only shows when the marker is selected —
  rendered at `(x,y)`, offset from the marker with a leader line, marker drawn last so the
  card never covers it. Tapping the photo (or "🔍 Förstora") enlarges it **in-plan** (no new
  window; `bigPhoto` state). "💬 Kommentar" mode has a Kommentar/Bild toggle for what a tap
  creates. Photos live in Supabase Storage (see photo-uploads section). All of a room's
  comments+photos are auto-collected read-only, numbered, in that room's **Dokument** tab
  ("Från planritningen", `PlanCollection`) for print-outs.
- **Projekt → "Kommentarer & bilder per rum"** (`RoomsCommentBrowser`): a room-tabbed
  browser of every room's plan comments/photos (numbered), for browsing across rooms.
- **PDF export (saved file, no print dialog)**: `planner/pdf.js` (jsPDF, **lazy-loaded** via
  dynamic `import()` so it stays out of the main bundle) builds and **downloads a real .pdf**.
  `savePlanPdf` = one room; `saveProjectPdf` = cover page (from `cover`) + **Färgschema**
  (project `colors`) + one section per room. The plan SVG (`buildPlanSvg`) is rasterized to a
  JPEG via canvas (`svgToJpeg`; the plan SVG has no remote images so the canvas stays clean),
  comment photos are embedded (`fetchDataUrl`), room `description` is included. Buttons: "⬇ PDF"
  in the planner header, "🖨"/"⬇ Skapa PDF …" in `RoomsCommentBrowser`. The old HTML
  `window.print()` path (`printPlanDoc`/`printProjectDoc` in planSvg.js) is retired/unused.
- Legacy print helper (kept for reference, unused): shared static renderer `planSvg.js` (`buildPlanSvg` → SVG string, `printPlanDoc`
  → print-only section + `window.print()`, reliable on iPad Safari, no iframe/new tab). Used
  from the planner header (`printPlan`, live state) AND per-room in the Projekt browser
  (`RoomsCommentBrowser`, loads the plan via `loadPlanForPrint` so any room prints without
  opening it). Output = plan drawing (walls/openings/furniture/numbered comment markers) +
  the numbered comments/photos list. Keep `buildPlanSvg` in sync with the planner's SVG.
  `printProjectDoc({ sections })` prints a **whole-project PDF**: a cover page (title + TOC)
  followed by one page-broken room section each — button "🖨 Skapa PDF för hela projektet"
  in `RoomsCommentBrowser`. `printPlanDoc`/`printProjectDoc` share `roomSection`/`doPrint`.
  The whole-project cover page is filled from **Projekt → "Försättsblad (PDF)"** (`CoverInfo`),
  stored on the project space as `cover` {projectName, officialName, houseAddress, contactName,
  email, phone, contactAddress, freeText} and passed to `printProjectDoc`.
- **PDF architecture (current):** `addRoomPages(doc, data, first)` renders one room's full
  3 pages; `savePlanPdf` = one room; `saveProjectPdf` = a cover page (+ optional project-wide
  färgschema) then **every room's full 3-page layout stacked** ("stor bibba"). `sectionFor`
  (Spaces.jsx) returns the full per-room data used by both. `addRoom`/`addColors` are the
  older simpler helpers (`addRoom` now unused).
- **Free pan**: dragging empty canvas pans the view at any zoom (not just when zoomed
  in) so a selected object can be slid out from behind the selection toolbar; ⤢ resets.
- Pinch-zoom 1×–8× with capture-phase pointer tracking; letterbox-aware coordinate
  mapping (`s = min(rect.w/vb.w, rect.h/vb.h)` + centering offsets); `touchAction:none`.
- Planner is one component (`src/planner/RoomPlanner.jsx`) taking `storageKey` + `title`
  props. Split per M1 in ROADMAP only with behavior parity.

## Visual language (settled)

Architectural-drawing aesthetic: paper `#FAF8F3`, ink `#33312E`, accent slate blue
`#5A7A8C`, cabinet fill `#E4EAED`, alert `#9a4a3a`. Dimensions in monospace
(ui-monospace stack); labels in Avenir Next/Helvetica. Poché walls, dashed swing arcs.
No default-looking UI kit styling. The overview uses the real situationsplan raster with
SVG hotspot overlays (blue tint on hover/selection).

## Tech plan

- Vite + React, plain JS (no TS). Minimal deps: react, react-dom, vite, plugin-react.
  Hand-rolled hash router (~30 lines) — keep it boring.
- `vite.config.js` → `base: '/Villa-Skogstorp/'`.
- Situationsplan assets: `public/plans/Situationsplan_v3.pdf` (original),
  `src/assets/situationsplan_full.png` (1600 px render), `src/assets/cluster.png`
  (building-cluster crop 1320×1193 — hotspot polygons in `src/data/zones.js` are in
  this pixel space).
- No backend, no accounts, no build-time data.

## Out of scope for now (discussed, deliberately deferred)

Photo uploads (localStorage can't hold them — docs are links + notes for now),
room-level floor plans traced from architect drawings, multi-floor view, share links,
non-rectangular rooms, export PNG/PDF at scale. See ROADMAP.md for ordering.
