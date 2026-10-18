"""Clean a merged whole-floor plan (output of whole_merge.py): replace its walls with a hand-checked
wall list (spec) so there are no doubled walls and every corner closes on the wall faces.

  python3 whole_clean.py merged.json spec.json out.json

spec = { "walls": [{id, a:[x,y], b:[x,y], w}], "extra": [{wallId, kind, from, to, flip?}],
         "kinds": {openingId: kind} (fix a mis-traced opening type),
         "drop": [openingId] (openings with no wall any more),
         "set": {openingId: [[x,y],[x,y]]} (exact opening edges, e.g. from the architect's vector drawing),
         "faces": [[axis, old, new, lo, hi]] (a wall face moved: furniture flush with the old face
                  follows it, and objects in a row pushed by it move along) }
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
drop = set(spec.get('drop', []))
for o in p['openings']:
    if o['id'] in drop: continue
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
# exact edges for chosen openings
for oid, (e0, e1) in spec.get('set', {}).items():
    q = next(o for o in ops if o['id'] == oid); nw = next(w for w in new if w['id'] == q['wallId'])
    A = nw['pts'][0]; (vx, vy), _ = geom(*nw['pts'])
    t0 = vx * (e0[0] - A[0]) + vy * (e0[1] - A[1]); t1 = vx * (e1[0] - A[0]) + vy * (e1[1] - A[1])
    q['pos'] = round(min(t0, t1)); q['len'] = round(abs(t1 - t0))
# furniture follows moved wall faces (flush within 20 mm), then pushes its neighbours in a row
moved = {}
for ax, f_old, f_new, lo, hi in spec.get('faces', []):
    d = f_new - f_old
    for it in p['items']:
        a0, a1 = (it['x'], it['x'] + it['w']) if ax == 'x' else (it['y'], it['y'] + it['h'])
        b0, b1 = (it['y'], it['y'] + it['h']) if ax == 'x' else (it['x'], it['x'] + it['w'])
        if b1 <= lo or b0 >= hi: continue
        if min(abs(a0 - f_old), abs(a1 - f_old)) <= 20:
            moved.setdefault(it['id'], {'x': 0, 'y': 0})[ax] = d
changed = True
while changed:
    changed = False
    for it in p['items']:
        m = moved.get(it['id'])
        if not m: continue
        for ax in ('x', 'y'):
            d = m[ax]
            if not d: continue
            k, n = ('x', 'w') if ax == 'x' else ('y', 'h')
            ok, on = ('y', 'h') if ax == 'x' else ('x', 'w')
            edge = it[k] if d < 0 else it[k] + it[n]  # leading edge in the direction of the move
            for jt in p['items']:
                if jt is it or moved.get(jt['id'], {}).get(ax): continue
                if jt[ok] + jt[on] <= it[ok] or jt[ok] >= it[ok] + it[on]: continue
                if (d < 0 and abs(jt[k] + jt[n] - edge) <= 2) or (d > 0 and abs(jt[k] - edge) <= 2):
                    moved.setdefault(jt['id'], {'x': 0, 'y': 0})[ax] = d; changed = True
for it in p['items']:
    m = moved.get(it['id'])
    if m: it['x'] += m['x']; it['y'] += m['y']
if moved: print('moved items:', {k: (v['x'], v['y']) for k, v in moved.items()})
# sanity: every opening lies inside its wall
for o in ops:
    nw = next(w for w in new if w['id'] == o['wallId']); _, L = geom(*nw['pts'])
    if o['pos'] < -1 or o['pos'] + o['len'] > L + 1: sys.exit(f"opening {o['id']} outside wall {nw['id']}")
p['walls'] = new; p['openings'] = ops
json.dump(j, open(out, 'w'))
print(len(new), 'walls,', len(ops), 'openings')
