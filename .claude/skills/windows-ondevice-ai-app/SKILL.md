---
name: windows-ondevice-ai-app
description: Create a complete on-device AI app for Windows 11 Copilot+ PC from an app idea. Scaffolds a packaged WinUI 3 + WebView2 app and wires in the Windows AI components the idea needs - Phi Silica LanguageModel (text generation, streaming), TextSummarizer / TextRewriter / TextToTableConverter, OCR (TextRecognizer, images and scanned PDFs), ImageDescriptionGenerator, PdfPig, AppContentIndexer local search, ImageGenerator / ImageScaler / background removal - then builds the UI and app logic, tests on the real NPU, and packages a signed MSIX the team can install. Use when asked to create, build, prototype, extend, debug or package a Windows app/demo that runs AI locally on a Copilot+ PC / NPU / Windows AI APIs / Phi Silica, or to turn an idea into such an app.
---

# Windows on-device AI app builder

Turn an app idea into a working, installable Windows app whose AI runs on the PC's NPU. The architecture never changes:

- a packaged **WinUI 3 window that only hosts a WebView2**;
- a **C# host** made of small **bridge modules**, one per Windows AI component (`template/Modules/*.cs`);
- a **plain HTML/JS UI** in `www/` talking to the host through `bridge.js` (`NativeAI.call('generate', {...})`).

Everything you need is inside this skill folder (`$SKILL` below = the folder containing this file):

| Path | What |
|---|---|
| `scripts/new-app.ps1` | Scaffolds a project from the template, keeping only the chosen components |
| `scripts/dev-register.ps1` | Developer loop: build Debug, register under a separate dev identity, start |
| `scripts/build-app.ps1` | Signed MSIX + `dist\<App>-x64-install.zip` (msix, .cer, installer script) |
| `template/` | The working project (compiles, passes its own self-test on a Copilot+ PC) |
| `reference/components.md` | **Which component for which need**, ops, limits, traps. Read it when choosing components and when a component misbehaves |
| `reference/playbook.md` | The long-form guide: design rules, prompt rules, traps table, definition of done |

## Workflow

### 1. Understand the idea (ask only what you cannot decide)
Restate the idea in a short brief: persona and decision, inputs (text, PDF, scan, photo, folder), what code must compute, what the model should write, whether search over documents is needed, what (if anything) may leave the device. If the idea is far larger than one on-device app (databases, trained models, multi-service backends), propose 2 to 3 scope options and let the user choose before building. If the user gave enough, do not interrogate: choose sensible defaults and say what you chose.

### 2. Choose the components
Use the table in `reference/components.md`. Quick map:

| The app needs to... | Components |
|---|---|
| answer, explain, draft, classify, chat | `language` |
| summarize, rewrite in a tone, turn text into a table | `textskills` |
| read photos of documents, receipts, whiteboards, scanned PDFs | `ocr` |
| read PDFs that have a text layer | `pdf` (then `ocr` for scans) |
| describe a photo (caption, alt text) | `vision` |
| search the user's own documents / ground answers in them | `index` (+ `language`) |
| create, upscale, restyle or cut out pictures | `images` |

Include only what is used: every extra module is a first-run model download and surface to maintain. `new-app.ps1 -Components language,pdf,ocr`.

### 3. Scaffold
```powershell
& "$SKILL\scripts\new-app.ps1" -Name InvoiceChecker -Display "Invoice Checker" `
   -Description "Checks invoices against purchase orders, on-device" `
   -Components language,pdf,ocr -Publisher "CN=<TeamOrName>" -Destination <where projects live>
```
`Name` is PascalCase letters/digits (folder, namespace, assembly). `Publisher` becomes the certificate subject and the package publisher (the script creates a self-signed certificate in `Cert:\CurrentUser\My` if none exists). Ask the user for a team/publisher name only if they care; the default `CN=OnDeviceAIDev` works. Run on Windows 11 with the .NET 8+ SDK.

### 4. Make it the user's app
The scaffold ships a **playground UI** (one tab per component + a self-test). Replace it:
- Keep `www/bridge.js`. Rewrite `www/index.html`, `style.css`, `app.js` for the idea. Keep the CSP `connect-src 'none'`. Use `NativeAI.call(op, args, onEvent)`; the ops and their arguments are documented at the top of each `Modules/*Module.cs` file and in `reference/components.md`.
- **Code computes, the model words.** Totals, comparisons, dates, rules, scores are JavaScript (or C#); put the computed facts in the prompt and ask the model to explain them; verify figures it writes. See `reference/playbook.md` section 8.
- App-specific host work (files, a database, a custom API) goes in a new `Modules/<Thing>Module.cs` implementing `IBridgeModule`; it is discovered automatically (see `reference/components.md`, "Adding your own module").
- Generate realistic **synthetic** sample data with a script kept outside the package; never real personal data.

### 5. Test on the real model
```powershell
cd <project>; .\scripts\dev-register.ps1          # builds Debug, registers "<Name>Dev", starts the app
```
- Headless check of every included component: create an empty `autotest.flag` in the dev package's `LocalState` folder (`%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalState`) before starting the app; it runs the self-test and writes `selftest-report.json` beside `bridge.log`. Put the text `images` in the flag to include the (slow-to-download) image models. Expect `pass` for everything on a Copilot+ PC; a `FAIL` with a status in the message is a real finding.
- Read `bridge.log` first when something returns nothing: it logs operation names, sizes and statuses (never content).
- Also test with the app's own data: a normal case, an oversized input, a moderation-sensitive input, an empty/unreadable file, first run with models not ready.
- Do not attach the WebView2 DevTools-protocol relay during looped tests (it crashed a host). Use `Log()` and `bridge.log`.
- Browser-only UI iteration works too: open `www/index.html` in a browser; `bridge.js` answers with a mock when there is no host.

### 6. Package and hand over
```powershell
.\scripts\build-app.ps1        # -> dist\<Name>-x64-install.zip
```
The zip holds the MSIX, the public certificate and `Install-<Name>.ps1` (run in an elevated PowerShell on the target Copilot+ PC; it trusts the certificate and installs). Raise `Version` in `Package.appxmanifest` for updates to upgrade in place (data kept). Write the app's `README.md`: what it does, what runs on the device, every network request (if any), limits, install steps.

### 7. Close out honestly
Run through the checklist in `reference/playbook.md` section 13. Tell the user exactly what was tested (which PC, which components, which inputs) and what was not (for example no second PC, no clean-machine install, no live cloud service).

## Hard rules

- **Package identity is mandatory.** Never run the raw `.exe`; use `dev-register.ps1` (it uses a separate `...Dev` identity so the real app's data is never wiped).
- Both device families (`Windows.Universal` + `Windows.Desktop`) and `systemAIModels` stay in the manifest. Pin the package versions in the csproj.
- An **empty model answer is a failure**: moderation and context overflow return empty text with a status, not an exception. The modules already surface `result.Status`; keep doing that in new code.
- `AppContentIndexer` only inside `Task.Run` (the template's `IndexModule` already does this, retries once, and flags fuzzy hits). Never call it from the UI-thread message handler.
- Never log prompts, documents, model output or keys. Never commit `.pfx`, API keys or `.env` files. The page keeps `connect-src 'none'`; if a cloud call is ever needed it is made by the host, with explicit user consent and a user-supplied key.
- Say honestly what leaves the device. Do not call an app "offline" if it fetches anything.
- Windows AI APIs are experimental: pinned SDK is `Microsoft.WindowsAppSDK 2.2.2-experimental9`. A different SDK may rename things; if the template stops compiling after an upgrade, fix the module and tell the user.
- Tooling gotchas: a Bash tool may collapse `\\` to `\` (write scripts with a file-writing tool); Windows PowerShell 5.1 reads UTF-8 as ANSI with `Get-Content -Raw` (use `[IO.File]::ReadAllText(path, [Text.Encoding]::UTF8)`); `git commit -F file` for multi-line messages; stop `dotnet build-server` / the app before deleting a project folder.

## Requirements on the machine

Windows 11 (24H2+), x64; for the AI features a **Copilot+ PC** (NPU). .NET 8 SDK or newer. No Visual Studio needed. Internet on first run (NuGet restore; Windows downloads the on-device models once).
