import sys, json, math
sys.path.insert(0,'/home/user/Villa-Skogstorp/scripts'); import vsapi
S=sys.argv[1]; FL=sys.argv[2]; NEW=sys.argv[3]; NAME=sys.argv[4]
K=35.278; CROP={'kallare':(84,170),'plan1':(84,42),'plan2':(84,42)}
OR=json.load(open(f'{S}/whole/origins_{FL}.json'))
WALL=200
segs=[]; items=[]; dims=[]; comments=[]
def add_seg(rid,a,b,w,ops,tag):
    segs.append(dict(id=f'{tag}',a=a,b=b,w=w,ops=ops,rid=rid))
for rid,o in OR.items():
    p=vsapi.get(rid,kind='plan')['data']; ox,oy=o['origin']
    T=lambda q:(q[0]+ox,q[1]+oy)
    room=p.get('room',{}); rw,rl=room.get('w',0),room.get('l',0)
    ops=p.get('openings',[])
    # room rectangle walls -> freeform segments (centre line 100 outside the interior)
    if room.get('frame') is not False and rw and rl:
        H=WALL/2; E=WALL
        geo={'N':((-E,-H),(rw+E,-H),False,E),'E':((rw+H,-E),(rw+H,rl+E),False,E),
             'S':((rw+E,rl+H),(-E,rl+H),True,None),'W':((-H,rl+E),(-H,-E),True,None)}
        L={'N':rw+2*E,'E':rl+2*E,'S':rw+2*E,'W':rl+2*E}
        for k,(a,b,rev,off) in geo.items():
            so=[]
            for op in ops:
                if op.get('wallId') is None and op.get('wall')==k:
                    q=dict(op); q.pop('wall',None)
                    q['pos']=(L[k]-E-(op['pos']+op['len'])) if rev else op['pos']+E
                    if rev: q['flip']=not op.get('flip',False)
                    so.append(q)
            add_seg(rid,T(a),T(b),WALL,so,f'{rid}-{k}')
    for w in p.get('walls',[]):
        pts=w.get('pts') or []
        for i in range(len(pts)-1):
            so=[dict(op) for op in ops if op.get('wallId')==w['id'] and op.get('seg')==i]
            add_seg(rid,T(pts[i]),T(pts[i+1]),w.get('w',WALL),so,f"{rid}-{w['id']}-{i}")
    for it in p.get('items',[]):
        q=dict(it); q['id']=rid+'-'+str(it['id']); q['x']=it['x']+ox; q['y']=it['y']+oy; items.append(q)
    for dm in p.get('dims',[]):
        q=dict(dm); q['id']=rid+'-'+str(dm['id']); q['a']=list(T(dm['a'])); q['b']=list(T(dm['b'])); dims.append(q)
    for c in p.get('comments',[]):
        q=dict(c); q['id']=rid+'-'+str(c['id'])
        for kx,ky in (('x','y'),('tx','ty')):
            if kx in q: q[kx]+=ox; q[ky]+=oy
        comments.append(q)
def geom(s):
    dx,dy=s['b'][0]-s['a'][0],s['b'][1]-s['a'][1]; L=math.hypot(dx,dy) or 1; return (dx/L,dy/L),L
# absolute openings
allops=[]
for s in segs:
    (ux,uy),L=geom(s)
    for op in s['ops']:
        c=op['pos']+op['len']/2
        allops.append(dict(seg=s,op=op,cx=s['a'][0]+ux*c,cy=s['a'][1]+uy*c,u=(ux,uy)))
# dedupe openings (same place, parallel, same kind)
keep=[]
for o in allops:
    dup=any(abs(o['cx']-k['cx'])<200 and abs(o['cy']-k['cy'])<200 and abs(o['u'][0]*k['u'][1]-o['u'][1]*k['u'][0])<0.1 and o['op'].get('kind')==k['op'].get('kind') for k in keep)
    if dup: o['seg']['ops'].remove(o['op'])
    else: keep.append(o)
# cut every wall segment that runs across someone else's opening
changed=True
while changed:
    changed=False
    for s in list(segs):
        (ux,uy),L=geom(s)
        for o in keep:
            if o['seg'] is s: continue
            if abs(ux*o['u'][1]-uy*o['u'][0])>0.1: continue
            rx,ry=o['cx']-s['a'][0],o['cy']-s['a'][1]
            d=abs(-uy*rx+ux*ry); t=ux*rx+uy*ry
            if d>s['w']/2+o['seg']['w']/2 or t<=0 or t>=L: continue
            h=o['op']['len']/2; t0,t1=max(0,t-h),min(L,t+h)
            pieces=[]
            for (u0,u1) in ((0,t0),(t1,L)):
                if u1-u0<20: continue
                a=(s['a'][0]+ux*u0,s['a'][1]+uy*u0); b=(s['a'][0]+ux*u1,s['a'][1]+uy*u1)
                ops2=[]
                for op in s['ops']:
                    if op['pos']>=u0-1 and op['pos']+op['len']<=u1+1:
                        q=dict(op); q['pos']=op['pos']-u0; ops2.append(q)
                pieces.append(dict(id=s['id']+f'c{len(segs)}',a=a,b=b,w=s['w'],ops=ops2,rid=s['rid']))
            # re-home openings of s that sat in removed span (shouldn't happen)
            segs.remove(s); segs.extend(pieces)
            for o2 in keep:
                if o2['seg'] is s:
                    for pc in pieces:
                        if any(abs(op.get('pos',0)-(o2['op']['pos']-0))<1e9 and op.get('id')==o2['op'].get('id') for op in pc['ops']): o2['seg']=pc
            changed=True; break
        if changed: break
# drop exact duplicate segments without openings
out=[]
for s in segs:
    if not s['ops'] and any((math.dist(s['a'],t['a'])<80 and math.dist(s['b'],t['b'])<80) or (math.dist(s['a'],t['b'])<80 and math.dist(s['b'],t['a'])<80) for t in out): continue
    out.append(s)
# shift so everything starts at (0,0)
xs=[p[0] for s in out for p in (s['a'],s['b'])]+[i['x'] for i in items]; ys=[p[1] for s in out for p in (s['a'],s['b'])]+[i['y'] for i in items]
X0,Y0=min(xs)-300,min(ys)-300; X1=max(xs+[i['x']+i['w'] for i in items])+300; Y1=max(ys+[i['y']+i['h'] for i in items])+300
sh=lambda q:[round(q[0]-X0),round(q[1]-Y0)]
walls=[]; openings=[]
for n,s in enumerate(out):
    wid=f'w{n}'; walls.append(dict(id=wid,w=s['w'],pts=[sh(s['a']),sh(s['b'])]))
    for op in s['ops']:
        q=dict(op); q['wallId']=wid; q['seg']=0; q['pos']=round(q['pos']); q.pop('wall',None); q['id']=wid+'-'+str(op.get('id','o')); openings.append(q)
for i in items: i['x']=round(i['x']-X0); i['y']=round(i['y']-Y0)
for d in dims: d['a']=sh(d['a']); d['b']=sh(d['b'])
for c in comments:
    for kx,ky in (('x','y'),('tx','ty')):
        if kx in c: c[kx]=round(c[kx]-X0); c[ky]=round(c[ky]-Y0)
fimg=vsapi.get('floor-'+FL,kind='bg')['data']
cx,cy=CROP[FL]
bg=dict(x=round(cx*K-X0),y=round(cy*K-Y0),wmm=round(fimg['w']*0.48*K),opacity=0.3,visible=True,rot=0)
plan=dict(room=dict(w=round(X1-X0),l=round(Y1-Y0),frame=False),walls=walls,openings=openings,items=items,dims=dims,comments=comments,bg=bg)
print('walls',len(walls),'openings',len(openings),'items',len(items),'dims',len(dims),'room',plan['room'],'bg',bg)
json.dump(dict(plan=plan,bgimg=fimg,id=NEW,name=NAME),open(f'{S}/whole/{NEW}.json','w'))
