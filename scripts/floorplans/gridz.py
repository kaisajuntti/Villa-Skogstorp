import sys,pymupdf
from PIL import Image, ImageDraw, ImageFont
K=35.278
pg=int(sys.argv[1]); x0,y0,x1,y1=map(float,sys.argv[2:6]); out=sys.argv[6]
d=pymupdf.open('/root/.claude/uploads/400cb4f6-b742-5668-b88f-b4842d125823/cd3a34b6-SKOGSTORP_KARLSHAMN_5_1_BYGGLOV_REV_260616.pdf')
R=pymupdf.Rect(x0/K,y0/K,x1/K,y1/K); pix=d[pg].get_pixmap(clip=R,dpi=200)
im=Image.frombytes("RGB",(pix.w,pix.h),pix.samples); dr=ImageDraw.Draw(im); f=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",13)
sx=im.width/(x1-x0); sy=im.height/(y1-y0)
import math
for m in range(int(math.ceil(x0/250)*250),int(x1),250):
    X=(m-x0)*sx; dr.line([(X,0),(X,im.height)],fill=(255,0,0) if m%1000==0 else (255,200,200))
    if m%1000==0: dr.text((X+2,2),str(m),fill=(200,0,0),font=f)
for m in range(int(math.ceil(y0/250)*250),int(y1),250):
    Y=(m-y0)*sy; dr.line([(0,Y),(im.width,Y)],fill=(0,0,255) if m%1000==0 else (200,200,255))
    if m%1000==0: dr.text((2,Y+2),str(m),fill=(0,0,200),font=f)
im.save(out); print(im.size)
