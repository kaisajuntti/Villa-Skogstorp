# Avritning av bygglovsritningen → utrymmen i ritverktyget

Källa: bygglovshandling rev 2026-06-16 (PDF, A3 = skala 1:100 → 1 pt = 35,278 mm).
Sid 2 = källare, 3 = plan 1, 4 = plan 2. PDF:en ligger inte i repot (hålls privat).

1. `floors.py` – utrymmenas polygoner (px i 150 dpi-utsnitt) + byggnadsdel-ytor per våning.
2. `extract.py <sida> x0 y0 x1 y1` – rastrerar (1 px = 10 mm), hittar gråa väggfyllningar → `rects_<sida>.json`.
3. `build.py` – slår ihop väggbitar, luckor → öppningar (dörr/pardörr via slagbåge, annars fönster/öppning),
   klipper per utrymme, beskär bakgrund ±2,5 m. Rummen sparas med `room.frame=false` (bara fria väggar).
4. `fixups.py` – handpåläggning (fönster/dörrar som rasterytan missar, kamin, glasverandan) +
   `apply_user` som tar över Kök och Master bedroom från användarens egna ritningar (bara ny bakgrund).
5. `genall.py` – kör allt → `gen.json`; uppladdning görs med `scripts/vsapi.py`.
