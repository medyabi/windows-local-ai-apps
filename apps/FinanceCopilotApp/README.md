# Finance Copilot

Drop a customer's **bank statement (CSV)**, a **payslip / credit report (PDF)** and an **ID scan (image)**. The app builds a financial profile (income, expenses, savings, debt-to-income, anomalies) and lets you ask questions about it. The language model runs on the PC.

## How it works

```mermaid
flowchart LR
  F[CSV / PDF / image] --> C{classifyAndStore}
  C -->|CSV| P[parseCSV + computeAnalysis<br/>JavaScript]
  C -->|PDF| T[pdfText op<br/>PdfPig]
  C -->|image| O[ocr op<br/>TextRecognizer]
  P --> FACTS[buildFacts]
  T --> FACTS
  O --> FACTS
  FACTS --> M[generate op<br/>Phi Silica]
  M --> N[narrative + chat answers]
```

- **Computed by code, never by the model:** `computeAnalysis` / `categorize` turn the statement into totals by category, average income and spending, DTI and anomalies.
- **The model only words** the result: `buildFacts` hands it the numbers, `callLocalNarrative` writes the summary, `callLocalChat` answers questions.
- Raw merchant and card strings are mapped to generic categories before they go into a prompt: the Windows content filter otherwise returns empty answers (see [`docs/WINDOWS-AI-LESSONS.md`](../../docs/WINDOWS-AI-LESSONS.md)).
- The **"Prove it"** panel is a static statement of the design (no API, no upload); its counters are not measured by instrumenting the network. The page does load a Google Fonts stylesheet (cosmetic).

## Source files

| File | What it contains |
|---|---|
| `FinanceCopilotApp.csproj`, `Package.appxmanifest`, `app.manifest`, `App.xaml(.cs)`, `MainWindow.xaml` | Standard shell, see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md). References PdfPig. |
| `MainWindow.xaml.cs` | Bridge ops `ensureReady`, `generate`, `pdfText` (PdfPig), `ocr` (`TextRecognizer`). |
| `www/index.html` | The whole UI and logic (HTML + CSS + JS in one file): `handleFiles` → `processFile` → `classifyAndStore`; `parseCSV`, `computeAnalysis`, `runAnalysis`, `renderProfile`; `buildFacts`, `callLocalNarrative`, `sendChatMessage`; the Prove-it modal. |
| `sample-data/` | Synthetic customers: statements (CSV), a payslip and a credit report (PDF), an ID card (PNG). |

## Step-by-step deployment

Everything below is copy-paste PowerShell on a Windows 11 PC. Replace nothing: the repository owner is `medyabi`.

**1. Check the PC and install the tools (once)**

- Windows 11 build 22621 or later, x64 (`winver`). For the AI features you need a Copilot+ PC (NPU); otherwise the app starts but reports the model as unavailable.

```powershell
winget install --id Microsoft.DotNet.SDK.8
winget install --id Git.Git
winget install --id GitHub.cli
```

**2. Sign in to GitHub and clone** (the repository is private, so the account must have access)

```powershell
gh auth login
git clone https://github.com/medyabi/windows-local-ai-apps.git
cd windows-local-ai-apps
```

**3. Build the signed package** (about 30 s to 2 min; the first build also downloads NuGet packages and needs internet)

```powershell
.\scripts\build-app.ps1 -App FinanceCopilotApp
```

It creates a self-signed certificate if needed and writes two files: `dist\FinanceCopilotApp\FinanceCopilotApp_1.0.0.0_x64.msix` and `dist\FinanceCopilotApp\FinanceCopilotApp.cer`. A warning about `mspdbcmf.exe` is harmless.

**4. Trust the certificate** (PowerShell **as administrator**, once per PC)

```powershell
Import-Certificate -FilePath .\dist\FinanceCopilotApp\FinanceCopilotApp.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

**5. Install**

```powershell
Add-AppxPackage -Path .\dist\FinanceCopilotApp\FinanceCopilotApp_1.0.0.0_x64.msix
```

**6. Launch** it from the Start menu (**Finance Copilot**) or:

```powershell
$p = Get-AppxPackage *FinanceCopilot*
Start-Process "shell:AppsFolder\$($p.PackageFamilyName)!App"
```

**7. First launch**

- The status pill shows the on-device model state. The first time, Windows may need to prepare the model (a few minutes, may need Windows Update).
- Click the demo loader, or drop the files from `sample-data/`.

**8. If something fails**

```powershell
$p = Get-AppxPackage *FinanceCopilot*
notepad "$env:LOCALAPPDATA\Packages\$($p.PackageFamilyName)\LocalState\bridge.log"
```

Common errors and fixes are in [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md#troubleshooting).

**9. Uninstall** (also removes the app's data)

```powershell
Get-AppxPackage *FinanceCopilot* | Remove-AppxPackage
```

## Try it

1. Launch the app, wait for the status pill *On-device model: ready*.
2. Click the demo loader (`loadDemo`) or drop files from `sample-data/` (e.g. `1_marco_rossi_statement.csv`, `3_ahmed_khalil_payslip.pdf`, `4_priya_sharma_id_card.png`).
3. Read the profile and narrative, then ask a question in the chat.

## Limits

Demo only: not for real credit decisions. Behaviour on real-world statement formats is untested.
