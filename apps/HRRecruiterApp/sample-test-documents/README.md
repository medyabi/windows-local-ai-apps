# HR Recruiter Agent — Sample Test Documents

One job description and two résumés for testing the app immediately. All
content is synthetic.

1. Open the app → **"➕ New Role"** → drop `JobDescription-SeniorCloudEngineer.pdf`
   (or open it and paste the text) → **Analyze Role**.
2. On the role page, drop both résumés onto **"Upload Résumés"**.

| File | Expected result |
|---|---|
| `Resume-Amina-Cloud-StrongFit.pdf` | Strong fit — 7 years of Azure/Kubernetes/Terraform experience, Azure Solutions Architect Expert certified, direct evidence for nearly every requirement. |
| `Resume-Youssef-Web-WeakFit.pdf` | Weak fit — frontend/React developer with no cloud infrastructure experience. A good candidate for exercising the "gaps" and low-evidence paths of the fit assessment. |

Each résumé takes roughly 30-60 seconds to fully analyze (text extraction,
profile extraction, fit assessment, then strengths/gaps/interview
questions) — a progress indicator shows in the candidate list while it runs.
