import json,sys,math
pl=json.load(open(sys.argv[1]))['plan']
segs=[]
for w in pl['walls']:
    for i,(A,B) in enumerate(zip(w['pts'],w['pts'][1:])):
        L=math.hypot(B[0]-A[0],B[1]-A[1]) or 1; segs.append(dict(id=w['id'],i=i,A=A,B=B,u=((B[0]-A[0])/L,(B[1]-A[1])/L),L=L,T=w['w'],sep=w.get('sep',False),n=len(w['pts'])-1))
def dist_band(P,s):
    # signed-ish: 0 if inside the rectangle of segment band (butt ends), else distance
    rx,ry=P[0]-s['A'][0],P[1]-s['A'][1]; t=rx*s['u'][0]+ry*s['u'][1]; d=abs(-rx*s['u'][1]+ry*s['u'][0])
    dt=max(0,-t,t-s['L']); dd=max(0,d-s['T']/2); return math.hypot(dt,dd)
for s in segs:
    if s['sep']: continue
    for end,(E,sgn) in enumerate(((s['A'],-1),(s['B'],1))):
        if (end==0 and s['i']>0) or (end==1 and s['i']<s['n']-1): continue  # inner vertex
        ux,uy=s['u'][0]*sgn,s['u'][1]*sgn  # outward direction at this end
        others=[o for o in segs if not (o['id']==s['id']) and not o['sep']]
        # corners of the end face
        h=s['T']/2; C=[(E[0]-uy*h,E[1]+ux*h),(E[0]+uy*h,E[1]-ux*h)]
        dmin=min(dist_band(E,o) for o in others)
        cmin=[min(dist_band(c,o) for o in others) for c in C]
        if dmin<=1 and max(cmin)<=1: continue
        # protrusion: walk back along the wall until inside another band
        back=None
        for k in range(1,400):
            P=(E[0]-ux*k,E[1]-uy*k)
            if min(dist_band(P,o) for o in others)<=0.5: back=k; break
        print(f"{s['id']:<10} end {'AB'[end]} at ({E[0]:.0f},{E[1]:.0f}) T{s['T']:.0f}: gap {dmin:.0f} mm, corner gaps {cmin[0]:.0f}/{cmin[1]:.0f}" + (f", sticks out {back} mm past a wall" if back and dmin>1 else ""))
