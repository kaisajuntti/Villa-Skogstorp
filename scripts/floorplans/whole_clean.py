"""Clean a merged whole-floor plan (output of whole_merge.py): replace its walls with a hand-checked
wall list (spec) so there are no doubled walls and every corner closes on the wall faces.

  python3 whole_clean.py merged.json spec.json out.json

spec = { "walls": [{id, a:[x,y], b:[x,y], w}], "extra": [{wallId, kind, from, to, flip?}],
         "kinds": {openingId: kind} (fix a mis-traced opening type) }
(all mm in the merged plan's coordinates). Every existing opening is moved to the new wall that is
parallel to it and whose band contains its centre; its absolute position, hinge side and swing side
are kept (direction reversal toggles flip/out). An opening that finds no wall stops the script.
"""
import json, math, sys

src, spec_p, out = sys.argv[1:4]
j = json.load(open(src)); p = j['plan']; spec = json.load(open(spec_p))
old = {w['id']: w for w in p['walls']}

def geom(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy); return (dx / L, dy / L), L

new = [dict(id=w['id'], w=w['w'], pts=[list(w['a']), list(w['b'])]) for w in spec['walls']]
ops = []
for o in p['openings']:
    w = old[o['wallId']]; a, b = w['pts'][o['seg']], w['pts'][o['seg'] + 1]
    (ux, uy), _ = geom(a, b)
    p0 = (a[0] + ux * o['pos'], a[1] + uy * o['pos']); p1 = (a[0] + ux * (o['pos'] + o['len']), a[1] + uy * (o['pos'] + o['len']))
    c = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    best = None
    for nw in new:
        A, B = nw['pts']; (vx, vy), L = geom(A, B)
        if abs(ux * vy - uy * vx) > 0.05: continue
        rx, ry = c[0] - A[0], c[1] - A[1]; d = abs(-vy * rx + vx * ry); t = vx * rx + vy * ry
        if d > nw['w'] / 2 + 160 or t < 0 or t > L: continue
        if best is None or d < best[0]: best = (d, nw, (vx, vy))
    if not best: sys.exit(f"no wall for opening {o['id']} at {c}")
    _, nw, (vx, vy) = best; A = nw['pts'][0]
    t0 = vx * (p0[0] - A[0]) + vy * (p0[1] - A[1]); t1 = vx * (p1[0] - A[0]) + vy * (p1[1] - A[1])
    q = dict(o); q['wallId'] = nw['id']; q['seg'] = 0; q['pos'] = max(0, round(min(t0, t1)))
    if t0 > t1:  # wall runs the other way: keep the same hinge and swing side
        q['flip'] = not o.get('flip', False)
        if 'out' in o: q['out'] = not o['out']
    q['kind'] = spec.get('kinds', {}).get(o['id'], q.get('kind'))
    ops.append(q)
for i, e in enumerate(spec.get('extra', [])):
    nw = next(w for w in new if w['id'] == e['wallId']); A = nw['pts'][0]; (vx, vy), _ = geom(*nw['pts'])
    t0 = vx * (e['from'][0] - A[0]) + vy * (e['from'][1] - A[1]); t1 = vx * (e['to'][0] - A[0]) + vy * (e['to'][1] - A[1])
    ops.append(dict(id=f"{e['wallId']}-x{i}", wallId=e['wallId'], seg=0, kind=e['kind'], pos=round(min(t0, t1)),
                    len=round(abs(t1 - t0)), flip=e.get('flip', False)))
# sanity: every opening lies inside its wall
for o in ops:
    nw = next(w for w in new if w['id'] == o['wallId']); _, L = geom(*nw['pts'])
    if o['pos'] < -1 or o['pos'] + o['len'] > L + 1: sys.exit(f"opening {o['id']} outside wall {nw['id']}")
p['walls'] = new; p['openings'] = ops
json.dump(j, open(out, 'w'))
print(len(new), 'walls,', len(ops), 'openings')
