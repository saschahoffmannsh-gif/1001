# Nachbearbeitung der UI-Renderings: Schattenfänger-Grundschleier entfernen, Ränder weich ausblenden, WebP.
import sys, os, glob
from PIL import Image, ImageChops, ImageDraw, ImageFilter
d = sys.argv[1]
for f in glob.glob(os.path.join(d, '*.png')):
    im = Image.open(f).convert('RGBA'); r, g, b, a = im.split(); w, h = im.size
    a = a.point(lambda v: 0 if v < 14 else min(255, int((v - 14) * 255 / 241)))
    edge = max(6, min(w, h) // 22)
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rectangle((edge, edge, w - 1 - edge, h - 1 - edge), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(edge / 2.2))
    a = ImageChops.multiply(a, m)
    Image.merge('RGBA', (r, g, b, a)).save(f[:-4] + '.webp', quality=90, method=6)
    os.remove(f)
print('post ok')
