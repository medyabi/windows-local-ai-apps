"""Generates the Offline Spec Sheet Q&A icon set: a vermilion rounded tile with a
datasheet page (folded corner, ruled lines, one highlighted spec row) and a navy
"IQ" speech bubble. Drawn at 1024px and downsampled for crisp edges."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Assets")
os.makedirs(OUT, exist_ok=True)
FONTS = r"C:\Windows\Fonts"

VERM_TOP, VERM_BOT = (236, 92, 48), (192, 56, 18)
PAPER, PAPER_SHADE, RULE, HILITE = (255, 251, 242), (233, 224, 204), (205, 195, 172), (255, 208, 64)
NAVY = (22, 32, 52)


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


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


def draw_mark(S=1024):
    """The mark alone (transparent background), S x S."""
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # page
    px0, py0, px1, py1 = int(S * .20), int(S * .13), int(S * .74), int(S * .84)
    fold = int(S * .17)
    d.polygon([(px0, py0), (px1 - fold, py0), (px1, py0 + fold), (px1, py1), (px0, py1)], fill=PAPER)
    d.polygon([(px1 - fold, py0), (px1, py0 + fold), (px1 - fold, py0 + fold)], fill=PAPER_SHADE)
    # ruled spec rows
    lx0, lx1 = px0 + int(S * .06), px1 - int(S * .06)
    y = py0 + int(S * .27)
    row_h = int(S * .095)
    for i in range(5):
        if i == 2:
            d.rounded_rectangle([lx0 - 8, y - 6, lx1 + 8, y + int(S * .05) + 6], radius=14, fill=HILITE)
        d.rounded_rectangle([lx0, y, lx0 + int(S * .13), y + int(S * .05)], radius=10, fill=NAVY if i == 2 else RULE)
        d.rounded_rectangle([lx0 + int(S * .17), y, lx1 - (0 if i % 2 else int(S * .06)), y + int(S * .05)], radius=10,
                            fill=(120, 96, 20) if i == 2 else RULE)
        y += row_h
    # speech bubble
    bx0, by0, bx1, by1 = int(S * .52), int(S * .52), int(S * .90), int(S * .86)
    d.rounded_rectangle([bx0 - 14, by0 - 14, bx1 + 14, by1 + 14], radius=int(S * .09), fill=(0, 0, 0, 0))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([bx0 + 6, by0 + 12, bx1 + 6, by1 + 12], radius=int(S * .09), fill=(0, 0, 0, 70))
    im = Image.alpha_composite(im, shadow)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(S * .09), fill=NAVY)
    d.polygon([(bx0 + int(S * .06), by1 - 4), (bx0 + int(S * .02), by1 + int(S * .075)), (bx0 + int(S * .13), by1 - 4)], fill=NAVY)
    f = font("segoeuib.ttf", int(S * .235))
    bb = d.textbbox((0, 0), "IQ", font=f)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text(((bx0 + bx1) // 2 - tw // 2 - bb[0], (by0 + by1) // 2 - th // 2 - bb[1]), "IQ", font=f, fill=(255, 255, 255))
    return im


def square_tile(px, mark, corner=.22, padding=.07):
    S = 1024
    bg = vgradient((S, S), VERM_TOP, VERM_BOT).convert("RGBA")
    inner = int(S * (1 - 2 * padding))
    m = mark.resize((inner, inner), Image.LANCZOS)
    bg.alpha_composite(m, (int(S * padding), int(S * padding)))
    bg.putalpha(rounded_mask((S, S), int(S * corner)))
    return bg.resize((px, px), Image.LANCZOS)


def save(img, name):
    img.save(os.path.join(OUT, name), "PNG")
    print("wrote", name, img.size)


mark = draw_mark(1024)

# Square tiles (authored at 4x of nominal size so they stay crisp on high-DPI displays)
save(square_tile(176, mark), "Square44x44Logo.png")
save(square_tile(600, mark), "Square150x150Logo.png")
save(square_tile(200, mark), "StoreLogo.png")
save(square_tile(96, mark, corner=.2, padding=.04), "LockScreenLogo.png")
for t in (16, 24, 32, 48, 256):
    save(square_tile(t, mark, corner=.2, padding=.04), f"Square44x44Logo.targetsize-{t}_altform-unplated.png")

# Wide tile: mark on the left, wordmark on the right, full-bleed vermilion
WW, WH = 1240, 600
wide = vgradient((WW, WH), VERM_TOP, VERM_BOT).convert("RGBA")
wm = mark.resize((int(WH * .82), int(WH * .82)), Image.LANCZOS)
wide.alpha_composite(wm, (int(WH * .09), int(WH * .09)))
d = ImageDraw.Draw(wide)
d.text((int(WH * 1.0), 150), "LocalIQ", font=font("segoeuib.ttf", 112), fill=(255, 255, 255))
d.text((int(WH * 1.0), 296), "Ask your files · on-device AI", font=font("segoeui.ttf", 42), fill=(255, 226, 212))
d.text((int(WH * 1.0), 420), "by Dyabi", font=font("seguisb.ttf", 52), fill=(255, 255, 255))
save(wide, "Wide310x150Logo.png")

# Splash: paper background, mark + name
SW, SH = 1240, 600
splash = Image.new("RGBA", (SW, SH), (245, 241, 232, 255))
sd = ImageDraw.Draw(splash)
for gx in range(0, SW, 40):
    sd.line([(gx, 0), (gx, SH)], fill=(232, 226, 211, 255), width=1)
for gy in range(0, SH, 40):
    sd.line([(0, gy), (SW, gy)], fill=(232, 226, 211, 255), width=1)
tile = square_tile(300, mark)
splash.alpha_composite(tile, (SW // 2 - 150, 70))
f1 = font("segoeuib.ttf", 84)
t1 = "LocalIQ"
w1 = sd.textlength(t1, font=f1)
sd.text(((SW - w1) / 2, 390), t1, font=f1, fill=NAVY)
f2 = font("seguisb.ttf", 40)
t2 = "by Dyabi"
w2 = sd.textlength(t2, font=f2)
sd.text(((SW - w2) / 2, 490), t2, font=f2, fill=(217, 72, 28))
save(splash, "SplashScreen.png")

# Multi-size .ico for the window / taskbar
ico_src = square_tile(256, mark, corner=.2, padding=.04)
ico_src.save(os.path.join(OUT, "AppIcon.ico"), format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote AppIcon.ico")

