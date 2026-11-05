# HybridMind

[LocalMind](../LocalMindApp) plus a **router** and an **agent mode**: the on-device Windows AI model (Phi Silica) answers first, and **your own cloud model** (Azure OpenAI or any OpenAI-compatible endpoint) is used only when the task needs it, always visibly and with a way to say no.

> **Tested against a mock server only**, never against a real cloud service. Treat the cloud routing and the cloud agent as unproven until you try them with your own endpoint.

## How it works

```mermaid
flowchart LR
  UI[chat.js] --> R{router.js<br/>can the local model do it?}
  R -->|yes| LOC[ChatEngine → Phi Silica]
  R -->|no / user chose cloud| CON[consent dialog]
  CON -->|approved| RED[Redactor<br/>secrets, e-mail, phone, IBAN…<br/>→ placeholders]
  RED --> CLD[CloudEngine<br/>host-side HTTP]
  CLD -->|reply| UNR[placeholders restored] --> UI
  CLD --> LOG[(usage log)]
  UI --> AG[agent.js loop] -->|tool requests| AE[AgentEngine<br/>read: picked folders<br/>write: working folder, with approval]
```

- **The page has no network access.** Every cloud call is made by the C# host (`CloudEngine`), so the web UI cannot exfiltrate anything by itself. Redirects are not followed.
- **The API key** is stored encrypted with Windows DPAPI for the current user (`Secrets`); the page can save a key but never read it back, and the key is deleted if the endpoint address changes without a new key.
- **Redaction is pattern matching, not understanding** (`Redactor`): it replaces secrets, payment cards, e-mail, phone, IBAN and ID-like numbers with stable placeholders such as `[EMAIL_1]` and puts the originals back in the reply. It does **not** detect names, addresses, health details or confidential business text.
- **Agent mode** (`agent.js`, `AgentEngine`): a model plans and asks for tools; the host executes each tool and enforces the allowed folders. The loop can be driven by the cloud model or by a **local** OpenAI-compatible server on loopback (e.g. Foundry Local), which sends nothing off the machine.

## Source files

Everything in LocalMind (chat, files, skills, images; see its README), plus:

| File | What it adds |
|---|---|
| `CloudEngine.cs` | Cloud half: endpoint normalisation for Azure (project endpoint, v1 vs per-deployment API styles) and OpenAI-compatible servers, connection test, chat completions, usage accounting. |
| `Redactor.cs`, `Secrets.cs` | Deterministic redaction; DPAPI key storage. |
| `AgentEngine.cs` | Agent sessions, tool execution in the host, path checks, write approvals. |
| `www/js/router.js` | Routing policy: local first; what may leave the PC. |
| `www/js/hybrid-ui.js` | Per-chat route switch, cloud status, Settings → Cloud / Routing & privacy / Cloud usage. |
| `www/js/agent.js`, `agent-ui.js`, `agent-menu.js` | Agent loop, Settings → Agent (folders, working folder, limits), engine chooser. |
| `dev/` | Test scripts. E-mail addresses, the "API key" and the card number in them are **fake strings** used to test redaction. |

## Deploy

```powershell
.\scripts\build-app.ps1 -App HybridMindApp -Install
```

Full guide: [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md). Package name `Dyabi.HybridMind`. No endpoint or key is included in this repository.

## Try it

1. Without any cloud settings it behaves like LocalMind.
2. Settings → Cloud: enter your endpoint, deployment and key; **Test connection**.
3. Send a message containing a fake e-mail address with the route set to cloud; check the consent dialog, the redaction, and Settings → Cloud usage.
