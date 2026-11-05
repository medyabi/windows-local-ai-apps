# Reading Room Assistant — Sample Import Data

Files for testing the app's **"📥 Import Study"** page. Everything here is a
synthetic, schematic placeholder image (drawn shapes, not a real X-ray) with
synthetic metadata — no real patient data anywhere. Every image is also
visibly watermarked "SYNTHETIC SAMPLE — NOT REAL PATIENT DATA."

## DICOM files (`.dcm`) — real metadata, auto-filled fields

Drop one of these on the "Current study image" zone. The app genuinely parses
the file on-device (patient ID, age, sex, body part, accession, study date)
and renders its pixel data — the form fields below will pre-fill
automatically. Review them, then click **Import Study**.

| File | Pre-filled fields |
|---|---|
| `chest-sample.dcm` | MRN-SAMP001, age 54, M, Chest X-ray, ACC-SAMP001 |
| `knee-sample.dcm` | MRN-SAMP002, age 41, F, Knee X-ray, ACC-SAMP002 |
| `abdomen-sample.dcm` | MRN-SAMP003, age 67, M, Abdomen X-ray, ACC-SAMP003 |

Remember: none of these get automated AI findings — only a real, on-device,
general-purpose image caption. That's by design (see the app's Responsible
AI page).

## Plain image — manual entry path

`chest-plain-image.png` has no embedded metadata, so it exercises the
"type it in yourself" path. Suggested values to enter:

- Accession: `ACC-SAMP004`
- Patient ID: `MRN-SAMP004`
- Age: `58`
- Sex: `M`
- Exam type: `Chest X-ray`

## Prior-study comparison

To try **"+ Add prior study for comparison"**, import `chest-sample.dcm` (or
the plain image above) as the current study, then attach
`chest-prior-companion.png` as the prior image with:

- Prior study date: pick a date ~9 months before the current one
- Prior report summary: *"No focal consolidation. Heart size normal. No
  pleural effusion."*

Then open the imported study and try **"🔀 Compare with prior"**.
