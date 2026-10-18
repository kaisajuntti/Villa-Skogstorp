// Three-way merge of plan records, so two people can edit the same floor at the same time:
// base = the version this device last synced, ours = this device's edit, theirs = what is on the server now.
// Lists of objects with an id (walls, openings, items, dims, comments, areas) merge per object and per field;
// every other field is taken from whoever changed it. When both changed the same thing, ours wins (the
// server keeps the previous version in the history).
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isIdList = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && x.id != null);

function mergeObj(b, o, t) {
  // field-wise: a field changed only by them keeps their value
  const out = { ...o };
  for (const k of new Set([...Object.keys(b || {}), ...Object.keys(o || {}), ...Object.keys(t || {})])) {
    const bv = b?.[k], ov = o?.[k], tv = t?.[k];
    if (same(ov, bv) && !same(tv, bv)) { if (tv === undefined) delete out[k]; else out[k] = tv; }
  }
  return out;
}

function mergeList(b = [], o = [], t = []) {
  const B = new Map(b.map((x) => [x.id, x])), O = new Map(o.map((x) => [x.id, x])), T = new Map(t.map((x) => [x.id, x]));
  const pick = (id) => {
    const bx = B.get(id), ox = O.get(id), tx = T.get(id);
    if (same(ox, bx)) return tx;            // we did not touch it: theirs (incl. their delete)
    if (same(tx, bx)) return ox;            // they did not touch it: ours (incl. our delete)
    if (!ox) return tx;                      // we deleted, they changed: keep their change
    if (!tx) return ox;                      // they deleted, we changed: keep ours
    return mergeObj(bx, ox, tx);             // both changed: per field
  };
  // their order first (stable numbering for comments), then what only we have, in our order
  const out = [], seen = new Set();
  for (const x of t) { seen.add(x.id); const v = pick(x.id); if (v) out.push(v); }
  for (const x of o) { if (seen.has(x.id)) continue; seen.add(x.id); const v = pick(x.id); if (v) out.push(v); }
  return out;
}

export function mergePlan(base, ours, theirs) {
  if (!theirs) return ours;
  if (!base) return ours;                     // nothing to compare with: behave as before (ours wins)
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
    const b = base[k], o = ours[k], t = theirs[k];
    if (isIdList(b) || isIdList(o) || isIdList(t)) { const v = mergeList(b || [], o || [], t || []); if (v.length || o || t) out[k] = v; continue; }
    const v = same(o, b) ? t : o;
    if (v !== undefined) out[k] = v;
  }
  return out;
}
