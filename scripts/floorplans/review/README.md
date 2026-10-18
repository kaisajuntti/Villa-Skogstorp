# Granskning av hela-planet-ritningarna mot arkitekten

Kör i en mapp med `<plan>.json` (`{"plan": …}` från `vsapi.get(<id>, "plan")`) och `lay_<plan>.json`
(`arch_layers.py` för samma sida/origo). Allt i plan-mm.

- `diffc.py plan.json lay.json out.png` – väggar (minus öppningar) mot arkitektens gråa lager, 5 mm raster:
  listar sammanhängande skillnader ≥ 0,04 m² (OURS = bara vi, ARCH = bara arkitekten) + bild.
- `opcmp.py plan.json lay.json` – arkitektens luckor i väggarna mot våra öppningar (saknas / kantavvikelse > 15 mm).
- `joints.py plan.json` – väggändar som inte möter en annan vägg, glipor och utstick.
- `items.py plan.json` – inredning som skär in i väggar eller står 4–60 mm från en vägg (borde stå an).
- `archareas.mjs` – m² med arkitektens egna väggar (luckor stängda med våra öppningar) jämfört med våra.
- `declutter.mjs in.json out.json` – flyttar måttetiketter (`lt`/`ls`) och rumsnamn så att de inte krockar
  med väggar, dörrslag, möbeltexter, kommentarer eller varandra.
