# HybridMed

A **hybrid pipeline** demo for lab-result triage: a local stage on the device, a cloud stage only if you configure one.

- **Local stage:** raw lab text (names, dates of birth, values, identifiers) is parsed into structured JSON **on the device** by Phi Silica (this replaces an earlier stage that called Foundry Local over HTTP).
- **Cloud stage:** triage guidance from a model on **your own Azure AI Foundry endpoint** (`gpt-4.1-mini` in the demo). It is a real network call: enter your endpoint and key in the app's settings panel. No endpoint or key is included in this repository.
- Synthetic data only; not for clinical use.

Build: [`docs/BUILD.md`](../../docs/BUILD.md).
