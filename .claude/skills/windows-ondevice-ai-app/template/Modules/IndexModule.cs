using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Windows.Search.AppContentIndex;

namespace AiApp;

// Local semantic/keyword search over your own text (AppContentIndexer). Operations:
//   indexAdd      { contentId, text }          add or replace one passage
//   indexAddMany  { items:[{contentId,text}] } add many
//   indexRemove   { contentId }  |  indexClear
//   indexQuery    { query, top? }              -> { matches:[{contentId, snippet, text, confirmed, offset, length}] }
//   indexStats                                  -> { count }
//
// Three hard-won rules are implemented HERE so that app code cannot forget them:
//  1. Every call runs inside Task.Run: AppContentIndexer called on the UI thread DEADLOCKS the whole app silently.
//  2. Indexing is asynchronous: a query right after an add can return nothing, so an empty result is retried once after 3 s.
//  3. Matching is FUZZY: a hit only means "shares words". `confirmed` is true when every query word of 3+ letters really
//     appears in the stored passage; use it (or your own exact check) before treating a hit as proof.
// The matches carry offsets, not the source text, so this module keeps contentId -> text (LocalState\index-map.json).
// The index is documented as not intended for sensitive personal data: index manuals, policies, the user's own notes.
internal sealed class IndexModule : IBridgeModule
{
    public string Name => "index";
    public IReadOnlyCollection<string> Ops => new[] { "indexAdd", "indexAddMany", "indexRemove", "indexClear", "indexQuery", "indexStats" };

    private const string IndexName = "app-index";
    private static readonly object L = new();
    private static AppContentIndexer? _ix;
    private static Dictionary<string, string>? _map;
    private static string _mapPath = "";
    private static DateTime _lastAdd = DateTime.MinValue;

    public IEnumerable<(string feature, string state)> Status()
    {
        yield return ("AppContentIndexer", "Available (opened on first use)");
    }

    private static AppContentIndexer Open(BridgeContext ctx)
    {
        lock (L)
        {
            if (_ix != null) return _ix;
            _mapPath = Path.Combine(ctx.LocalFolder, "index-map.json");
            try { _map = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(_mapPath)) ?? new(); }
            catch { _map = new(); }
            var r = AppContentIndexer.GetOrCreateIndex(IndexName);
            if (!r.Succeeded) throw new InvalidOperationException($"Could not open the local index ({r.Status}: {r.ExtendedError}).");
            _ix = r.Indexer;
            if (_map.Count == 0) { try { _ix.RemoveAllContentItems(); } catch { } }   // keep index and map consistent
            return _ix;
        }
    }

    private static void SaveMap() { try { File.WriteAllText(_mapPath, JsonSerializer.Serialize(_map)); } catch { } }

    public Task<JsonObject> HandleAsync(BridgeContext ctx, BridgeRequest req) =>
        Task.Run(() => Handle(ctx, req));          // rule 1: never on the UI thread

    private static JsonObject Handle(BridgeContext ctx, BridgeRequest req)
    {
        var ix = Open(ctx);
        switch (req.Type)
        {
            case "indexAdd":
            {
                var id = req.Str("contentId"); var text = req.Str("text");
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(text)) return R.Fail(req.Id, "contentId and text are required");
                lock (L) { ix.AddOrUpdate(AppManagedIndexableAppContent.CreateFromString(id, text)); _map![id] = text; _lastAdd = DateTime.UtcNow; SaveMap(); }
                return R.Ok(req.Id);
            }
            case "indexAddMany":
            {
                int n = 0;
                lock (L)
                {
                    foreach (var it in req.Arr("items") ?? new JsonArray())
                    {
                        var id = it?["contentId"]?.GetValue<string>(); var text = it?["text"]?.GetValue<string>();
                        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(text)) continue;
                        ix.AddOrUpdate(AppManagedIndexableAppContent.CreateFromString(id, text)); _map![id] = text; n++;
                    }
                    _lastAdd = DateTime.UtcNow; SaveMap();
                }
                var r = R.Ok(req.Id); r["added"] = n;
                ctx.Log($"indexAddMany added={n}");
                return r;
            }
            case "indexRemove":
            {
                var id = req.Str("contentId");
                if (string.IsNullOrEmpty(id)) return R.Fail(req.Id, "contentId is required");
                lock (L) { try { ix.RemoveContentItem(id); } catch { } _map!.Remove(id); SaveMap(); }
                return R.Ok(req.Id);
            }
            case "indexClear":
                lock (L) { try { ix.RemoveAllContentItems(); } catch { } _map!.Clear(); SaveMap(); }
                return R.Ok(req.Id);
            case "indexStats":
            {
                var r = R.Ok(req.Id); lock (L) r["count"] = _map!.Count; return r;
            }
            case "indexQuery":
            {
                var q = req.Str("query") ?? "";
                int top = Math.Clamp(req.Int("top") ?? 5, 1, 50);
                if (q.Trim().Length == 0) return R.Fail(req.Id, "Empty query");
                var matches = Query(ix, q, top);
                if (matches.Count == 0 && (DateTime.UtcNow - _lastAdd).TotalSeconds < 30)
                {
                    Thread.Sleep(3000);                    // rule 2: indexing is asynchronous
                    matches = Query(ix, q, top);
                }
                var words = q.ToLowerInvariant().Split(new[] { ' ', ',', '.', ';', ':', '?', '!', '"', '\'', '(', ')' }, StringSplitOptions.RemoveEmptyEntries)
                             .Where(w => w.Length >= 3).Distinct().ToList();
                var arr = new JsonArray();
                foreach (var (id, off, len) in matches)
                {
                    string text; lock (L) text = _map!.TryGetValue(id, out var t) ? t : "";
                    string snippet = off >= 0 && len > 0 && off + len <= text.Length ? text.Substring(off, len) : "";
                    bool confirmed = words.Count > 0 && words.All(w => text.Contains(w, StringComparison.OrdinalIgnoreCase));   // rule 3
                    arr.Add(new JsonObject
                    {
                        ["contentId"] = id, ["snippet"] = snippet, ["text"] = text.Length > 2000 ? text[..2000] : text,
                        ["confirmed"] = confirmed, ["offset"] = off, ["length"] = len,
                    });
                }
                var r = R.Ok(req.Id); r["matches"] = arr;
                ctx.Log($"indexQuery matches={arr.Count}");
                return r;
            }
        }
        return R.Fail(req.Id, "Unknown index op");
    }

    private static List<(string id, int offset, int length)> Query(AppContentIndexer ix, string q, int top)
    {
        var list = new List<(string, int, int)>();
        var tq = ix.CreateTextQuery(q);
        foreach (var m in tq.GetNextMatches(top).OfType<AppManagedTextQueryMatch>())
            if (!list.Any(x => x.Item1 == m.ContentId)) list.Add((m.ContentId, (int)m.TextOffset, (int)m.TextLength));
        return list;
    }
}
