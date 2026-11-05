"""Generates a mixed-format sample library for LocalIQ: documents, a scanned PDF, a photo of a whiteboard, code,
spreadsheets, slides and more. Everything is invented ("Northvale Studio", "Harbor & Pine Ltd") — no real data."""
import os, json, zipfile
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sample-files")
os.makedirs(OUT, exist_ok=True)
F = r"C:\Windows\Fonts"


def font(name, size):
    try:
        return ImageFont.truetype(os.path.join(F, name), size)
    except Exception:
        return ImageFont.truetype(os.path.join(F, "arial.ttf"), size)


def w(name, text, mode="w"):
    with open(os.path.join(OUT, name), mode, encoding=None if "b" in mode else "utf-8", newline="" if "b" not in mode else None) as f:
        f.write(text)
    print("wrote", name)


# 1 — Markdown meeting notes
w("Meeting-notes-2026-09-18.md", """# Northvale Studio — Product sync, 18 September 2026

**Attendees:** Priya (product), Tomas (engineering), Lena (design), Marcus (finance)

## Decisions
- The public launch moves from 29 October to **12 November 2026** so the onboarding redesign can finish testing.
- Marketing budget for the launch is approved at **$48,000**; Marcus will release it in two tranches.
- We will not support the legacy mobile app after the launch; users get an in-app migration notice on 15 October.

## Action items
- Tomas: freeze the release branch by 2 November.
- Lena: deliver final onboarding screens by 6 October.
- Priya: confirm the press list with the agency by 9 October.
- Marcus: send the first budget tranche ($24,000) on 1 October.

## Risks
- Payment provider certification could slip by a week; owner: Tomas.
""")

# 2 — CSV sales
w("Q3-sales.csv", """region,rep,customer,deal_value_usd,stage,close_date
North,Aisha Rahman,Beacon Foods,18500,Closed won,2026-07-14
North,Aisha Rahman,Cedar Logistics,7200,Closed lost,2026-08-02
South,Diego Alvarez,Mariner Health,32000,Closed won,2026-08-19
South,Diego Alvarez,Plum Street Cafe,2400,Negotiation,2026-10-05
East,Hannah Weiss,Orchard Labs,54000,Closed won,2026-09-03
East,Hannah Weiss,Willow Textiles,12600,Proposal,2026-10-21
West,Kenji Mori,Summit Outdoor,9800,Closed won,2026-09-12
West,Kenji Mori,Delta Print,15400,Negotiation,2026-10-11
""")

# 3 — DOCX contract + 7 — handbook
import docx
d = docx.Document()
d.add_heading("Vendor Services Agreement — Northvale Studio and Harbor & Pine Ltd", 1)
d.add_paragraph("This agreement is effective 1 June 2026 between Northvale Studio (the Client) and Harbor & Pine Ltd (the Vendor).")
d.add_heading("4. Payment", 2)
d.add_paragraph("The Client shall pay each undisputed invoice within 45 days of receipt (net 45). Late payments accrue interest at 1.5% per month.")
d.add_heading("9. Termination", 2)
d.add_paragraph("Either party may terminate this agreement for convenience by giving the other party 60 days' written notice. Either party may terminate immediately for material breach that remains uncured 15 days after written notice.")
d.add_heading("11. Confidentiality", 2)
d.add_paragraph("Each party shall keep the other party's confidential information secret for three years after the agreement ends.")
d.add_heading("Fees", 2)
t = d.add_table(rows=1, cols=3); t.style = "Light Grid Accent 1"
for i, h in enumerate(["Service", "Rate", "Unit"]): t.rows[0].cells[i].text = h
for r in [["Design sprint", "$1,800", "per day"], ["Front-end build", "$1,250", "per day"], ["Usability testing", "$950", "per session"]]:
    c = t.add_row().cells
    for i, v in enumerate(r): c[i].text = v
d.save(os.path.join(OUT, "Vendor-Agreement.docx")); print("wrote Vendor-Agreement.docx")

d = docx.Document()
d.add_heading("Northvale Studio Team Handbook", 1)
d.add_heading("Time off", 2)
d.add_paragraph("Full-time employees receive 25 days of paid annual leave per calendar year, plus public holidays. Up to 5 unused days may be carried into the next year.")
d.add_heading("Working pattern", 2)
d.add_paragraph("The team works remotely by default. In-office days are Tuesday and Thursday, with core hours from 10:00 to 16:00.")
d.add_heading("Expenses", 2)
d.add_paragraph("Meals while travelling are reimbursed up to $75 per day. Submit receipts within 30 days.")
d.save(os.path.join(OUT, "Team-Handbook.docx")); print("wrote Team-Handbook.docx")

# 4 — text PDF invoice
c = canvas.Canvas(os.path.join(OUT, "Invoice-INV-2041.pdf"), pagesize=A4)
c.setFont("Helvetica-Bold", 18); c.drawString(60, 780, "INVOICE INV-2041")
c.setFont("Helvetica", 11)
y = 750
for line in ["Harbor & Pine Ltd", "12 Quay Street, Galway", "", "Bill to: Northvale Studio", "Invoice date: 30 September 2026", "Due date: 30 October 2026", "",
             "Description                              Qty        Rate          Amount",
             "Design sprint                             2        $1,800.00     $3,600.00",
             "Usability testing                         1        $950.00       $950.00",
             "Travel and materials                      1        $310.00       $310.00", "",
             "Subtotal                                                          $4,860.00",
             "Total due                                                         $4,860.00", "", "Payment terms: net 45. Thank you for your business."]:
    c.drawString(60, y, line); y -= 18
c.save(); print("wrote Invoice-INV-2041.pdf")

# 5 — scanned (image-only) PDF receipt
img = Image.new("RGB", (620, 900), (250, 248, 242))
dr = ImageDraw.Draw(img)
fm = font("consola.ttf", 27)
y = 40
for line in ["CORNER BAKERY & CAFE", "14 Mill Lane", "Tel 091 555 0142", "-" * 30, "Date: 2026-09-21  08:42", "Order #5518", "-" * 30,
             "Flat white x2         7.60", "Sourdough loaf       5.20", "Almond croissant x3 10.50", "Orange juice          4.50", "-" * 30,
             "SUBTOTAL            27.80", "VAT 0%               0.00", "TOTAL EUR           27.80", "-" * 30, "Paid by card ****", "Thank you!"]:
    dr.text((40, y), line, font=fm, fill=(20, 20, 20)); y += 44
img = img.rotate(0.8, expand=False, fillcolor=(250, 248, 242)).filter(ImageFilter.GaussianBlur(0.6))
img.save(os.path.join(OUT, "Scanned-Receipt.pdf"), "PDF", resolution=110)
print("wrote Scanned-Receipt.pdf (image-only)")

# 6 — whiteboard photo PNG
wb = Image.new("RGB", (1300, 760), (243, 244, 240))
dr = ImageDraw.Draw(wb)
dr.rectangle([14, 14, 1286, 746], outline=(150, 150, 150), width=10)
fh = font("segoepr.ttf", 62) if os.path.exists(os.path.join(F, "segoepr.ttf")) else font("arialbd.ttf", 62)
fb = font("segoepr.ttf", 46) if os.path.exists(os.path.join(F, "segoepr.ttf")) else font("arial.ttf", 46)
dr.text((70, 50), "Sprint 14 goals", font=fh, fill=(20, 50, 140))
for i, ln in enumerate(["1. Fix the login timeout bug", "2. Ship onboarding v2 to beta users", "3. Update the pricing page copy", "Demo: Friday 3pm"]):
    dr.text((90, 190 + i * 110), ln, font=fb, fill=(20, 50, 140) if i < 3 else (170, 30, 30))
wb.save(os.path.join(OUT, "Whiteboard-photo.png")); print("wrote Whiteboard-photo.png")

# 16 — photo without text (synthetic scene)
sc = Image.new("RGB", (900, 600), (135, 190, 235))
dr = ImageDraw.Draw(sc)
dr.ellipse([640, 60, 760, 180], fill=(255, 220, 90))
dr.polygon([(0, 600), (0, 380), (250, 300), (520, 420), (780, 330), (900, 400), (900, 600)], fill=(70, 140, 80))
dr.rectangle([300, 400, 430, 520], fill=(190, 60, 50)); dr.polygon([(285, 400), (365, 340), (445, 400)], fill=(90, 50, 40))
sc.save(os.path.join(OUT, "Photo-no-text.png")); print("wrote Photo-no-text.png")

# 8 — Python code
w("retry_logic.py", '''"""HTTP helper with retries."""
import random
import time

MAX_ATTEMPTS = 5
BASE_BACKOFF_SECONDS = 2
MAX_BACKOFF_SECONDS = 30


def fetch_with_retry(fetch, attempts=MAX_ATTEMPTS):
    """Call fetch() and retry on failure using exponential backoff with jitter.

    The wait doubles after every failed attempt (2s, 4s, 8s...) but never exceeds MAX_BACKOFF_SECONDS.
    Only ConnectionError and TimeoutError are retried; any other exception is raised immediately.
    """
    for attempt in range(1, attempts + 1):
        try:
            return fetch()
        except (ConnectionError, TimeoutError):
            if attempt == attempts:
                raise
            delay = min(BASE_BACKOFF_SECONDS * 2 ** (attempt - 1), MAX_BACKOFF_SECONDS)
            time.sleep(delay + random.uniform(0, 0.5))
''')

# 9 — XLSX
import openpyxl
wb2 = openpyxl.Workbook(); ws = wb2.active; ws.title = "Plan"
ws.append(["Milestone", "Owner", "Due date", "Status"])
for r in [["Onboarding screens final", "Lena", "2026-10-06", "In progress"], ["Press list confirmed", "Priya", "2026-10-09", "Not started"], ["Pricing page update", "Tomas", "2026-10-20", "Not started"],
          ["Release branch freeze", "Tomas", "2026-11-02", "Not started"], ["Public launch", "Priya", "2026-11-12", "Planned"]]: ws.append(r)
b = wb2.create_sheet("Budget"); b.append(["Line item", "Amount (USD)"])
for r in [["Agency fees", 22000], ["Paid social", 15000], ["Events", 11000]]: b.append(r)
wb2.save(os.path.join(OUT, "Project-Plan.xlsx")); print("wrote Project-Plan.xlsx")

# 10 — PPTX
from pptx import Presentation
p = Presentation()
s1 = p.slides.add_slide(p.slide_layouts[1]); s1.shapes.title.text = "Launch kickoff"
s1.placeholders[1].text = "Goal: 5,000 beta sign-ups before public launch\nPublic launch: 12 November 2026"
s2 = p.slides.add_slide(p.slide_layouts[1]); s2.shapes.title.text = "Top risks"
s2.placeholders[1].text = "Payment provider certification may slip a week\nDesign capacity in October is tight"
p.save(os.path.join(OUT, "Kickoff.pptx")); print("wrote Kickoff.pptx")

# 11 — travel policy (txt)
w("travel-policy.txt", """Northvale Studio - Travel policy

Flights: book economy class for trips under 6 hours; premium economy is allowed above 6 hours.
Hotels: nightly cap is $180 in major cities and $130 elsewhere.
Rail is preferred over flights for trips under 4 hours.
Car rental needs approval from your manager in advance.
""")

# 12 — RTF
w("Call-notes-Marta.rtf", r"""{\rtf1\ansi\deff0{\fonttbl{\f0 Calibri;}}\f0\fs22 Call with Marta Kowalski\par
Marta prefers email over phone calls.\par
Her contract renewal date is March 3, 2027.\par
She asked us to send the revised quote by Friday.\par
}""")

# 13 — ODT (hand-built OpenDocument)
with zipfile.ZipFile(os.path.join(OUT, "Soup-recipe.odt"), "w") as z:
    z.writestr("mimetype", "application/vnd.oasis.opendocument.text", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/manifest.xml", '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>')
    z.writestr("content.xml", '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>'
               '<text:h>Grandma\'s tomato soup</text:h><text:p>Simmer the tomatoes, onion and garlic for 40 minutes, then blend until smooth.</text:p><text:p>Serve with basil and a spoon of cream. Serves four.</text:p></office:text></office:body></office:document-content>')
print("wrote Soup-recipe.odt")

# 14 — EPUB (minimal)
with zipfile.ZipFile(os.path.join(OUT, "Short-story.epub"), "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    z.writestr("OEBPS/content.opf", '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>')
    z.writestr("OEBPS/chapter1.xhtml", '<html><body><h1>The Lighthouse Keeper</h1><p>Every evening at sundown, Ingrid climbed the 112 steps to light the lamp.</p><p>Her only companion was a grey cat named Biscuit, who slept beside the brass lens.</p></body></html>')
print("wrote Short-story.epub")

# 15 — notebook
nb = {"cells": [{"cell_type": "markdown", "source": ["# Churn analysis\n", "We compare churn between the free and paid plans."]},
                {"cell_type": "code", "source": ["churn = df.groupby('plan').churned.mean()\n", "print(churn)"], "outputs": [{"output_type": "stream", "text": ["plan\n", "free    0.184\n", "paid    0.071\n"]}]},
                {"cell_type": "markdown", "source": ["Paid customers churn at 7.1% versus 18.4% for free users."]}], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}
w("churn-analysis.ipynb", json.dumps(nb, indent=1))

# 17 — legacy / binary / no-extension
with open(os.path.join(OUT, "Old-Report.doc"), "wb") as f: f.write(bytes(range(256)) * 20)
with open(os.path.join(OUT, "blob.dat"), "wb") as f: f.write(os.urandom(4096))
w("LICENSE", "MIT License\n\nCopyright (c) 2026 Northvale Studio\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software to use it without restriction.\n")

# 18 — HTML
w("office-hours.html", """<html><head><title>Visit us</title><style>body{color:red}</style></head><body><h1>Visit the Northvale office</h1>
<p>We are open Monday to Friday, 9:00 to 17:30, and closed on public holidays.</p>
<table><tr><th>Room</th><th>Capacity</th></tr><tr><td>Studio A</td><td>12 people</td></tr><tr><td>Workshop</td><td>30 people</td></tr></table></body></html>""")
print("DONE")
