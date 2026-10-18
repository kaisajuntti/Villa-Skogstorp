"""Pixel diff (5 mm) of a plan's walls (minus openings) against the architect layers from arch_layers.py.
grey = both, red = only ours, blue = only the architect's.   python3 arch_diff.py plan.json layers.json out.png
"""
import json, sys, numpy as np, math
from PIL import Image
plan=json.load(open(sys.argv[1]))['plan']; lay=json.load(open(sys.argv[2])); out=sys.argv[3]
R=5; W,H=16000//R,15000//R
ours=np.zeros((H,W),bool); arch=np.zeros((H,W),bool)
def fill(m,x0,y0,x1,y1):
    m[max(0,int(round(y0/R))):int(round(y1/R)), max(0,int(round(x0/R))):int(round(x1/R))]=True
for l in lay:
    x0,y0,x1,y1=l['rect']
    for a,b in l['solid']:
        if l['horiz']: fill(arch,a,y0,b,y1)
        else: fill(arch,x0,a,x1,b)
ops=plan['openings']
for w in plan['walls']:
    if w.get('sep'): continue
    (ax,ay),(bx,by)=w['pts'][0],w['pts'][1]; T=w['w']
    L=math.hypot(bx-ax,by-ay); ux,uy=(bx-ax)/L,(by-ay)/L
    cuts=sorted((o['pos'],o['pos']+o['len']) for o in ops if o['wallId']==w['id'])
    segs=[];cur=0
    for a,b in cuts:
        if a>cur: segs.append((cur,a))
        cur=max(cur,b)
    if cur<L: segs.append((cur,L))
    for a,b in segs:
        p=(ax+ux*a,ay+uy*a); q=(ax+ux*b,ay+uy*b)
        fill(ours,min(p[0],q[0])-abs(uy)*T/2,min(p[1],q[1])-abs(ux)*T/2,max(p[0],q[0])+abs(uy)*T/2,max(p[1],q[1])+abs(ux)*T/2)
img=np.full((H,W,3),255,np.uint8)
img[ours&arch]=(150,150,150); img[ours&~arch]=(220,0,0); img[arch&~ours]=(0,90,255)
Image.fromarray(img).save(out)
print('both',int((ours&arch).sum()*R*R/1e6*1000)/1000,'m2  ours-only',int((ours&~arch).sum()*R*R/1e4)/100,'m2  arch-only',int((arch&~ours).sum()*R*R/1e4)/100,'m2')
