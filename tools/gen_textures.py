# Erzeugt alle Texturen fuer Brett und Steine (Albedo, Hoehe/Normal, Rauheit).
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
L = json.load(open(os.path.join(ROOT, 'tools/layout.json')))
OUT = os.path.join(ROOT, 'tex'); os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1001)
FONT_VAR = '/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf'

def font(size, weight='Bold'):
    f = ImageFont.truetype(FONT_VAR, size)
    try: f.set_variation_by_name(weight)
    except Exception: pass
    return f

def hex2rgb(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def smooth_noise(h, w, sy, sx, seed):
    r = np.random.default_rng(seed)
    small = r.standard_normal((max(2, int(h / sy)), max(2, int(w / sx)))).astype(np.float32)
    img = Image.fromarray(small)
    img = img.resize((w, h), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32)

def normal_from_height(hgt, strength):
    gx = ndimage.sobel(hgt, axis=1) * strength
    gy = ndimage.sobel(hgt, axis=0) * strength
    n = np.stack([-gx, gy, np.ones_like(hgt)], -1)  # OpenGL (Y+) Konvention
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8))

# ---------------------------------------------------------------- Holz
def wood(h, w, seed, base=(240, 222, 199), contrast=1.0, ppu=230):
    # Ahorn/Birke: feine, laengs laufende Maserung, sanfte Farbschwankung
    warp = smooth_noise(h, w, ppu * 1.2, ppu * 3, seed + 1) * ppu * 0.10
    yy = np.arange(h, dtype=np.float32)[:, None] + warp
    xx = np.arange(w, dtype=np.float32)[None, :].repeat(h, 0)
    # Maserlinien: Sinus ueber verzerrtes y mit variabler Frequenz
    freq = 2 * math.pi / (ppu * 0.055)
    ring = np.sin(yy * freq + smooth_noise(h, w, ppu * 0.3, ppu * 2.5, seed + 2) * 3.0)
    ring = (ring * 0.5 + 0.5) ** 6
    fine = smooth_noise(h, w, 2.0, ppu * 0.8, seed + 3)          # sehr feine Streifen
    mid = smooth_noise(h, w, ppu * 0.08, ppu * 1.5, seed + 4)
    low = smooth_noise(h, w, ppu * 1.5, ppu * 4, seed + 5)
    v = (-0.016 * ring + 0.009 * fine + 0.008 * mid + 0.014 * low) * contrast
    b = np.array(base, np.float32)[None, None, :] / 255.0
    tint = np.array([1.0, 0.93, 0.80], np.float32)[None, None, :]   # dunkler = waermer
    col = b * (1 + v[..., None] * tint * 1.0) + (v[..., None] < 0) * v[..., None] * 0.04
    hgt = 0.6 * ring + 0.25 * fine * 0.2
    return np.clip(col, 0, 1), hgt

def board_textures():
    W, D = L['boardW'], L['boardD']
    TW = 4096; ppu = TW / W; TH = int(round(D * ppu))
    col, hgt = wood(TH, TW, 7, ppu=ppu)
    fine_h = smooth_noise(TH, TW, 1.5, ppu * 0.6, 77)
    img = Image.fromarray((col * 255).astype(np.uint8))
    # Druckebene (Hoehe: Gravuren vertieft)
    eng = Image.new('L', (TW, TH), 0); de = ImageDraw.Draw(eng)
    d = ImageDraw.Draw(img)
    def P(x, y):  # Brettkoordinate (Zentrum 0, y nach oben) -> Pixel
        return ((x + W / 2) * ppu, (D / 2 - y) * ppu)
    gx0 = -L['cols'] / 2; gy0 = -D / 2 + L['marginBottom']
    line = (203, 181, 152); lw = max(2, int(ppu * 0.009))
    cw = L['cols'] / L['gridCols']; ch = L['rows'] / L['gridRows']
    for c in range(L['gridCols'] + 1):
        x = gx0 + c * cw; a = P(x, gy0); b = P(x, gy0 + L['rows'])
        d.line([a, b], fill=line, width=lw); de.line([a, b], fill=255, width=lw + 2)
    for r in range(L['gridRows'] + 1):
        y = gy0 + r * ch; a = P(gx0, y); b = P(gx0 + L['cols'], y)
        d.line([a, b], fill=line, width=lw); de.line([a, b], fill=255, width=lw + 2)
    # Punkteleiste: Felder + Texte
    ink = (74, 66, 58)
    hy = L['holeY']; n = len(L['scores'])
    for i, s in enumerate(L['scores']):
        x = L['holeX0'] + (L['holeX1'] - L['holeX0']) * i / (n - 1)
        cx, cy = P(x, hy); r = L['holeR'] * ppu
        # Lochboden etwas dunkler / schattiger
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(226, 208, 184))
        f = font(int(ppu * L['holeR'] * (0.62 if s < 1000 else 0.5)), 'SemiBold')
        d.text((cx, cy + ppu * 0.01), str(s), font=f, fill=ink, anchor='mm')
    for side, (big, small) in ((-1, ('0', 'START')), (1, ('1001', 'ODER MEHR'))):
        x = side * L['boxX']; cx, cy = P(x, hy)
        bw, bh = L['boxW'] * ppu, L['boxH'] * ppu
        rect = [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]
        d.rounded_rectangle(rect, radius=ppu * 0.05, outline=(190, 168, 140), width=int(ppu * 0.013))
        de.rounded_rectangle(rect, radius=ppu * 0.06, outline=255, width=int(ppu * 0.022))
        d.text((cx, cy - bh * 0.12), big, font=font(int(bw * (0.34 if side < 0 else 0.27)), 'SemiBold'), fill=(58, 52, 46), anchor='mm')
        d.text((cx, cy + bh * 0.25), small, font=font(int(bw * (0.13 if side < 0 else 0.105)), 'Medium'), fill=ink, anchor='mm')
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(os.path.join(OUT, 'board_albedo.jpg'), quality=92)
    # Normal: Holzmaserung + Gravuren
    e = np.asarray(eng.filter(ImageFilter.GaussianBlur(1.6)), np.float32) / 255.0
    H = hgt * 0.03 + fine_h * 0.012 - e * 0.5
    nimg = normal_from_height(H, 0.9).resize((2048, int(TH * 2048 / TW)), Image.LANCZOS)
    nimg.save(os.path.join(OUT, 'board_normal.jpg'), quality=93)
    # Rauheit: Holz satiniert, Maserlinien leicht rauer
    rough = (0.62 + 0.10 * (hgt - hgt.mean()) + 0.08 * e).clip(0, 1)
    Image.fromarray((rough * 255).astype(np.uint8)).resize((1024, int(TH * 1024 / TW)), Image.BILINEAR).save(os.path.join(OUT, 'board_rough.jpg'), quality=90)
    # Seitenholz (Kanten / Hirnholz) – kachelbar genutzt
    scol, _ = wood(1024, 2048, 11, base=(226, 203, 172), contrast=1.6, ppu=300)
    Image.fromarray((scol * 255).astype(np.uint8)).save(os.path.join(OUT, 'board_side.jpg'), quality=90)
    print('board', TW, TH)

# ---------------------------------------------------------------- Symbole
def heart_poly(cx, cy, s, n=400):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * s / 32, cy - (y + 2.5) * s / 32))
    return pts

def draw_suit(d, suit, cx, cy, s, fill):
    if suit == 'H':
        d.polygon(heart_poly(cx, cy, s * 1.02), fill=fill)
    elif suit == 'S':
        pts = [(x, 2 * cy - y) for (x, y) in heart_poly(cx, cy - s * 0.06, s * 0.98)]
        d.polygon(pts, fill=fill)
        # Stiel mit geschwungenem Fuss
        st = [(cx - s * 0.05, cy + s * 0.12), (cx + s * 0.05, cy + s * 0.12), (cx + s * 0.22, cy + s * 0.56), (cx - s * 0.22, cy + s * 0.56)]
        d.polygon(st, fill=fill)
    elif suit == 'C':
        r = s * 0.25
        for (dx, dy) in ((0, -0.24), (-0.26, 0.10), (0.26, 0.10)):
            d.ellipse([cx + dx * s - r, cy + dy * s - r, cx + dx * s + r, cy + dy * s + r], fill=fill)
        d.polygon([(cx - s * 0.08, cy), (cx + s * 0.08, cy), (cx, cy + s * 0.12)], fill=fill)
        d.polygon([(cx - s * 0.045, cy + s * 0.05), (cx + s * 0.045, cy + s * 0.05), (cx + s * 0.2, cy + s * 0.56), (cx - s * 0.2, cy + s * 0.56)], fill=fill)
    elif suit == 'D':
        a = s * 0.50
        # leicht gerundete Raute (gedrehtes Quadrat wie im Bild)
        pts = []
        for i in range(4):
            ang = math.pi / 2 * i
            pts.append((cx + a * math.sin(ang), cy - a * math.cos(ang)))
        d.polygon(pts, fill=fill)

RANK_TXT = {'9': '9', 'J': 'J', 'Q': 'Q', 'K': 'K', '10': '10', 'A': 'A'}

def tile_faces():
    tw, th = L['tileW'], L['tileH']
    W = 512; H = int(round(W * th / tw)); SS = 4
    ws, hs = W * SS, H * SS
    for suit in 'HDCS':
        body = hex2rgb(L['colors'][suit]); ink = hex2rgb(L['ink'][suit])
        for rank in ['9', 'J', 'Q', 'K', '10', 'A']:
            im = Image.new('RGB', (ws, hs), body); d = ImageDraw.Draw(im)
            draw_suit(d, suit, ws / 2, hs * 0.315, ws * 0.355, ink)
            fs = int(hs * 0.40 if rank != '10' else hs * 0.36)
            d.text((ws / 2 + (ws * -0.01 if rank == '10' else 0), hs * 0.69), RANK_TXT[rank], font=font(fs, 'Bold'), fill=ink, anchor='mm')
            im = im.resize((W, H), Image.LANCZOS)
            im.save(os.path.join(OUT, f'tile_{suit}{rank}.png'), optimize=True)
    # Rueckseite (verdeckte Steine)
    back = (236, 226, 208)
    im = Image.new('RGB', (ws, hs), back); d = ImageDraw.Draw(im)
    m = ws * 0.20
    d.rounded_rectangle([m, m * 1.05, ws - m, hs - m * 1.05], radius=ws * 0.08, outline=(200, 160, 120), width=int(ws * 0.022))
    d.text((ws / 2, hs / 2), '1001', font=font(int(hs * 0.15), 'Bold'), fill=(196, 112, 70), anchor='mm')
    im.resize((W, H), Image.LANCZOS).save(os.path.join(OUT, 'tile_back.png'), optimize=True)
    # Feine Lack-/Holzstruktur als Normal (kachelbar) + Rauheit
    n = smooth_noise(512, 512, 1.5, 1.5, 3) * 0.6 + smooth_noise(512, 512, 5, 5, 4) * 0.4
    normal_from_height(n, 0.035).save(os.path.join(OUT, 'tile_normal.png'))
    print('tiles', W, H)

if __name__ == '__main__':
    tile_faces()
    board_textures()
