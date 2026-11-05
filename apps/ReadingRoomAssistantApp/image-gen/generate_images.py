"""Generates stylized, schematic grayscale placeholder images for Reading Room
Assistant's demo studies. These are NOT real medical images and are not meant
to be anatomically precise — they exist purely to give the imaging viewer
something plausible-looking to zoom/pan/adjust, for a workflow demo. Every
image is stamped with a visible "SYNTHETIC DEMO IMAGE" watermark.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "www", "images")
os.makedirs(OUT, exist_ok=True)

W, H = 900, 1100


def base_canvas(bg=18):
    img = Image.new("L", (W, H), color=bg)
    return img


def add_noise(img, amount=6):
    px = img.load()
    for _ in range(30000):
        x = random.randint(0, W - 1)
        y = random.randint(0, H - 1)
        v = px[x, y] + random.randint(-amount, amount)
        px[x, y] = max(0, min(255, v))
    return img


def watermark(img, label):
    rgb = img.convert("RGB")
    d = ImageDraw.Draw(rgb)
    try:
        font = ImageFont.truetype("arial.ttf", 16)
        font_small = ImageFont.truetype("arial.ttf", 13)
    except Exception:
        font = ImageFont.load_default()
        font_small = font
    d.rectangle([0, H - 46, W, H], fill=(10, 10, 10))
    d.text((14, H - 40), "SYNTHETIC DEMO IMAGE — NOT REAL PATIENT DATA", fill=(245, 158, 11), font=font)
    d.text((14, H - 20), label, fill=(140, 145, 155), font=font_small)
    return rgb


def chest_xray(seed, label, variant="normal"):
    random.seed(seed)
    img = base_canvas(bg=14)
    d = ImageDraw.Draw(img)

    cx, cy = W // 2, int(H * 0.42)
    ribcage_w, ribcage_h = 340, 380

    # Lung fields (slightly lighter, mostly airy/dark like real film)
    d.ellipse([cx - ribcage_w, cy - ribcage_h, cx - 40, cy + ribcage_h], fill=46)
    d.ellipse([cx + 40, cy - ribcage_h, cx + ribcage_w, cy + ribcage_h], fill=46)

    # Ribs — arcs
    for i in range(9):
        y0 = cy - ribcage_h + i * 78
        bow = 30 + i * 4
        d.arc([cx - ribcage_w - bow, y0, cx - 30, y0 + 130], start=200, end=340, fill=95, width=5)
        d.arc([cx + 30, y0, cx + ribcage_w + bow, y0 + 130], start=200, end=340, fill=95, width=5)

    # Spine
    d.rectangle([cx - 22, cy - ribcage_h - 20, cx + 22, cy + ribcage_h + 60], fill=170)

    # Clavicles
    d.line([cx - 260, cy - ribcage_h + 10, cx - 40, cy - ribcage_h - 40], fill=150, width=14)
    d.line([cx + 260, cy - ribcage_h + 10, cx + 40, cy - ribcage_h - 40], fill=150, width=14)

    # Cardiac silhouette
    d.ellipse([cx - 130, cy + 40, cx + 90, cy + 260], fill=120)

    # Diaphragm domes
    d.arc([cx - ribcage_w - 10, cy + 200, cx - 20, cy + 420], start=0, end=180, fill=110, width=10)
    d.arc([cx + 20, cy + 200, cx + ribcage_w + 10, cy + 420], start=0, end=180, fill=110, width=10)

    if variant == "opacity":
        d.ellipse([cx + 150, cy + 260, cx + 260, cy + 360], fill=200)
        img = img.filter(ImageFilter.GaussianBlur(0.6))
        d = ImageDraw.Draw(img)
        d.ellipse([cx + 150, cy + 260, cx + 260, cy + 360], outline=200)
    if variant == "nodule":
        d.ellipse([cx - 250, cy - 40, cx - 210, cy], fill=210)

    img = img.filter(ImageFilter.GaussianBlur(2.2))
    img = add_noise(img, 5)
    return watermark(img, label)


def abdominal_xray(seed, label):
    random.seed(seed)
    img = base_canvas(bg=20)
    d = ImageDraw.Draw(img)
    cx, cy = W // 2, int(H * 0.5)

    # Soft bowel-gas-like blobs
    for i in range(10):
        bx = cx + random.randint(-260, 260)
        by = cy + random.randint(-260, 260)
        bw = random.randint(60, 160)
        bh = random.randint(40, 100)
        shade = random.randint(30, 60)
        d.ellipse([bx, by, bx + bw, by + bh], fill=shade)

    # Spine
    d.rectangle([cx - 24, cy - 380, cx + 24, cy + 300], fill=175)
    for i in range(10):
        y = cy - 360 + i * 68
        d.line([cx - 24, y, cx - 90, y + 24], fill=140, width=6)
        d.line([cx + 24, y, cx + 90, y + 24], fill=140, width=6)

    # Pelvis arcs
    d.arc([cx - 300, cy + 200, cx + 300, cy + 560], start=200, end=340, fill=190, width=16)
    d.ellipse([cx - 60, cy + 340, cx + 60, cy + 460], outline=190, width=8)

    img = img.filter(ImageFilter.GaussianBlur(2.0))
    img = add_noise(img, 6)
    return watermark(img, label)


def knee_xray(seed, label):
    random.seed(seed)
    img = base_canvas(bg=16)
    d = ImageDraw.Draw(img)
    cx = W // 2

    # Femur (upper bone)
    d.rectangle([cx - 90, 80, cx + 90, 480], fill=185)
    d.ellipse([cx - 130, 420, cx + 130, 560], fill=190)

    # Joint space (dark gap)
    d.rectangle([cx - 110, 560, cx + 110, 610], fill=18)

    # Tibia (lower bone)
    d.ellipse([cx - 120, 600, cx + 120, 700], fill=190)
    d.rectangle([cx - 80, 660, cx + 80, 1000], fill=182)

    # Patella
    d.ellipse([cx - 55, 500, cx + 55, 600], fill=205)

    # Fibula
    d.rectangle([cx + 95, 660, cx + 130, 980], fill=160)

    img = img.filter(ImageFilter.GaussianBlur(1.6))
    img = add_noise(img, 5)
    return watermark(img, label)


chest_xray(1, "AP CHEST — SUPINE", "normal").save(os.path.join(OUT, "chest-clean.png"))
chest_xray(2, "PA CHEST — ERECT", "opacity").save(os.path.join(OUT, "chest-opacity.png"))
chest_xray(3, "PA CHEST — ERECT", "nodule").save(os.path.join(OUT, "chest-multi.png"))
chest_xray(4, "PA CHEST — ERECT (PRIOR)", "normal").save(os.path.join(OUT, "chest-prior.png"))
abdominal_xray(5, "AP ABDOMEN — SUPINE").save(os.path.join(OUT, "abdomen-1.png"))
abdominal_xray(6, "AP ABDOMEN — SUPINE (PRIOR)").save(os.path.join(OUT, "abdomen-prior.png"))
knee_xray(7, "AP/LAT KNEE").save(os.path.join(OUT, "knee-1.png"))

print("DONE. Images written to", OUT)
