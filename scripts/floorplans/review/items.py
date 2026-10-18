import json,sys,math
pl=json.load(open(sys.argv[1]))['plan']
segs=[]
for w in pl['walls']:
    if w.get('sep'): continue
    for A,B in zip(w['pts'],w['pts'][1:]):
        L=math.hypot(B[0]-A[0],B[1]-A[1]) or 1; segs.append((w['id'],A,((B[0]-A[0])/L,(B[1]-A[1])/L),L,w['w']))
ops=pl['openings']
def inwall(x,y):
    for wid,A,u,L,T in segs:
        rx,ry=x-A[0],y-A[1]; t=rx*u[0]+ry*u[1]; d=abs(-rx*u[1]+ry*u[0])
        if -0.5<t<L+0.5 and d<T/2-0.5: return wid
    return None
for it in pl['items']:
    x0,y0,x1,y1=it['x'],it['y'],it['x']+it['w'],it['y']+it['h']
    hits={}
    n=0
    for i in range(1,20):
        for j in range(1,20):
            x=x0+(x1-x0)*i/20; y=y0+(y1-y0)*j/20; n+=1
            w=inwall(x,y)
            if w: hits[w]=hits.get(w,0)+1
    # depth into walls: check edges inset by k mm
    deep=[]
    for k in (10,30,60):
        pts=[(x0+k,(y0+y1)/2),(x1-k,(y0+y1)/2),((x0+x1)/2,y0+k),((x0+x1)/2,y1-k)]
        if any(inwall(*p) for p in pts): deep.append(k)
    # gap to wall on each side (5..60mm)
    gaps=[]
    for side,(px,py,dx,dy) in {'W':(x0,(y0+y1)/2,-1,0),'E':(x1,(y0+y1)/2,1,0),'N':((x0+x1)/2,y0,0,-1),'S':((x0+x1)/2,y1,0,1)}.items():
        for g in range(1,61):
            if inwall(px+dx*g,py+dy*g):
                if g>3: gaps.append(f"{side}{g}")
                break
    flag=[]
    if deep: flag.append(f"IN WALL >= {max(deep)} mm ({','.join(hits) or '-'})")
    if gaps: flag.append("near-flush gaps "+' '.join(gaps))
    if flag: print(f"{it['id'][:24]:<25}{(it.get('t') or ''):<18}{it['x']},{it['y']} {it['w']}x{it['h']}: "+' | '.join(flag))
