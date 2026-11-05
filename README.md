# On-device AI apps for Windows

Eleven small desktop apps that run their AI **on the PC** (Windows AI APIs: Phi Silica, on-device OCR, local semantic index) and show what "nothing leaves this device" can look like for everyday business tasks.

They share one architecture: a **WinUI 3 shell** (C#) hosting a **WebView2 UI** (plain HTML/JS in `www/`), talking over a small JSON bridge. The rule that runs through all of them:

> **Code computes the facts, the model only words them.** Every number, total, date or citation is produced by deterministic code from the document text; the on-device model writes the explanation, and its figures are checked against the facts before they are shown.

## The apps

| App | What it does |
|---|---|
| [`FinanceCopilotApp`](apps/FinanceCopilotApp) | Drop a customer's bank statement (CSV), payslip / loan papers (PDF) and an ID scan: a financial profile (income, expenses, DTI, anomalies) is computed in code; the model writes the narrative and answers questions. Includes a "prove it" panel showing zero external calls. |
| [`FraudInvestigatorApp`](apps/FraudInvestigatorApp) | Fraud / AML investigation assistant: transaction analysis plus retrieval over policy documents (local semantic index), answers grounded in the retrieved passages. |
| [`HRRecruiterApp`](apps/HRRecruiterApp) | Screens résumés against a job description: evidence-backed fit assessment (quotes from the résumé), interview questions, prioritisation, duplicate-application detection. |
| [`POEVerificationApp`](apps/POEVerificationApp) | Proof-of-execution verification: cross-checks invoices against purchase orders and delivery evidence, detects reused evidence, estimates quantities from photos, investigation copilot. |
| [`POEPhotoProcessorApp`](apps/POEPhotoProcessorApp) | Blurs faces and captions event photos with on-device AI (a native rewrite of a demo that used Foundry Local). |
| [`AIShelfAuditorApp`](apps/AIShelfAuditorApp) | Retail shelf-execution assistant: shelf photos and their analysis stay on the device. (The UI is a built web bundle.) |
| [`ReadingRoomAssistantApp`](apps/ReadingRoomAssistantApp) | Radiology reading-room **prototype**: prioritised worklist, imaging viewer with AI / radiologist annotation layers, sign-off. Synthetic studies only; the AI findings are preset demo data, the draft impressions are generated on-device. |
| [`HybridMedApp`](apps/HybridMedApp) | Hybrid pipeline demo: lab text is triaged by the on-device model, and only the structured output of that local stage goes to a cloud model **you configure** (Azure AI Foundry endpoint). |
| [`LocalIQApp`](apps/LocalIQApp) | "Ask your files": any file type (PDF, Office, text, images with OCR) indexed locally (semantic index + BM25), answers with citations and deterministic checks. Works offline. |
| [`LocalMindApp`](apps/LocalMindApp) | A private ChatGPT-style assistant: streaming chat, branches, memory, files (RAG), assistants and projects, tools. Works offline. |
| [`HybridMindApp`](apps/HybridMindApp) | LocalMind plus a router: on-device first, **your own** cloud model (Azure / OpenAI / compatible) only when needed, with consent, redaction and a usage log. Tested against a mock server only. |

All sample data in the repo (customers, résumés, transactions, DICOM studies, invoices, datasheets) is **synthetic**.

## Requirements

- Windows 11 (build 22621 or later), x64
- For the AI features: a PC that supports the Windows AI APIs (Phi Silica needs a Copilot+ PC with an NPU)
- .NET 8 SDK, Visual Studio Build Tools / Windows SDK 10.0.26100, Windows App SDK `2.2.2-experimental9`

On a PC without these, the AI features are unavailable.

## Build

See [`docs/BUILD.md`](docs/BUILD.md): one command builds a signed MSIX for any app, with a certificate **you** create. No binaries are published here on purpose, so nobody has to trust someone else's certificate.

## Lessons from building them

[`docs/WINDOWS-AI-LESSONS.md`](docs/WINDOWS-AI-LESSONS.md) collects the things that were measured the hard way (content moderation that returns an empty answer without an exception, the small context window, UI-thread deadlocks with the local index, …).

## Status and honesty

These are demos and prototypes, not products. Do not use the fraud, HR, finance or radiology apps to make real decisions. Where something was only tested against a mock (HybridMind's cloud routing) or only with synthetic data (everything), the app's README says so.

## Licence

[MIT](LICENSE). Third-party components are listed in [`THIRD-PARTY.md`](THIRD-PARTY.md).
