# HR Recruiter Agent

An on-device recruiting copilot: screens résumés against a job description and explains why, with evidence.

- Role analysis, résumé analysis and an **evidence-backed fit assessment** (quotes taken from the résumé).
- Interview questions, prioritisation of candidates, and duplicate-application detection.
- The analysis is split into **two smaller model calls** instead of one large one: this fixed both an 8-minute latency and truncated JSON.
- Do not use the WebView2 DevTools relay from the host: it crashed this app regardless of load.
- `sample-test-documents/` has one job description and two synthetic résumés (see its README).

Build: [`docs/BUILD.md`](../../docs/BUILD.md). A demo: a model must never be the only judge of a candidate.
