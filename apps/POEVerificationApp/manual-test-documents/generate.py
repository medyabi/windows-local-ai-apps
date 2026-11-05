"""Generates realistic PO/Invoice/POE PDFs (+ photos for one scenario) for manually
testing POE Verification Analyst's "Verify New Submission" upload flow, like a real
analyst would receive them. Six scenarios, each exercising a different risk pattern.
All data is synthetic.
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from PIL import Image, ImageDraw

OUT = os.path.dirname(os.path.abspath(__file__))


def doc(folder, filename, title, supplier, rows, footer=None):
    d = os.path.join(OUT, folder)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, filename)
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    c.setFillColor(colors.HexColor("#1e293b"))
    c.rect(0, h - 28 * mm, w, 28 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(20 * mm, h - 18 * mm, title)
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, h - 24 * mm, supplier)

    y = h - 42 * mm
    c.setFillColor(colors.black)
    for label, value in rows:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(20 * mm, y, label + ":")
        c.setFont("Helvetica", 11)
        c.drawString(70 * mm, y, str(value))
        c.setStrokeColor(colors.HexColor("#e2e8f0"))
        c.line(20 * mm, y - 3 * mm, w - 20 * mm, y - 3 * mm)
        y -= 10 * mm

    if footer:
        c.setFont("Helvetica-Oblique", 9)
        c.setFillColor(colors.HexColor("#64748b"))
        c.drawString(20 * mm, 25 * mm, footer)

    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#94a3b8"))
    c.drawString(20 * mm, 15 * mm, "Synthetic demo document - generated for POE Verification Analyst")
    c.save()
    print("wrote", path)


def device_grid_photo(folder, filename, rows, cols, label):
    W, H = 900, 600
    img = Image.new("RGB", (W, H), (30, 34, 42))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 60], fill=(20, 23, 29))
    d.text((20, 20), label, fill=(220, 224, 230))
    box_w, box_h = 60, 44
    gap = 14
    grid_w = cols * (box_w + gap) - gap
    grid_h = rows * (box_h + gap) - gap
    start_x = (W - grid_w) // 2
    start_y = 90 + (H - 90 - grid_h) // 2
    for r in range(rows):
        for c in range(cols):
            x = start_x + c * (box_w + gap)
            y = start_y + r * (box_h + gap)
            d.rectangle([x, y, x + box_w, y + box_h], fill=(148, 163, 184), outline=(226, 232, 240), width=2)
            d.rectangle([x + 8, y + 8, x + box_w - 8, y + box_h - 18], fill=(71, 85, 105))
    out_dir = os.path.join(OUT, folder)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, filename)
    img.save(path, "JPEG", quality=88)
    print("wrote", path, rows * cols, "units")


# ── Scenario 1: clean case (everything matches) — GlobalTech Partners ──
F = "1-clean-globaltech"
doc(F, "PO.pdf", "Purchase Order PO-7710", "GlobalTech Partners - Network Infrastructure",
    [("PO Number", "PO-7710"), ("Supplier", "GlobalTech Partners"), ("Service", "Network installation"),
     ("Product", "Cisco Catalyst network switch"), ("Quantity", "40 units"), ("Unit Price", "EUR 800.00"),
     ("Total Value", "EUR 32,000.00"), ("Delivery Location", "Casablanca, Morocco"),
     ("Requested Execution Date", "10 September 2026"), ("Authorized By", "S. Idrissi, IT Procurement")])
doc(F, "Invoice.pdf", "Invoice INV-15501", "GlobalTech Partners - Network Infrastructure",
    [("Invoice Number", "INV-15501"), ("Supplier", "GlobalTech Partners"), ("PO Reference", "PO-7710"),
     ("Product", "Cisco Catalyst network switch"), ("Quantity Billed", "40 units"), ("Unit Price", "EUR 800.00"),
     ("Total Amount Due", "EUR 32,000.00"), ("Delivery Location", "Casablanca, Morocco"),
     ("Invoice Date", "13 September 2026"), ("Payment Terms", "Net 30")])
doc(F, "POE.pdf", "Proof of Execution POE-7710-A", "GlobalTech Partners - Network Infrastructure",
    [("POE Reference", "POE-7710-A"), ("PO Reference", "PO-7710"), ("Supplier", "GlobalTech Partners"),
     ("Product", "Cisco Catalyst network switch"), ("Quantity Installed", "40 units"),
     ("Installation Location", "Casablanca, Morocco"), ("Execution Date", "10 September 2026"),
     ("Site Contact", "R. Fassi, Network Manager"), ("Signed Off By", "Site Manager + GlobalTech Technician")])

# ── Scenario 2: quantity overbilling — Atlas Logistics ──
F = "2-quantity-overbilling-atlas"
doc(F, "PO.pdf", "Purchase Order PO-7820", "Atlas Logistics - Freight & Warehousing",
    [("PO Number", "PO-7820"), ("Supplier", "Atlas Logistics"), ("Service", "Freight & logistics"),
     ("Product", "Pallet freight delivery"), ("Quantity", "300 pallets"), ("Unit Price", "EUR 200.00"),
     ("Total Value", "EUR 60,000.00"), ("Delivery Location", "Tangier, Morocco"),
     ("Requested Execution Date", "8 September 2026"), ("Authorized By", "H. Alaoui, Logistics Lead")])
doc(F, "Invoice.pdf", "Invoice INV-15602", "Atlas Logistics - Freight & Warehousing",
    [("Invoice Number", "INV-15602"), ("Supplier", "Atlas Logistics"), ("PO Reference", "PO-7820"),
     ("Product", "Pallet freight delivery"), ("Quantity Billed", "340 pallets"), ("Unit Price", "EUR 200.00"),
     ("Total Amount Due", "EUR 68,000.00"), ("Delivery Location", "Tangier, Morocco"),
     ("Invoice Date", "11 September 2026"), ("Payment Terms", "Net 30")])
doc(F, "POE.pdf", "Proof of Execution POE-7820-A", "Atlas Logistics - Freight & Warehousing",
    [("POE Reference", "POE-7820-A"), ("PO Reference", "PO-7820"), ("Supplier", "Atlas Logistics"),
     ("Product", "Pallet freight delivery"), ("Quantity Received", "300 pallets"),
     ("Receiving Location", "Tangier, Morocco"), ("Execution Date", "8 September 2026"),
     ("Site Contact", "N. Ziani, Warehouse Supervisor"), ("Signed Off By", "Warehouse Supervisor + Atlas Driver")])

# ── Scenario 3: price inflation (quantities match, amount doesn't) — Nexa Communications ──
F = "3-price-inflation-nexa"
doc(F, "PO.pdf", "Purchase Order PO-7935", "Nexa Communications - Telecom Rollout",
    [("PO Number", "PO-7935"), ("Supplier", "Nexa Communications"), ("Service", "Telecom rollout"),
     ("Product", "SIM provisioning kit"), ("Quantity", "600 units"), ("Unit Price", "EUR 50.00"),
     ("Total Value", "EUR 30,000.00"), ("Delivery Location", "Rabat, Morocco"),
     ("Requested Execution Date", "12 September 2026"), ("Authorized By", "K. Benjelloun, Procurement")])
doc(F, "Invoice.pdf", "Invoice INV-15703", "Nexa Communications - Telecom Rollout",
    [("Invoice Number", "INV-15703"), ("Supplier", "Nexa Communications"), ("PO Reference", "PO-7935"),
     ("Product", "SIM provisioning kit"), ("Quantity Billed", "600 units"), ("Unit Price", "EUR 63.33"),
     ("Total Amount Due", "EUR 38,000.00"), ("Delivery Location", "Rabat, Morocco"),
     ("Invoice Date", "15 September 2026"), ("Payment Terms", "Net 30")])
doc(F, "POE.pdf", "Proof of Execution POE-7935-A", "Nexa Communications - Telecom Rollout",
    [("POE Reference", "POE-7935-A"), ("PO Reference", "PO-7935"), ("Supplier", "Nexa Communications"),
     ("Product", "SIM provisioning kit"), ("Quantity Activated", "600 units"),
     ("Activation Location", "Rabat, Morocco"), ("Execution Date", "12 September 2026"),
     ("Site Contact", "L. Tazi, Regional Hub Lead"), ("Signed Off By", "Regional Hub Lead + Nexa Technician")])

# ── Scenario 4: execution shortfall (invoice matches PO, POE shows less) — Prime Facilities Group ──
F = "4-execution-shortfall-prime"
doc(F, "PO.pdf", "Purchase Order PO-8010", "Prime Facilities Group - Office Fit-Out",
    [("PO Number", "PO-8010"), ("Supplier", "Prime Facilities Group"), ("Service", "Facilities fit-out"),
     ("Product", "Office furniture set"), ("Quantity", "250 sets"), ("Unit Price", "EUR 400.00"),
     ("Total Value", "EUR 100,000.00"), ("Delivery Location", "Marrakech, Morocco"),
     ("Requested Execution Date", "9 September 2026"), ("Authorized By", "A. Berrada, Facilities Manager")])
doc(F, "Invoice.pdf", "Invoice INV-15804", "Prime Facilities Group - Office Fit-Out",
    [("Invoice Number", "INV-15804"), ("Supplier", "Prime Facilities Group"), ("PO Reference", "PO-8010"),
     ("Product", "Office furniture set"), ("Quantity Billed", "250 sets"), ("Unit Price", "EUR 400.00"),
     ("Total Amount Due", "EUR 100,000.00"), ("Delivery Location", "Marrakech, Morocco"),
     ("Invoice Date", "12 September 2026"), ("Payment Terms", "Net 30")])
doc(F, "POE.pdf", "Proof of Execution POE-8010-A", "Prime Facilities Group - Office Fit-Out",
    [("POE Reference", "POE-8010-A"), ("PO Reference", "PO-8010"), ("Supplier", "Prime Facilities Group"),
     ("Product", "Office furniture set"), ("Quantity Installed", "220 sets"),
     ("Installation Location", "Marrakech, Morocco"), ("Execution Date", "9 September 2026"),
     ("Site Contact", "M. Ouazzani, Site Coordinator"),
     ("Notes", "30 sets on backorder, not yet installed at time of sign-off.")])

# ── Scenario 5: backdated evidence (POE date before PO date) — Horizon Field Services ──
F = "5-backdated-evidence-horizon"
doc(F, "PO.pdf", "Purchase Order PO-8122", "Horizon Field Services - Maintenance",
    [("PO Number", "PO-8122"), ("Supplier", "Horizon Field Services"), ("Service", "Maintenance service"),
     ("Product", "HVAC rooftop unit"), ("Quantity", "35 units"), ("Unit Price", "EUR 600.00"),
     ("Total Value", "EUR 21,000.00"), ("Delivery Location", "Tangier, Morocco"),
     ("Requested Execution Date", "14 September 2026"), ("Authorized By", "Y. Chraibi, Facilities Ops")])
doc(F, "Invoice.pdf", "Invoice INV-15905", "Horizon Field Services - Maintenance",
    [("Invoice Number", "INV-15905"), ("Supplier", "Horizon Field Services"), ("PO Reference", "PO-8122"),
     ("Product", "HVAC rooftop unit"), ("Quantity Billed", "35 units"), ("Unit Price", "EUR 600.00"),
     ("Total Amount Due", "EUR 21,000.00"), ("Delivery Location", "Tangier, Morocco"),
     ("Invoice Date", "18 September 2026"), ("Payment Terms", "Net 30")])
doc(F, "POE.pdf", "Proof of Execution POE-8122-A", "Horizon Field Services - Maintenance",
    [("POE Reference", "POE-8122-A"), ("PO Reference", "PO-8122"), ("Supplier", "Horizon Field Services"),
     ("Product", "HVAC rooftop unit"), ("Quantity Serviced", "35 units"),
     ("Service Location", "Tangier, Morocco"), ("Execution Date", "5 September 2026"),
     ("Site Contact", "F. Amrani, Building Manager"), ("Signed Off By", "Building Manager + Horizon Technician")])

# ── Scenario 6: with photos, quantity discrepancy — DeviceHub Morocco ──
F = "6-photo-discrepancy-devicehub"
doc(F, "PO.pdf", "Purchase Order PO-8233", "DeviceHub Morocco - IT Equipment Distribution",
    [("PO Number", "PO-8233"), ("Supplier", "DeviceHub Morocco"), ("Service", "Device deployment"),
     ("Product", "Lenovo ThinkCentre desktop PC"), ("Quantity", "60 units"), ("Unit Price", "EUR 550.00"),
     ("Total Value", "EUR 33,000.00"), ("Delivery Location", "Casablanca, Morocco"),
     ("Requested Execution Date", "16 September 2026"), ("Authorized By", "D. Squalli, IT Procurement")])
doc(F, "Invoice.pdf", "Invoice INV-16006", "DeviceHub Morocco - IT Equipment Distribution",
    [("Invoice Number", "INV-16006"), ("Supplier", "DeviceHub Morocco"), ("PO Reference", "PO-8233"),
     ("Product", "Lenovo ThinkCentre desktop PC"), ("Quantity Billed", "60 units"), ("Unit Price", "EUR 550.00"),
     ("Total Amount Due", "EUR 33,000.00"), ("Delivery Location", "Casablanca, Morocco"),
     ("Invoice Date", "19 September 2026"), ("Payment Terms", "Net 30")])
doc(F, "POE.pdf", "Proof of Execution POE-8233-A", "DeviceHub Morocco - IT Equipment Distribution",
    [("POE Reference", "POE-8233-A"), ("PO Reference", "PO-8233"), ("Supplier", "DeviceHub Morocco"),
     ("Product", "Lenovo ThinkCentre desktop PC"), ("Quantity Deployed", "60 units"),
     ("Deployment Location", "Casablanca, Morocco"), ("Execution Date", "16 September 2026"),
     ("Site Contact", "O. Bennani, Site Manager"), ("Photos Attached", "2"),
     ("Signed Off By", "Site Manager + DeviceHub Technician")])
device_grid_photo(F, "photo1-batch-1.jpg", 4, 6, "Casablanca site - Batch 1 - 16 Sept 2026")  # 24
device_grid_photo(F, "photo2-batch-2.jpg", 3, 7, "Casablanca site - Batch 2 - 16 Sept 2026")  # 21

print("\nDONE. Scenario 6 photos show", 24 + 21, "visible units vs 60 claimed on the POE/invoice.")
