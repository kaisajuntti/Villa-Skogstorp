"""First draft of a whole_clean spec from the architect's wall layers (arch_layers.py) and the merged plan.

  python3 whole_autospec.py merged.json layers.json spec_out.json [review.txt] [--all]

1. Layers that are parallel, touch across (<= 3 mm) and overlap >= 60 % along are one architect wall:
   band = outermost faces, span = outermost ends, openings = gaps in the thickest layer.
2. Each architect wall is compared with the merged (owner's) walls on the same band:
   covered >= 60 %  -> the architect wall, whole span; covered partly -> the owner's pieces, ends snapped to
   the architect ends / perpendicular faces; not covered -> dropped (listed in the review).
3. Owner walls with no architect wall under them (own design) are kept, ends snapped to architect faces.
4. Openings are rebuilt from the merge's `srcops` (every utrymme's openings; the same opening traced in two
   utrymmen -> the most recently edited one wins). An opening inside an architect gap gets the gap's exact edges;
   an architect gap with no owner opening is listed for review (kept closed); openings with no wall are dropped.
"""
import json, math, sys

ALL = '--all' in sys.argv; sys.argv = [a for a in sys.argv if a != '--all']  # --all: every architect wall (no owner design on this floor)
mp, lp, outp = sys.argv[1:4]; rev = sys.argv[4] if len(sys.argv) > 4 else None
plan = json.load(open(mp))['plan']; layers = json.load(open(lp))
log = []

# ---- 1. architect walls
n = len(layers); par = list(range(n))
def find(i):
    while par[i] != i: par[i] = par[par[i]]; i = par[i]
    return i
def ext(l):  # (across0, across1, along0, along1)
    x0, y0, x1, y1 = l['rect']
    return (y0, y1, x0, x1) if l['horiz'] else (x0, x1, y0, y1)
for i in range(n):
    for j in range(i + 1, n):
        if layers[i]['horiz'] != layers[j]['horiz']: continue
        a, b = ext(layers[i]), ext(layers[j])
        touch = min(abs(a[1] - b[0]), abs(b[1] - a[0])) <= 3 or (a[0] < b[1] - 1 and b[0] < a[1] - 1)
        ov = min(a[3], b[3]) - max(a[2], b[2])
        if touch and ov > 0.6 * max(a[3] - a[2], b[3] - b[2]): par[find(i)] = find(j)  # same wall: about equally long
groups = {}
for i in range(n): groups.setdefault(find(i), []).append(layers[i])
arch = []
for g in groups.values():
    E = [ext(l) for l in g]
    f0, f1 = min(e[0] for e in E), max(e[1] for e in E); s0, s1 = min(e[2] for e in E), max(e[3] for e in E)
    main = max(g, key=lambda l: ext(l)[1] - ext(l)[0])
    m = ext(main); gaps = []
    sol = main['solid']
    for (a0, a1), (b0, b1) in zip(sol, sol[1:]):
        if b0 - a1 >= 250: gaps.append([a1, b0])
    arch.append(dict(h=g[0]['horiz'], f0=f0, f1=f1, s0=s0, s1=s1, gaps=gaps))
arch = [a for a in arch if a['s1'] - a['s0'] > 150 or a['f1'] - a['f0'] > 150]
# A thin lining (<= 150 mm) against another wall's face along part of it is the same wall: split the host
# where the lining starts/ends and widen that piece (one wall per line, never two bands side by side).
changed = True
while changed:
    changed = False
    for t in arch:
        if t['f1'] - t['f0'] > 150: continue
        h = next((h for h in arch if h is not t and h['h'] == t['h'] and (abs(t['f0'] - h['f1']) <= 3 or abs(t['f1'] - h['f0']) <= 3)
                  and h['s0'] <= t['s0'] + 5 and t['s1'] <= h['s1'] + 5 and h['f1'] - h['f0'] > t['f1'] - t['f0']), None)
        if not h: continue
        # a split point inside one of the host's openings: snap to the opening edge (<= 50 mm) or keep them apart
        ends = [t['s0'], t['s1']]; ok = True
        for i, v in enumerate(ends):
            for g in h['gaps']:
                if g[0] < v < g[1]:
                    near = min(g, key=lambda e: abs(e - v))
                    if abs(near - v) <= 50: ends[i] = near
                    else: ok = False
        if not ok: continue
        t0, t1 = ends
        arch.remove(t); arch.remove(h)
        for p0, p1, wide in ((h['s0'], t0, False), (max(h['s0'], t0), min(h['s1'], t1), True), (t1, h['s1'], False)):
            if p1 - p0 < 30: continue
            arch.append(dict(h=h['h'], f0=min(h['f0'], t['f0']) if wide else h['f0'], f1=max(h['f1'], t['f1']) if wide else h['f1'],
                             s0=p0, s1=p1, gaps=[g for g in h['gaps'] if p0 - 1 <= g[0] and g[1] <= p1 + 1]))
        log.append(f"LINING merged: {'H' if t['h'] else 'V'} {t['f0']:.0f}..{t['f1']:.0f} span {t['s0']:.0f}..{t['s1']:.0f} into wall {h['f0']:.0f}..{h['f1']:.0f}")
        changed = True; break

# ---- owner walls as axis segments
def segs_of(w):
    (ax, ay), (bx, by) = w['pts'][0], w['pts'][1]
    if abs(ay - by) < 5: return dict(h=True, c=(ay + by) / 2, s0=min(ax, bx), s1=max(ax, bx), w=w['w'], rev=bx < ax, id=w['id'])
    if abs(ax - bx) < 5: return dict(h=False, c=(ax + bx) / 2, s0=min(ay, by), s1=max(ay, by), w=w['w'], rev=by < ay, id=w['id'])
    return None
own = [s for s in (segs_of(w) for w in plan['walls'] if len(w['pts']) == 2) if s]
if len(own) != len(plan['walls']): log.append('NOTE: non-axis or polyline owner walls are kept untouched')
# openings: the merge's source list (every utrymme's openings, absolute) when present
J = json.load(open(mp)); src = J.get('srcops')
if src is None:
    src = []
    for o in plan['openings']:
        w = next(x for x in plan['walls'] if x['id'] == o['wallId']); A, B = w['pts'][o['seg']], w['pts'][o['seg'] + 1]
        L = math.hypot(B[0] - A[0], B[1] - A[1]); ux, uy = (B[0] - A[0]) / L, (B[1] - A[1]) / L
        src.append(dict(id=o['id'], kind=o['kind'], flip=o.get('flip', False), out=o.get('out'), stamp='',
                        p0=[A[0] + ux * o['pos'], A[1] + uy * o['pos']], p1=[A[0] + ux * (o['pos'] + o['len']), A[1] + uy * (o['pos'] + o['len'])]))
odd = [w for w in plan['walls'] if not any(x['id'] == w['id'] for x in own)]
ops = {}; oddops = []
for k, o in enumerate(sorted(src, key=lambda o: o['stamp'], reverse=True)):  # newest utrymme first
    (x0, y0), (x1, y1) = o['p0'], o['p1']
    if abs(y0 - y1) < 5: h, c, a0, a1 = True, (y0 + y1) / 2, x0, x1
    elif abs(x0 - x1) < 5: h, c, a0, a1 = False, (x0 + x1) / 2, y0, y1
    else: oddops.append(o); continue
    d = dict(o=o, h=h, c=c, a0=min(a0, a1), a1=max(a0, a1), dir=1 if a1 > a0 else -1)
    dup = next((q for q in ops.values() if q['h'] == h and abs(q['c'] - c) < 200 and
                min(q['a1'], d['a1']) - max(q['a0'], d['a0']) > 0.5 * min(q['a1'] - q['a0'], d['a1'] - d['a0'])), None)
    if dup: continue  # same opening traced in an older utrymme (or the same one twice)
    ops[f"{o.get('id')}#{k}"] = d

def on_band(s, a):
    return s['h'] == a['h'] and abs(s['c'] - (a['f0'] + a['f1']) / 2) < (s['w'] + a['f1'] - a['f0']) / 2
def union(iv):
    iv = sorted(iv); out = []
    for a, b in iv:
        if out and a <= out[-1][1] + 1: out[-1][1] = max(out[-1][1], b)
        else: out.append([a, b])
    return out

walls = []; used = set(); wid = [0]; faces = []
def perp_faces(h, c):
    """faces of perpendicular architect walls crossing coordinate c (along-axis positions)."""
    out = []
    for a in arch:
        if a['h'] == h: continue
        if a['s0'] - 5 <= c <= a['s1'] + 5: out += [a['f0'], a['f1']]
    return out
def snap_end(v, a, h, c):
    if abs(v - a['s0']) <= 300: return a['s0']
    if abs(v - a['s1']) <= 300: return a['s1']
    fs = perp_faces(h, c); best = min(fs, key=lambda f: abs(f - v), default=None)
    return best if best is not None and abs(best - v) <= 200 else v
for a in arch:
    mine = [s for s in own if on_band(s, a) and min(s['s1'], a['s1']) - max(s['s0'], a['s0']) > 50]
    for s in mine: used.add(s['id'])
    cov = union([[max(s['s0'], a['s0']), min(s['s1'], a['s1'])] for s in mine] +
                [[max(o['a0'], a['s0']), min(o['a1'], a['s1'])] for o in ops.values() if on_band(dict(h=o['h'], c=o['c'], w=100), a) and min(o['a1'], a['s1']) > max(o['a0'], a['s0'])])
    L = a['s1'] - a['s0']; c = sum(b - x for x, b in cov) / L if L else 0
    cc = (a['f0'] + a['f1']) / 2
    tag = f"{'H' if a['h'] else 'V'} band {a['f0']:.0f}..{a['f1']:.0f} span {a['s0']:.0f}..{a['s1']:.0f}"
    if c >= 0.6 or ALL: pieces = [[a['s0'], a['s1']]]
    elif c > 0.02:
        pieces = [[snap_end(x, a, a['h'], cc), snap_end(b, a, a['h'], cc)] for x, b in cov if b - x > 100]
        pieces = [p for p in pieces if p[1] - p[0] > 100]
        log.append(f'PARTIAL {c:.0%} {tag} -> {[[round(x), round(b)] for x, b in pieces]}')
    else:
        log.append(f'DROPPED (not in owner plan) {tag}'); continue
    for p0, p1 in pieces:
        wid[0] += 1; w = dict(id=f'a{wid[0]}', h=a['h'], c=cc, w=a['f1'] - a['f0'], s0=p0, s1=p1, gaps=a['gaps'], own=[s['id'] for s in mine])
        walls.append(w)
        # the owner's faces moved onto the architect's: furniture flush with them follows (whole_clean `faces`)
        for sw in mine:
            lo, hi = max(sw['s0'], p0), min(sw['s1'], p1)
            if hi - lo < 50: continue
            for old_f, new_f in ((sw['c'] - sw['w'] / 2, a['f0']), (sw['c'] + sw['w'] / 2, a['f1'])):
                if 1 <= abs(new_f - old_f) <= 150:
                    faces.append(['y' if a['h'] else 'x', round(old_f), round(new_f), round(lo), round(hi)])
for s in own:
    if s['id'] in used: continue
    wid[0] += 1
    s0, s1 = s['s0'], s['s1']
    fs = perp_faces(s['h'], s['c'])
    for k, v in (('s0', s0), ('s1', s1)):
        best = min(fs, key=lambda f: abs(f - v), default=None)
        if best is not None and abs(best - v) <= 150: s[k] = best
    walls.append(dict(id=f'o{wid[0]}', h=s['h'], c=s['c'], w=s['w'], s0=s['s0'], s1=s['s1'], gaps=[], own=[s['id']]))
    log.append(f"OWNER-ONLY wall {s['id']} {'H' if s['h'] else 'V'} c {s['c']:.0f} {s['s0']:.0f}..{s['s1']:.0f} w {s['w']}")

# ---- openings (all rebuilt: every merged opening is dropped and re-added from the source list)
extra = []; matched_gaps = set()
for oid, o in ops.items():
    cen = (o['a0'] + o['a1']) / 2; oo = o['o']
    host = [w for w in walls if w['h'] == o['h'] and abs(w['c'] - o['c']) <= w['w'] / 2 + 160 and w['s0'] - 1 <= cen <= w['s1'] + 1]
    if not host: log.append(f"DROP opening {oo.get('id')} ({oo['kind']} {o['a1']-o['a0']:.0f}) at {'y' if o['h'] else 'x'} {o['c']:.0f} {o['a0']:.0f}..{o['a1']:.0f} – no wall"); continue
    w = host[0]
    g = next((g for g in w['gaps'] if g[0] - 60 <= cen <= g[1] + 60), None)
    e0, e1 = (g[0], g[1]) if g else (o['a0'], o['a1'])
    if g: matched_gaps.add((w['id'], g[0]))
    else: log.append(f"OWNER opening {oo.get('id')} ({oo['kind']} {o['a1']-o['a0']:.0f}) at {o['a0']:.0f}..{o['a1']:.0f} on {w['id']} has no architect gap – kept")
    P = lambda v: [round(v), round(w['c'])] if w['h'] else [round(w['c']), round(v)]
    flip = bool(oo.get('flip')); out = oo.get('out')
    if o['dir'] < 0: flip = not flip; out = (not out) if out is not None else None
    extra.append(dict(wallId=w['id'], kind=oo['kind'], **{'from': P(e0), 'to': P(e1)}, flip=flip, out=out, id=f"{w['id']}-{oo.get('id')}"))
for o in oddops:
    def dist(x, P):
        (ax, ay), (bx, by) = x['pts'][0], x['pts'][-1]; L2 = (bx - ax) ** 2 + (by - ay) ** 2 or 1
        t = max(0, min(1, ((P[0] - ax) * (bx - ax) + (P[1] - ay) * (by - ay)) / L2))
        return math.hypot(P[0] - ax - t * (bx - ax), P[1] - ay - t * (by - ay))
    C = ((o['p0'][0] + o['p1'][0]) / 2, (o['p0'][1] + o['p1'][1]) / 2)
    w = min(odd, key=lambda x: dist(x, C), default=None)
    if w and dist(w, C) > w['w'] / 2 + 60: w = None
    if not w: log.append(f"DROP opening {o.get('id')} ({o['kind']}) on a diagonal wall that is gone"); continue
    extra.append(dict(wallId=w['id'], kind=o['kind'], **{'from': o['p0'], 'to': o['p1']}, flip=o.get('flip', False), out=o.get('out'), id=f"{w['id']}-{o.get('id')}"))
for w in walls:
    for g in w['gaps']:
        if (w['id'], g[0]) not in matched_gaps and w['s0'] < g[0] and g[1] < w['s1']:
            log.append(f"ARCH GAP without owner opening: wall {w['id']} {'H' if w['h'] else 'V'} c {w['c']:.0f}  {g[0]:.0f}..{g[1]:.0f} ({g[1]-g[0]:.0f})")
drop = [o['id'] for o in plan['openings']]; sets = {}

R = lambda v: int(round(v))
spec = dict(walls=[dict(id=w['id'], a=[R(w['s0']), R(w['c'])] if w['h'] else [R(w['c']), R(w['s0'])],
                        b=[R(w['s1']), R(w['c'])] if w['h'] else [R(w['c']), R(w['s1'])], w=max(1, R(w['w'])), _own=w['own'])
                   for w in walls] + [dict(id=w['id'], a=w['pts'][0], b=w['pts'][-1], w=w['w'], _own=[w['id']]) for w in odd], drop=drop, set={}, extra=extra, faces=faces)
json.dump(spec, open(outp, 'w'), indent=1)
txt = '\n'.join(log); print(f'{len(arch)} architect walls, {len(walls)} spec walls, {len(extra)} openings ({len(matched_gaps)} on architect gaps)'); 
if rev: open(rev, 'w').write(txt)
else: print(txt)
