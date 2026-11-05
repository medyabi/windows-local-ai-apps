"""Generates the LocalMind icon set: a deep-navy rounded tile with a violet-to-cyan speech bubble
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
    """The mark alone (transparent background), S x S."""
    # bubble mask: rounded body + tail
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    bx0, by0, bx1, by1 = int(S * .13), int(S * .15), int(S * .87), int(S * .69)
    md.rounded_rectangle([bx0, by0, bx1, by1], radius=int(S * .22), fill=255)
    md.polygon([(int(S * .27), by1 - 30), (int(S * .17), int(S * .86)), (int(S * .47), by1 - 30)], fill=255)
    fill = dgradient((S, S), VIOLET, CYAN)
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    glow.paste(Image.new("RGBA", (S, S), VIOLET + (150,)), (0, 0), mask.filter(ImageFilter.GaussianBlur(S * .035)))
    im = Image.alpha_composite(Image.new("RGBA", (S, S), (0, 0, 0, 0)), glow)
    bubble = fill.convert("RGBA")
    bubble.putalpha(mask)
    im = Image.alpha_composite(im, bubble)
    d = ImageDraw.Draw(im)
    cx, cy = (bx0 + bx1) // 2, (by0 + by1) // 2 - int(S * .005)
    star(d, cx, cy, int(S * .205), int(S * .062), INK)
    star(d, cx + int(S * .235), cy - int(S * .13), int(S * .062), int(S * .02), INK)
    star(d, cx - int(S * .255), cy + int(S * .14), int(S * .045), int(S * .015), INK)
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
d.text((int(WH * 1.0), 140), "LocalMind", font=font("segoeuib.ttf", 112), fill=(255, 255, 255))
d.text((int(WH * 1.0), 290), "Private chat · on-device AI", font=font("segoeui.ttf", 42), fill=(176, 184, 214))
d.text((int(WH * 1.0), 420), "by Dyabi", font=font("seguisb.ttf", 52), fill=CYAN)
save(wide, "Wide310x150Logo.png")

# Splash
SW, SH = 1240, 600
splash = Image.new("RGBA", (SW, SH), (13, 15, 20, 255))
sd = ImageDraw.Draw(splash)
tile = square_tile(280, mark)
splash.alpha_composite(tile, (SW // 2 - 140, 70))
f1 = font("segoeuib.ttf", 84)
t1 = "LocalMind"
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
