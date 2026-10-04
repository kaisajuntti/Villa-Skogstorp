import json
exec(open('build.py').read())
U=[('kallare','Nya källaren','tillbyggnad','u-k-nya','K · Nya källaren'),
   ('kallare','Gamla källaren','befintlig','u-k-gamla','K · Gamla källaren'),
   ('plan1','Gästrum','tillbyggnad','u-p1-gastrum','P1 · Gästrum'),
   ('plan1','Tvätt','tillbyggnad','u-p1-tvatt','P1 · Tvätt'),
   ('plan1','Arbetsrum','tillbyggnad','u-p1-arbetsrum','P1 · Arbetsrum'),
   ('plan1','Entré, hallar, WC, städ & trapphall','befintlig','u-p1-entre','P1 · Entré, hallar, WC, städ & trapphall'),
   ('plan1','Vardagsrum & matsal','befintlig','u-p1-vardagsrum','P1 · Vardagsrum & matsal'),
   ('plan1','Kök','befintlig','u-p1-kok','P1 · Kök'),
   ('plan2','Allrum, rum & trapphall','befintlig','u-p2-allrum','P2 · Allrum, rum & trapphall'),
   ('plan2','Master bedroom, walk-in & bathroom','befintlig','u-p2-master','P2 · Master bedroom, walk-in & bathroom'),
   ('plan2','Balkong (stor)','befintlig','u-p2-balkong','P2 · Balkong')]
EXTRA={}
try: EXTRA=json.load(open('extra.json'))
except Exception: pass
res={}
for fl,n,z,rid,name in U:
    ex=[dict(e) for e in EXTRA.get(fl,[])]
    p,bg,o=build(fl,n,z,rid,extra_walls=ex)
    res[rid]=dict(name=name,zone=z,plan=p,bg=bg,origin=o,fl=fl)
    print(name, p['room'], len(p['walls']), 'walls', len(p['openings']),'ops', {k:sum(1 for x in p['openings'] if x['kind']==k) for k in ('dorr','pardorr','fonster','oppning')})
json.dump(res,open('gen.json','w'),ensure_ascii=False)
