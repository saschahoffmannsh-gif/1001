# Gravur-Masken (weiß = eingraviert) für blender/build_ui.py; läuft mit System-Python + Pillow.
# Aufruf: python3 blender/ui_masks.py OUTDIR 'json-spec'
import sys, json, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
out, spec = sys.argv[1], json.loads(sys.argv[2])
PPU = 320
for m in spec:
    w, h = m['w'], m['h']
    W, H = int(w * PPU), int(h * PPU)
    im = Image.new('L', (W, H), 0); d = ImageDraw.Draw(im)
    for it in m['items']:
        if it['kind'] == 'text':
            f = ImageFont.truetype(os.path.join(HERE, 'fonts', f"Inter-{it.get('weight','Bold')}.ttf"), int(it['size'] * PPU))
            txt = it['text']; sp = it.get('spacing', 0) * PPU
            widths = [d.textlength(c, font=f) for c in txt]; tw = sum(widths) + sp * (len(txt) - 1)
            x = W / 2 + it.get('x', 0) * PPU - tw / 2
            y = H / 2 - it['y'] * PPU
            for c, cw in zip(txt, widths):
                d.text((x, y), c, font=f, fill=255, anchor='lm'); x += cw + sp
        elif it['kind'] == 'frame':
            ins, r, lw = it['inset'] * PPU, it['r'] * PPU, it['width'] * PPU
            d.rounded_rectangle((ins, ins, W - ins, H - ins), radius=r, outline=255, width=int(lw))
    im = im.filter(ImageFilter.GaussianBlur(2.4))
    im.save(os.path.join(out, m['name'] + '.png'))
print('masks ok')
