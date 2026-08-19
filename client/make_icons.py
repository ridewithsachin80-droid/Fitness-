"""
make_icons.py — FitLife app icon set.

THE MARK
A runner mid-stride: weighted silhouette with a forward lean, filled with a
violet→pale gradient and lit along its top-left edge. No ring, no wordmark —
one idea, executed cleanly.

Why this over the earlier drafts:
  · A stick figure reads as clip-art. Tapered limbs that narrow along their
    length give the silhouette weight, which is what makes it look designed.
  · Flat fills look cheap at any size. The mark is filled with a real linear
    gradient through a shape mask, and carries a rim light on the lit edge so
    the form has physicality.
  · The ground is an off-centre radial glow, not a flat wash — light appears
    to fall from the top-left onto the tile.
  · The mark sits fractionally above true centre. A perfectly centred form
    reads as sitting low; this is optical centring.

Run from client/:  python3 make_icons.py
"""
from PIL import Image, ImageDraw, ImageFilter
import math, os

OUT = 'public/icons'
os.makedirs(OUT, exist_ok=True)

SS = 4                       # supersample; downsampled with LANCZOS at the end

BG_OUT = (6, 5, 12)          # tile corners
BG_IN  = (28, 20, 56)        # glow centre — the app's hero violet-black
VIOLET = (124, 92, 252)      # #7c5cfc, the app's accent
PALE   = (208, 196, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def ground(S):
    """Off-centre radial glow — light falling from the top-left."""
    img = Image.new('RGB', (S, S), BG_OUT)
    px = img.load()
    gx, gy = S * 0.38, S * 0.32
    maxd = S * 0.95
    for y in range(S):
        for x in range(S):
            t = max(0.0, 1.0 - math.hypot(x - gx, y - gy) / maxd) ** 2.2
            px[x, y] = lerp(BG_OUT, BG_IN, t)
    return img.convert('RGBA')


def grad_layer(S, c0, c1, angle=50):
    g = Image.new('RGB', (S, S))
    px = g.load()
    a = math.radians(angle)
    dx, dy = math.cos(a), math.sin(a)
    for y in range(S):
        for x in range(S):
            t = ((x / S) * dx + (y / S) * dy + 1) / 2
            px[x, y] = lerp(c0, c1, max(0.0, min(1.0, t)))
    return g


def rim(mask_img, S, strength=165):
    """Offset-difference edge light on the lit side of the form."""
    shifted = mask_img.transform(
        mask_img.size, Image.AFFINE, (1, 0, S * 0.010, 0, 1, S * 0.010))
    edge = Image.new('L', mask_img.size, 0)
    ep, mp, sp = edge.load(), mask_img.load(), shifted.load()
    for y in range(S):
        for x in range(S):
            v = mp[x, y] - sp[x, y]
            if v > 0:
                ep[x, y] = min(255, int(v * strength / 255))
    return edge.filter(ImageFilter.GaussianBlur(S * 0.004))


def rounded(size, ratio=0.225):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1],
                                        radius=int(size * ratio), fill=255)
    return m


def runner_mask(S, scale=1.0, dy=0.0):
    """Runner silhouette. `scale` shrinks it into the maskable safe zone."""
    m = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(m)
    c = S / 2
    k = scale

    def taper(pts, w0, w1):
        n = len(pts) - 1
        for i in range(n):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            steps = 60
            for j in range(steps):
                t = (i + j / steps) / n
                x = x0 + (x1 - x0) * (j / steps)
                y = y0 + (y1 - y0) * (j / steps)
                w = (w0 + (w1 - w0) * t) / 2
                d.ellipse([x - w, y - w, x + w, y + w], fill=255)

    def P(px, py):
        return (c + S * px * k, c + S * (py + dy) * k)

    hr = S * 0.058 * k
    hx, hy = P(0.045, -0.225)
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=255)

    hip = P(-0.015, 0.030)
    taper([P(0.030, -0.145), hip],                       S*0.105*k, S*0.080*k)  # torso
    taper([hip, P(0.115, 0.115), P(0.185, 0.245)],       S*0.078*k, S*0.034*k)  # lead leg
    taper([hip, P(-0.135, 0.120), P(-0.215, 0.040)],     S*0.074*k, S*0.032*k)  # trail leg
    taper([P(0.020, -0.110), P(-0.115, -0.030)],         S*0.052*k, S*0.026*k)  # back arm
    taper([P(0.045, -0.120), P(0.170, -0.190)],          S*0.050*k, S*0.024*k)  # drive arm
    return m


def build(size, *, scale=1.0, rounded_corners=True, opaque=False):
    S = size * SS
    img = ground(S)
    m = runner_mask(S, scale, dy=-0.012)          # optical centring
    img.paste(grad_layer(S, VIOLET, PALE, 50), (0, 0), m)
    img.paste(Image.new('RGB', (S, S), (255, 255, 255)), (0, 0), rim(m, S))
    img = img.resize((size, size), Image.LANCZOS)
    if rounded_corners:
        img.putalpha(rounded(size))
    return img.convert('RGB') if opaque else img


# ── standard icons — launchers draw these as-is ──────────────────────────────
build(512).save(f'{OUT}/icon-512.png')
build(192).save(f'{OUT}/icon-192.png')

# ── maskable — full-bleed square, art inside the centre 80% safe zone so a
#    circular launcher mask can't clip it ─────────────────────────────────────
build(512, scale=0.76, rounded_corners=False).save(f'{OUT}/icon-512-maskable.png')
build(192, scale=0.76, rounded_corners=False).save(f'{OUT}/icon-192-maskable.png')

# ── iOS applies its own mask and dislikes alpha ──────────────────────────────
build(180, rounded_corners=False, opaque=True).save(f'{OUT}/apple-touch-icon.png')

build(64).save(f'{OUT}/favicon-64.png')
build(32).save(f'{OUT}/favicon-32.png')

for f in sorted(os.listdir(OUT)):
    print(' ', f, os.path.getsize(f'{OUT}/{f}'), 'bytes')
