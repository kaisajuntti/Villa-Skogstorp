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
- Rotation = swap w/h. Door = leaf + quarter-arc swing, `flip` = hinge side.
- Walls render as segments minus sorted openings (`wallSegs`).
- Freeform walls (Väggar mode) carry a per-wall thickness `w`: **Yttervägg 300 mm**
  or **Innervägg 100 mm** (toggle in the toolbar; older walls without `w` fall back
  to 200 mm). Thickness is captured when the polyline is started.
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
