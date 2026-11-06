# windows-ondevice-ai-app (Claude Code skill)

Give Claude Code an app idea; it creates a complete **on-device AI app for Windows 11 Copilot+ PC** and wires in the Windows AI components the idea needs:

| Component | Windows API | Module |
|---|---|---|
| Text generation, streaming | `LanguageModel` (Phi Silica) | `LanguageModule` |
| Summarize / rewrite / text to table | `TextSummarizer`, `TextRewriter`, `TextToTableConverter` | `TextSkillsModule` |
| OCR (images, scanned PDFs) | `TextRecognizer` + `Windows.Data.Pdf` | `OcrModule` |
| Photo captions | `ImageDescriptionGenerator` | `VisionModule` |
| PDFs with a text layer | PdfPig (no AI) | `PdfModule` |
| Local search over your documents | `AppContentIndexer` | `IndexModule` |
| Generate / restyle / upscale / cut out pictures | `ImageGenerator`, `ImageScaler`, `ImageForegroundExtractor` | `ImageModule` |

The result is a signed MSIX that installs on any Copilot+ PC, with the AI running on the NPU and nothing leaving the device.

## Install the skill

Copy this whole folder (`windows-ondevice-ai-app`) into one of:

- `%USERPROFILE%\.claude\skills\` : available in every Claude Code session on your PC (personal);
- `<your repo>\.claude\skills\` : available to everyone who works in that repo (commit it).

Restart Claude Code (or start a new session). No other setup: the skill carries its own template and scripts.

## Use it

In Claude Code, describe the app. Examples:

> Create a Windows on-device AI app that checks supplier invoices (PDF or photo) against purchase orders and explains the differences. Nothing may leave the PC.

> Build me an "ask my files" app for our product manuals: pick a folder, ask questions, answers cite the source passage.

> Make a small tool that turns a photo of a whiteboard into clean meeting minutes.

Claude restates the brief, picks the components, scaffolds the project, builds the UI and logic, tests on the real NPU and produces `dist\<App>-x64-install.zip`.

You can also call the pieces by hand (PowerShell, Windows 11 + .NET 8 SDK):

```powershell
.\scripts\new-app.ps1 -Name InvoiceChecker -Display "Invoice Checker" -Components language,pdf,ocr -Publisher "CN=MyTeam" -Destination C:\src
cd C:\src\InvoiceChecker
.\scripts\dev-register.ps1      # build, register as a dev package, start
.\scripts\build-app.ps1         # signed MSIX + install zip
```

Components: `language, textskills, ocr, vision, pdf, index, images` or `all`.

## What the team needs

- Windows 11 24H2+, x64, **Copilot+ PC** for the AI features (the build itself works on any Windows 11 PC; the AI calls report `NotSupportedOnCurrentSystem` elsewhere).
- .NET 8 SDK or newer. No Visual Studio.
- Internet on first use: NuGet restore, and Windows downloads the on-device models once (a few minutes; the image models can take much longer).
- One elevated PowerShell step per target PC to trust the app's self-signed certificate (the generated `Install-<App>.ps1` does it).

## What was verified (and what was not)

Verified on one Copilot+ PC with `Microsoft.WindowsAppSDK 2.2.2-experimental9`, .NET SDK 9.0.318:
- the template scaffolds, compiles and registers with all seven components and with a subset (`language,pdf`);
- the built-in self-test passes 16 of 16 checks on the real NPU: language (generate, stream, fit test), summarize, rewrite, table, OCR of an image, PDF text layer, OCR of a PDF page, image description, index add and query, image upscale, cut-out and generation;
- `build-app.ps1` produces the MSIX, certificate, installer script and zip.

Not verified: installing the generated MSIX on a clean second PC; the playground's visual layout was not reviewed on screen (its logic ran inside the real WebView2); Windows ARM64 vs x64 beyond x64; behaviour with other SDK versions. The Windows AI APIs are experimental and can change; if a newer SDK breaks the template, fix the affected module.

## Files

```
SKILL.md                 instructions Claude follows (workflow, rules)
README.md                this file
scripts/                 new-app.ps1, dev-register.ps1, build-app.ps1
template/                the working project (C# host + bridge modules + www/ playground UI)
reference/components.md  which component for which need, ops, measured limits and traps
reference/playbook.md    long-form guide: design and prompt rules, traps, definition of done
```
