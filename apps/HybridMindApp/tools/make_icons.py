"""Generates the HybridMind icon set: a deep-navy rounded tile with a violet-to-cyan speech bubble
that holds a four-point spark. Drawn at 1024px and downsampled for crisp edges."""
import math
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Assets")
os.makedirs(OUT, exist_ok=True)
FONTS = "C:/Windows/Fonts"

NAVY_TOP, NAVY_BOT = (30, 34, 66), (11, 13, 22)
VIOLET, CYAN = (139, 123, 255), (63, 193, 238)
INK = (14, 16, 28)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def vgradient(size, top, bot):
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return img


def dgradient(size, a, b):
    """diagonal gradient from top-left (a) to bottom-right (b)"""
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h - 2)
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return img


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


def star(draw, cx, cy, r_out, r_in, fill):
    pts = []
    for i in range(8):
        ang = math.pi / 4 * i - math.pi / 2
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    draw.polygon(pts, fill=fill)


def draw_mark(S=1024):
    """The mark alone: a cyan cloud and a violet chip, joined by a spark (on-device + cloud)."""
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # cloud (union of circles + base), filled with a cyan->blue gradient
    cm = Image.new("L", (S, S), 0)
    cd = ImageDraw.Draw(cm)
    cd.ellipse([int(S*.36), int(S*.20), int(S*.66), int(S*.50)], fill=255)
    cd.ellipse([int(S*.52), int(S*.28), int(S*.88), int(S*.64)], fill=255)
    cd.ellipse([int(S*.30), int(S*.34), int(S*.58), int(S*.62)], fill=255)
    cd.rounded_rectangle([int(S*.30), int(S*.44), int(S*.88), int(S*.64)], radius=int(S*.10), fill=255)
    cloud = dgradient((S, S), (90, 210, 245), (60, 130, 240)).convert("RGBA")
    cloud.putalpha(cm)
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    glow.paste(Image.new("RGBA", (S, S), CYAN + (120,)), (0, 0), cm.filter(ImageFilter.GaussianBlur(S * .03)))
    im = Image.alpha_composite(im, glow)
    im = Image.alpha_composite(im, cloud)
    # chip (rounded square with pins) in violet, overlapping the cloud's lower left
    cx0, cy0, cx1, cy1 = int(S*.14), int(S*.42), int(S*.54), int(S*.82)
    ch = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    chd = ImageDraw.Draw(ch)
    pin = int(S*.035)
    for k in range(3):
        t = cx0 + int((cx1-cx0) * (k+1) / 4)
        chd.rounded_rectangle([t-pin//2, cy0-int(S*.055), t+pin//2, cy0+8], radius=6, fill=(200, 190, 255, 255))
        chd.rounded_rectangle([t-pin//2, cy1-8, t+pin//2, cy1+int(S*.055)], radius=6, fill=(200, 190, 255, 255))
        u = cy0 + int((cy1-cy0) * (k+1) / 4)
        chd.rounded_rectangle([cx0-int(S*.055), u-pin//2, cx0+8, u+pin//2], radius=6, fill=(200, 190, 255, 255))
        chd.rounded_rectangle([cx1-8, u-pin//2, cx1+int(S*.055), u+pin//2], radius=6, fill=(200, 190, 255, 255))
    body = dgradient((S, S), (160, 140, 255), (110, 90, 235)).convert("RGBA")
    bm = Image.new("L", (S, S), 0)
    ImageDraw.Draw(bm).rounded_rectangle([cx0, cy0, cx1, cy1], radius=int(S*.07), fill=255)
    body.putalpha(bm)
    # dark outline so the chip separates from the cloud
    ol = Image.new("L", (S, S), 0)
    ImageDraw.Draw(ol).rounded_rectangle([cx0-14, cy0-14, cx1+14, cy1+14], radius=int(S*.085), fill=255)
    outline = Image.new("RGBA", (S, S), NAVY_BOT + (255,)); outline.putalpha(ol)
    im = Image.alpha_composite(im, outline)
    im = Image.alpha_composite(im, ch)
    im = Image.alpha_composite(im, body)
    d = ImageDraw.Draw(im)
    star(d, (cx0+cx1)//2, (cy0+cy1)//2, int(S*.12), int(S*.036), INK)
    return im


def square_tile(px, mark, corner=.22, padding=.07):
    S = 1024
    bg = vgradient((S, S), NAVY_TOP, NAVY_BOT).convert("RGBA")
    inner = int(S * (1 - 2 * padding))
    m = mark.resize((inner, inner), Image.LANCZOS)
    bg.alpha_composite(m, (int(S * padding), int(S * padding)))
    bg.putalpha(rounded_mask((S, S), int(S * corner)))
    return bg.resize((px, px), Image.LANCZOS)


def save(img, name):
    img.save(os.path.join(OUT, name), "PNG")
    print("wrote", name, img.size)


mark = draw_mark(1024)

save(square_tile(176, mark), "Square44x44Logo.png")
save(square_tile(600, mark), "Square150x150Logo.png")
save(square_tile(200, mark), "StoreLogo.png")
save(square_tile(96, mark, corner=.2, padding=.04), "LockScreenLogo.png")
for t in (16, 24, 32, 48, 256):
    save(square_tile(t, mark, corner=.2, padding=.04), f"Square44x44Logo.targetsize-{t}_altform-unplated.png")

# Wide tile
WW, WH = 1240, 600
wide = vgradient((WW, WH), NAVY_TOP, NAVY_BOT).convert("RGBA")
wm = mark.resize((int(WH * .86), int(WH * .86)), Image.LANCZOS)
wide.alpha_composite(wm, (int(WH * .07), int(WH * .07)))
d = ImageDraw.Draw(wide)
d.text((int(WH * 1.0), 140), "HybridMind", font=font("segoeuib.ttf", 100), fill=(255, 255, 255))
d.text((int(WH * 1.0), 290), "On-device first · cloud when needed", font=font("segoeui.ttf", 33), fill=(176, 184, 214))
d.text((int(WH * 1.0), 420), "by Dyabi", font=font("seguisb.ttf", 52), fill=CYAN)
save(wide, "Wide310x150Logo.png")

# Splash
SW, SH = 1240, 600
splash = Image.new("RGBA", (SW, SH), (13, 15, 20, 255))
sd = ImageDraw.Draw(splash)
tile = square_tile(280, mark)
splash.alpha_composite(tile, (SW // 2 - 140, 70))
f1 = font("segoeuib.ttf", 84)
t1 = "HybridMind"
w1 = sd.textlength(t1, font=f1)
sd.text(((SW - w1) / 2, 380), t1, font=f1, fill=(233, 236, 243))
f2 = font("seguisb.ttf", 40)
t2 = "by Dyabi"
w2 = sd.textlength(t2, font=f2)
sd.text(((SW - w2) / 2, 487), t2, font=f2, fill=CYAN)
save(splash, "SplashScreen.png")

ico_src = square_tile(256, mark, corner=.2, padding=.04)
ico_src.save(os.path.join(OUT, "AppIcon.ico"), format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote AppIcon.ico")
