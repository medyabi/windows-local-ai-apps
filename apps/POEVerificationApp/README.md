# POE Verification Analyst

On-device **proof-of-execution** verification: cross-checks an invoice against its purchase order and the delivery / execution evidence.

- A deterministic **verification matrix** (quantities, prices, dates, parties) computed by code.
- **Reuse detection** of evidence across claims with the local index (`AppContentIndexer`): the index is asynchronous (needs a retry / delay) and fuzzy (hits are confirmed on the client side).
- **Photo quantity estimation** with `ImageDescriptionGenerator`.
- An investigation copilot (Phi Silica) that explains findings from the computed facts.
- `manual-test-documents/` contains six synthetic scenarios (clean, quantity over-billing, price inflation, execution shortfall, back-dated evidence, photo discrepancy); see its README.

Build: [`docs/BUILD.md`](../../docs/BUILD.md). Demo only.
