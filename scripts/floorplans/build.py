import json, math, io, base64, pymupdf, numpy as np
from PIL import Image
from extract import PDF, DPI
K=35.278; S=72/DPI*K  # mm per raster px (=10)
doc=pymupdf.open(PDF)
PAGE={'kallare':1,'plan1':2,'plan2':3}
CROP={'kallare':(84,170),'plan1':(84,42),'plan2':(84,42)}
exec(open('floors.py').read().split('COLS=')[0])  # -> F
def poly_mm(fl,poly):
    ox,oy=CROP[fl]; return [((ox+x*0.48)*K,(oy+y*0.48)*K) for x,y in poly]
def load(fl):
    pg=PAGE[fl]; J=json.load(open(f'rects_{pg}.json')); R=pymupdf.Rect(*J['R'])
    pix=doc[pg].get_pixmap(clip=R,dpi=DPI)
    g=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.h,pix.w,pix.n)[:,:,:3].mean(2)
    X0,Y0=R.x0*K,R.y0*K
    rs=[]
    for o,x0,y0,x1,y1 in J['rects']:
        a=(X0+x0*S,Y0+y0*S,X0+x1*S,Y0+y1*S)
        T=(a[3]-a[1]) if o=='h' else (a[2]-a[0]); L=(a[2]-a[0]) if o=='h' else (a[3]-a[1])
        if T>800 or L<50 or T<80: continue
        if T>400 and L<1.6*T: continue  # kamin/murstock block
        rs.append(dict(o=o,x0=a[0],y0=a[1],x1=a[2],y1=a[3],T=T,c=(a[1]+a[3])/2 if o=='h' else (a[0]+a[2])/2,
                       s=a[0] if o=='h' else a[1], e=a[2] if o=='h' else a[3]))
    return rs,g,(X0,Y0)
def dark(g,org,x,y):
    px=int(round((x-org[0])/S)); py=int(round((y-org[1])/S))
    if py<2 or px<2 or py>=g.shape[0]-2 or px>=g.shape[1]-2: return False
    return g[py-3:py+4,px-3:px+4].min()<170
def arcscore(g,org,o,c,T,h,r,side,dirn):
    # hinge at along-coordinate h; leaf opens to side (+1/-1 in normal); arc spans along toward dirn
    hits=0; n=0
    for th in range(20,80,6):
        t=math.radians(th); rr=r-110; a=h+dirn*(55+rr*math.cos(t)); b=c+side*(rr*math.sin(t))
        x,y=(a,b) if o=='h' else (b,a); n+=1; hits+=dark(g,org,x,y)
    return hits/n
def merge(rs):
    walls=[]
    for r in sorted(rs,key=lambda r:(r['o'],round(r['c']/40),r['s'])):
        for w in walls:
            if w['o']==r['o'] and abs(w['c']-r['c'])<45 and abs(w['T']-r['T'])<60 and r['s']-w['e']<3200 and r['e']>w['s']-50:
                if r['s']>w['e']+60: w['gaps'].append((w['e'],r['s']))
                w['e']=max(w['e'],r['e']); w['T']=max(w['T'],r['T']); break
        else:
            walls.append(dict(o=r['o'],c=r['c'],T=r['T'],s=r['s'],e=r['e'],gaps=[]))
    return walls
def build(fl,name,zone,rid,extra_walls=(),bbox_pad=350):
    rs,g,org=load(fl)
    P=[p for n,z,p in F[fl]['u'] if n==name][0]; P=poly_mm(fl,P)
    bx0=min(p[0] for p in P); by0=min(p[1] for p in P); bx1=max(p[0] for p in P); by1=max(p[1] for p in P)
    W=round(bx1-bx0); L=round(by1-by0)
    walls=merge(rs+list(extra_walls))
    E=bbox_pad; out=[]; ops=[]
    for i,w in enumerate(walls):
        if w['o']=='h':
            if not (by0-E<=w['c']<=by1+E): continue
            lo,hi=max(w['s'],bx0-E),min(w['e'],bx1+E)
        else:
            if not (bx0-E<=w['c']<=bx1+E): continue
            lo,hi=max(w['s'],by0-E),min(w['e'],by1+E)
        if hi-lo<150: continue
        T=int(round((w['T']+(70 if w['T']>=180 else 0))/10)*10); wid=f"w{len(out)+1}"
        if w['o']=='h': A=[round(lo-bx0),round(w['c']-by0)]; B=[round(hi-bx0),round(w['c']-by0)]
        else: A=[round(w['c']-bx0),round(lo-by0)]; B=[round(w['c']-bx0),round(hi-by0)]
        out.append({"id":wid,"w":T,"pts":[A,B]})
        for (gs,ge) in w['gaps']:
            if gs<lo-10 or ge>hi+10: continue
            ln=ge-gs
            if ln<350: continue
            best=(0,None)
            for side in (1,-1):
                for hinge,dirn in ((gs,1),(ge,-1)):
                    sc=arcscore(g,org,w['o'],w['c'],w['T'],hinge,ln,side,dirn)
                    if sc>best[0] and 550<=ln<=1150: best=(sc,('dorr',side,hinge==ge))
                sc=min(arcscore(g,org,w['o'],w['c'],w['T'],gs,ln/2+55,side,1),arcscore(g,org,w['o'],w['c'],w['T'],ge,ln/2+55,side,-1))
                if sc>=best[0] and sc>0.55 and 950<=ln<=2100: best=(sc,('pardorr',side,False))
            if best[0]>=0.55:
                kind,side,flip=best[1]
                outflag=(side==-1) if w['o']=='h' else (side==1)
            else:
                kind='fonster' if w['T']>=200 else 'oppning'; outflag=False; flip=False
            ops.append({"id":f"o{len(ops)+1}","wallId":wid,"seg":0,"pos":round(gs-lo),"len":round(ln),"kind":kind,"flip":flip,"out":outflag})
    # background crop
    M=2500; pg=PAGE[fl]
    Rb=pymupdf.Rect((bx0-M)/K,(by0-M)/K,(bx1+M)/K,(by1+M)/K)
    pix=doc[pg].get_pixmap(clip=Rb,dpi=230)
    im=Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB"); buf=io.BytesIO(); im.save(buf,"JPEG",quality=70)
    bg={"dataUrl":"data:image/jpeg;base64,"+base64.b64encode(buf.getvalue()).decode(),"w":im.width,"h":im.height}
    plan={"v":2,"room":{"w":W,"l":L,"frame":False},"openings":ops,"items":[],"walls":out,
          "bg":{"x":-M,"y":-M,"wmm":round(Rb.width*K),"opacity":0.3,"visible":True,"rot":0}}
    return plan,bg,(bx0,by0)
