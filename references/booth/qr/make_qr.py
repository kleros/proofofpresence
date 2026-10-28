"""
Kleros booth QR codes, drawn in the check-in site's look: night background, the Kleros logo
mark, Urbanist + Space Mono, and a crisp violet-to-blue QR with the Kleros mark inside.

    python3 qr/make_qr.py                      # https://devcon.kleros.io
    python3 qr/make_qr.py https://other.url    # any other address
    python3 qr/make_qr.py --qr-art=path.png    # use a designed QR image instead of drawing one
                                               # (it must scan to the address; the self-check fails otherwise)

The footer line is read from the site (<div class="tagline"> in site/index.html), so the poster always says
what the site says: rerun this script after changing it.

Writes into qr/:
  devcon-kleros-qr-poster.png   1800x2400 portrait card (6x8 in at 300 dpi) for a table stand
  devcon-kleros-qr-poster-a4.png/.pdf   the same poster on A4 (2480x3508 at 300 dpi), PDF ready to print
  devcon-kleros-qr-square.png   1500x1500 sticker / social square
  devcon-kleros-qr-plain.png    QR only on white, for designers to drop into other artwork
  devcon-kleros-qr-plain.svg    QR only, vector, same styling, for large-format print

The address is the same every year (devcon.kleros.io), so these can be reprinted as-is.
Fonts are bundled in qr/fonts (SIL Open Font License).
Needs: pip install "qrcode[pil]" (and opencv-python-headless + zxing-cpp to self-check scanning).
"""
import html
import os
import re
import sys

import qrcode
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
URL = ARGS[0] if ARGS else "https://devcon.kleros.io"
QR_ART = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--qr-art=")), "")
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "site", "assets")   # the flat Kleros mark, shared with the site
FONTS = os.path.join(HERE, "fonts")

# Same tokens as index.html
NIGHT, NIGHT_2, DUSK = (15, 10, 46), (29, 16, 80), (52, 24, 112)
KLEROS, KLEROS_DEEP = (144, 19, 254), (77, 0, 180)
GOLD, LILAC, MUTED, WHITE = (242, 196, 109), (199, 182, 255), (184, 172, 220), (255, 255, 255)
PINK, TEAL, VIOLET, SITE_DUSK = (222, 79, 208), (127, 240, 224), (183, 123, 255), (75, 35, 145)
# QR ink: violet into the blue edge of the icosahedron (both well over 6:1 on white)
INK_A, INK_B = (77, 0, 180), (40, 72, 206)
# Finder-eye corner radii in modules (outer, hole, centre). Rounder eyes look softer but some
# scanners (OpenCV among them) stop finding them past ~0.5, so keep these small.
EYE_R = (0.45, 0.22, 0.32)

HEADLINE = "Check in with Kleros"
PERK = "Claim your limited-edition merch"
DOMAIN = re.sub(r"^https?://", "", URL).rstrip("/")


def urbanist(size, weight="ExtraBold"):
    f = ImageFont.truetype(os.path.join(FONTS, "Urbanist.ttf"), size)
    f.set_variation_by_name(weight)
    return f


def mono(size, bold=True):
    return ImageFont.truetype(os.path.join(FONTS, "SpaceMono-Bold.ttf" if bold else "SpaceMono-Regular.ttf"), size)


# ---------- QR ----------

def matrix():
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=0)
    q.add_data(URL)
    q.make(fit=True)
    return q.get_matrix()


def layout(m):
    """Split the code into finder eyes, data modules and the cleared centre for the mark."""
    n = len(m)
    eyes = [(0, 0), (n - 7, 0), (0, n - 7)]
    c = 7 if n < 33 else 9                     # cleared square, a small share of H-level redundancy
    c0 = (n - c) // 2

    def in_eye(x, y):
        return any(ex <= x < ex + 7 and ey <= y < ey + 7 for ex, ey in eyes)

    def in_centre(x, y):
        return c0 <= x < c0 + c and c0 <= y < c0 + c

    dots = [(x, y) for y in range(n) for x in range(n) if m[y][x] and not in_eye(x, y) and not in_centre(x, y)]
    return n, eyes, dots, (c0, c)


def gradient(size, a, b):
    """Diagonal a -> b gradient, top-left to bottom-right."""
    w, h = size
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return small.resize((w, h), Image.BILINEAR)


def kleros_mark(d):
    """App-icon style Kleros mark: violet rounded square with the white flat icosahedron."""
    ss = 4
    big = d * ss
    tile = gradient((big, big), KLEROS, KLEROS_DEEP).convert("RGBA")
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.26), fill=255)
    tile.putalpha(mask)
    s = int(big * 0.62)
    tile.alpha_composite(symbol_png(s), ((big - s) // 2, (big - s) // 2))
    return tile.resize((d, d), Image.LANCZOS)


def symbol_png(size):
    """Rasterise the flat white icosahedron from the bundled SVG path (no SVG renderer needed)."""
    svg = open(os.path.join(ASSETS, "kleros-symbol-white-flat.svg"), encoding="utf-8").read()
    tx, ty = map(float, re.search(r'translate\(([\d.]+),\s*([\d.]+)\)', svg).groups())
    d = re.search(r'<path d="([^"]+)"', svg).group(1)
    vb = 1445.0
    k = size / vb
    img = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(img)
    for i, sub in enumerate(re.findall(r'M[^M]+', d)):
        pts = [(float(x), float(y)) for x, y in re.findall(r'([\d.]+),([\d.]+)', sub)]
        poly = [((x + tx) * k, (y + ty) * k) for x, y in pts]
        draw.polygon(poly, fill=255 if i == 0 else 0)   # first path is the outline, the rest are holes
    out = Image.new("RGBA", (size, size), WHITE + (0,))
    out.putalpha(img)
    return out


def qr_image(size):
    """Separated rounded modules, soft-cornered eyes, violet-to-blue ink, Kleros mark in the middle.
    With --qr-art, the designed image instead (scaled to the same square)."""
    if QR_ART:
        return Image.open(QR_ART).convert("RGBA").resize((size, size), Image.LANCZOS)
    n, eyes, dots, (c0, c) = layout(matrix())
    ss = 4
    S = size * ss
    u = S / n
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    g = u * 0.09                                  # gap around each module
    for x, y in dots:
        d.rounded_rectangle((x * u + g, y * u + g, (x + 1) * u - g, (y + 1) * u - g), radius=u * 0.3, fill=255)
    for ex, ey in eyes:
        x0, y0 = ex * u, ey * u
        d.rounded_rectangle((x0, y0, x0 + 7 * u, y0 + 7 * u), radius=u * EYE_R[0], fill=255)
        d.rounded_rectangle((x0 + u, y0 + u, x0 + 6 * u, y0 + 6 * u), radius=u * EYE_R[1], fill=0)
        d.rounded_rectangle((x0 + 2 * u, y0 + 2 * u, x0 + 5 * u, y0 + 5 * u), radius=u * EYE_R[2], fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)

    img = Image.new("RGBA", (size, size), WHITE + (0,))
    ink = gradient((size, size), INK_A, INK_B).convert("RGBA")
    ink.putalpha(mask)
    img.alpha_composite(ink)

    mark = int(size * (c - 1.2) / n)
    img.alpha_composite(kleros_mark(mark), ((size - mark) // 2, (size - mark) // 2))
    return img


# ---------- poster pieces ----------

def background(w, h):
    """Night gradient, a violet glow behind the code, a blue one near the top, light grain."""
    small = Image.new("RGB", (8, 256))
    px = small.load()
    for y in range(256):
        t = y / 255
        a, b, k = (NIGHT, NIGHT_2, t / 0.5) if t < 0.5 else (NIGHT_2, DUSK, (t - 0.5) / 0.5)
        for x in range(8):
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
    bg = small.resize((w, h), Image.BILINEAR).convert("RGBA")
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((w * -0.1, h * 0.38, w * 1.1, h * 1.02), fill=KLEROS + (70,))
    gd.ellipse((w * 0.22, h * -0.06, w * 0.78, h * 0.26), fill=(70, 110, 255, 45))
    bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(w // 8)))
    grain = Image.effect_noise((w, h), 22).convert("RGBA")
    grain.putalpha(10)
    return Image.alpha_composite(bg, grain)


def text_width(text, f, tracking=0):
    d = ImageDraw.Draw(Image.new("L", (1, 1)))
    if not tracking:
        return d.textlength(text, font=f)
    return sum(d.textlength(ch, font=f) for ch in text) + tracking * (len(text) - 1)


def draw_text(img, xy, text, f, fill, tracking=0):
    d = ImageDraw.Draw(img)
    x, y = xy
    if not tracking:
        d.text((x, y), text, font=f, fill=fill)
        return
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + tracking


def centered(img, y, text, f, fill, tracking=0):
    draw_text(img, ((img.width - text_width(text, f, tracking)) / 2, y), text, f, fill, tracking)


def gradient_headline(img, y, text, f):
    """White fading to lilac top to bottom, like the site's h1."""
    w = int(text_width(text, f)) + 20
    asc, desc = f.getmetrics()
    h = asc + desc
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).text((10, 0), text, font=f, fill=255)
    fill = Image.new("RGB", (1, h))
    for yy in range(h):
        t = min(1, max(0, (yy / h - 0.35) / 0.8))
        fill.putpixel((0, yy), tuple(int(WHITE[i] + (LILAC[i] - WHITE[i]) * t) for i in range(3)))
    fill = fill.resize((w, h)).convert("RGBA")
    fill.putalpha(mask)
    img.alpha_composite(fill, (int((img.width - w) / 2), int(y)))


def perk_pill(img, y, text, f):
    """Gold hairline pill with a small gold diamond: the merch line, kept quiet."""
    pad_x, dia = int(f.size * 1.0), int(f.size * 0.42)
    tw = text_width(text, f)
    w = int(tw + pad_x * 2 + dia + f.size * 0.55)
    h = int(f.size * 2.05)
    x0 = (img.width - w) // 2
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((x0, y, x0 + w, y + h), radius=h // 2, fill=GOLD + (22,), outline=GOLD + (170,), width=max(2, f.size // 18))
    cx, cy = x0 + pad_x + dia / 2, y + h / 2
    d.polygon([(cx, cy - dia / 2), (cx + dia / 2, cy), (cx, cy + dia / 2), (cx - dia / 2, cy)], fill=GOLD + (255,))
    asc, desc = f.getmetrics()
    d.text((x0 + pad_x + dia + f.size * 0.55, cy - (asc + desc) / 2 + f.size * 0.04), text, font=f, fill=GOLD + (255,))
    img.alpha_composite(layer)
    return y + h


def qr_card(img, x0, y0, card, qr):
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0 + 30, y0 + 50, x0 + card - 30, y0 + card + 30), radius=card // 14, fill=(20, 0, 60, 200))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(card // 22)))
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle((x0, y0, x0 + card, y0 + card), radius=card // 14, fill=WHITE + (255,))
    img.alpha_composite(layer)
    img.alpha_composite(qr_image(qr), (x0 + (card - qr) // 2, y0 + (card - qr) // 2))


def logo(img, cx, y, width):
    """The Kleros logo mark (flat white icosahedron) with a soft violet halo."""
    m = symbol_png(width * 2)
    m = m.crop(m.getchannel("A").getbbox())
    h = int(m.height * width / m.width)
    m = m.resize((width, h), Image.LANCZOS)
    halo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    r = width * 0.62
    ImageDraw.Draw(halo).ellipse((cx - r, y + h / 2 - r, cx + r, y + h / 2 + r), fill=(150, 120, 255, 70))
    img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(width // 4)))
    img.alpha_composite(m, (int(cx - width / 2), int(y)))
    return y + h


# ---------- the check-in site's look, for the booth poster ----------

def svg_subpaths(d, k, ox=0.0, oy=0.0):
    """Absolute M/L/H/V/C/Z path data (all the Kleros logo uses) as polygons, cubics flattened."""
    toks = re.findall(r"[MLHVCZ]|-?\d*\.?\d+(?:e-?\d+)?", d)
    polys, cur, x, y, i, cmd = [], [], 0.0, 0.0, 0, None
    num = lambda: float(toks[i])
    while i < len(toks):
        if toks[i] in "MLHVCZ":
            cmd = toks[i]; i += 1
            if cmd == "Z":
                polys.append(cur); cur = []
            continue
        if cmd == "M" or cmd == "L":
            x, y = num(), float(toks[i + 1]); i += 2
            if cmd == "M" and cur:
                polys.append(cur); cur = []
            cur.append((x, y)); cmd = "L" if cmd == "M" else cmd
        elif cmd == "H":
            x = num(); i += 1; cur.append((x, y))
        elif cmd == "V":
            y = num(); i += 1; cur.append((x, y))
        elif cmd == "C":
            x1, y1, x2, y2, x3, y3 = (float(t) for t in toks[i:i + 6]); i += 6
            for s in range(1, 13):
                t = s / 12
                cur.append(((1 - t) ** 3 * x + 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3 * x3,
                            (1 - t) ** 3 * y + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3 * y3))
            x, y = x3, y3
    if cur:
        polys.append(cur)
    return [[((px + ox) * k, (py + oy) * k) for px, py in p] for p in polys if len(p) > 2]


def svg_mask(name, width):
    """An SVG from site/assets as an alpha mask `width` px wide, filled even-odd (holes stay open)."""
    svg = open(os.path.join(ASSETS, name), encoding="utf-8").read()
    vw, vh = map(float, re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg).groups())
    t = re.search(r'translate\(([\d.]+),\s*([\d.]+)\)', svg)
    ox, oy = map(float, t.groups()) if t else (0.0, 0.0)
    ss = 4
    k = width * ss / vw
    W, H = int(vw * k), int(vh * k)
    mask = Image.new("L", (W, H), 0)
    for d in re.findall(r'<path[^>]* d="([^"]+)"', svg):
        for poly in svg_subpaths(d, k, ox, oy):
            layer = Image.new("L", (W, H), 0)
            ImageDraw.Draw(layer).polygon(poly, fill=255)
            mask = ImageChops.logical_xor(mask.convert("1"), layer.convert("1")).convert("L")
    mask = mask.resize((W // ss, H // ss), Image.LANCZOS)
    return mask.crop(mask.getbbox())


def site_background(w, h):
    """index.html's body: night to dusk, a pink glow from the bottom, a faint teal one top right, stars."""
    small = Image.new("RGB", (8, 256))
    px = small.load()
    for yy in range(256):
        t = yy / 255
        a, b, k = (NIGHT, NIGHT_2, t / 0.45) if t < 0.45 else (NIGHT_2, SITE_DUSK, (t - 0.45) / 0.55)
        for xx in range(8):
            px[xx, yy] = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
    bg = small.resize((w, h), Image.BILINEAR).convert("RGBA")
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((w * -0.2, h * 0.72, w * 1.2, h * 1.35), fill=PINK + (95,))
    gd.ellipse((w * 0.55, h * -0.12, w * 1.25, h * 0.22), fill=TEAL + (28,))
    gd.ellipse((w * 0.05, h * 0.36, w * 0.95, h * 0.86), fill=KLEROS + (40,))
    bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(w // 7)))
    stars = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stars)
    import random
    rnd = random.Random(8)                       # same stars every run
    for _ in range(90):
        x, y, r = rnd.uniform(0, w), rnd.uniform(0, h), rnd.choice((1.5, 2, 2, 2.5, 3.5))
        if w * 0.16 < x < w * 0.84:              # keep the text column clear
            continue
        sd.ellipse((x - r, y - r, x + r, y + r), fill=WHITE + (rnd.randint(70, 150),))
    bg = Image.alpha_composite(bg, stars)
    grain = Image.effect_noise((w, h), 22).convert("RGBA")
    grain.putalpha(8)
    return Image.alpha_composite(bg, grain)


def float_mark(img, cx, cy, width, colour, alpha, angle):
    """One of the site's drifting icosahedrons: the flat mark, tinted, rotated, with a glow."""
    m = svg_mask("kleros-symbol-white-flat.svg", width).rotate(angle, resample=Image.BICUBIC, expand=True)
    tile = Image.new("RGBA", m.size, colour + (0,))
    tile.putalpha(m.point(lambda v: v * alpha // 255))
    glow = Image.new("RGBA", m.size, colour + (0,))
    glow.putalpha(m.point(lambda v: v * alpha // 400).filter(ImageFilter.GaussianBlur(width // 12)))
    pos = (int(cx - m.width / 2), int(cy - m.height / 2))
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    layer.alpha_composite(glow, (max(pos[0], 0), max(pos[1], 0)), (max(-pos[0], 0), max(-pos[1], 0)))
    layer.alpha_composite(tile, (max(pos[0], 0), max(pos[1], 0)), (max(-pos[0], 0), max(-pos[1], 0)))
    img.alpha_composite(layer)


def deco_frame(img, inset, s):
    """The thin gold frame with art-deco corners that sits around the check-in page."""
    w, h = img.size
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    line = max(2, s // 14)
    d.rounded_rectangle((inset, inset, w - inset, h - inset), radius=s // 5, outline=GOLD + (95,), width=line)
    corner = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    cd = ImageDraw.Draw(corner)
    u = s / 34                                   # the site's corner is drawn on a 34-unit grid
    c = GOLD + (215,)
    cd.line([(5 * u, 33 * u), (5 * u, 5 * u), (33 * u, 5 * u)], fill=c, width=line)
    cd.line([(9 * u, 33 * u), (9 * u, 9 * u), (33 * u, 9 * u)], fill=c, width=line)
    cd.line([(5 * u, 5 * u), (14 * u, 14 * u)], fill=c, width=line)
    cd.polygon([(14 * u, 9.8 * u), (18.2 * u, 14 * u), (14 * u, 18.2 * u), (9.8 * u, 14 * u)], outline=c, width=line)
    o = inset - int(5 * u)
    layer.alpha_composite(corner, (o, o))
    layer.alpha_composite(corner.transpose(Image.FLIP_LEFT_RIGHT), (w - o - s, o))
    layer.alpha_composite(corner.transpose(Image.FLIP_TOP_BOTTOM), (o, h - o - s))
    layer.alpha_composite(corner.transpose(Image.ROTATE_180), (w - o - s, h - o - s))
    img.alpha_composite(layer)


def white_wordmark(img, x, y, width):
    m = svg_mask("logo-kleros-white.svg", width)
    tile = Image.new("RGBA", m.size, WHITE + (0,))
    tile.putalpha(m)
    img.alpha_composite(tile, (int(x), int(y)))
    return m.size


def badge(img, right, cy, text, f):
    """Gold hairline pill, right-aligned, like the edition badge in the site header."""
    tracking = f.size * 0.16
    tw = text_width(text, f, tracking)
    pad, h = f.size * 1.0, int(f.size * 2.3)
    x0 = int(right - tw - pad * 2)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle((x0, cy - h // 2, right, cy + h // 2), radius=h // 2, outline=GOLD + (120,), width=max(2, f.size // 14))
    img.alpha_composite(layer)
    asc, desc = f.getmetrics()
    draw_text(img, (x0 + pad, cy - (asc + desc) / 2 + f.size * 0.08), text, f, GOLD, tracking)


def gradient_gem(img, cx, y, width):
    """The site's hero mark: the icosahedron in gold, white and violet, glowing."""
    m = svg_mask("kleros-symbol-white-flat.svg", width)
    w, h = m.size
    fill = Image.new("RGB", (w, h))
    p = fill.load()
    for yy in range(h):
        for xx in range(w):
            t = (xx / w * 0.53 + yy / h * 0.47)
            a, b, k = (GOLD, WHITE, t / 0.45) if t < 0.45 else (WHITE, VIOLET, (t - 0.45) / 0.55)
            p[xx, yy] = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
    fill = fill.convert("RGBA")
    fill.putalpha(m)
    halo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    r = width * 0.7
    hd.ellipse((cx - r, y + h / 2 - r, cx + r, y + h / 2 + r), fill=VIOLET + (90,))
    img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(width // 3)))
    img.alpha_composite(fill, (int(cx - w / 2), int(y)))
    return y + h


# Designed QR art (--qr-art) brings its own dark margin as the border, so it goes on the page without the
# white card. The code and its light frame sit inside ART_CORE of each edge; outside that, the dark nebula
# fades into the poster while the bright gold ornaments and light rays stay, tapering off before the edge.
ART_CORE = 0.068


def art_qr(img, x0, y0, size):
    art = Image.open(QR_ART).convert("RGB").resize((size, size), Image.LANCZOS)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sp = size * 0.07
    ImageDraw.Draw(glow).ellipse((x0 - sp, y0 - sp * 0.6, x0 + size + sp, y0 + size + sp * 1.2), fill=(120, 40, 255, 108))
    glow = glow.filter(ImageFilter.GaussianBlur(size // 11))
    img.alpha_composite(glow)
    grain = Image.effect_noise(img.size, 22).convert("RGBA")   # dithers the glow so it doesn't band in print
    grain.putalpha(glow.getchannel("A").point(lambda v: v * 24 // 255))
    img.alpha_composite(grain)
    c = size * ART_CORE
    core = Image.new("L", (size, size), 0)
    ImageDraw.Draw(core).rectangle((c, c, size - c, size - c), fill=255)
    core = core.filter(ImageFilter.GaussianBlur(size * 0.004))
    lo, hi = 45, 125
    luma = art.convert("L").point(lambda v: 0 if v < lo else 255 if v > hi else (v - lo) * 255 // (hi - lo))
    fade = Image.new("L", (size, size), 0)       # full until the outer half of the margin, ~0 at the edge
    ImageDraw.Draw(fade).rectangle((c * 0.35, c * 0.35, size - c * 0.35, size - c * 0.35), fill=255)
    fade = fade.filter(ImageFilter.GaussianBlur(c * 0.15))
    art = art.convert("RGBA")
    art.putalpha(ImageChops.lighter(core, ImageChops.multiply(luma, fade)))
    img.alpha_composite(art, (int(x0), int(y0)))


def framed_qr_card(img, x0, y0, card, qr):
    """White QR card inside a thin gold-to-pink-to-violet ring, with a violet glow behind. Designed QR art
    goes on the page instead (art_qr)."""
    if QR_ART:
        return art_qr(img, x0, y0, card)
    ring = max(6, card // 130)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle((x0 - 30, y0 - 10, x0 + card + 30, y0 + card + 50), radius=card // 12, fill=(120, 40, 255, 150))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(card // 16)))
    grad = gradient((card + 2 * ring, card + 2 * ring), GOLD, KLEROS).convert("RGBA")
    rm = Image.new("L", grad.size, 0)
    ImageDraw.Draw(rm).rounded_rectangle((0, 0, grad.width - 1, grad.height - 1), radius=card // 14 + ring, fill=255)
    grad.putalpha(rm)
    img.alpha_composite(grad, (x0 - ring, y0 - ring))
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle((x0, y0, x0 + card, y0 + card), radius=card // 14, fill=WHITE + (255,))
    img.alpha_composite(layer)
    img.alpha_composite(qr_image(qr), (x0 + (card - qr) // 2, y0 + (card - qr) // 2))


def site_tagline():
    """The site's footer line, from <div class="tagline"> in site/index.html: [(text, colour)]. Like on the
    site, the keywords are white, the <b> one gold and the dots between them muted."""
    page = open(os.path.join(HERE, "..", "site", "index.html"), encoding="utf-8").read()
    inner = re.search(r'<div class="tagline">(.*?)</div>', page, re.S).group(1)
    parts = []
    for i, seg in enumerate(inner.split("·")):
        if i:
            parts.append(("  ·  ", MUTED))
        parts.append((html.unescape(re.sub(r"<[^>]+>", "", seg)).strip().upper(), GOLD if "<b>" in seg else WHITE))
    return parts


def tagline(img, y, f):
    """The site footer line (site_tagline), centred."""
    parts = site_tagline()
    tr = f.size * 0.14
    total = sum(text_width(t, f, tr) for t, _ in parts) + tr * 2
    x = (img.width - total) / 2
    for t, c in parts:
        draw_text(img, (x, y), t, f, c, tr)
        x += text_width(t, f, tr) + tr


def poster(W=1800, H=2400):
    """Drawn on a 1800x2400 grid (6x8 in) and scaled to W; a taller page (A4) spreads the extra height
    over the gaps, so the design stays the same."""
    k = W / 1800
    s = lambda v: int(round(v * k))
    extra = H - 2400 * k                         # 0 for 6x8 in, about 200 px for A4
    img = site_background(W, H)
    for cx, cy, w, colour, a, ang in ((60, 610, 250, GOLD, 80, -14), (1745, 1180, 430, VIOLET, 75, 16),
                                      (95, 1760, 170, TEAL, 95, 28), (1705, 330, 175, TEAL, 70, -8),
                                      (1650, 2130, 300, GOLD, 60, 22), (150, 2260, 120, VIOLET, 70, -20)):
        float_mark(img, cx * k, cy * H / 2400, s(w), colour, a, ang)
    deco_frame(img, s(46), s(102))

    ww, wh = white_wordmark(img, s(150), s(125), s(330))
    badge(img, W - s(150), s(125) + wh / 2, "DEVCON VIII · MUMBAI", urbanist(s(34), "Bold"))

    y = gradient_gem(img, W / 2, s(285) + extra * 0.25, s(205))
    y += extra * 0.1
    centered(img, y + s(40), "TRUST AT MACHINE SPEED", urbanist(s(40), "Bold"), GOLD, tracking=7 * k)
    gradient_headline(img, y + s(105), HEADLINE, urbanist(s(146)))
    y = perk_pill(img, int(y + s(320) + extra * 0.1), PERK, urbanist(s(48), "SemiBold"))
    card, qr = s(1030), s(850)
    y += s(70) + extra * 0.25
    framed_qr_card(img, (W - card) // 2, int(y), card, qr)
    y += card
    centered(img, y + s(62), DOMAIN, mono(s(66)), WHITE, tracking=4 * k)
    tagline(img, H - s(175), urbanist(s(32), "SemiBold"))
    return img.convert("RGB")


def square():
    W = H = 1500
    img = site_background(W, H)
    for cx, cy, w, colour, a, ang in ((55, 470, 200, GOLD, 80, -14), (1450, 900, 300, VIOLET, 75, 16),
                                      (80, 1220, 140, TEAL, 95, 28), (1420, 260, 140, TEAL, 70, -8)):
        float_mark(img, cx, cy, w, colour, a, ang)
    deco_frame(img, 38, 86)
    ww, wh = white_wordmark(img, 115, 95, 260)
    badge(img, W - 115, 95 + wh / 2, "DEVCON VIII · MUMBAI", urbanist(28, "Bold"))
    gradient_headline(img, 200, HEADLINE, urbanist(112))
    y = perk_pill(img, 362, PERK, urbanist(38, "SemiBold"))
    card, qr = 820, 676
    if QR_ART:                                    # a little smaller: its pendant reaches further down than a card
        art_qr(img, (W - card * 0.96) // 2, y + 52, int(card * 0.96))
    else:
        framed_qr_card(img, (W - card) // 2, y + 52, card, qr)
    centered(img, y + 52 + card + 46, DOMAIN, mono(54), WHITE, tracking=3)
    return img.convert("RGB")


def plain():
    img = Image.new("RGBA", (2000, 2000), WHITE + (255,))
    img.alpha_composite(qr_image(1700), (150, 150))   # 150px white margin as quiet zone
    write_svg(os.path.join(HERE, "devcon-kleros-qr-plain.svg"))
    return img.convert("RGB")


def write_svg(path):
    """Vector twin of qr_image: same modules, eyes, gradient and centre mark."""
    n, eyes, dots, (c0, c) = layout(matrix())
    q = 4                                         # quiet zone in modules
    V = n + 2 * q
    g = 0.09
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {V} {V}" width="{V * 40}" height="{V * 40}">',
             '<defs><linearGradient id="ink" x1="0" y1="0" x2="1" y2="1">'
             f'<stop offset="0" stop-color="#{"%02x%02x%02x" % INK_A}"/><stop offset="1" stop-color="#{"%02x%02x%02x" % INK_B}"/></linearGradient>'
             '<linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">'
             f'<stop offset="0" stop-color="#{"%02x%02x%02x" % KLEROS}"/><stop offset="1" stop-color="#{"%02x%02x%02x" % KLEROS_DEEP}"/></linearGradient></defs>',
             f'<rect width="{V}" height="{V}" fill="#fff"/>',
             f'<g fill="url(#ink)" transform="translate({q} {q})">']
    for x, y in dots:
        parts.append(f'<rect x="{x + g:.2f}" y="{y + g:.2f}" width="{1 - 2 * g:.2f}" height="{1 - 2 * g:.2f}" rx=".3"/>')
    for ex, ey in eyes:
        parts.append(f'<path fill-rule="evenodd" d="{rrect(ex, ey, 7, EYE_R[0])} {rrect(ex + 1, ey + 1, 5, EYE_R[1])}"/>')
        parts.append(f'<rect x="{ex + 2}" y="{ey + 2}" width="3" height="3" rx="{EYE_R[2]}"/>')
    parts.append('</g>')
    m = c - 1.2
    mx = q + (n - m) / 2
    parts.append(f'<rect x="{mx:.3f}" y="{mx:.3f}" width="{m:.3f}" height="{m:.3f}" rx="{m * 0.26:.3f}" fill="url(#tile)"/>')
    svg = open(os.path.join(ASSETS, "kleros-symbol-white-flat.svg"), encoding="utf-8").read()
    tx, ty = re.search(r'translate\(([\d.]+),\s*([\d.]+)\)', svg).groups()
    d = re.search(r'<path d="([^"]+)"', svg).group(1)
    s = m * 0.62
    k = s / 1445
    o = mx + (m - s) / 2
    parts.append(f'<path fill="#fff" fill-rule="evenodd" transform="translate({o:.3f} {o:.3f}) scale({k:.6f}) translate({tx} {ty})" d="{d}"/>')
    parts.append('</svg>')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(parts))


def rrect(x, y, s, r):
    return (f"M{x + r} {y}H{x + s - r}A{r} {r} 0 0 1 {x + s} {y + r}V{y + s - r}A{r} {r} 0 0 1 {x + s - r} {y + s}"
            f"H{x + r}A{r} {r} 0 0 1 {x} {y + s - r}V{y + r}A{r} {r} 0 0 1 {x + r} {y}Z")


def same_url(text, url):
    """Does a decoded QR open `url`? Scheme and host ignore case, and a bare trailing / doesn't matter:
    designed codes often encode HTTPS://DEVCON.KLEROS.IO/ in capitals, which makes the code less dense."""
    from urllib.parse import urlsplit
    a, b = urlsplit(text.strip()), urlsplit(url.strip())
    key = lambda u: (u.scheme.lower(), u.netloc.lower(), u.path.rstrip("/"), u.query)
    return key(a) == key(b)


def self_check(paths):
    """Decode each file at phone-ish sizes with OpenCV and ZXing (the engine in many phone
    scanners), the ZXing pass slightly blurred like a camera frame. Fails loudly on a miss."""
    try:
        import cv2
    except ImportError:
        print("opencv not installed; skipped scan check")
        return
    try:
        import zxingcpp
    except ImportError:
        zxingcpp = None
        print("zxing-cpp not installed; checking with OpenCV only")
    det = cv2.QRCodeDetector()
    for p in paths:
        im = cv2.imread(p)
        cv_hits = zx_hits = 0
        scales = (0.6, 0.4, 0.25, 0.15)
        for scale in scales:
            small = cv2.resize(im, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            try:
                cv_hits += same_url(det.detectAndDecode(small)[0], URL)
            except cv2.error:
                pass
            if zxingcpp:
                found = zxingcpp.read_barcodes(cv2.GaussianBlur(small, (0, 0), 1.0))
                zx_hits += bool(found) and same_url(found[0].text, URL)
        # OpenCV is the pickier decoder and can miss one odd size; ZXing must read every size.
        ok = cv_hits >= len(scales) - 1 and (not zxingcpp or zx_hits == len(scales))
        print(("scans OK  " if ok else "NO SCAN   ") + f"{os.path.basename(p)}  "
              f"(OpenCV {cv_hits}/{len(scales)}" + (f", ZXing {zx_hits}/{len(scales)})" if zxingcpp else ")"))
        if not ok:
            sys.exit(1)


if __name__ == "__main__":
    out = []
    for name, fn in (("poster", poster), ("poster-a4", lambda: poster(2480, 3508)), ("square", square), ("plain", plain)):
        p = os.path.join(HERE, f"devcon-kleros-qr-{name}.png")
        im = fn()
        im.save(p, dpi=(300, 300))
        if name == "poster-a4":
            im.save(p[:-4] + ".pdf", resolution=300)
        out.append(p)
    print("encoded:", URL)
    self_check(out)
