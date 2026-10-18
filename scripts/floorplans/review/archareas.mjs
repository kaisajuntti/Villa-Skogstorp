import { areaGrid, areaSummary } from "../../../src/planner/geom.js";
import fs from "fs";
for (const f of ["u-k-hela", "u-p1-hela", "u-p2-hela"]) {
  const p = JSON.parse(fs.readFileSync(f + ".json", "utf8")).plan;
  const lay = JSON.parse(fs.readFileSync("lay_" + f + ".json" /* arch_layers.py output */, "utf8"));
  const walls = [];
  let n = 0;
  for (const l of lay) {
    const [x0, y0, x1, y1] = l.rect;
    for (const [a, b] of l.solid) {
      if (l.horiz) walls.push({ id: "L" + n++, w: y1 - y0, pts: [[a, (y0 + y1) / 2], [b, (y0 + y1) / 2]] });
      else walls.push({ id: "L" + n++, w: x1 - x0, pts: [[(x0 + x1) / 2, a], [(x0 + x1) / 2, b]] });
    }
  }
  // keep our seps, diagonals and thin line-walls (not in the grey layers)
  for (const w of p.walls) {
    const diag = w.pts.some((q, i) => i && q[0] !== w.pts[i - 1][0] && q[1] !== w.pts[i - 1][1]);
    if (w.sep || diag || w.w <= 60) walls.push(w);
  }
  // close the architect's door/window gaps with our openings (same places)
  for (const o of p.openings) {
    const w = p.walls.find((x) => x.id === o.wallId); const A = w.pts[o.seg], B = w.pts[o.seg + 1];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
    walls.push({ id: "O" + o.id, w: w.w, pts: [[A[0] + ux * (o.pos - 30), A[1] + uy * (o.pos - 30)], [A[0] + ux * (o.pos + o.len + 30), A[1] + uy * (o.pos + o.len + 30)]] });
  }
  const ours = areaSummary(areaGrid(p.room, p.walls), p.areas);
  const arch = areaSummary(areaGrid(p.room, walls), p.areas);
  console.log(f, "BOA ours", ours.sum.boa.toFixed(2), "arch-geom", arch.sum.boa.toFixed(2));
  for (const a of p.areas) console.log("  ", a.id.padEnd(4), (a.name || "").padEnd(16), "ours", ours.byArea[a.id]?.toFixed(2), "arch-geom", arch.byArea[a.id]?.toFixed(2));
}
