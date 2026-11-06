using System.Text;
using System.Text.Json.Nodes;
using UglyToad.PdfPig;

namespace AiApp;

// PDFs that have a text layer, read locally with PdfPig (no AI involved: exact and fast).
//   pdfText { base64 } -> { text, pages[], pageCount, hasText }
// If hasText is false the PDF is a scan: call "ocrPdf" (OcrModule) instead.
internal sealed class PdfModule : IBridgeModule
{
    public string Name => "pdf";
    public IReadOnlyCollection<string> Ops => new[] { "pdfText" };

    public Task<JsonObject> HandleAsync(BridgeContext ctx, BridgeRequest req)
    {
        var b64 = req.Str("base64");
        if (string.IsNullOrEmpty(b64)) return Task.FromResult(R.Fail(req.Id, "No data"));
        try
        {
            if (b64.StartsWith("data:") && b64.Contains(',')) b64 = b64[(b64.IndexOf(',') + 1)..];
            using var ms = new MemoryStream(Convert.FromBase64String(b64));
            using var doc = PdfDocument.Open(ms);
            var pages = new JsonArray();
            var all = new StringBuilder();
            foreach (var page in doc.GetPages())
            {
                pages.Add(page.Text);
                all.AppendLine(page.Text);
            }
            var text = all.ToString().Trim();
            var r = R.Ok(req.Id, text);
            r["pages"] = pages;
            r["pageCount"] = doc.NumberOfPages;
            r["hasText"] = text.Length > 20;
            ctx.Log($"pdfText pages={doc.NumberOfPages} chars={text.Length}");
            return Task.FromResult(r);
        }
        catch (Exception ex)
        {
            return Task.FromResult(R.Fail(req.Id, "PDF extraction failed: " + ex.Message));
        }
    }
}
