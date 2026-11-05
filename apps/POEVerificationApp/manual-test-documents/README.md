# POE Verification Analyst — Manual Test Documents

Six realistic PO/Invoice/POE document sets for testing the app's **"➕ New Case"**
upload flow like a real analyst would: drop each PDF in one at a time, watch
the app extract fields with on-device AI, and see the verdict. All data is
synthetic.

For each scenario: open the app → **New Case** → enter the supplier name shown
below → drop `PO.pdf`, `Invoice.pdf`, `POE.pdf` (and photos, where present) →
**Extract & Verify**.

| Folder | Supplier (type this exactly) | What it tests | Expected result |
|---|---|---|---|
| `1-clean-globaltech` | GlobalTech Partners | Everything matches | 🟢 Approved — no risk indicators |
| `2-quantity-overbilling-atlas` | Atlas Logistics | PO 300 / Invoice 340 / POE 300 | 🔴 Quantity mismatch, ~€8,000 exposure |
| `3-price-inflation-nexa` | Nexa Communications | Quantities match (600), invoice price inflated | 🔴 Amount mismatch only, ~€8,000 exposure |
| `4-execution-shortfall-prime` | Prime Facilities Group | Invoice matches PO (250), POE confirms only 220 | 🔴 Execution shortfall risk |
| `5-backdated-evidence-horizon` | Horizon Field Services | POE execution date (5 Sept) before PO date (implied ~10 Sept) | 🟠 Date inconsistency |
| `6-photo-discrepancy-devicehub` | DeviceHub Morocco | PO/Invoice/POE all claim 60 units; 2 attached photos show ~45 visible units | Documents match cleanly, but photo analysis flags a visual quantity discrepancy — try clicking **"Analyze photos with on-device AI"** after opening the case |

## Notes

- The extraction step runs the actual on-device model twice per document
  (once for OCR/text extraction via PdfPig, once for AI field extraction) —
  each document takes roughly 5-15 seconds depending on your hardware.
- After extraction, the new case behaves exactly like any seeded case: you can
  run **"Search for reused evidence"**, ask the **Investigation Copilot**
  questions, and re-extract any of the 3 documents again from the case page.
- If you type a supplier name that doesn't already exist in the demo dataset
  (e.g. "DeviceHub Morocco" for scenario 6), the app automatically creates a
  new supplier bucket — check **Suppliers** afterward to see it listed.
- All documents and photos are synthetic, generated for testing only.
