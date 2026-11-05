# Reading Room Assistant (prototype)

A human-in-the-loop **radiology reading-room prototype**: AI pre-screening, a prioritised worklist, an imaging viewer with AI and radiologist annotation layers, and a sign-off workflow.

- **The AI findings (boxes, confidence) are preset demo data.** What is genuinely generated on the device is the draft impression text (Phi Silica). A colour system separates AI (amber) from radiologist (cyan) marks.
- Studies are **synthetic** (`sample-import-data/*.dcm`, made with pydicom, no patient information); DICOM is read with fo-dicom.
- This is **not a medical device** and must never be used for diagnosis.

Build: [`docs/BUILD.md`](../../docs/BUILD.md). Third-party licences: [`THIRD-PARTY.md`](../../THIRD-PARTY.md) (fo-dicom, ImageSharp).
