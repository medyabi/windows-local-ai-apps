# Use the `windows-ondevice-ai-app` skill: step by step

The skill lets Claude Code build a complete **on-device AI app for a Windows 11 Copilot+ PC** from an app idea. It carries its own working template, scripts and reference, and wires in the Windows AI components the idea needs (Phi Silica, OCR, image description, local search, summarize/rewrite/table, image generation).

Skill source: [`.claude/skills/windows-ondevice-ai-app/`](../.claude/skills/windows-ondevice-ai-app/).

## 0. What you need

| | |
|---|---|
| PC | Windows 11 24H2 or newer, x64. A **Copilot+ PC** to run the AI features (building works on any Windows 11 PC) |
| Tools | [Claude Code](https://claude.com/claude-code) and the **.NET 8 SDK or newer** (`dotnet --version`). No Visual Studio |
| Network | Internet on first use: NuGet restore, and Windows downloads the on-device models once (a few minutes; image models can take much longer) |
| Access | This repository is **private**: your GitHub account must be added as a collaborator, or use the zip your colleague sends you |

## 1. Install the skill (once per PC)

Pick **one** of the two ways.

**A. Personal install: available in every Claude Code session on your PC**

```powershell
git clone https://github.com/medyabi/windows-local-ai-apps.git
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills" | Out-Null
Copy-Item .\windows-local-ai-apps\.claude\skills\windows-ondevice-ai-app "$env:USERPROFILE\.claude\skills\" -Recurse -Force
```

**B. From a zip** (if you cannot access the repo): unzip `windows-ondevice-ai-app-skill.zip` so that the folder `windows-ondevice-ai-app` lands in `%USERPROFILE%\.claude\skills\`.

**C. Project-level:** work inside a clone of this repository; Claude Code picks the skill up from `.claude\skills\` automatically.

Check: the file `%USERPROFILE%\.claude\skills\windows-ondevice-ai-app\SKILL.md` exists. Then **start a new Claude Code session** (skills are read at start-up).

## 2. Start Claude Code in your working folder

```powershell
mkdir C:\src ; cd C:\src
claude
```

Optional check: ask `Which skills do you have?` and look for `windows-ondevice-ai-app`.

## 3. Describe your app idea

Write what the app is for, who uses it, what goes in, what must come out, and what may leave the PC. Claude uses the skill automatically when the request is about an on-device Windows AI app. Examples:

> Create a Windows on-device AI app that checks supplier invoices (PDF or photo) against purchase orders and explains the differences. Nothing may leave the PC.

> Build an "ask my files" app for our product manuals: pick a folder, ask questions, answers must cite the source passage.

> Make a small tool that turns a photo of a whiteboard into clean meeting minutes.

To force the skill, start the request with: `Use the windows-ondevice-ai-app skill to ...`.

## 4. What Claude does (and where you step in)

| Step | Claude | You |
|---|---|---|
| 1 | Restates the idea as a short brief; asks only what it cannot decide | Confirm or correct the brief |
| 2 | Chooses the components (language, textskills, ocr, vision, pdf, index, images) | Say if you want more or fewer |
| 3 | Scaffolds the project with `new-app.ps1` (only the chosen modules are kept) | - |
| 4 | Replaces the playground UI with the app's own screens and logic; code computes the facts, the model words them | Review the screens, ask for changes |
| 5 | Registers a dev copy, runs the headless self-test on the real NPU, tests with realistic synthetic data | Try the app (it opens by itself) |
| 6 | Builds the signed installer: `dist\<App>-x64-install.zip` | - |
| 7 | Reports what was tested and what was not | Read it before sharing the app |

## 5. Try the app yourself

Claude starts it for you. To start it again from the project folder:

```powershell
cd C:\src\<YourApp>
.\scripts\dev-register.ps1        # builds, registers a "<YourApp>Dev" package, starts it
```

The first launch downloads the on-device models: wait for the status line to say the model is ready. If something returns nothing, open `bridge.log` in the app's `LocalState` folder (`%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalState`): it records operation names, sizes and Windows statuses, never content.

## 6. Ask for changes

Stay in the same Claude Code session and say what to change ("add a page that exports the findings to a Word file", "also read scanned PDFs", "shorter explanations"). To add a component later: `Add local search over a folder of PDFs`. Claude adds the module (or writes a new one) and re-runs the self-test.

## 7. Package and install on another PC

```powershell
cd C:\src\<YourApp>
.\scripts\build-app.ps1           # -> dist\<YourApp>-x64-install.zip
```

On the **target Copilot+ PC**: unzip, then right-click `Install-<YourApp>.ps1` -> *Run with PowerShell as administrator* (it trusts the app's self-signed certificate once, then installs the MSIX). Start the app from the Start menu. To ship an update, raise `Version` in `Package.appxmanifest` and rebuild: the app upgrades in place and keeps its data.

## 8. Without Claude (manual use of the scripts)

```powershell
$SK = "$env:USERPROFILE\.claude\skills\windows-ondevice-ai-app"
& "$SK\scripts\new-app.ps1" -Name InvoiceChecker -Display "Invoice Checker" -Components language,pdf,ocr -Publisher "CN=MyTeam" -Destination C:\src
cd C:\src\InvoiceChecker
.\scripts\dev-register.ps1
.\scripts\build-app.ps1
```

`-Components` takes any of `language, textskills, ocr, vision, pdf, index, images`, or `all`.

## 9. If something goes wrong

| Symptom | Cause / fix |
|---|---|
| Claude does not use the skill | Folder not at `...\.claude\skills\windows-ondevice-ai-app\SKILL.md`, or the session was not restarted. Name the skill in the request |
| `NotSupportedOnCurrentSystem` | The PC is not a Copilot+ PC (or Windows is older than 24H2) |
| Model not ready / long first run | Models download through Windows Update on first use; image models can take 15+ minutes. Retry |
| Empty model answer | Content moderation or prompt too large; read the status in the error text and `bridge.log` |
| Build errors after changing SDK versions | The Windows AI APIs are experimental; the template is pinned to `Microsoft.WindowsAppSDK 2.2.2-experimental9`. Ask Claude to fix the affected module |
| Installer refuses the package | Run `Install-<App>.ps1` as administrator so the certificate gets trusted first |

## 10. What has and has not been verified

Verified on one Copilot+ PC: the template compiles with all components and with a subset, the built-in self-test passes 16 of 16 checks on the NPU, and `build-app.ps1` produces the MSIX and install zip. **Not verified:** installation on a clean second PC, the playground's visual layout on screen, ARM64, other SDK versions. Details and the component limits are in the skill's [`README.md`](../.claude/skills/windows-ondevice-ai-app/README.md) and [`reference/components.md`](../.claude/skills/windows-ondevice-ai-app/reference/components.md).
