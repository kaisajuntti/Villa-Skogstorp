import sys, json, base64, io
sys.path.insert(0,'/home/user/Villa-Skogstorp/scripts'); import vsapi
import numpy as np, pymupdf
from PIL import Image
from scipy.signal import fftconvolve
# python3 whole_match.py SCRATCH PAGE OUT.json roomId...   (bygglov pages: 1 källare, 2 plan 1, 3 plan 2)
S=sys.argv[1]; PAGE=int(sys.argv[2]); OUT=sys.argv[3]; ROOMS=sys.argv[4:]
K=35.278  # mm per pt
doc=pymupdf.open(S+'/bygglov.pdf'); page=doc[PAGE]
res={}
for rid in ROOMS:
    plan=vsapi.get(rid,kind='plan')['data']; bg=vsapi.get(rid,kind='bg')['data']; T=plan['bg']
    im=Image.open(io.BytesIO(base64.b64decode(bg['dataUrl'].split(',',1)[1]))).convert('L')
    pxmm=im.width/T['wmm']            # bg px per mm
    # the stored image is an upright crop of the page; bg.rot only turns it on screen (see whole_merge)
    dpi=pxmm*K*72
    z=pxmm*K; pix=page.get_pixmap(matrix=pymupdf.Matrix(z,z), colorspace=pymupdf.csGRAY)
    P=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.h,pix.w).astype(float)
    t=np.asarray(im,dtype=float)
    # downscale both for speed
    f=4
    Ps=P[::f,::f]; ts=t[::f,::f]
    a=255-Ps; b=255-ts; b=b-b.mean()
    c=fftconvolve(a,b[::-1,::-1],mode='valid')
    y,x=np.unravel_index(np.argmax(c),c.shape)
    # refine at full res in window
    y0,x0=y*f,x*f; best=(-1e18,0,0)
    th,tw=t.shape; bt=(255-t); bt=bt-bt.mean()
    for dy in range(-f,f+1):
        for dx in range(-f,f+1):
            yy,xx=y0+dy,x0+dx
            if yy<0 or xx<0 or yy+th>P.shape[0] or xx+tw>P.shape[1]: continue
            v=((255-P[yy:yy+th,xx:xx+tw])*bt).sum()
            if v>best[0]: best=(v,yy,xx)
    _,yy,xx=best
    # page-mm of bg top-left; room origin = that - (bg.x,bg.y) (rot 0 only)
    bx,by=xx/pxmm, yy/pxmm
    res[rid]=dict(origin=[bx-T['x'], by-T['y']], rot=T.get('rot',0), pxmm=pxmm)
    print(rid, 'origin page-mm', [round(v) for v in res[rid]['origin']], 'rot',T.get('rot',0))
json.dump(res,open(OUT,'w'))
