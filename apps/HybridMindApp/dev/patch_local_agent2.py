import os
R = r'C:\Users\MohamedDYABI\HybridMindApp'

def patch(path, pairs):
    p = os.path.join(R, path)
    s = open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert old in s, (path, old[:90])
        s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf-8').write(s)

# ── C#: compact tool list for small models ──
patch('AgentEngine.cs', [
    ('    [JsonPropertyName("profile")] public string Profile { get; set; } = "cloud";   // cloud | local\n}',
     '    [JsonPropertyName("profile")] public string Profile { get; set; } = "cloud";   // cloud | local\n    [JsonPropertyName("compact")] public bool Compact { get; set; }               // small-context model: fewer, shorter tool descriptions\n}'),
    ('    public static JsonArray ToolSpecs()\n    {',
     '''    // Small local models do better with a short list: the five file tools with one-line descriptions.
    public static JsonArray ToolSpecs(bool compact)
    {
        var all = ToolSpecs();
        if (!compact) return all;
        var keep = new Dictionary<string, string>
        {
            ["search_files"] = "Search the user's indexed files. Returns passages with file path.",
            ["list_folder"] = "List a folder (empty path = the allowed folders).",
            ["find_files"] = "Find files by name pattern like *.pdf.",
            ["read_file"] = "Read a file's text (use offset to continue).",
            ["write_file"] = "Create a text file in the working folder (user approves).",
        };
        var res = new JsonArray();
        foreach (var t in all)
        {
            var name = t!["function"]!["name"]!.ToString();
            if (!keep.TryGetValue(name, out var d)) continue;
            var o = JsonNode.Parse(t.ToJsonString())!.AsObject();
            o["function"]!["description"] = d;
            // drop the long per-parameter descriptions too
            if (o["function"]!["parameters"]!["properties"] is JsonObject props) foreach (var kv in props.ToList()) if (kv.Value is JsonObject po) po.Remove("description");
            res.Add(o);
        }
        return res;
    }

    public static JsonArray ToolSpecs()
    {'''),
])
patch('CloudEngine.cs', [
    ('            if (req.Tools) body["tools"] = AgentEngine.ToolSpecs();', '            if (req.Tools) body["tools"] = AgentEngine.ToolSpecs(req.Compact);'),
])

# ── JS: bridge ──
patch('www/js/bridge.js', [
    ("    // agent (tools run in the host)",
     """    // local agent (a local OpenAI-compatible server such as Foundry Local)
    localAgentGet: () => call('localAgentGet').then(json),
    localAgentSet: (cfg) => call('localAgentSet', { data: JSON.stringify(cfg) }).then(json),
    localAgentModels: () => call('localAgentModels').then(json),
    localAgentTest: () => call('localAgentTest').then(json),

    // agent (tools run in the host)"""),
])
print('patched')
