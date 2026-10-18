"""Compare architect wall gaps (main layers) with our openings.  opcmp.py plan.json layers.json"""
import json,sys,math
pl=json.load(open(sys.argv[1]))['plan']; lay=json.load(open(sys.argv[2]))
W={w['id']:w for w in pl['walls']}
ours=[]
for o in pl['openings']:
    w=W[o['wallId']]; a,b=w['pts'][o['seg']],w['pts'][o['seg']+1]; L=math.hypot(b[0]-a[0],b[1]-a[1]); ux,uy=(b[0]-a[0])/L,(b[1]-a[1])/L
    p=(a[0]+ux*o['pos'],a[1]+uy*o['pos']); q=(a[0]+ux*(o['pos']+o['len']),a[1]+uy*(o['pos']+o['len']))
    horiz=abs(uy)<1e-6; vert=abs(ux)<1e-6
    if horiz: ours.append(dict(o=o,h=True,c=p[1],s=min(p[0],q[0]),e=max(p[0],q[0]),T=w['w']))
    elif vert: ours.append(dict(o=o,h=False,c=p[0],s=min(p[1],q[1]),e=max(p[1],q[1]),T=w['w']))
gaps=[]
for l in lay:
    x0,y0,x1,y1=l['rect']; th=(y1-y0) if l['horiz'] else (x1-x0)
    if th<60: continue
    c=(y0+y1)/2 if l['horiz'] else (x0+x1)/2
    sol=sorted(l['solid'])
    for (a1,b1),(a2,b2) in zip(sol,sol[1:]):
        if a2-b1>=250: gaps.append(dict(h=l['horiz'],c=c,s=b1,e=a2,th=th,band=(y0,y1) if l['horiz'] else (x0,x1)))
# merge duplicate gaps (several layers)
uniq=[]
for g in gaps:
    if not any(u['h']==g['h'] and abs(u['s']-g['s'])<30 and abs(u['e']-g['e'])<30 and abs(u['c']-g['c'])<400 for u in uniq): uniq.append(g)
used=set()
for g in sorted(uniq,key=lambda g:(g['h'],g['c'],g['s'])):
    best=None
    for i,o in enumerate(ours):
        if o['h']!=g['h'] or abs(o['c']-g['c'])>max(250,o['T']): continue
        ov=min(o['e'],g['e'])-max(o['s'],g['s'])
        if ov>0.5*(g['e']-g['s']) or ov>0.5*(o['e']-o['s']):
            best=i; break
    tag='H' if g['h'] else 'V'
    if best is None: print(f"ARCH-GAP no opening: {tag} c={g['c']:.0f} {g['s']:.0f}-{g['e']:.0f} len {g['e']-g['s']:.0f} th {g['th']:.0f}"); continue
    used.add(best); o=ours[best]
    ds,de=o['s']-g['s'],o['e']-g['e']
    if abs(ds)>15 or abs(de)>15: print(f"EDGE {o['o']['id']} {o['o']['kind']} {tag} c={g['c']:.0f} arch {g['s']:.0f}-{g['e']:.0f} ours {o['s']:.0f}-{o['e']:.0f} (d {ds:+.0f}/{de:+.0f})")
for i,o in enumerate(ours):
    if i not in used: print(f"OURS no arch gap: {o['o']['id']} {o['o']['kind']} {'H' if o['h'] else 'V'} c={o['c']:.0f} {o['s']:.0f}-{o['e']:.0f} len {o['e']-o['s']:.0f}")
