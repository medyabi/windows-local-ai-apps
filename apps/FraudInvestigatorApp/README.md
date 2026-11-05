# Local Fraud Investigator

An on-device fraud / AML investigation assistant. Customer data never leaves the PC.

- Transactions and customer profiles are analysed by deterministic code (flags, patterns, totals).
- Policy documents (AML, KYC, transaction-monitoring procedures, an investigation handbook) are indexed locally with `AppContentIndexer`; answers are grounded in the retrieved passages.
- The on-device model (Phi Silica) writes the explanations from those facts and passages.
- `sample-data/` and `www/` contain **synthetic** customers, transactions (about 420 KB of CSV) and policy PDFs.

Worth knowing: the local index is asynchronous and fuzzy, and calling it straight from a WebView2 handler deadlocks the UI thread: see [`docs/WINDOWS-AI-LESSONS.md`](../../docs/WINDOWS-AI-LESSONS.md).

Build: [`docs/BUILD.md`](../../docs/BUILD.md). Demo only: not for real investigations.
