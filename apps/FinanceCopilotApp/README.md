# Finance Copilot

On-device analysis of a customer's financial documents: drop a **bank statement (CSV)**, a **payslip / loan document (PDF)** and an **ID scan (image)**; the app builds a financial profile and lets you question it. Nothing leaves the PC, and a "Prove it" panel shows a count of external calls (zero).

- **Computed by code, not by the model:** income, expenses, savings, debt-to-income ratio, anomalies. The CSV is parsed in JavaScript, PDFs with PdfPig, the ID scan by on-device OCR (`TextRecognizer`).
- **The model (Phi Silica) only writes** the narrative and answers chat questions, from the pre-computed facts. Raw merchant / card strings are mapped to generic categories before any prompt (the content filter blocks them otherwise: see [`docs/WINDOWS-AI-LESSONS.md`](../../docs/WINDOWS-AI-LESSONS.md)).
- `sample-data/` holds synthetic customers.

Build: [`docs/BUILD.md`](../../docs/BUILD.md). Demo only: not for real credit decisions.
