# HybridMind

[LocalMind](../LocalMindApp) plus a **router**: on-device Windows AI (Phi Silica) first, and **your own cloud model** (Azure, OpenAI or any compatible endpoint) only when the task needs it.

- **Consent** before anything leaves the PC, **redaction** of sensitive strings, and a **usage log** of what was sent.
- The cloud key is stored protected with DPAPI. No endpoint or key is included in this repository.
- **Tested against a mock server only**, never against a real cloud service: treat the cloud routing as unproven.
- `dev/` holds the test scripts; the e-mail addresses and the "API key" in them are fake strings used to test redaction.

Build: [`docs/BUILD.md`](../../docs/BUILD.md).
