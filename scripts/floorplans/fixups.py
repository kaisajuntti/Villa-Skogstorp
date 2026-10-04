import math, json, sys, copy
sys.path.insert(0,'/home/user/Villa-Skogstorp/scripts')
def addwall(g,A,B,T,ops=()):
    p=g['plan']; ox,oy=g['origin']; wid=f"w{len(p['walls'])+1}x"
    a=[round(A[0]-ox),round(A[1]-oy)]; b=[round(B[0]-ox),round(B[1]-oy)]
    p['walls'].append({"id":wid,"w":T,"pts":[a,b]})
    for (pos,ln,kind,out,flip) in ops:
        p['openings'].append({"id":f"o{len(p['openings'])+1}x","wallId":wid,"seg":0,"pos":pos,"len":ln,"kind":kind,"flip":flip,"out":out})
    return wid
def addop_on_nearest(g,x0,x1,y,kind='fonster'):
    # horizontal wall nearest to page y, opening spanning page x0..x1
    p=g['plan']; ox,oy=g['origin']; Y=y-oy
    best=min((w for w in p['walls'] if w['pts'][0][1]==w['pts'][1][1]),key=lambda w:abs(w['pts'][0][1]-Y))
    lo=min(best['pts'][0][0],best['pts'][1][0])
    p['openings'].append({"id":f"o{len(p['openings'])+1}x","wallId":best['id'],"seg":0,"pos":round(x0-ox-lo),"len":round(x1-x0),"kind":kind,"flip":False,"out":False})
def additem(g,t,x0,y0,x1,y1):
    p=g['plan']; ox,oy=g['origin']
    p['items'].append({"id":f"i{len(p['items'])+1}x","t":t,"x":round(x0-ox),"y":round(y0-oy),"w":round(x1-x0),"h":round(y1-y0)})
def apply(gen):
    # Gästrum: two small north windows + diagonal door wall
    g=gen['u-p1-gastrum']
    addop_on_nearest(g,8383,8833,g['origin'][1]-150); addop_on_nearest(g,10383,10833,g['origin'][1]-150)
    L=math.hypot(11395-10075,6477-7070)
    addwall(g,(10075,7070),(11395,6477),100,[(round((L-800)/2),800,'dorr',True,False)])
    # Vardagsrum & matsal: glass veranda perimeter + kamin
    g=gen['u-p1-vardagsrum']
    addwall(g,(11769,14351),(11769,16926),150,[(250,2575-500,'fonster',False,False)])
    addwall(g,(11769,16926),(18373,16926),150,[(331,1800,'fonster',False,False),(2331,1800,'fonster',False,False),(4331,1800,'fonster',False,False)])
    additem(g,'Kamin',11513,11789,12013,12839)
    # Allrum: kamin block
    g=gen['u-p2-allrum']; additem(g,'Kamin',11179,11269,11659,12319)
def set_kind(g,y,x0,x1,kind,out=False,flip=False):
    p=g['plan']; ox,oy=g['origin']; Y=y-oy
    hw=[w for w in p['walls'] if w['pts'][0][1]==w['pts'][1][1] and abs(w['pts'][0][1]-Y)<200
        and min(w['pts'][0][0],w['pts'][1][0])<=x1-ox and max(w['pts'][0][0],w['pts'][1][0])>=x0-ox]
    if not hw: print('no wall for',g['name'],y,x0); return
    w=min(hw,key=lambda w:abs(w['pts'][0][1]-Y)); lo=min(w['pts'][0][0],w['pts'][1][0])
    hits=[o for o in p['openings'] if o['wallId']==w['id'] and o['pos']+lo+ox<x1 and o['pos']+o['len']+lo+ox>x0]
    if hits:
        for o in hits: o.update(kind=kind,out=out,flip=flip)
    else:
        p['openings'].append({"id":f"o{len(p['openings'])+1}x","wallId":w['id'],"seg":0,"pos":round(x0-ox-lo),"len":round(x1-x0),"kind":kind,"flip":flip,"out":out})
def apply2(gen):
    for rid in ('u-p1-vardagsrum','u-p1-entre'):
        g=gen[rid]
        set_kind(g,10259,12432,13576,'fonster'); set_kind(g,10259,14337,15480,'fonster')
        set_kind(g,10259,16792,17978,'pardorr',out=False)
    set_kind(gen['u-p2-allrum'],9748,13956,15141,'fonster')
def set_kind_v(g,x,y0,y1,kind,out=False,flip=False):
    p=g['plan']; ox,oy=g['origin']; X=x-ox
    vw=[w for w in p['walls'] if w['pts'][0][0]==w['pts'][1][0] and abs(w['pts'][0][0]-X)<250
        and min(w['pts'][0][1],w['pts'][1][1])<=y1-oy and max(w['pts'][0][1],w['pts'][1][1])>=y0-oy]
    if not vw: print('no vwall',g['name'],x,y0); return
    w=min(vw,key=lambda w:abs(w['pts'][0][0]-X)); lo=min(w['pts'][0][1],w['pts'][1][1])
    hits=[o for o in p['openings'] if o['wallId']==w['id'] and o['pos']+lo+oy<y1 and o['pos']+o['len']+lo+oy>y0]
    for o in hits: p['openings'].remove(o)
    p['openings'].append({"id":f"o{len(p['openings'])+1}v","wallId":w['id'],"seg":0,"pos":round(y0-oy-lo),"len":round(y1-y0),"kind":kind,"flip":flip,"out":out})
def apply3(gen):
    g=gen['u-k-nya']
    set_kind_v(g,7328,14250,15150,'dorr',out=True)      # utgång gym -> trappa ut
    set_kind_v(g,7328,12550,13350,'oppning')            # gym -> duschrum
    set_kind(g,11850,9850,10700,'dorr',out=False)       # KPR
import io, base64, pymupdf
from PIL import Image
def crop_bg(fl,cx,cy,W,L,M=2500):
    pg={'kallare':1,'plan1':2,'plan2':3}[fl]; K=35.278
    Rb=pymupdf.Rect((cx-W/2-M)/K,(cy-L/2-M)/K,(cx+W/2+M)/K,(cy+L/2+M)/K)
    pix=pymupdf.open(PDF)[pg].get_pixmap(clip=Rb,dpi=230)
    im=Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB"); buf=io.BytesIO(); im.save(buf,"JPEG",quality=70)
    return {"dataUrl":"data:image/jpeg;base64,"+base64.b64encode(buf.getvalue()).decode(),"w":im.width,"h":im.height}, round(Rb.width*K)
def apply_user(gen):
    from vsapi import get
    KC=(20285.5,12425.0); MC=(19963.0,11967.0)
    kok=copy.deepcopy(get('kok-u22w','plan')['data']); W,L=kok['room']['w'],kok['room']['l']
    bg,wmm=crop_bg('plan1',KC[0],KC[1],W,L)
    kok['bg']={"x":-2500,"y":-2500,"wmm":wmm,"opacity":0.3,"visible":True,"rot":180}
    gen['u-p1-kok'].update(plan=kok,bg=bg)
    ms=copy.deepcopy(get('master-bedroom-qa15','plan')['data']); W2,L2=ms['room']['w'],ms['room']['l']
    bg,wmm=crop_bg('plan2',MC[0],MC[1],W2,L2)
    ms['bg']={"x":-2500,"y":-2500,"wmm":wmm,"opacity":0.3,"visible":True,"rot":0}
    gen['u-p2-master'].update(plan=ms,bg=bg)
    # Entré: hall + WC from the user's kitchen drawing (moved wall + garderober)
    g=gen['u-p1-entre']; p=g['plan']; ox,oy=g['origin']
    X0,X1=KC[0]-W/2,KC[0]+W/2; Y0=KC[1]-L/2; YC=Y0+3200
    ph=lambda x,y:(KC[0]+W/2-x, KC[1]+L/2-y)
    loc=lambda P:[round(P[0]-ox),round(P[1]-oy)]
    keep=[]
    for w in p['walls']:
        (ax,ay),(bx,by)=w['pts']; ax+=ox; bx+=ox; ay+=oy; by+=oy
        inside=lambda x,y: X0+120<x<X1-120 and Y0+120<y<YC
        if ay==by and Y0+120<ay<YC and min(ax,bx)<X0+120 and max(ax,bx)>X0+120:   # long h wall crossing into hall: cut at X0
            w['pts']=[loc((min(ax,bx),ay)),loc((X0,ay))]; keep.append(w); continue
        if inside(ax,ay) and inside(bx,by): continue
        if ax==bx and X0+120<ax<X1-120 and min(ay,by)<YC and max(ay,by)>Y0: continue
        keep.append(w)
    ids={w['id'] for w in keep}
    p['openings']=[o for o in p['openings'] if o['wallId'] in ids and
                   (lambda w: o['pos']+o['len']<=math.hypot(w['pts'][1][0]-w['pts'][0][0],w['pts'][1][1]-w['pts'][0][1])+5)(next(x for x in keep if x['id']==o['wallId']))]
    p['walls']=keep
    for w in kok['walls']:
        if min(pt[1] for pt in w['pts'])>=5550 and max(pt[1] for pt in w['pts'])>=6200 or max(pt[1] for pt in w['pts'])>6300:
            p['walls'].append({"id":"k"+w['id'],"w":w.get('w',100),"pts":[loc(ph(*pt)) for pt in w['pts']]})
    for it in kok['items']:
        if it['y']>=6200:
            x0,y0=ph(it['x']+it['w'],it['y']+it['h'])
            p['items'].append({"id":"k"+it['id'],"t":it['t'],"x":round(x0-ox),"y":round(y0-oy),"w":it['w'],"h":it['h']})
