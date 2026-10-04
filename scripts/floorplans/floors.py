import json
from PIL import Image, ImageDraw, ImageFont
F={
"kallare":{"title":"Källare","img":"n_kallare.png",
 "till":[(245,50),(505,50),(505,325),(735,325),(735,465),(478,465),(478,728),(245,728),(245,480),(118,480),(118,308),(245,308)],
 "bef":[(735,325),(890,325),(890,310),(1135,310),(1135,895),(495,895),(495,465),(735,465)],
 "u":[("Nya källaren","tillbyggnad",[(268,72),(482,72),(482,348),(735,348),(735,463),(475,463),(475,705),(268,705),(268,465),(135,465),(135,322),(268,322)]),
      ("Gamla källaren","befintlig",[(755,345),(888,345),(888,690),(515,690),(515,505),(755,505)])]},
"plan1":{"title":"Plan 1","img":"n_plan1.png",
 "till":[(262,92),(515,92),(515,372),(755,372),(755,515),(497,515),(497,760),(262,760),(262,520),(135,520),(135,345),(262,345)],
 "bef":[(755,372),(905,372),(905,360),(1145,360),(1145,925),(510,925),(510,515),(755,515)],
 "u":[("Gästrum","tillbyggnad",[(282,100),(498,100),(498,295),(420,330),(282,330)]),
      ("Tvätt","tillbyggnad",[(150,345),(413,338),(413,465),(452,465),(452,512),(150,512)]),
      ("Arbetsrum","tillbyggnad",[(282,522),(493,522),(493,748),(282,748)]),
      ("Entré, hallar, WC, städ & trapphall","befintlig",[(417,338),(495,334),(500,378),(1138,378),(1138,512),(456,512),(456,465),(417,465)]),
      ("Vardagsrum & matsal","befintlig",[(507,522),(908,522),(908,912),(522,912)]),
      ("Kök","befintlig",[(922,522),(1133,522),(1133,912),(922,912)])]},
"plan2":{"title":"Plan 2","img":"n_plan2.png",
 "till":[(240,65),(492,65),(492,345),(735,345),(735,490),(475,490),(475,740),(240,740)],
 "bef":[(735,345),(890,345),(890,328),(1118,328),(1118,898),(478,898),(478,490),(735,490)],
 "u":[("Sovrum, walk-ins & WC/D","tillbyggnad",[(262,88),(470,88),(470,730),(262,730)]),
      ("Allrum, rum & trapphall","befintlig",[(474,354),(888,354),(888,722),(478,722)]),
      ("Master bedroom, walk-in & bathroom","befintlig",[(904,348),(1108,348),(1108,888),(904,888)]),
      ("Balkong (stor)","befintlig",[(484,738),(888,738),(888,890),(484,890)])]},
}
COLS=[(200,60,60),(40,140,60),(50,70,200),(170,60,170),(205,120,0),(0,140,140),(120,90,40),(200,40,120),(60,120,160),(90,90,90)]
f=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",22)
fl=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",26)
import textwrap
for key,fl_ in F.items():
    im=Image.open(fl_["img"]).convert('RGBA'); W,H=im.size
    ov=Image.new('RGBA',im.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
    d.polygon(fl_["bef"],fill=(90,122,140,60)); d.polygon(fl_["till"],fill=(214,160,70,80))
    for (n,z,p),c in zip(fl_["u"],COLS): d.polygon(p,outline=c+(255,),width=5)
    im=Image.alpha_composite(im,ov); d=ImageDraw.Draw(im)
    for (n,z,p),c in zip(fl_["u"],COLS):
        xs=[q[0] for q in p]; ys=[q[1] for q in p]; cx=sum(xs)/len(xs); cy=sum(ys)/len(ys)
        w=max(8,int((max(xs)-min(xs))/14))
        d.multiline_text((cx,cy),"\n".join(textwrap.wrap(n,w)),fill=c+(255,),font=f,anchor="mm",align="center",stroke_width=4,stroke_fill="white")
    d.rectangle((10,10,330,140),fill="white",outline="black",width=2)
    d.text((22,16),fl_["title"],fill="black",font=fl)
    d.rectangle((22,60,60,84),fill=(214,170,100)); d.text((70,58),"Tillbyggnad",fill="black",font=f)
    d.rectangle((22,96,60,120),fill=(150,175,190)); d.text((70,94),"Befintligt",fill="black",font=f)
    im.convert('RGB').save(f'draft_{key}.jpg',quality=82)
    fl_["norm"]={"size":[W,H]}
json.dump({k:{"title":v["title"],"size":v["norm"]["size"],"till":v["till"],"bef":v["bef"],"u":v["u"]} for k,v in F.items()},open('floors.json','w'),ensure_ascii=False)
