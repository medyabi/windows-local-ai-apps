using System.Text.Json.Nodes;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Imaging;
using Windows.Storage.Streams;

namespace AiApp;

// On-device OCR (TextRecognizer).
//   ocr     { base64 }                -> { text, lines[] }          an image (png/jpg/...; data: URLs accepted)
//   ocrPdf  { base64, maxPages? }     -> { text, pages[], totalPages }   a SCANNED pdf: pages are rendered with Windows.Data.Pdf, then OCR'd
// For PDFs that have a text layer use "pdfText" (PdfModule) instead: it is exact and instant.
internal sealed class OcrModule : IBridgeModule
{
    public string Name => "ocr";
    public IReadOnlyCollection<string> Ops => new[] { "ocr", "ocrPdf" };

    private static TextRecognizer? _rec;
    private static readonly SemaphoreSlim Lock = new(1, 1);

    public IEnumerable<(string feature, string state)> Status()
    {
        yield return ("TextRecognizer (OCR)", TextRecognizer.GetReadyState().ToString());
    }

    private static async Task<(TextRecognizer? rec, string? error)> GetAsync(BridgeContext ctx, string id)
    {
        if (_rec != null) return (_rec, null);
        await Lock.WaitAsync();
        try
        {
            if (_rec != null) return (_rec, null);
            var err = await Ai.EnsureReadyAsync("on-device OCR", TextRecognizer.GetReadyState, TextRecognizer.EnsureReadyAsync,
                p => ctx.Event(id, "status", $"Preparing OCR... {(int)(p * 100)}%"));
            if (err != null) return (null, err);
            _rec = await TextRecognizer.CreateAsync();
            return (_rec, null);
        }
        finally { Lock.Release(); }
    }

    // Lines is NULL (not empty) for an image that contains no text.
    private static List<string> Lines(TextRecognizer rec, Microsoft.Graphics.Imaging.ImageBuffer buffer)
    {
        var result = rec.RecognizeTextFromImage(buffer);
        if (result?.Lines == null) return new List<string>();
        return result.Lines.Select(l => (l?.Text ?? "").Trim()).Where(t => t.Length > 0).ToList();
    }

    public async Task<JsonObject> HandleAsync(BridgeContext ctx, BridgeRequest req)
    {
        var b64 = req.Str("base64");
        if (string.IsNullOrEmpty(b64)) return R.Fail(req.Id, "No data");
        var (rec, err) = await GetAsync(ctx, req.Id);
        if (rec == null) return R.Fail(req.Id, err ?? "OCR unavailable");

        if (req.Type == "ocr")
        {
            using var buf = await ImageUtil.FromBase64Async(b64);
            var lines = Lines(rec, buf);
            var r = R.Ok(req.Id, string.Join("\n", lines));
            r["lines"] = new JsonArray(lines.Select(l => (JsonNode)JsonValue.Create(l)!).ToArray());
            ctx.Log($"ocr lines={lines.Count}");
            return r;
        }

        // ocrPdf
        int max = Math.Clamp(req.Int("maxPages") ?? 40, 1, 200);
        var bytes = Convert.FromBase64String(b64.Contains(',') && b64.StartsWith("data:") ? b64[(b64.IndexOf(',') + 1)..] : b64);
        using var ms = new InMemoryRandomAccessStream();
        using (var w = new DataWriter(ms)) { w.WriteBytes(bytes); await w.StoreAsync(); await w.FlushAsync(); w.DetachStream(); }
        ms.Seek(0);
        var pdf = await Windows.Data.Pdf.PdfDocument.LoadFromStreamAsync(ms);
        int total = (int)pdf.PageCount, n = Math.Min(total, max);
        var pages = new JsonArray();
        var all = new System.Text.StringBuilder();
        for (uint i = 0; i < n; i++)
        {
            ctx.Event(req.Id, "status", $"OCR page {i + 1}/{n}");
            using var page = pdf.GetPage(i);
            using var pms = new InMemoryRandomAccessStream();
            await page.RenderToStreamAsync(pms, new Windows.Data.Pdf.PdfPageRenderOptions { DestinationWidth = 1800 });
            pms.Seek(0);
            using var buf = await ImageUtil.FromStreamAsync(pms);
            var text = string.Join("\n", Lines(rec, buf));
            pages.Add(text);
            all.Append(text).Append("\n\n");
        }
        var res = R.Ok(req.Id, all.ToString().Trim());
        res["pages"] = pages;
        res["totalPages"] = total;
        res["truncated"] = total > n;
        ctx.Log($"ocrPdf pages={n}/{total}");
        return res;
    }
}
