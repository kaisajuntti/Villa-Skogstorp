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
#/vaning/<id>       Våningar — kallare | plan1 | plan2: architect plan, tinted befintligt/tillbyggnad, clickable utrymmen
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

- `storage.js` is an async facade over localStorage — **except big values (`vs:v1:bg:*` images) which live in
  IndexedDB** (+ memory cache; `migrateBigKeys` moves old ones out of localStorage). Safari caps localStorage at ~5 MB
  and the images exceeded it (2026-10-04: sync aborted → Våningar empty on iPad). Pulls are **incremental**
  (`vs:v1:_lastpull` = newest server updated_at; `updated_at=gt.(last − 10 min)`), first pull is full.
- (orig.) `storage.js` is an async facade over localStorage. When a sync config is present it also
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
- **Per-object merge for plans (2026-10-18)** (`src/merge.js`, `storage.js` `pushPlanMerged`): plan keys are pushed through a
  per-key queue; if the server row changed since our last sync (updated_at ≠ `_meta`), a three-way merge (base =
  `vs:v1:_base:plan:<id>`, last synced copy) merges id-lists (walls, openings, items, dims, comments, areas) per object and
  per field — two people can edit different things in the same floor plan at once; true same-field conflicts = ours wins
  (prior value in vs_versions). Written with a conditional PATCH (`updateIf`, `updated_at=eq.<prev>`), retried ≤ 4×.
- **Version history UI**: `VersionHistory` (per room plan, per room space, project space)
  lists snapshots with Restore. Restore pushes the chosen data as current (which snapshots
  the current state first). Sync-only feature (versions live in Supabase).

### Inloggning & säkerhet (Supabase Auth, 2026-10)
- The old SHA-256 password gate (`Lock.jsx`, VIEW/EDIT hashes) is **replaced** by real Supabase Auth
  (email + password): `src/auth.js` (REST login/refresh/logout, session in `vs:v1:session`,
  `authHeaders()` = publishable apikey + user's access token), `src/pages/Login.jsx`, nav "Logga ut".
- Access level = `app_metadata.access` ('edit' | 'view', set by admin via SQL — users can't change it);
  anything else = read-only in the UI and **no access at all** in RLS.
- RLS SQL in `supabase/`: `01_auth.sql` (vs_access() helper, authenticated policies, vs-photos
  insert/delete for 'edit', **private bucket `vs-docs`** for sensitive docs — signed URLs) and
  `02_lockdown.sql` (drops the old anon policies; run only after every device has logged in).
  Public signups must be **off** (Authentication → Sign In / Providers).
- **Sensitive material (kontrakt, KA-handlingar, kontakter/personuppgifter) never goes in the repo or
  `public/`** — the repo is public. It lives in Supabase (`vs-docs` / space records) behind login.
- **Claude administers Supabase** (the owner does not want to click in the dashboard): a Supabase personal
  access token in the environment variable `SUPABASE_ACCESS_TOKEN` (cloud environment settings, never in
  chat/repo). `scripts/vsapi.py` uses it for SQL (`sql()`, Management API), the server key (data scripts,
  bypasses RLS) and user admin. Accounts: **one per person** (Claude creates them on request via the Auth
  admin API, auto-confirmed, `app_metadata.access` = 'edit' or 'view').
- **Rollout DONE (2026-10-04):** signups off, accounts created, `01_auth.sql` + `02_lockdown.sql` applied, login
  code on main. Anonymous reads now return nothing; scripts use `scripts/vsapi.py` with `SUPABASE_ACCESS_TOKEN`.

### Projektinfo för projekt-PDF (2026-10, steg 2)
- Project space gets `contacts: [{id, role, name, company, phone, email, note}]` (**Kontakter & roller**) and
  `tech: [{id, area, choice, detail}]` (**Tekniska val**) — `src/components/ProjectInfo.jsx` (`RowList`:
  compact rows, tap → edit card, ↑/↓, Ta bort). Shown at the top of Projekt. Seeded by Claude (6 contacts,
  10 tech choices from the decisions in this file). Contacts = personal data → only in Supabase.
- **Projekt page = the project PDF, 1:1 (2026-10-04).** `src/pages/Project.jsx` (`PDF_SECTIONS`) +
  `src/components/ProjectSections.jsx`. Sections, each a collapsible card with "I PDF" checkbox + "⬇ PDF" (single-section
  PDF, wired in step 2): 1 Försättsblad (`cover` + cover image) · 2 Kontakter · 3 Projektbeskrivning (`chapters:[{id,title,
  text,photos:[{id,photo?,path?,ref?,caption}]}]` — `ref` = private drawing bg key, e.g. `floor-plan1`,
  `doc-bygglov-fasad-soder`; + project `inspo`) · 4 Tekniska val · 5 Beslutslogg (`decisions:[{id,date,area,decision,why}]`)
  + part 2 **Att besluta / att göra** (`todos:[{id,area,item,detail,who,due,status: Öppen|Pågår|Klar}]`, in the PDF unless
  `pdf.decisions.todos === false`; seeded 2026-10-04 with startbesked requirements from the bygglovsbeslut)
  · 6 Arbetsplan & budget (LINKED from Budget: etapper, views, detail, prices on/off) · 7 Våningar & utrymmen (LINKED:
  per floor overview on/off, per utrymme on/off + detail full|compact, inspo on/off) · 8 Färgschema · 9 Bilagor
  (`attachments:[{id,title,path,size,type,on}]`, private bucket **vs-docs**, `uploadDoc/signedDocUrl/deleteDoc` in photos.js).
  All PDF choices on the project space as `pdf = { <sectionId>: { on, …opts }, filename }` (synced). "Övrigt (ingår inte i
  PDF:en)" at the bottom: situationsplan, Dokument & länkar, RoomsCommentBrowser (old PDF until step 2), kladd, backup.
- Bygglov sheets (situationsplan, 4 fasader, sektioner, terrass, garage, 2 vyer) stored privately as `vs:v1:bg:doc-bygglov-*`
  and listed in `space:floors.sheets`; the full bygglov PDF is attachment A in vs-docs. Chapters 1–5 + 23 decisions seeded
  by Claude as drafts ("[Utkast …]"). **No colours/finishes are decided** — never write inspo colours into Färger.
- **PDF generator (step 2, 2026-10-04)** `src/planner/projectPdf.js` (lazy-loaded) `buildProjectPdf({ project, ids })`:
  "Skapa PDF" = all sections with "I PDF" on, in PDF order; each section's "⬇ PDF" = that section alone. Cover (+ cover
  image) → Innehåll (TOC with page numbers + links, sections renumbered 1… among those included) → sections. Empty
  sections are skipped. Budget: per etapp summary figures, per fas (sums | rows | rows + material lines), material totalt,
  per yrke, leveranser, Gantt on a landscape page; `prices:false` hides every amount. Våningar: floor overview (floor image
  + tints + labels drawn on canvas) then each utrymme via **`renderRoom`** (compact flow, 2026-10-05 — the old 3-pager
  spread one image per page): header · Beskrivning/Åtgärder · plan with numbered comment cards beside it · 4-col photo
  thumbnails · 3-col inspo · links list · colour chips · inventory (commented objects as table, rest grouped on one line).
  A room continues on the same page when header+text+plan fit. full = all of it, compact = text + plan (+ inspo).
  **Budget order (2026-10-05): per etapp the Gantt first (landscape), then "Faser & tidsplan" (the phase list as on the
  Budget page: name, när, arbete per yrke, kostnad), summary, yrken, leveranser, then poster per fas and material.** Poster per fas shows each row's **material lines expanded** under it
  (default detail = "lines", 6.9 pt sub-rows spanning Post+Ansvarig; a lone anonymous "Material" line is skipped); long
  phase titles wrap instead of running into the date/sum text (`W.h3`). Bilagor: fetched via signed URL before rendering (page counts known), "Bilaga A" divider page, then
  **pdf-lib** inserts the attachment's pages after its divider. Attachment `mode`: `"full"` (default, pages included) or
  `"list"` (only named in the bilageförteckning, "Listad – separat" — e.g. A1 construction drawings). Current bilagor
  (2026-10-04, private vs-docs): A bygglovsbeslut, B strandskyddsdispens, C tomtplatsavgränsning, D antikvariskt utlåtande
  (Restaurera), E bygglovshandling rev 260616 (full); F–H K-01-0-001 / K-15-1-100 / K-20-2-100 konstruktion (list). Footer "n / N" on every page but the cover.
  Budget arithmetic is shared in **`src/budgetCalc.js`** (`computeBudget`) — Budget page, Projekt summary and PDF.
  **jsPDF fonts = Windows-1252 only**: one char outside it (≈ → ✓ emoji) garbles the whole line, so `newDoc()` (pdf.js)
  patches text/splitTextToSize/getTextWidth to run `clean()` — always create docs via `newDoc()`.

### Utgifter (2026-10-14)
- `#/utgifter` (`src/pages/Expenses.jsx`, nav "Utgifter"): register invoices/receipts. Record **`space:expenses`** =
  `{ items:[{ id, date, supplier, what, amount (INKL. moms, as on the invoice), vat? (blank = 20 % of amount), paidBy:
  Pelle|Linus|Emma, status: Obetald|Betald, due, etapp: budget|budget2, phaseId, part (T/R/G/M), files:[{path,name,type,
  size}], note }] }`. Files go to the **private `vs-docs`** bucket (`uploadDoc`, opened via signed URL). Summary: spenderat,
  obetalt (förfallna red), per betalare, **utfall vs budget per fas and per byggdel** (budget from `computeBudget`, exkl.
  moms). Same exkl./inkl. moms toggle as Budget (`vs:v1:ui:moms`). Linking = fas + byggdel only (owner: not per budget row).
- **Konto** (`#/konto`, nav): "Byt lösenord" (PUT /auth/v1/user). Login has "Glömt lösenord?" → /auth/v1/recover with
  redirect to the live site; the link lands as `#access_token…&type=recovery` → `RecoverPassword` sets a new password.
  Auth `site_url`/`uri_allow_list` set to the live URL (2026-10-14). No custom SMTP → Supabase's default mailer may only
  deliver to project team addresses; the reliable path is Byt lösenord while still logged in.

### Våningar & utrymmen (2026-10)
- New concept **utrymme** = one entry in `vs:v1:rooms` that may cover several rooms. 12 utrymmen drawn from the
  bygglov rev 2026-06-16 (ids `u-k-*`, `u-p1-*`, `u-p2-*`, names prefixed "K ·", "P1 ·", "P2 ·"): K Nya/Gamla källaren;
  P1 Gästrum, Tvätt, Arbetsrum, Entré/hallar/WC/städ/trapphall, Vardagsrum & matsal, Kök; P2 Sovrum & WC/D,
  Allrum/rum/trapphall, Master bedroom/walk-in/bathroom, Balkong. **Old rooms removed from the list 2026-10-04**: their
  description/actions/notes/docs/colors moved into the utrymmen, old plan comments (+photos) became Dokument entries, budget
  roomIds remapped; old rows stay in Supabase under the old ids, list archived in `space:arkiv-gamla-rum`.
- Each has the architect drawing as background (exact scale, ±2.5 m, opacity 0.3) and walls/doors/windows auto-traced
  (`scripts/floorplans/`). **`room.frame === false`** = no rectangle room walls, only freeform walls (checkbox
  "Rumsväggar (rektangel)" in Rum mode). Kök + Master = the owner's own drawings (moved kitchen wall, garderober)
  with the new background; Entré got the hall part of the kitchen drawing.
- Owner decisions: walk-in closets on P2 removed → garderober in the niche, one door per sovrum; farstukvisten at the
  main entrance is demolished; "balkong liten" doesn't exist (it is the roof of the kitchen farstukvist).
- **Planner save rule (bug fix 2026-10-04):** the planner saves only after a real user edit on that device
  (`editedRef`); loading/sync never writes back (it used to overwrite newer remote data with a stale local copy).
- Fine-tuned 2026-10-04 (`build.py clean()`): double-line (befintliga) walls merged into one wall, collinear overlaps
  merged, endpoints snapped to perpendicular walls (L-corners extended to the outer face → no gaps/notches), doors on
  thick walls detected from the face; manual door/window fixes in `fixups.py` (apply…apply6). Scale verified against
  the drawing's areas (Gästrum 12,9/13,0 m², Arbetsrum 14,1/14,0, Förråd 9,2/9,5; outer width 4 200/4 180).
- **Väggar mode UX (2026-10-04):** tap a wall = select it (blue highlight, handles only on that wall); drag the wall
  body = move it; drag a handle = move a corner; Yttervägg/Innervägg/Bredd apply to the selected wall; "Ta bort vägg"
  deletes it (+ its openings). "+ Ny vägg" starts drawing (taps add corners), "✓ Klar" ends. Openings are not
  draggable in Väggar/Mät mode (so they don't steal taps).
- **Våningsvy (2026-10-04)** `src/pages/Floors.jsx`, nav "Våningar" + buttons on Översikt. Data behind login:
  space record **`space:floors`** = `{ source, floors:[{ id, title, w, h, till:[[x,y]…], bef:[[x,y]…],
  areas:[{ roomId, poly }] }] }` (image px of the floor image) and the floor images in **`vs:v1:bg:floor-<id>`**
  ({dataUrl,w,h}, 150 dpi crops of the bygglov PDF). Labels = utrymme name without the "K ·/P1 ·/P2 ·" prefix (live
  from `rooms`). Areas whose room is deleted are hidden. Polygon editing in-app = not built yet (edit via script).

- **Hela planet (2026-10-18, test on Plan 2)**: utrymme **`u-p2-hela`** "P2 · Hela planet (sammanställning)" = all P2 utrymmen
  merged into one plan on the full floor image (bg = `floor-plan2` copied to `bg:u-p2-hela`). `scripts/floorplans/whole_match.py`
  finds each utrymme's page-mm origin by template-matching its bg crop against the bygglov page; `whole_merge.py` translates
  walls/openings/items/dims, turns rectangle room walls into freeform segments (S/W reversed + flip toggled), dedupes
  openings, cuts walls that cross another room's opening and drops duplicate segments. It is a **snapshot** – later edits in
  the individual utrymmen do not flow into it (re-run the scripts).
  **Cleaned 2026-10-18** with `whole_clean.py merged.json whole_clean_plan2.json out.json`: the 42 merged segments are
  replaced by a hand-checked list of 22 walls (`whole_clean_plan2.json`, faces read off the bygglov drawing / the
  owner's room interiors): one wall per line, butt ends on the perpendicular wall's face, L-corners overlapping. Openings
  are re-attached by absolute position (reversed wall → flip/out toggled); spec `kinds` fixes mis-traced types and
  `extra` adds missing ones (allrum S window). Re-running whole_merge needs a re-run of whole_clean after it.
  **Exact vs the architect (2026-10-18):** the bygglov PDF is vector — every wall is grey filled layer rectangles
  (e.g. ytterväggen 21+25+220+22 = 288 mm) whose clip paths cut out windows/doors. `arch_layers.py` extracts them
  (plan mm), `arch_diff.py` diffs our walls against them at 5 mm. `whole_clean_plan2.json` now holds the
  architect's exact faces/openings (±1 mm rounding), keeping the owner's design (walk-ins removed, master v2 inner
  walls; murstock not drawn – it is demolished). Scale verified: scale bar 35.281 mm/pt vs K 35.278; the drawing's
  own 4180/11198 = 4178/11197 mm (11198 ends mid-wall at y 11394, not at a face – facade-to-facade is 11 303).
  Wall faces that moved (master: N −28, E −42, S −72, W −55/+51 mm) carry flush furniture along (`faces`).
  `whole_dims.py` + `whole_dims_plan2.json` = exterior chains (window edges, totals), clear room dims on the faces,
  room boundaries (`sep` walls) and room labels; every dim is anchored. Architect's text 4.5 m² for WC/D does not
  match their own walls (2404 × 2425 = 5.83 m²).
- **Källare + Plan 1 whole floors (2026-10-18)**: utrymmen **`u-k-hela`** / **`u-p1-hela`** ("K/P1 · Hela planet
  (sammanställning)"), same idea as P2 but generated: `whole_match.py SCRATCH PAGE out.json rooms…` (bygglov pages: 1 källare,
  2 plan 1, 3 plan 2) → `whole_merge.py` (now also rotates utrymmen drawn on a **bg shown at rot 180** – the kitchen –
  about the bg centre, and writes `srcops` = every utrymme's openings with absolute edges) → `arch_layers.py … GREY`
  (wall grey differs per page: 0.38/0.349 källare, 0.286 plan 1, 0.4196 plan 2) → **`whole_autospec.py`** (groups layers into
  architect walls, merges thin linings into their wall piecewise, keeps/trims/drops them against the owner's walls,
  rebuilds openings from `srcops` – newest utrymme wins – snapped to architect gaps, writes item `faces`; `--all` =
  every architect wall, used for the källare which the owner never redrew) → `whole_clean.py merged spec out
  whole_fix_<floor>.json` (hand-checked overrides: diagonal walls from clip paths, missed doors/windows, removed
  murstock/fundament) → **`whole_autodims.py`** (exterior chains per facade plane from a flood fill of the outside,
  clear room dims by rays from each label; labels/room boundaries from `whole_rooms_<floor>.json`) → `whole_dims.py`.
  `whole_clean` closes hairline gaps (wall ends ≤ 8 mm from another wall are extended) and grows the plan frame.
  Decisions taken while drawing (to confirm with the owner): källare "NY VALVÖPPNING" drawn as a plain opening (the only
  way into vinkällare/install once the old stair goes); murstock on P1 and the skorsten foundation in the källare
  removed; tvätt + its bay are one room; P1 doors/windows the old tracing missed were added from the drawing.
- **Rum på hela planet (2026-10-18)** – the three whole-floor plans are the source: `space:floors.floors[].plan` =
  u-k-hela / u-p1-hela / u-p2-hela. **Våningar** (`Floors.jsx` `LivePlan`) draws the live plan (`buildPlanSvg`, dims
  toggle) with every room label's region clickable (`regionAt`/`regionRects` in geom.js) → **`#/rum/<planId>:<areaId>`**
  = a *virtual room* (`src/floorRooms.js`: name = floor short + pretty label, own space record `space:<planId>:<areaId>`).
  Lists: Rum (m², BOA/BIA tag) + Utrymmen = rooms-list entries with **`{ plan, areas:[areaIds] }`** (groups, e.g.
  P1 Entré = a3–a7). "Arkitektens ritning" = the old image view (per device `vs:v1:ui:floorView`).
  The room page opens the floor plan in **focus mode** (`RoomPlanner focus={areaIds}`): fit view = the rooms' bbox +
  900 mm, everything else dimmed by an SVG mask (still editable – walls, everything), "▣ Hela planet" toggles.
  Utrymmen can show their old own drawing via "Egen ritning (arkiv)" (per device `vs:v1:ui:ownPlan`).
  **Step 4 (2026-10-18)**: `cropPlan(plan, areaIds)` (floorRooms.js) = the rooms' region rects + the comments whose marker
  is inside (keeping their floor-plan number `num`, shown in CommentCards) + objects whose centre is inside (±200 mm).
  Dokument tab (PlanCollection/InventoryList with `areas`) lists only those. PDFs: `pdfPlanArgs(room, plan)` →
  `buildPlanSvg({ …, focus: rects })` crops to the rooms (+900 mm, rest dimmed, no floor summary) – used by the planner's
  ⬇ PDF (`spaceId` prop = the room's space), RoomsCommentBrowser and the project PDF (`roomData`). Project PDF floor
  overview = the live floor plan (with dims, m², BOA/BIA) when `floor.plan` is set; the hela-plan rooms are not printed
  again as utrymmen. Old utrymme plans = archive (only the kitchen had comments; they were already in u-p1-hela via
  whole_merge; no inventory notes existed).
- **Balkong + granskning (2026-10-18)**: P2 balkong drawn in `u-p2-hela` directly (not via the scripts – a re-run of
  whole_clean drops it): railing `wBR` (50 mm, on the inner edge of the architect's 200 mm slab band, deck inside
  4501–11134 × 11502–13945 = 16,2 m²), label `a12` kind **`ute`**, room `u-p2-balkong` = `{plan:u-p2-hela, areas:[a12]}`;
  the south façade chains moved outside the balcony. Old `p2-master-bedroom-walk-i-yc88` removed from the rooms list.
  Review (`scripts/floorplans/review/`, README there): walls match the architect's vector layers within 5 mm except the
  owner's own changes (P2 walk-ins/master v2, P1 kitchen/hall wall, murstock + skorsten fundament removed); room m² with the
  architect's own walls = ours ±0,01 – **the architect's m² texts are rounded/stale** (K gym "21,0" = 21,8 drawn, duschrum
  5,0/4,6, trapphall 8,0/7,6, P1 gästrum 13,0/12,7, P2 WC/D 4,5/5,8 …). Fixed: P1 trapphall north glasparti = 3 fönster
  (posts 8000–8168, 9098–9266; was one 3,15 m "oppning"), duplicate pardörr on the owner's entré→vardagsrum oppning
  removed, kitchen wall o42 60 mm stub trimmed, P2 door to RUM (was oppning), 14 objects moved flush to the exact wall
  faces (P2 S bed was 40 mm into the wall, kitchen sittbänk 110 mm), labels de-cluttered (`declutter.mjs`).
  Owner answers (2026-10-18): allrum S 7010–8164 = **wall**; bastu door = the diagonal glass wall (fine as drawn); kitchen E
  window stays (the insulation is *under* the window); källare valvöppning → **ordinary door** (`a6-ox1` dorr, swings into
  the befintliga källaren); **skjutdörrar**: arbetsrum→vardagsrum (`a28-ox1`, parks north on the arbetsrum side – kamin on the
  other side), master bathroom (`w23-…`) and master bedroom (`w29-skjut`, w29 extended to wMW1, sep s3 removed) as
  **fickdörrar** (garderober/säng flush on both sides); **stairs drawn** on all floors (items `trappa-k/p1/p2`).
  Opening kind **`skjut`** (Skjutdörr): jambs + leaf along a wall face (solid) + open position (dashed); `flip` = slides the
  other way, `out` = other face, `ficka` = pocket (leaf inside the wall, parked position dashed in paper colour). The opening
  selection bar now has a **type select** (change any opening's kind). Item **`stair: { steps, rev }`** = stair object: treads
  across the longer side + arrow pointing up (towards the start of the run, or the end when `rev`); `stairLines()` in
  planSvg.js; palette "TRAPPA"; selection bar ⇄ Upp åt andra hållet / Steg −/+.
  AREA_KINDS now include **`ute`** (outdoors: m² shown, walls towards it not counted, own legend line).
- **Mått & ytor in the planner (2026-10-18)** — `src/planner/geom.js` (shared by planner + planSvg/PDF):
  - **Anchored dims**: a dim end snapped to a feature keeps `ra`/`rb` ({k:"rc"|"it"|"wv"|"wf"|"wp"|"op", …}, see
    geom.js) and follows when the wall/opening/object/room changes (`resolveDims`; saved resolved). `ax` keeps a
    near-horizontal/vertical dim straight, `lt` slides the label (drag the number in Mät), `ls:-1` = label on the
    other side. Snapping: corners/edges/opening edges/object points, else the nearest **wall face** (`wp`); a face
    clearly closer than any point wins. Labels are rotated with the line (never upside down). The view box includes
    the dims.
  - **Ytor m²** mode: `areas:[{id,x,y,name}]` in the plan; m² = enclosed region around the label, computed exactly
    from the wall faces (`areaGrid`/`areaAt`, grid lines at every face, doors count as closed; "– m²" = open;
    1 mm tolerance against half-millimetre slits, diagonal walls block every cell they touch).
    Open plans are split with a **Rumsgräns** (wall with `sep:true`: dashed, no openings, only splits areas;
    toggle on a selected wall in ✏️ Väggar).
  - **BOA/BIA live (2026-10-18)**: each label has `kind` (absent = BOA, `"bia"`, `"ej"` = not counted, e.g. the
    stairwell on the upper floor – a stair counts on the floor it starts from); buttons BOA/BIA/Räknas ej on a
    selected label. `areaSummary(grid, areas)` = per-label m² + BOA/BIA totals per SS 21054: to the inside of the
    outer walls, interior walls included (a wall between two counted rooms split half/half; walls towards the outside
    or an unlabelled space like a krypgrund not counted). Region labelling is cached per wall grid (dragging a label
    ≈ 1 ms). The summary box (`areaLegend`) is drawn under the plan in the planner and the PDF; the Ytor toolbar shows
    BOA/BIA. Set 2026-10-18: källare förråd/vinkällare/install = BIA, P2 trapphall = ej → BOA K 44,6 + P1 135,6 +
    P2 104,8 ≈ 285 m², BIA 39,1 m².

### Inspirationsbilder (2026-10-04)
- Space field **`inspo: [{id, title, photo, path, note}]`** (AI renders / moodboards of the finished room). `InspoGallery`
  (Spaces.jsx) = own section at the top of Dokument (upload ✨, big images, title/note, ↑/↓, Ta bort); `InspoLightbox`
  = full-screen viewer (‹ › / Esc). Room page Planritning tab shows them in a **column left of the planner**
  (min(30%,420px); strip of thumbnails above the planner when < 760 px wide), toggle "✨ Inspo (n)" (per device,
  `vs:v1:ui:inspoPanel`). Photos in the public `vs-photos` bucket like other photos.

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
  **pRIVF "Rivning invändigt + murstock – löpande"** (2026-10): background phase from byggstart (26 Oct) to the day
  before Renovering befintlig; done when time allows and **excluded from the critical-path chain**
  (p0∥p1 → Grund → Stomme …). p1 = only what must go day 1 (friggebod in the way of schakt, carport,
  källartrappa). Goal: **tätt hus på tillbyggnaden före jul** (Stomme ends ~10 Dec).
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
- **Byggstart flyttad till 26 okt 2026 (beslut 2026-10-05)** – hela kedjan omräknad med `sched2.py` (start-param); tätt hus ~10 dec, Installationer över jullovet till 12 jan, KLART 31 maj oförändrat (april/maj-fönstren låg fast).
- **Tidsplan v2 (beslutat 2026-10-04): mål KLART/BEBOELIGT 31 maj 2027**, juni = buffert, inflytt jul–aug.
  Omlott mellan husdelarna: Renovering befintlig startar när snickarna är klara i tillbyggnaden (plattsättaren
  avslutar där). Målning i två omgångar: **omg. 1** (feb, kort ~110 h: spackel + slip + grund, **tak färdiga**, ytor bakom
  kök/garderober – före parkett/inredning) och **omg. 2 (pMAL2) = flexibelt fönster mars–maj**: inne (väggarnas
  slutstrykningar + linolja på snickerier, ej väderberoende) när det passar, ute linoljemålning när vädret tillåter (maj). **Linoljefärg utvändigt** (panel/foder levereras grundade med linolja).
  **Terrass + mark bakom huset (pTER, apr–maj) flyttad till etapp 1** – sista maskinjobbet bakom huset (maskin når inte
  dit när terrassen är byggd); natursten, granitplattor, blocksteg, **inga räcken**. Scheman räknas med `sched2.py`
  (scratch) – Utvändigt direkt efter Inredning (~11 mars), **grund garage + friggebod (pGARG) flyttad från etapp 2 till
  ~5–7 april** (tjälfri mark, fyller snickarhålet), terrass ≥12 april (natursten ligger i terrassfasen),
  målarens flexibla fönster mars–maj. Etapp 2: **trädgård september 2027** (efter inflytt): **färdiggräs i september** (svalt/regn, slipper
  sommarvattning och vattningsförbud), plantering, utebelysning, friggebod + garage jan 2028, **gårdsplan gatsten 2028 efter garaget**.
- **Maskinschema (beslutat 2026-10-04)** – maskinen ska inte stå still: p0 (26 okt–4 nov) steg 1–3 gårdsplan/runt källaren/
  schakt källare → **pMASK** (parallellt med grunden 5–23 nov) steg 4–7: trädgård grovplanering med egna massor,
  matjord i **upplag**, terrass bilning + schakt, höjden bakom terrassen, garage schakt + bärlager (= upplagsplats under
  bygget) → pMARK2 (24 nov–2 dec) steg 8: ledningsgravar + återfyllning runt källaren (minigrävare räcker) → **april:
  minigrävare ~2 d** (matjorden ut bakom huset + fyllning bakom terrassmurarna, innan terrassen stänger vägen).
- **Byggdel + köps av (2026-10-11)**: row field **`part`** = T Tillbyggnad · R Renovering befintligt · **G Gemensamt (hela
  huset – påverkar både befintligt och tillbyggnad: plåttak, bergvärme, ställning, målning, garderober …)** · M Mark/terrass/
  garage (tag select under the description, empty highlighted; "Visa efter: Byggdel"). Responsibility = `entreprenor`
  (Ansvarig; anything but "Linus" counts as Pelle); a material line may override with **`buyer`** ("Köps av" column).
  **Labour is split by trade: Målare = Linus, all other trades = Pelle** (Pelle's crew mounts Linus' kök/fönster/dörrar/
  garderober and lays granitkeramik – owner 2026-10-11). Tapet: not budgeted on purpose (väggar räknas som målade tills
  annat beslutas, vägg för vägg). **Oklart** = only "unsure if the row is needed" (not price uncertainty) – cleaned 2026-10-11, 7 rows left.
  `computeBudget().split[part][Pelle|Linus] = {Material, Extern, Arbete}` → matrix in the Budget summary card and in the
  PDF summary ("Fördelning – byggdel × ansvarig"). **Linus** = måleri, snickerier (platsbyggt, invändiga foder/bänkar/
  sockel), fönster/dörrar, kök, vitvaror, kamin, badrumsinredning + material lines granitkeramik/kakel/trägolv/heltäckning.
  Seeded by Claude as a first proposal (owner adjusts per row). **Tapet is not in the budget yet.**
- **Moms-växel (2026-10-14)**: "Exkl. moms / Inkl. moms" at the top of Budget (per device, `vs:v1:ui:moms`) multiplies every
  displayed amount by 1,25 (module-level `VAT` used by `kr`/`k0`); stored values and inputs are always exkl. moms. PDF option
  `pdf.budget.moms` ("Belopp inkl. moms" in Projekt → Arbetsplan & budget).
- Deferred (non-breaking): ROT layer, budget in PDF export, per-room budget on room page.
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
- **Prisbas: byggmaterial = Beijer inköp (specialpris) + 7 %, allt exkl. moms.** Plåt, el-, VVS-material och
  bergvärmepump köps **via respektive hantverkare** (deras grossistpris) – inte via Beijer. Snickare 580 kr/h (rör ej). **Materialstandard: alltid BRA grejer**
  (beställarens princip) – men räknat på Beijer-inköp. **Plattor/granitkeramik köps mycket billigt** (~200 kr/m² för plattan).
- **Offertpriser jämförs rakt – lägg INTE på 7 % på en offert** (owner 2026-10-14). Beijer-offert 261006 (Olle Svenssons
  Bygg): Finja Exakt 350 = 1 238 kr/m² vägg inkl. murbruk, armering, murlåda, frakt (budget 800); gips 12,5 = 31 kr/m²;
  K-ply 12 = 95 kr/m²; regel 45×45 = 9,45 kr/lpm.
  Budget updated 2026-10-14 (+65 tkr): Exakt 1 238 kr/m² (källarväggar + bärande vägg), U-block + bistål 400 kr/lm, garage-
  platta 450 kr/m², new row "Frakt tunga leveranser" 10 tkr. **Exakt only where it's warm inside (källarväggar, bärande vägg mot
  befintligt/krypgrund)** – stödmurar (terrass, nedgång) = vanlig betonghålsten fylld med betong (1 200 kr/lm kvar), garage = kantelement.
- **Inga småposter** i budgeten (slang, spridare, verktyg o.d.) – bara poster som spelar roll.
- **Utanför budgeten** (sköts vid sidan av): kontrollansvarig (KA), kommunens avgifter (bygglov/startbesked/slutbesked),
  lampor/armaturer. Ingen byggetablering (befintliga huset används).
- Ansvariga: **Pelle** = snickare/totalentreprenör (default). **Linus** = fönster och dörrar, **målare** (eget yrke
  Målare 580 kr/h, 2 pers) och **platsbyggt** (garderober/hyllor).
- Fönster/dörrar från **Snickarglädje** (snickargladje.com, prislistor exkl. moms) – **25 % rabatt**.
  **Offert Snickarglädje (2026-10-14): tillbyggnadens 22 fönster (inkl. välvt källarfönster + glasparti) + källardörr = 500 000
  inkl. moms (400 000 exkl.)** – i budget som en post. Befintligt hus: **11 fönster** (inte 20), uppskattat ~17 000 kr/st exkl.
  efter den offerten tills egen offert finns.
- **Ventilation (beslutat 2026-10)**: frånluft (F) i stället för FTX. Tillbyggnaden: frånluftsmodul (NIBE FLM) mot
  bergvärmen i **teknikrum = förrådet i tillbyggnadens källare** (bekräftat; INSTALL i befintlig källare är dagens plats för installationerna – dålig plats, ska inte användas), schakt **S1** intill tvättnedkastet (WC/D plan 2 + tvätt/städ plan 1 → källarens
  undertak), dusch + bastu direkt. Befintligt: vindsfläkt för master bath + WC entré; köket = **takfläkt över ön** med
  fjärrmotor på vinden, kanal i kökets tak till schakt **S2** (garderobshörnet i walk-in closet ovanför skafferiet).
  Tilluft via fönsterventiler (beställs med fönstren) + uteluftsdon bakom radiatorer i sovrummen. Inget don i gymmet,
  ingen extern kaminluft (för nu). Ingen murstock/fundament i källaren – prefab lättskorsten. Ritningar:
  `public/plans/ventilation/*.jpg`, länkade i Projekt → Dokument.
- **Bergvärmepump: inverterstyrd, 0–16 kW** (rättat 2026-10-04 från ~12 kW; budget 115 000 kr inkl. VVB). Borrdjup 200 m i
  budgeten – med 16 kW och ~300 m² kan det behövas 250–300 m (låt borrfirman räkna; står i att göra-listan).
- **El (beslutat 2026-10)**: elcentral i **städ plan 1** (tillbyggnaden), kablar ner till teknikrummet via S1 (ingen
  undercentral). Smart belysning = **Plejd** (trådlösa dimrar i vanliga dosor, även i befintligt hus) – grovinstallationen
  ska ha **nolla till alla brytardosor + djupa dosor**. Med i budget: nätverk CAT6, sammankopplade brandvarnare, utebelysning.
  Plattsättning/tätskikt = eget yrke **Plattsättare** (600 kr/h, certifierad våtrum).

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
- **Phone layout (2026-10-16)**: ≤640 px the nav, room tabs and every planner toolbar become ONE horizontally scrollable
  row (`.nav`, `.tabs`, `.pl-bar` in index.css), hints/subtitle/breadcrumb are hidden (`.pl-hint`, `.pl-sub`, `.room-crumb`),
  header buttons go icon-only (`.pl-lbl` hidden) → the canvas gets ~2/3 of an iPhone screen. New planner toolbars must use
  `className="pl-bar"` and hint spans `className="pl-hint"`.
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
