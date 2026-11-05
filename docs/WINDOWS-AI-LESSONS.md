# Lessons from building on the Windows AI APIs

Things that were measured while building these apps (Phi Silica through `Microsoft.Windows.AI.Text.LanguageModel`, on-device OCR, `AppContentIndexer`). They reflect the SDK version used here (`2.2.2-experimental9`) and may change.

## The model

1. **Always check `LanguageModelResponseResult.Status`, not only `.Text`.** `PromptBlockedByContentModeration` comes back with an empty text and no exception, so a blocked call looks like a successful empty answer.
2. **What triggered the moderation block** was not the obviously sensitive words. It was raw transaction descriptions containing a masked card number pattern (`VISA ****4471`) together with merchant / person-shaped text. A prompt made of pure numeric facts passed. Fix: never send raw merchant or account-like strings; map them to generic categories (« Subscription », « Auto loan payment ») before they reach a prompt. The real text stays in the UI.
3. **Do not try to loosen `ContentFilterOptions` / `SeverityLevel`.** Passing a custom severity returned `BlockedByPolicy` in about 30 ms, i.e. blocked before inference: overriding the filter appears to be gated behind a Limited Access Feature. Fix the prompt instead.
4. **The context window is small.** About 5,900 characters of transactions returned `PromptLargerThanContext` with an empty text. Cap what is sent: always the flagged items, plus a limited number of the most recent ones, with small recurring items summarised as aggregates. A "fit test" that shrinks the prompt until it passes is worth building.
5. **Signed numbers confuse comparisons.** « -7800.00 » was read as smaller than 5000. Show a positive amount with an explicit label (deposit / withdrawal) and tell the system prompt to compare magnitudes.
6. **Decoding is close to deterministic and streaming sends deltas** (LocalMind). Build the streaming UI on deltas, and do not rely on temperature to get a different answer on retry.
7. **One big JSON-producing call is fragile.** Splitting a combined analysis into two smaller calls fixed both an 8-minute latency and truncated JSON (HR Recruiter).
8. **Verify every figure the model writes** against the facts computed by code, and show a warning (and the facts) when one does not match. Most of the apps do this.

## OCR and documents

- On-device OCR pattern that works: base64 → `InMemoryRandomAccessStream` (via `DataWriter`) → `BitmapDecoder.CreateAsync` → `GetSoftwareBitmapAsync()` → `ImageBuffer.CreateForSoftwareBitmap` → `TextRecognizer.CreateAsync()` → `RecognizeTextFromImage(...).Lines`.
- PDFs with a text layer are read with PdfPig; scanned PDFs are rendered with `Windows.Data.Pdf` and sent to OCR.

## The local index (`AppContentIndexer`)

- Indexing is **asynchronous**: query right after adding content and you get nothing. Poll or retry with a delay.
- Matching is **fuzzy**, not exact: confirm hits on the client side (e.g. by checking the text really contains the quoted terms).
- Calling it directly from a WebView2 message handler can **deadlock the UI thread**: run it with `Task.Run`.

## Debugging this stack

- Add a temporary **self-test block** that runs the whole pipeline at startup and logs to a file; when an AI call "silently returns nothing", bisect the prompt into variants logged separately.
- WebView2 screenshots can be taken headlessly with `CapturePreviewAsync` (useful when screen capture of the app is blank).
- Using the WebView2 DevTools relay from the host crashed one app (HR Recruiter) regardless of load: avoid it.
- Packaged apps need package identity: register a Debug build rather than running the raw `.exe` (see `BUILD.md`).
