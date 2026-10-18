"""Exact architect walls from the bygglov PDF (vector): every wall layer is a grey filled rectangle whose
clip path cuts out the windows/doors. Prints/saves each layer with its solid intervals, in plan mm.

  python3 arch_layers.py bygglov.pdf PAGE X0 Y0 out.json
  X0/Y0 = page-mm of the plan's origin (u-p2-hela: X0 = 84*K - bg.x, Y0 = 42*K - bg.y)
Scale check (plan 2): scale bar 5 m = 141.72 pt -> 35.281 mm/pt (K = 35.278, A3 1:100); the
architect's own dims 4180 / 11198 measure 4178 / 11197 mm.
"""
import pymupdf, json, sys
import numpy as np
d=pymupdf.open(sys.argv[1]); p=d[int(sys.argv[2])]
K=35.278; X0=float(sys.argv[3]); Y0=float(sys.argv[4])
dr=p.get_drawings(extended=True)
def polys(items):
    # clip items are line segments forming one or more closed loops
    loops=[]; cur=[]
    for it in items:
        if it[0]=='l':
            a,b=it[1],it[2]
            if cur and (abs(cur[-1][0]-a.x)>1e-3 or abs(cur[-1][1]-a.y)>1e-3): loops.append(cur); cur=[]
            if not cur: cur=[(a.x,a.y)]
            cur.append((b.x,b.y))
        elif it[0]=='re':
            r=it[1]; loops.append([(r.x0,r.y0),(r.x1,r.y0),(r.x1,r.y1),(r.x0,r.y1),(r.x0,r.y0)])
    if cur: loops.append(cur)
    return loops
out=[]
clip=None
for g in dr:
    if g['type']=='clip' and g.get('level')==0: clip=g
    if g['type']=='f' and str(g['fill']).startswith('(0.4196'):
        loops=polys(clip['items']) if clip else []
        edges=[(a,b) for L in loops for a,b in zip(L,L[1:]+L[:1])]
        def contains(pts):
            P=np.array(pts); x=P[:,0]; y=P[:,1]; inside=np.zeros(len(P),bool)
            for (ax,ay),(bx,by) in edges:
                if ay==by: continue
                cond=((ay>y)!=(by>y))
                xi=ax+(y-ay)*(bx-ax)/(by-ay)
                inside^=cond&(x<xi)
            return inside
        for it in g['items']:
            if it[0]!='re': continue
            r=it[1]
            x0,y0,x1,y1=r.x0*K-X0,r.y0*K-Y0,r.x1*K-X0,r.y1*K-Y0
            horiz=(x1-x0)>=(y1-y0)
            # sample along the long axis at 2 mm
            a0,a1=(x0,x1) if horiz else (y0,y1); c=(y0+y1)/2 if horiz else (x0+x1)/2
            n=int((a1-a0)/2)+1
            pts=[((a0+i*2+X0)/K,(c+Y0)/K) if horiz else ((c+X0)/K,(a0+i*2+Y0)/K) for i in range(n)]
            ins=contains(pts) if edges else [True]*n
            iv=[];s=None
            for i,v in enumerate(ins):
                if v and s is None: s=i
                if not v and s is not None: iv.append([round(a0+s*2),round(a0+(i-1)*2)]); s=None
            if s is not None: iv.append([round(a0+s*2),round(a1)])
            out.append(dict(rect=[round(x0,1),round(y0,1),round(x1,1),round(y1,1)],horiz=horiz,solid=iv))
        clip=None
json.dump(out,open(sys.argv[5],'w'),indent=0)
for o in out: print(o['rect'], 'H' if o['horiz'] else 'V', o['solid'])
