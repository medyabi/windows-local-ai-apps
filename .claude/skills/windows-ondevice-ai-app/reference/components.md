# Windows AI components: what to use, how to call it, what goes wrong

Each component is one file in `template/Modules/` (delete it and its operations disappear). Ops are called from the page with
`NativeAI.call(op, args, onEvent)`; the argument names below are the ones the modules read. Every response has `ok`; on failure the
promise rejects with the module's error text (which includes the Windows `Status` when there is one).

**Measured on a Copilot+ PC with `Microsoft.WindowsAppSDK 2.2.2-experimental9`.** These APIs are experimental: re-run the self-test after upgrading the SDK.

## Choosing

| Need | Use | Not this |
|---|---|---|
| Write an explanation / answer / draft from facts you supply | `language` | Asking it to compute or enumerate |
| Short summary, tone change, text to table | `textskills` | `language` with a hand-written prompt (the skills are tuned) |
| Text from a photo, screenshot, receipt, whiteboard | `ocr` -> `ocr` | `vision` (captions, not text) |
| Text from a scanned PDF | `ocr` -> `ocrPdf` | `pdf` (no text layer) |
| Text from a normal PDF | `pdf` -> `pdfText` | `ocrPdf` (slower, less exact) |
| "What is in this picture" | `vision` -> `describeImage` | Counting/measuring (no such model) |
| Find relevant passages in the user's documents | `index` | Putting the corpus in one prompt (context is small) |
| New / restyled / upscaled / cut-out pictures | `images` | - |

Typical combinations: **document analyst** = pdf + ocr + language; **ask-your-files** = pdf + ocr + index + language (+ vision for photos); **photo auditor** = vision + ocr + language; **writing assistant** = language + textskills; **creative tool** = images + language.

---

## language: `LanguageModule` (Phi Silica, `Microsoft.Windows.AI.Text.LanguageModel`)

| Op | Args | Returns |
|---|---|---|
| `ensureReady` | - | `state`; downloads the model on first use (pushes `status` events) |
| `generate` | `prompt`, `system?`, `temperature?` | `text`, `status`, `ms`, `firstTokenMs` |
| `generateStream` | same | same, and pushes `{event:'delta', text:<cumulative>}` as it writes |
| `promptFits` | `prompt`, `system?` | `fits`, `usable`, `length` |
| `cancel` (core) | `target` = request id (`NativeAI.lastId()`) | stops a stream; the partial text is returned with `cancelled:true` |

Facts that shape the design:
- **Small context window.** About 5,900 characters of raw transactions overflowed it. Cap and summarise what you send; prefill is slow (about 3,000 characters of excerpts took 5 to 8 s before the first token). `promptFits` is a fit test (it returns the prompt length when the prompt fits), not a capacity number; shrink-and-retest in a loop.
- **Empty text is a failure.** `PromptBlockedByContentModeration` and `PromptLargerThanContext` come back as empty text with a status. The module turns them into an error with a hint.
- **What triggered moderation in practice:** masked card numbers (`VISA ****4471`) next to merchant/person-shaped text. Pure numeric facts passed. Send generic categories ("Subscription") and keep the raw text in the UI.
- **Do not try to loosen `ContentFilterOptions`.** A custom severity returns `BlockedByPolicy` in about 30 ms. Fix the prompt.
- **Decoding is deterministic.** Same input, same output. For "regenerate" pass `temperature` (about 0.8).
- **Streaming sends deltas**; the module accumulates and sends cumulative text so the page just replaces the output.
- **Signed numbers confuse comparisons** (`-7800.00` read as less than 5000). Send positive amounts with a label ("withdrawal 7800") and ask to compare magnitudes.
- **Quirks:** may start with a stray label, wrap short answers in an untagged code fence, invent names, hallucinate "facts" from a plain question. Forbid inventions in the system prompt, strip fences, and filter extracted facts against the user's actual text.
- **One call returning a big JSON object is fragile** (slow and truncated). Split into 2 to 3 small calls (an 8-minute analysis became normal).
- **Verify the model's figures** against facts computed by code; show a warning with the facts when they disagree.

```js
// grounded explanation of computed facts
const facts = { total: 1280.5, flagged: 3, rule: 'amount above 3x median' };
const r = await NativeAI.call('generate', {
  system: 'You explain findings to an analyst. Use only the facts given. Do not invent numbers. Be concise.',
  prompt: 'Facts:\n' + JSON.stringify(facts) + '\nExplain what the analyst should check first.' });
```

## textskills: `TextSkillsModule` (`TextSummarizer`, `TextRewriter`, `TextToTableConverter`)

| Op | Args | Returns |
|---|---|---|
| `summarize`, `summarizeParagraph` | `text` | `text` (streams `delta`), `truncated` |
| `rewrite` | `text`, `tone?` = formal / casual / general / any custom phrase | `text` |
| `table` | `text` | `rows` (array of arrays), `text` (markdown) |

Input is capped at about 6,000 characters (and at the point the skill reports it no longer fits); `truncated:true` tells the page to say so. They share the single model, so they queue behind other generations.

## ocr: `OcrModule` (`TextRecognizer`)

| Op | Args | Returns |
|---|---|---|
| `ocr` | `base64` (png/jpg/...; `data:` URLs accepted) | `text`, `lines[]` |
| `ocrPdf` | `base64` (a PDF), `maxPages?` (default 40, max 200) | `text`, `pages[]`, `totalPages`, `truncated`; pushes `status` per page |

Notes: an image with no text yields no lines (handled); EXIF orientation is respected for photos; scanned-PDF pages are rendered at 1,800 px with `Windows.Data.Pdf` before recognition. Show the user when pages were skipped (`truncated`).

## pdf: `PdfModule` (PdfPig, no AI)

`pdfText { base64 }` -> `text`, `pages[]`, `pageCount`, `hasText`. When `hasText` is false the PDF is a scan: call `ocrPdf`. Uses `UglyToad.PdfPig 1.7.0-custom-5` (pinned prerelease; check NuGet for a newer stable one).

```js
async function pdfToText(file) {
  const base64 = await NativeAI.fileToBase64(file);
  const t = await NativeAI.call('pdfText', { base64 });
  if (t.hasText) return t.text;
  return (await NativeAI.call('ocrPdf', { base64, maxPages: 30 })).text;     // scanned
}
```

## vision: `VisionModule` (`ImageDescriptionGenerator`)

`describeImage { base64, kind? }` (kind: detailed / brief / diagram / accessible) -> `text`, `status`.
- Captions only. There is **no on-device object counting**: if you must estimate quantities, let the language model estimate from captions and label it "estimate" in the UI.
- Statuses seen: `ImageHasTooMuchText` (use OCR), `ImageBlockedByContentModeration`, `InternalError`. Failures are surfaced, not silently dropped.
- Run OCR first; describe only images with little text. Label output "generated by on-device AI, may be inaccurate". Tell the language model that a caption is what the picture shows, otherwise it answers "I can't view images".
- Slow (several seconds per image): make it optional in the UI.

## index: `IndexModule` (`AppContentIndexer`)

| Op | Args | Returns |
|---|---|---|
| `indexAdd` | `contentId`, `text` | - |
| `indexAddMany` | `items:[{contentId,text}]` | `added` |
| `indexRemove` / `indexClear` | `contentId` / - | - |
| `indexQuery` | `query`, `top?` | `matches:[{contentId, snippet, text, confirmed, offset, length}]` |
| `indexStats` | - | `count` |

Built in, because each one hung or misled earlier apps:
1. runs in `Task.Run` (calling it on the UI thread deadlocks the whole app silently);
2. an empty result shortly after an add is retried once after 3 s (indexing is asynchronous);
3. `confirmed` is true only when every query word of 3+ letters occurs in the stored passage (matching is fuzzy: a hit alone is not proof). For exact duplicate detection compare fingerprints yourself.

The module keeps `contentId -> text` in `LocalState\index-map.json` (matches give offsets, not text). Chunk documents yourself (a few hundred words per passage, ids like `docname#12`) and put the document name in the passage text. For better recall combine with your own keyword (BM25) ranking in JS. The index is documented as not intended for sensitive personal data: index manuals, policies, the user's own notes, and say so in the UI.

```js
const hits = (await NativeAI.call('indexQuery', { query: question, top: 5 })).matches.filter(m => m.confirmed);
if (!hits.length) return 'Not found in your documents.';              // answer without calling the model
const prompt = 'Answer using only these excerpts and cite the id in brackets.\n' + hits.map(m => `[${m.contentId}] ${m.text}`).join('\n') + '\nQuestion: ' + question;
```

## images: `ImageModule` (`ImageGenerator`, `ImageScaler`, `ImageForegroundExtractor`)

`imageGenerate {prompt, style?, seed?}`, `imageRestyle {base64, prompt}`, `imageUpscale {base64}`, `imageCutout {base64}` -> `png` (base64), `width`, `height`, `status`.
- Each model is provisioned by Windows Update on first use (the generator took 15+ minutes on one PC; the upscaler failed once mid-download and worked on retry). The module pushes `status` events with the download percentage and gives up after 20 minutes without progress. Always offer a retry.
- Generation takes about 5 to 60 s. Moderation can refuse a prompt (`TextBlockedByContentModeration`); the error says so. LLM-written SVG drawings are crude: do not present them as a generator.
- Output is a PNG as base64: show with `img.src = 'data:image/png;base64,' + r.png`. Large results are megabytes: do not keep many in memory.

---

## Core ops (always present)

`info` (modules and ops), `status` (readiness of each Windows AI feature on this PC), `log { text }` (short diagnostic line into `bridge.log`; never user content), `cancel { target }`, `writeReport` (self-test).

## Adding your own module

Create `Modules/FilesModule.cs` (any file name); it is found by reflection, no registration needed:

```csharp
using System.Text.Json.Nodes;
namespace MyApp;

internal sealed class FilesModule : IBridgeModule
{
    public string Name => "files";
    public IReadOnlyCollection<string> Ops => new[] { "readTextFile" };

    public async Task<JsonObject> HandleAsync(BridgeContext ctx, BridgeRequest req)
    {
        var path = req.Str("path");
        if (string.IsNullOrEmpty(path) || !File.Exists(path)) return R.Fail(req.Id, "File not found");
        var r = R.Ok(req.Id, await File.ReadAllTextAsync(path));
        ctx.Log("readTextFile size=" + r["text"]!.ToString().Length);      // sizes only
        return r;
    }
}
```
Use `ctx.Event(req.Id, "status", "...")` for progress, `Ai.Register/Unregister(req.Id)` + `Ai.Cancel` for cancellable work, `Ai.ModelGate` around language-model calls, and `Task.Run` for anything blocking or thread-sensitive. Folder pickers/save dialogs in WinUI need the window handle (`WinRT.Interop.WindowNative.GetWindowHandle`); not exercised by the template.

## Not included (untested here)

- **Speech** (`Microsoft.Windows.AI.Speech`, on-device dictation) exists in the SDK but was never wired in or tested.
- **`ImageObjectRemover`** exists in `Microsoft.Windows.AI.Imaging`; not wired in.
- **Embeddings** (`GenerateEmbeddingVectors`) exist on the model; not used. `AppContentIndexer` covers retrieval.
- **Tool calling / agents:** Phi Silica was weak at choosing tools; the apps that needed an agent used a user-supplied cloud or local-server model through the host. Not in the template.
- **Cloud stage (Azure OpenAI etc.):** a pattern exists in the author's HybridMind/HybridMed apps (consent, redaction, DPAPI-protected key, host-only network); not in the template. Ask the user before adding anything that leaves the device.
