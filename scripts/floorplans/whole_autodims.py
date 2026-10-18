"""Draft dimension spec (for whole_dims.py) for a cleaned whole-floor plan.

  python3 whole_autodims.py plan.json bygglov.pdf PAGE X0 Y0 out_spec.json [rooms.json]
  rooms.json = {areas:[{name,x,y}], seps:[{id,a,b}]} hand-placed labels/room boundaries (replace the text ones)

- room labels: the architect's room names (text '<NAME>' above '<n.n> m²' on the page), placed a bit below
- exterior chains: every wall face that touches the outside (flood fill of the walls, doors closed), per facade
  plane: wall ends + opening edges at 450 mm out, the plane's total at 900; totals per side at 1350
- clear room dims: from each label, rays left/right (above the label) and up/down (beside it) to the nearest
  wall faces; skipped when a ray ends on a room boundary or leaves the house
Rooms that share one region (open plan) are listed; split them with `seps` by hand.
"""
import json, math, re, sys
import numpy as np, pymupdf

pj, pdf, page, X0, Y0, outp = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
K = 35.278; R = 25  # raster mm
plan = json.load(open(pj))['plan']
rooms = json.load(open(sys.argv[7])) if len(sys.argv) > 7 else {}
walls = [w for w in plan['walls'] if len(w['pts']) == 2] + [dict(id=s_['id'], sep=True, w=10, pts=[s_['a'], s_['b']]) for s_ in rooms.get('seps', [])]

def info(w):
    (ax, ay), (bx, by) = w['pts']; L = math.hypot(bx - ax, by - ay); ux, uy = (bx - ax) / L, (by - ay) / L
    return ax, ay, bx, by, L, ux, uy

# ---- raster of walls (openings closed) and the outside
W_ = int(plan['room']['w'] / R) + 80; H_ = int(plan['room']['l'] / R) + 80; OFF = 40 * R
own = np.full((H_, W_), -1, np.int32)
for i, w in enumerate(walls):
    ax, ay, bx, by, L, ux, uy = info(w); h = (2 if w.get('sep') else w['w'] / 2)
    xs = [ax - uy * h, ax + uy * h, bx - uy * h, bx + uy * h]; ys = [ay + ux * h, ay - ux * h, by + ux * h, by - ux * h]
    x0, x1 = int((min(xs) + OFF) / R), int((max(xs) + OFF) / R) + 1; y0, y1 = int((min(ys) + OFF) / R), int((max(ys) + OFF) / R) + 1
    gy, gx = np.mgrid[y0:y1, x0:x1]; px = gx * R + R / 2 - OFF; py = gy * R + R / 2 - OFF
    t = (px - ax) * ux + (py - ay) * uy; d = -(px - ax) * uy + (py - ay) * ux
    m = (t >= -1) & (t <= L + 1) & (np.abs(d) <= h + 1)
    own[y0:y1, x0:x1][m] = i
blocked = own >= 0
outside = np.zeros_like(blocked); stack = [(0, 0)]; outside[0, 0] = True
while stack:
    y, x = stack.pop()
    for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
        if 0 <= yy < H_ and 0 <= xx < W_ and not outside[yy, xx] and not blocked[yy, xx]: outside[yy, xx] = True; stack.append((yy, xx))
cell = lambda x, y: (int((y + OFF) / R), int((x + OFF) / R))
def is_out(x, y):
    r, c = cell(x, y); return 0 <= r < H_ and 0 <= c < W_ and outside[r, c]

# ---- exterior chains per facade plane: the outside faces at one coordinate, joined where they touch (walls
# meeting end to end, or a perpendicular wall's end cap in the same plane), measured between the joined ends and
# at every opening edge
ops_by_wall = {}
for o in plan['openings']: ops_by_wall.setdefault(o['wallId'], []).append(o)
planes = {}  # (side, face) -> list of (s0, s1, ref0, ref1, openings[(along, ref)])
def add_piece(side, face, s0, s1, r0, r1, ops=()):
    planes.setdefault((side, round(face)), []).append((s0, s1, r0, r1, list(ops)))
for w in walls:
    if w.get('sep'): continue
    ax, ay, bx, by, L, ux, uy = info(w)
    if abs(ux) > 1e-6 and abs(uy) > 1e-6: continue
    h = w['w'] / 2
    for n in (-1, 1):
        nx, ny = -uy * n, ux * n
        samples = [t for t in range(25, int(L) - 24, 50)] or [L / 2]
        out = [is_out(ax + ux * t + nx * (h + 40), ay + uy * t + ny * (h + 40)) for t in samples]
        if not any(out): continue
        side = ('N' if ny < 0 else 'S') if abs(ny) > 0.5 else ('W' if nx < 0 else 'E')
        hor = side in 'NS'
        face = (ay if hor else ax) + (ny if hor else nx) * h
        al = lambda P: P[0] if hor else P[1]
        f = 1 if n == 1 else 0
        # exact places along this wall where perpendicular walls meet it (where the face stops being outside)
        cuts = []
        for o in walls:
            if o is w or o.get('sep'): continue
            oax, oay, obx, oby, oL, oux, ouy = info(o)
            if abs(oux * ux + ouy * uy) > 0.1: continue
            oc = oax if abs(oux) < 0.5 else oay  # centre coordinate across this wall's direction
            for e in (oc - o['w'] / 2, oc + o['w'] / 2):
                t = (e - ax) * ux if abs(ux) > 0.5 else (e - ay) * uy
                if 0 < t < L: cuts.append(t)
        runs = []; cur = None
        for t, o_ in zip(samples, out):
            if o_ and cur is None: cur = [t, t]
            elif o_: cur[1] = t
            elif cur: runs.append(cur); cur = None
        if cur: runs.append(cur)
        for t0, t1 in runs:
            if t1 - t0 < 200: continue
            ends = []
            for t, wall_end in ((t0, 0), (t1, L)):
                if abs(t - wall_end) <= 60: ends.append((wall_end, ['wf', w['id'], 0 if wall_end == 0 else 1, n]))
                else:
                    c = min(cuts, key=lambda v: abs(v - t), default=None)
                    tt = c if c is not None and abs(c - t) <= 60 else t
                    ends.append((tt, ['wp', w['id'], round(tt), n]))
            (s0, r0), (s1, r1) = ends
            ops = []
            for o in ops_by_wall.get(w['id'], []):
                if s0 - 1 <= o['pos'] and o['pos'] + o['len'] <= s1 + 1:
                    for end, d in ((0, o['pos']), (1, o['pos'] + o['len'])): ops.append((al((ax + ux * d, ay + uy * d)), ['op', o['id'], end, f]))
            P0 = (ax + ux * s0 + nx * h, ay + uy * s0 + ny * h); P1 = (ax + ux * s1 + nx * h, ay + uy * s1 + ny * h)
            if al(P0) > al(P1): P0, P1, r0, r1 = P1, P0, r1, r0
            add_piece(side, face, al(P0), al(P1), r0, r1, ops)
    # end caps: the wall's end face lies in a facade plane of the other direction
    for end, (Ex, Ey), sgn in ((0, (ax, ay), -1), (1, (bx, by), 1)):
        ex, ey = ux * sgn, uy * sgn  # outward along the wall
        if not is_out(Ex + ex * 40, Ey + ey * 40): continue
        side = ('N' if ey < 0 else 'S') if abs(ey) > 0.5 else ('W' if ex < 0 else 'E')
        hor = side in 'NS'
        c0 = (Ex - uy * h, Ey + ux * h); c1 = (Ex + uy * h, Ey - ux * h)  # n=+1 and n=-1 corners
        al = lambda P: P[0] if hor else P[1]
        ra, rb = ['wf', w['id'], end, 1], ['wf', w['id'], end, -1]
        if al(c0) > al(c1): c0, c1, ra, rb = c1, c0, rb, ra
        add_piece(side, Ey if hor else Ex, al(c0), al(c1), ra, rb)
chains = []; extent = {}
for (side, face), pcs in sorted(planes.items()):
    pcs.sort(key=lambda p: p[0]); groups = []
    for p in pcs:
        if groups and p[0] <= groups[-1]['s1'] + 3:
            g = groups[-1]
            if p[1] > g['s1']: g['s1'], g['r1'] = p[1], p[3]
            g['ops'] += p[4]
        else: groups.append(dict(s0=p[0], s1=p[1], r0=p[2], r1=p[3], ops=list(p[4])))
    sgn = -1 if side in 'NW' else 1; ax_ = 'x' if side in 'NS' else 'y'
    for g in groups:
        pts = [(g['s0'], g['r0'])] + sorted(g['ops'], key=lambda q: q[0]) + [(g['s1'], g['r1'])]
        uniq = []
        for a_, r_ in pts:
            if not uniq or a_ - uniq[-1][0] > 15: uniq.append((a_, r_))
        if len(uniq) < 2 or g['s1'] - g['s0'] < 300: continue
        chains.append(dict(ax=ax_, line=face + sgn * 450, pts=[r for _, r in uniq]))
        if len(uniq) > 2: chains.append(dict(ax=ax_, line=face + sgn * 900, pts=[uniq[0][1], uniq[-1][1]]))
        e = extent.setdefault(side, [math.inf, -math.inf, None, None, face])
        if g['s0'] < e[0]: e[0], e[2] = g['s0'], g['r0']
        if g['s1'] > e[1]: e[1], e[3] = g['s1'], g['r1']
        e[4] = min(e[4], face) if side in 'NW' else max(e[4], face)
for side in ('N', 'W'):
    if side in extent:
        e = extent[side]; chains.append(dict(ax='x' if side == 'N' else 'y', line=e[4] - 1350, pts=[e[2], e[3]]))

# ---- room labels from the architect's text
doc = pymupdf.open(pdf); pg = doc[page]
lines = []
for b in pg.get_text('dict')['blocks']:
    for l in b.get('lines', []):
        t = ' '.join(s['text'] for s in l['spans']).strip(); x0, y0, x1, y1 = l['bbox']
        lines.append((t, (x0 + x1) / 2 * K - X0, (y0 + y1) / 2 * K - Y0, (y1 - y0) * K))
areas = []
for t, x, y, hgt in lines:
    if re.match(r'^\d+[.,]\d\s*m²$', t):
        cands = [(abs(x2 - x) + abs(y - hgt - y2), t2) for t2, x2, y2, h2 in lines if 0 < y - y2 < 2.5 * hgt and abs(x2 - x) < 1500 and not re.search(r'm²', t2)]
        if not cands: continue
        name = min(cands)[1]
        if is_out(x, y + 700) or blocked[cell(x, y + 700)]: continue
        areas.append(dict(name=name.upper(), x=round(x / 50) * 50, y=round((y + 700) / 50) * 50, arch=t))

if rooms.get('areas'): areas = [dict(a, arch='') for a in rooms['areas']]
# ---- clear room dims by rays from each label
def ray(x, y, dx, dy):
    for k in range(1, 4000):
        px, py = x + dx * k * R, y + dy * k * R
        r, c = cell(px, py)
        if not (0 <= r < H_ and 0 <= c < W_) or outside[r, c]: return None
        if blocked[r, c]:
            w = walls[own[r, c]]
            if w.get('sep'): return None
            ax, ay, bx, by, L, ux, uy = info(w)
            if abs(ux) > 1e-6 and abs(uy) > 1e-6: return None
            nx, ny = -uy, ux  # face toward the ray's origin: the side opposite the ray direction
            n = 1 if (nx * -dx + ny * -dy) > 0 else -1
            return [w['id'], n]
    return None
def region(x, y):
    r0 = cell(x, y); seen = np.zeros_like(blocked); st = [r0]; seen[r0] = True
    while st:
        yy, xx = st.pop()
        for q in ((yy + 1, xx), (yy - 1, xx), (yy, xx + 1), (yy, xx - 1)):
            if 0 <= q[0] < H_ and 0 <= q[1] < W_ and not seen[q] and not blocked[q]: seen[q] = True; st.append(q)
    return seen
inner = []
for a in areas:
    if blocked[cell(a['x'], a['y'])]: continue
    reg = region(a['x'], a['y'])
    inside = lambda x, y: (lambda c: 0 <= c[0] < H_ and 0 <= c[1] < W_ and reg[c])(cell(x, y))
    for dy in (-650, 650, -1000, 1000, -350, 350):  # width: a horizontal ray above/below the label
        yl = a['y'] + dy
        if not inside(a['x'], yl): continue
        l, r_ = ray(a['x'], yl, -1, 0), ray(a['x'], yl, 1, 0)
        if l and r_: inner.append(dict(ax='x', at=yl, a=l, b=r_)); break
    for dx in (1000, -1000, 700, -700, 1400, -1400):  # depth: a vertical ray beside the label
        xl = a['x'] + dx
        if not inside(xl, a['y']): continue
        u, d = ray(xl, a['y'], 0, -1), ray(xl, a['y'], 0, 1)
        if u and d: inner.append(dict(ax='y', at=xl, a=u, b=d)); break
json.dump(dict(keep=[d['id'] for d in plan.get('dims', [])], chains=chains, inner=inner, seps=rooms.get('seps', []), areas=[{k: a[k] for k in ('name', 'x', 'y')} for a in areas]), open(outp, 'w'), indent=1, ensure_ascii=False)
print(len(chains), 'chains,', len(inner), 'room dims,', len(areas), 'room labels:', ', '.join(f"{a['name']} ({a['arch']})" for a in areas))
