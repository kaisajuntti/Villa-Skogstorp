"""Dimension lines, room boundaries and room labels (m²) for a whole-floor plan.

  python3 whole_dims.py plan.json spec.json out.json

spec = {
  "keep": [dimId],                       existing dims to keep (others are replaced); their ends are
                                         re-anchored to a wall face / opening edge / object within 25 mm
  "faces": [[axis, old, new, lo, hi]],   moved wall faces (kept dims whose end sat on the old face follow)
  "chains": [{"ax": "x"|"y", "line": c, "pts": [ref, ...]}],   exterior chains, consecutive dims
  "inner": [{"ax": "x"|"y", "at": c, "a": [wallId, n], "b": [wallId, n]}],   clear room dims on the faces
  "seps": [{"id", "a", "b"}],            room boundaries (dashed, only split areas)
  "areas": [{"name", "x", "y"}] }
ref = ["wf", wallId, end, n] | ["op", openingId, end, f] | ["wp", wallId, t, n]   (see src/planner/geom.js)
Every dim stays anchored (ra/rb), so it follows when a wall or opening is moved in the planner.
"""
import json, math, sys

src, spec_p, out = sys.argv[1:4]
j = json.load(open(src)); p = j['plan']; spec = json.load(open(spec_p))
W = {w['id']: w for w in p['walls']}; O = {o['id']: o for o in p['openings']}

def seg(w, s=0):
    A, B = w['pts'][s], w['pts'][s + 1]; L = math.hypot(B[0] - A[0], B[1] - A[1])
    return A, B, (B[0] - A[0]) / L, (B[1] - A[1]) / L, L

def pt(ref):
    k = ref['k']
    if k in ('wf', 'wp'):
        w = W[ref['id']]; A, B, ux, uy, L = seg(w, ref.get('seg', 0)); h = w['w'] / 2 * ref['n']
        if k == 'wf': P = B if ref['end'] else A; return (P[0] - uy * h, P[1] + ux * h)
        t = max(0, min(L, ref['t'])); return (A[0] + ux * t - uy * h, A[1] + uy * t + ux * h)
    if k == 'op':
        o = O[ref['id']]; w = W[o['wallId']]; A, B, ux, uy, L = seg(w, o['seg'])
        d = o['pos'] + (o['len'] if ref['end'] else 0); e = -w['w'] / 2 + ref.get('f', 0) * w['w']
        return (A[0] + ux * d - uy * e, A[1] + uy * d + ux * e)
    if k == 'it':
        it = next(i for i in p['items'] if i['id'] == ref['id'])
        return (it['x'] + ref['fx'] * it['w'], it['y'] + ref['fy'] * it['h'])
    raise ValueError(ref)

def mkref(r):
    if r[0] == 'wf': return {'k': 'wf', 'id': r[1], 'seg': 0, 'end': r[2], 'n': r[3]}
    if r[0] == 'op': return {'k': 'op', 'id': r[1], 'end': r[2], 'f': r[3]}
    if r[0] == 'wp': return {'k': 'wp', 'id': r[1], 'seg': 0, 't': r[2], 'n': r[3]}
    raise ValueError(r)

n_id = [0]
def dim(ra, rb, ax, line, short=False):
    a, b = pt(ra), pt(rb)
    if (b[0] - a[0] if ax == 'x' else b[1] - a[1]) < 0: ra, rb, a, b = rb, ra, b, a
    off = (line - a[1]) if ax == 'x' else (a[0] - line)
    n_id[0] += 1
    d = {'id': f'dA{n_id[0]}', 'a': [round(a[0]), round(a[1])], 'b': [round(b[0]), round(b[1])], 'off': round(off),
         'ra': ra, 'rb': rb, 'ax': ax}
    if short: d['ls'] = -1
    return d

def face_t(wid, ax, at):
    A, B, ux, uy, L = seg(W[wid])
    return round((at - A[1]) * uy) if ax == 'x' else round((at - A[0]) * ux)

dims = []
for c in spec.get('chains', []):
    refs = sorted((mkref(r) for r in c['pts']), key=lambda r: pt(r)[0 if c['ax'] == 'x' else 1])
    for i in range(len(refs) - 1):
        L = abs(pt(refs[i + 1])[0 if c['ax'] == 'x' else 1] - pt(refs[i])[0 if c['ax'] == 'x' else 1])
        # short pieces (window piers): label on the other side of the line, clear of the neighbours' labels
        dims.append(dim(refs[i], refs[i + 1], c['ax'], c['line'], short=L < 420))
for d in spec.get('inner', []):
    ra = mkref(['wp', d['a'][0], face_t(d['a'][0], d['ax'], d['at']), d['a'][1]])
    rb = mkref(['wp', d['b'][0], face_t(d['b'][0], d['ax'], d['at']), d['b'][1]])
    dims.append(dim(ra, rb, d['ax'], d['at']))

# kept dims: follow moved faces, then re-anchor each end to the nearest feature within 25 mm
def candidates():
    for w in p['walls']:
        if w.get('sep'): continue
        for s in range(len(w['pts']) - 1):
            for end in (0, 1):
                for n in (-1, 1): yield {'k': 'wf', 'id': w['id'], 'seg': s, 'end': end, 'n': n}
    for o in p['openings']:
        for end in (0, 1):
            for f in (0, 1): yield {'k': 'op', 'id': o['id'], 'end': end, 'f': f}
    for it in p['items']:
        for fx in (0, .5, 1):
            for fy in (0, .5, 1): yield {'k': 'it', 'id': it['id'], 'fx': fx, 'fy': fy}
def face_ref(P):
    best = None
    for w in p['walls']:
        if w.get('sep'): continue
        A, B, ux, uy, L = seg(w); t = (P[0] - A[0]) * ux + (P[1] - A[1]) * uy
        if t < 0 or t > L: continue
        dd = -(P[0] - A[0]) * uy + (P[1] - A[1]) * ux
        for n in (-1, 1):
            e = abs(dd - n * w['w'] / 2)
            if e < 25 and (best is None or e < best[0]): best = (e, {'k': 'wp', 'id': w['id'], 'seg': 0, 't': round(t), 'n': n})
    return best[1] if best else None
kept = []
for d in p.get('dims', []):
    if d['id'] not in spec.get('keep', []): continue
    d = dict(d)
    for key in ('a', 'b'):
        P = list(d[key])
        for ax, f_old, f_new, lo, hi in spec.get('faces', []):
            i, o = (0, 1) if ax == 'x' else (1, 0)
            if abs(P[i] - f_old) <= 20 and lo <= P[o] <= hi: P[i] = f_new
        best = min(((math.hypot(pt(c)[0] - P[0], pt(c)[1] - P[1]), c) for c in candidates()), key=lambda x: x[0])
        ref = best[1] if best[0] <= 25 else face_ref(P)
        if ref: d['r' + key] = ref; P = [round(v) for v in pt(ref)]
        d[key] = P
    adx, ady = abs(d['b'][0] - d['a'][0]), abs(d['b'][1] - d['a'][1])
    if min(adx, ady) / (max(adx, ady) or 1) < 0.22: d['ax'] = 'x' if adx >= ady else 'y'
    kept.append(d)
p['dims'] = kept + dims
p['walls'] = [w for w in p['walls'] if not w.get('sep')] + [dict(id=s['id'], sep=True, w=10, pts=[s['a'], s['b']]) for s in spec.get('seps', [])]
p['areas'] = [dict(id=f"a{i + 1}", name=a['name'], x=a['x'], y=a['y']) for i, a in enumerate(spec.get('areas', []))]
json.dump(j, open(out, 'w'))
print(len(kept), 'kept +', len(dims), 'new dims,', len(p['areas']), 'areas')
for d in dims: print(d['id'], d['ax'], d['a'], d['b'], abs((d['b'][0] - d['a'][0]) if d['ax'] == 'x' else (d['b'][1] - d['a'][1])))
