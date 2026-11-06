using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Text;

namespace AiApp;

// Phi Silica (LanguageModel): ensureReady, generate, generateStream, promptFits.
//   generate        { prompt, system?, temperature? }  -> { text, status }
//   generateStream  same; pushes { id, event:"delta", text:<cumulative text> } while it writes; cancel with op "cancel"
//   promptFits      { prompt, system? }                -> { fits, usable, length }   (a fit test, not a capacity number)
// Lessons built in: an empty answer is a FAILURE carrying result.Status (content moderation and an oversized prompt return
// empty text, not an exception); default decoding is deterministic, so pass temperature (e.g. 0.8) for a different retry.
internal sealed class LanguageModule : IBridgeModule
{
    public string Name => "language";
    public IReadOnlyCollection<string> Ops => new[] { "ensureReady", "generate", "generateStream", "promptFits" };

    public IEnumerable<(string feature, string state)> Status()
    {
        yield return ("LanguageModel (Phi Silica)", LanguageModel.GetReadyState().ToString());
    }

    public async Task<JsonObject> HandleAsync(BridgeContext ctx, BridgeRequest req)
    {
        switch (req.Type)
        {
            case "ensureReady":
            {
                var (model, err) = await Ai.GetModelAsync(p => ctx.Event(req.Id, "status", $"Preparing the on-device model... {(int)(p * 100)}%"));
                if (model == null) return R.Fail(req.Id, err ?? "Model unavailable");
                var r = R.Ok(req.Id);
                r["state"] = LanguageModel.GetReadyState().ToString();
                return r;
            }
            case "promptFits":
            {
                var (model, err) = await Ai.GetModelAsync();
                if (model == null) return R.Fail(req.Id, err ?? "Model unavailable");
                var prompt = req.Str("prompt") ?? "";
                var c = model.CreateContext(req.Str("system") ?? "");
                var usable = model.GetUsablePromptLength(c, prompt);
                var r = R.Ok(req.Id);
                r["fits"] = usable >= (ulong)prompt.Length;
                r["usable"] = (long)Math.Min(usable, (ulong)long.MaxValue);
                r["length"] = prompt.Length;
                return r;
            }
            case "generate":
            case "generateStream":
                return await GenerateAsync(ctx, req, stream: req.Type == "generateStream");
        }
        return R.Fail(req.Id, "Unknown language op");
    }

    private static async Task<JsonObject> GenerateAsync(BridgeContext ctx, BridgeRequest req, bool stream)
    {
        var prompt = req.Str("prompt") ?? "";
        if (prompt.Length == 0) return R.Fail(req.Id, "Empty prompt");

        var (model, err) = await Ai.GetModelAsync(p => ctx.Event(req.Id, "status", $"Preparing the on-device model... {(int)(p * 100)}%"));
        if (model == null) return R.Fail(req.Id, err ?? "Model unavailable");

        var opts = new LanguageModelOptions();
        if (req.Dbl("temperature") is double t) opts.Temperature = (float)t;
        var gctx = model.CreateContext(req.Str("system") ?? "");

        var cts = Ai.Register(req.Id);
        await Ai.ModelGate.WaitAsync(cts.Token);
        try
        {
            var sw = Stopwatch.StartNew();
            var sb = new StringBuilder();
            long lastFlush = 0, first = -1;
            var op = model.GenerateResponseAsync(gctx, prompt, opts);
            using var reg = cts.Token.Register(() => { try { op.Cancel(); } catch { } });
            if (stream)
            {
                op.Progress = (info, delta) =>
                {
                    string text;
                    lock (sb)
                    {
                        if (first < 0) first = sw.ElapsedMilliseconds;
                        sb.Append(delta);                                   // Progress delivers DELTAS
                        if (sw.ElapsedMilliseconds - lastFlush < 50) return;
                        lastFlush = sw.ElapsedMilliseconds;
                        text = sb.ToString();
                    }
                    ctx.Event(req.Id, "delta", text);
                };
            }

            LanguageModelResponseResult? result = null;
            try { result = await op; }
            catch (OperationCanceledException) { }
            catch (Exception ex) when (ex.GetType().Name.Contains("Cancel")) { }

            string streamed; lock (sb) streamed = sb.ToString();
            var final = !string.IsNullOrEmpty(result?.Text) ? result!.Text : streamed;
            var status = result?.Status.ToString() ?? (cts.IsCancellationRequested ? "Cancelled" : "Unknown");
            ctx.Log($"generate promptLen={prompt.Length} textLen={final.Length} status={status} ms={sw.ElapsedMilliseconds}");

            if (string.IsNullOrEmpty(final))
                return cts.IsCancellationRequested
                    ? new JsonObject { ["ok"] = true, ["text"] = "", ["status"] = status, ["cancelled"] = true }
                    : R.Fail(req.Id, "The model returned no text (status: " + status + "). " + Hint(status));

            var r = R.Ok(req.Id, final);
            r["status"] = status;
            r["ms"] = sw.ElapsedMilliseconds;
            r["firstTokenMs"] = first < 0 ? 0 : first;
            r["cancelled"] = cts.IsCancellationRequested;
            return r;
        }
        finally { Ai.ModelGate.Release(); Ai.Unregister(req.Id); }
    }

    private static string Hint(string status)
    {
        if (status.Contains("Moderation", StringComparison.OrdinalIgnoreCase))
            return "Windows content safety blocked the prompt. Avoid raw card/account-like strings and person-shaped text; send generic categories or computed facts instead.";
        if (status.Contains("Larger", StringComparison.OrdinalIgnoreCase) || status.Contains("Context", StringComparison.OrdinalIgnoreCase))
            return "The prompt is larger than the model's context window. Send less text (use promptFits to test).";
        return "";
    }
}
