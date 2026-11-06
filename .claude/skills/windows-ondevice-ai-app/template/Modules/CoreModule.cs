using System.Text.Json.Nodes;

namespace AiApp;

// Always present: app info, the list of available operations, component readiness, log lines from the page, cancel.
internal sealed class CoreModule : IBridgeModule
{
    public string Name => "core";
    public IReadOnlyCollection<string> Ops => new[] { "info", "status", "log", "cancel", "writeReport" };

    public Task<JsonObject> HandleAsync(BridgeContext ctx, BridgeRequest req)
    {
        switch (req.Type)
        {
            case "info":
            {
                var ops = new JsonArray();
                var mods = new JsonArray();
                foreach (var m in ctx.Modules)
                {
                    mods.Add(m.Name);
                    foreach (var op in m.Ops) ops.Add(op);
                }
                var r = R.Ok(req.Id);
                r["app"] = ctx.AppName;
                r["modules"] = mods;
                r["ops"] = ops;
                return Task.FromResult(r);
            }
            case "status":
            {
                // What can this PC do right now? One row per Windows AI feature.
                var rows = new JsonArray();
                foreach (var m in ctx.Modules)
                    foreach (var (feature, state) in m.Status())
                        rows.Add(new JsonObject { ["module"] = m.Name, ["feature"] = feature, ["state"] = state });
                var r = R.Ok(req.Id);
                r["features"] = rows;
                return Task.FromResult(r);
            }
            case "log":
                // The page may log short diagnostic lines (never user content).
            {
                var line = (req.Str("text") ?? "").Replace("\n", " ");
                ctx.Log("page: " + (line.Length > 300 ? line[..300] : line));
                return Task.FromResult(R.Ok(req.Id));
            }
            case "cancel":
            {
                var target = req.Str("target") ?? "";
                var r = R.Ok(req.Id);
                r["cancelled"] = Ai.Cancel(target);
                return Task.FromResult(r);
            }
            case "writeReport":
            {
                // Used by the page's self-test: saves <LocalState>\selftest-report.json
                File.WriteAllText(Path.Combine(ctx.LocalFolder, "selftest-report.json"), req.Str("text") ?? "");
                return Task.FromResult(R.Ok(req.Id));
            }
        }
        return Task.FromResult(R.Fail(req.Id, "Unknown core op"));
    }
}
