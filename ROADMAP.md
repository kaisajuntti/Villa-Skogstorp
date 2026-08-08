# ROADMAP — Villa Skogstorp

Ordered; each milestone is shippable on its own. Tick and date items as they land.

## M0 — Hub skeleton (this session)
- [x] Vite + React scaffold, `base: '/villa-skogstorp/'`, Pages deploy workflow
- [x] Översikt: clickable situationsplan snippet → zones
- [x] Zone pages with user-editable room lists (add/rename/delete)
- [x] Rumsplanerare ported per room (behavior parity with kok-planner-v2 artifact,
      `window.storage` → localStorage facade)
- [x] Spaces per room + project-level: färger, dokument (links), anteckningar
- [x] JSON export/import of all data
- [x] Standalone repo `kaisajuntti/Villa-Skogstorp` with self-contained Pages deploy
- [ ] Verify on iPad Safari: pinch-zoom, drag, save/reload, Add to Home Screen
- [ ] Optional: add original situationsplan PDF to `public/plans/` and link it on Projekt

## M1 — Structure & polish
- [ ] Split planner into components (`geometry.js` etc.) with smoke tests
- [ ] Move rooms between zones; reorder rooms
- [ ] Import old kitchen plan from the Claude artifact (paste JSON)

## M2 — Planning quality-of-life (kitchen crunch time)
- [ ] Item labels editable (rename BÄNK → "bänk vid fönster" etc.)
- [ ] Free measuring tool: tap two points, get mm distance
- [ ] Door-swing conflict hint: warn when furniture overlaps a swing arc
- [ ] Undo (single-level is enough)

## M2.5 — Sharing & history (done 2026-07)
- [x] Supabase sync — two devices share one workspace (config entered in-app, not in repo)
- [x] Version history with restore (server-side snapshot trigger; nothing lost)
- [x] Kopiera rum — duplicate a room's plan + spaces ("Kök v2 / test")
- [ ] Optional: live realtime updates (currently pull-on-load + on-focus)
- [ ] Optional: "someone else changed this" inline notice on same-key edits

## M3 — Documents & media
- [ ] Photo/inspiration boards per room (needs storage beyond localStorage — decide:
      GitHub repo assets vs external links only)
- [ ] Product list per room (artikel, leverantör, pris, status)

## M4 — Output
- [ ] Export room plan as PNG / printable PDF at true scale (1:50 / 1:20)
- [ ] Dimension annotations on export

## Later / maybe
- [ ] Non-rectangular rooms (L-shape via composed rectangles)
- [ ] Fixed installations layer (radiatorer, el, VVS points)
- [ ] Whole-house floor-plan view stitched from room plans
- [ ] Share links / sync between devices (would need a backend — decide then)
