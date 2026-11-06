using System.Text.Json.Nodes;

namespace AiApp;

// ── The bridge contract ─────────────────────────────────────────────────────────────────────────
// The page posts { id, type, ...args }. The host finds the module that owns `type`, runs it and posts back
// { id, ok, text?, error?, ...extra }. A module may also push progress events { id, event, ... } while it works.
// To add a capability: create Modules/MyModule.cs implementing IBridgeModule. It is discovered automatically,
// and deleting a module file removes its operations without touching any other code.

internal interface IBridgeModule
{
    string Name { get; }
    IReadOnlyCollection<string> Ops { get; }
    Task<JsonObject> HandleAsync(BridgeContext ctx, BridgeRequest req);

    // Optional: Windows AI feature states shown by the "status" op (feature name, ready state).
    IEnumerable<(string feature, string state)> Status() => Array.Empty<(string, string)>();
}

internal sealed class BridgeContext
{
    public required string LocalFolder { get; init; }
    public required Action<string> Log { get; init; }
    public required Action<JsonObject> Post { get; init; }            // thread-safe: marshals to the UI thread
    public IReadOnlyList<IBridgeModule> Modules { get; set; } = Array.Empty<IBridgeModule>();
    public string AppName { get; init; } = "AiApp";

    // Progress event for a running request (shown by the page next to the request id).
    public void Event(string id, string kind, string text) =>
        Post(new JsonObject { ["id"] = id, ["event"] = kind, ["text"] = text });
}

internal sealed class BridgeRequest
{
    public JsonObject Raw { get; }
    public string Id { get; }
    public string Type { get; }

    public BridgeRequest(JsonObject raw)
    {
        Raw = raw;
        Id = raw["id"]?.GetValue<string>() ?? "";
        Type = raw["type"]?.GetValue<string>() ?? "";
    }

    public string? Str(string key) => Raw[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    public int? Int(string key) => Raw[key] is JsonValue v && v.TryGetValue<double>(out var d) ? (int)d : null;
    public double? Dbl(string key) => Raw[key] is JsonValue v && v.TryGetValue<double>(out var d) ? d : null;
    public bool Bool(string key) => Raw[key] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
    public JsonArray? Arr(string key) => Raw[key] as JsonArray;
}

internal static class R
{
    public static JsonObject Ok(string id, string? text = null) =>
        new() { ["id"] = id, ["ok"] = true, ["text"] = text };

    public static JsonObject Fail(string id, string error) =>
        new() { ["id"] = id, ["ok"] = false, ["error"] = error };
}
