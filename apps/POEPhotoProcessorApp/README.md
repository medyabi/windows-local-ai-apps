# POE Photo Processor

Blurs faces and captions event photos with on-device AI (Windows AI APIs / Phi Silica). It is a native rewrite of an earlier demo that called Foundry Local.

- Needs package identity and the `Windows.Universal` + `Windows.Desktop` device families in the manifest (already set).
- The signing key used during development (`*_TemporaryKey.pfx`) is deliberately **not** in this repository: create your own certificate as described in [`docs/BUILD.md`](../../docs/BUILD.md).
