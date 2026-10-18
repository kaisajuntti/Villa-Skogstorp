"""Components of wall-diff (ours vs architect layers), 5 mm grid. diffc.py plan.json layers.json out.png"""
import json, sys, math, numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw
plan=json.load(open(sys.argv[1]))['plan']; lay=json.load(open(sys.argv[2]))
R=5; OX,OY=-1500,-1500; W,H=21000//R,18000//R
ours=np.zeros((H,W),bool); arch=np.zeros((H,W),bool)
def fill(m,x0,y0,x1,y1):
    m[max(0,int(round((y0-OY)/R))):int(round((y1-OY)/R)), max(0,int(round((x0-OX)/R))):int(round((x1-OX)/R))]=True
for l in lay:
    x0,y0,x1,y1=l['rect']
    for a,b in l['solid']:
        if l['horiz']: fill(arch,a,y0,b,y1)
        else: fill(arch,x0,a,x1,b)
from PIL import ImageDraw as D
oimg=Image.new('L',(W,H),0); od=D.Draw(oimg)
ops=plan['openings']
for w in plan['walls']:
    if w.get('sep'): continue
    T=w['w']
    for si,(A,B) in enumerate(zip(w['pts'],w['pts'][1:])):
        L=math.hypot(B[0]-A[0],B[1]-A[1]) or 1; ux,uy=(B[0]-A[0])/L,(B[1]-A[1])/L
        cuts=sorted((o['pos'],o['pos']+o['len']) for o in ops if o['wallId']==w['id'] and o['seg']==si)
        segs=[];cur=0
        for a,b in cuts:
            if a>cur: segs.append((cur,a))
            cur=max(cur,b)
        if cur<L: segs.append((cur,L))
        for a,b in segs:
            p=(A[0]+ux*a,A[1]+uy*a); q=(A[0]+ux*b,A[1]+uy*b); h=T/2
            poly=[(p[0]-uy*h,p[1]+ux*h),(q[0]-uy*h,q[1]+ux*h),(q[0]+uy*h,q[1]-ux*h),(p[0]+uy*h,p[1]-ux*h)]
            od.polygon([((x-OX)/R,(y-OY)/R) for x,y in poly],fill=255)
        # corner fillers at inner vertices
    for v in w['pts'][1:-1]:
        h=T/2; od.rectangle([((v[0]-h-OX)/R,(v[1]-h-OY)/R),((v[0]+h-OX)/R,(v[1]+h-OY)/R)],fill=255)
ours=np.array(oimg)>0
def comps(m,name):
    m=ndimage.binary_opening(m,iterations=2)  # ignore <~20 mm slivers
    lab,n=ndimage.label(m); out=[]
    for i,sl in enumerate(ndimage.find_objects(lab)):
        area=(lab[sl]==i+1).sum()*R*R
        if area<40000: continue  # < 0.04 m² (e.g. 200x200)
        y0,y1=sl[0].start*R+OY,sl[0].stop*R+OY; x0,x1=sl[1].start*R+OX,sl[1].stop*R+OX
        out.append((name,x0,y0,x1,y1,round(area/1e6,3)))
    return out
res=comps(ours&~arch,'OURS')+comps(arch&~ours,'ARCH')
for r in sorted(res,key=lambda r:(r[2],r[1])): print(*r)
img=np.full((H,W,3),255,np.uint8); img[ours&arch]=(150,150,150); img[ours&~arch]=(220,0,0); img[arch&~ours]=(0,0,230)
im=Image.fromarray(img); dr=ImageDraw.Draw(im)
for g in range(0,21000,1000):
    x=(g-OX)//R; dr.line([(x,0),(x,12)],fill=(0,0,0)); dr.text((x+2,2),str(g),fill=(0,0,0))
    y=(g-OY)//R; dr.line([(0,y),(12,y)],fill=(0,0,0)); dr.text((2,y+2),str(g),fill=(0,0,0))
im.save(sys.argv[3])
