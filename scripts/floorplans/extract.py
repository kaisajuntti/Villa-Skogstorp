# Extract wall rectangles from the architect PDF (raster): 1 px = 10 mm.
import pymupdf, numpy as np, json, sys
from scipy import ndimage as nd
PDF='/root/.claude/uploads/400cb4f6-b742-5668-b88f-b4842d125823/cd3a34b6-SKOGSTORP_KARLSHAMN_5_1_BYGGLOV_REV_260616.pdf'
K=35.278; DPI=254; PXMM=10.0  # 254 dpi on 1:100 A3 -> 10 mm / px
def mask(pg,R):
    d=pymupdf.open(PDF); pix=d[pg].get_pixmap(clip=R,dpi=DPI)
    a=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.h,pix.w,pix.n)[:,:,:3].astype(int)
    g=a.mean(2); neutral=(abs(a[:,:,0]-a[:,:,1])<12)&(abs(a[:,:,1]-a[:,:,2])<12)
    m=(g<125)&neutral
    m=nd.binary_opening(m,structure=np.ones((6,6)))
    return m,a
def rects(m,minlen=25):
    # horizontal/vertical run lengths
    H=np.zeros(m.shape,int); V=np.zeros(m.shape,int)
    for y in range(m.shape[0]):
        row=m[y]; lab,n=nd.label(row)
        if n: sizes=nd.sum(row,lab,range(1,n+1)); H[y]=np.where(lab>0,np.r_[0,sizes][lab],0)
    for x in range(m.shape[1]):
        col=m[:,x]; lab,n=nd.label(col)
        if n: sizes=nd.sum(col,lab,range(1,n+1)); V[:,x]=np.where(lab>0,np.r_[0,sizes][lab],0)
    out=[]
    for orient,sel in (('h',m&(H>=V)),('v',m&(V>H))):
        lab,n=nd.label(sel)
        for sl in nd.find_objects(lab):
            y0,y1=sl[0].start,sl[0].stop; x0,x1=sl[1].start,sl[1].stop
            w,h=x1-x0,y1-y0
            L,T=(w,h) if orient=='h' else (h,w)
            if L<minlen and L<T*1.5: continue
            if T<6: continue
            out.append((orient,x0,y0,x1,y1))
    return out
if __name__=='__main__':
    pg=int(sys.argv[1]); R=pymupdf.Rect(*map(float,sys.argv[2:6]))
    m,a=mask(pg,R); rs=rects(m)
    json.dump({'R':list(R),'rects':rs},open(f'rects_{pg}.json','w'))
    print(len(rs))
