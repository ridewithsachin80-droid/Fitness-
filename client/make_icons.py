"""
make_icons.py — FitLife app icon set, built from the FL monogram.

The source artwork is a mockup: the logo photographed on a textured wall with
directional lighting. Cropping it straight into an icon would drag the wall
texture and its light falloff along with it, which looks muddy at 48px.

So the mark is extracted rather than cropped:
  1. Isolate the gold by channel difference (R meaningfully above B), which
     separates metal from the neutral grey wall regardless of the lighting.
  2. Keep only the alpha shape, discarding the photographed colour entirely.
  3. Re-fill it with a clean linear gold gradient and add a rim light, so the
     metal is rendered rather than photographed.
  4. Composite onto the app's own dark ground.

Run from client/:  python3 make_icons.py
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import math, os

SRC = 'logo-source.png'          # the supplied artwork, kept in the repo
OUT = 'public/icons'
os.makedirs(OUT, exist_ok=True)

SS = 3

BG_OUT = (8, 8, 10)              # tile corners
BG_IN  = (30, 28, 32)            # warm charcoal centre
GOLD_D = (150, 112, 48)          # shadow side of the metal
GOLD   = (201, 162, 77)
GOLD_L = (245, 226, 168)         # lit edge


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def extract_mark(path):
    """Alpha mask of the monogram, lifted off the mockup background."""
    im = Image.open(path).convert('RGB')
    a = np.array(im).astype(int)
    gold = (a[:, :, 0] - a[:, :, 2]) > 28          # metal vs neutral wall

    # The wordmark sits below a clear horizontal gap; keep only the mark above it
    rows = gold.sum(axis=1)
    nz = np.where(rows > 0)[0]
    gaps = [y for y in range(nz.min(), nz.max()) if rows[y] == 0]
    cut = gaps[0] if gaps else nz.max()
    mark = gold[:cut, :]

    ys, xs = np.where(mark)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)

    # Soften the threshold edge — a hard binary cut aliases badly when scaled
    m = Image.fromarray((mark * 255).astype(np.uint8), 'L').crop(box)
    return m.filter(ImageFilter.GaussianBlur(0.6))


def ground(S):
    """Off-centre glow: light falling from the top-left, as in the artwork."""
    img = Image.new('RGB', (S, S), BG_OUT)
    px = img.load()
    gx, gy = S * 0.40, S * 0.34
    maxd = S * 0.95
    for y in range(S):
        for x in range(S):
            t = max(0.0, 1.0 - math.hypot(x - gx, y - gy) / maxd) ** 2.1
            px[x, y] = lerp(BG_OUT, BG_IN, t)
    return img.convert('RGBA')


def gold_layer(S):
    """Brushed-metal gradient: dark → mid → light along a diagonal."""
    g = Image.new('RGB', (S, S))
    px = g.load()
    a = math.radians(52)
    dx, dy = math.cos(a), math.sin(a)
    for y in range(S):
        for x in range(S):
            t = max(0.0, min(1.0, ((x / S) * dx + (y / S) * dy + 1) / 2))
            px[x, y] = lerp(GOLD_D, GOLD, t * 2) if t < 0.5 else lerp(GOLD, GOLD_L, (t - 0.5) * 2)
    return g


def rim(mask_img, S, strength=150):
    shifted = mask_img.transform(mask_img.size, Image.AFFINE,
                                 (1, 0, S * 0.008, 0, 1, S * 0.008))
    edge = Image.new('L', mask_img.size, 0)
    ep, mp, sp = edge.load(), mask_img.load(), shifted.load()
    for y in range(S):
        for x in range(S):
            v = mp[x, y] - sp[x, y]
            if v > 0:
                ep[x, y] = min(255, int(v * strength / 255))
    return edge.filter(ImageFilter.GaussianBlur(S * 0.003))


def rounded(size, ratio=0.225):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1],
                                        radius=int(size * ratio), fill=255)
    return m


MARK = extract_mark(SRC)


def build(size, *, fill=0.62, rounded_corners=True, opaque=False):
    """`fill` = how much of the tile width the mark occupies."""
    S = size * SS
    img = ground(S)

    target = int(S * fill)
    w, h = MARK.size
    scale = target / max(w, h)
    m_small = MARK.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

    holder = Image.new('L', (S, S), 0)
    # optical centring — the monogram's visual mass sits low, so lift it
    holder.paste(m_small, ((S - m_small.size[0]) // 2,
                           (S - m_small.size[1]) // 2 - int(S * 0.012)))

    img.paste(gold_layer(S), (0, 0), holder)
    img.paste(Image.new('RGB', (S, S), (255, 250, 235)), (0, 0), rim(holder, S))

    img = img.resize((size, size), Image.LANCZOS)
    if rounded_corners:
        img.putalpha(rounded(size))
    return img.convert('RGB') if opaque else img


build(512).save(f'{OUT}/icon-512.png')
build(192).save(f'{OUT}/icon-192.png')

# Maskable: art inside the centre 80% safe zone, no rounded corners
build(512, fill=0.50, rounded_corners=False).save(f'{OUT}/icon-512-maskable.png')
build(192, fill=0.50, rounded_corners=False).save(f'{OUT}/icon-192-maskable.png')

# iOS masks it itself and dislikes alpha
build(180, rounded_corners=False, opaque=True).save(f'{OUT}/apple-touch-icon.png')

build(64).save(f'{OUT}/favicon-64.png')
build(32).save(f'{OUT}/favicon-32.png')

for f in sorted(os.listdir(OUT)):
    print(' ', f, os.path.getsize(f'{OUT}/{f}'), 'bytes')
