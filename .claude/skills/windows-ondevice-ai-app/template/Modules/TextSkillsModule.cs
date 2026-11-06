using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Windows.AI.Text;

namespace AiApp;

// Ready-made Windows text skills built on the same model:
//   summarize / summarizeParagraph { text }        -> { text }   (streams { event:"delta" })
//   rewrite   { text, tone? }  tone: formal | casual | general | <any custom tone, e.g. "friendly and brief">
//   table     { text }         -> { rows: [[cell,...],...], markdown }
// Their input limit is small: the text is cut where the skill itself says it stops fitting, and `truncated` is set.
internal sealed class TextSkillsModule : IBridgeModule
{
    public string Name => "textskills";
    public IReadOnlyCollection<string> Ops => new[] { "summarize", "summarizeParagraph", "rewrite", "table" };

    private const int HardCap = 6000;
    private TextSummarizer? _sum;
    private TextRewriter? _rw;
    private TextToTableConverter? _table;

    public async Task<JsonObject> HandleAsync(BridgeContext ctx, BridgeRequest req)
    {
        var text = req.Str("text") ?? "";
        if (text.Trim().Length == 0) return R.Fail(req.Id, "Empty text");
        bool truncated = false;
        if (text.Length > HardCap) { text = text[..HardCap]; truncated = true; }

        var (model, err) = await Ai.GetModelAsync(p => ctx.Event(req.Id, "status", $"Preparing the on-device model... {(int)(p * 100)}%"));
        if (model == null) return R.Fail(req.Id, err ?? "Model unavailable");

        var cts = Ai.Register(req.Id);
        await Ai.ModelGate.WaitAsync(cts.Token);
        try
        {
            JsonObject r;
            switch (req.Type)
            {
                case "summarize":
                case "summarizeParagraph":
                {
                    _sum ??= new TextSummarizer(model);
                    try { if (_sum.IsPromptLargerThanContext(text, out var cutoff)) { text = text[..(int)Math.Min(cutoff, (ulong)text.Length)]; truncated = true; } } catch { }
                    var op = req.Type == "summarize" ? _sum.SummarizeAsync(text) : _sum.SummarizeParagraphAsync(text);
                    r = await Stream(ctx, req, op, cts);
                    break;
                }
                case "rewrite":
                {
                    _rw ??= new TextRewriter(model);
                    var tone = (req.Str("tone") ?? "").Trim().ToLowerInvariant();
                    var op = tone switch
                    {
                        "formal" => _rw.RewriteAsync(text, TextRewriteTone.Formal),
                        "casual" => _rw.RewriteAsync(text, TextRewriteTone.Casual),
                        "" or "general" => _rw.RewriteAsync(text, TextRewriteTone.General),
                        _ => _rw.RewriteCustomAsync(text, tone),
                    };
                    r = await Stream(ctx, req, op, cts);
                    break;
                }
                case "table":
                {
                    _table ??= new TextToTableConverter(model);
                    var tr = await _table.ConvertAsync(text);
                    var rows = new JsonArray();
                    var md = new StringBuilder();
                    var grid = tr.GetRows().Select(row => row.GetColumns().Select(c => (c ?? "").Replace("\n", " ").Trim()).ToList()).ToList();
                    if (grid.Count == 0) return R.Fail(req.Id, "No table could be built from that text (status: " + tr.Status + ").");
                    int cols = grid.Max(g => g.Count);
                    for (int i = 0; i < grid.Count; i++)
                    {
                        var cells = grid[i].Concat(Enumerable.Repeat("", cols - grid[i].Count)).ToList();
                        rows.Add(new JsonArray(cells.Select(c => (JsonNode)JsonValue.Create(c)!).ToArray()));
                        md.Append("| ").Append(string.Join(" | ", cells.Select(c => c.Replace("|", "\\|")))).Append(" |\n");
                        if (i == 0) md.Append('|').Append(string.Concat(Enumerable.Repeat(" --- |", cols))).Append('\n');
                    }
                    r = R.Ok(req.Id, md.ToString().TrimEnd());
                    r["rows"] = rows;
                    r["status"] = tr.Status.ToString();
                    break;
                }
                default:
                    return R.Fail(req.Id, "Unknown text skill");
            }
            r["truncated"] = truncated;
            return r;
        }
        finally { Ai.ModelGate.Release(); Ai.Unregister(req.Id); }
    }

    private static async Task<JsonObject> Stream(BridgeContext ctx, BridgeRequest req,
        Windows.Foundation.IAsyncOperationWithProgress<LanguageModelResponseResult, string> op, CancellationTokenSource cts)
    {
        var sb = new StringBuilder();
        long last = 0; var sw = System.Diagnostics.Stopwatch.StartNew();
        op.Progress = (i, d) =>
        {
            string t;
            lock (sb) { sb.Append(d); if (sw.ElapsedMilliseconds - last < 60) return; last = sw.ElapsedMilliseconds; t = sb.ToString(); }
            ctx.Event(req.Id, "delta", t);
        };
        using var reg = cts.Token.Register(() => { try { op.Cancel(); } catch { } });
        LanguageModelResponseResult? res = null;
        try { res = await op; } catch (OperationCanceledException) { }
        string streamed; lock (sb) streamed = sb.ToString();
        var text = !string.IsNullOrEmpty(res?.Text) ? res!.Text : streamed;
        var status = res?.Status.ToString() ?? "Cancelled";
        ctx.Log($"{req.Type} textLen={text.Length} status={status}");
        if (string.IsNullOrEmpty(text)) return R.Fail(req.Id, "The skill returned no text (status: " + status + ")");
        var r = R.Ok(req.Id, text);
        r["status"] = status;
        return r;
    }
}
