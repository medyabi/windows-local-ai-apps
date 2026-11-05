# LocalIQ

**Ask your files anything.** Documents, PDFs, notes, images and code are indexed locally and answered with citations by on-device Phi Silica. Works offline. (It supersedes an earlier "Offline Spec Sheet Q&A" app.)

- Any file type; images and scanned PDFs go through on-device OCR.
- Retrieval: the Windows local semantic index (`AppContentIndexer`) combined with BM25, with deterministic guards on numbers, citations and relevance.
- `sample-datasheets/` (synthetic component datasheets) and `sample-files/` (invoice, receipt, handbook, …) are there to try it.

Build: [`docs/BUILD.md`](../../docs/BUILD.md).
