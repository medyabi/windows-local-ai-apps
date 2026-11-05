import os
R = r'C:\Users\MohamedDYABI\HybridMindApp'

def patch(fname, pairs):
    p = os.path.join(R, fname)
    s = open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert old in s, (fname, old[:90])
        s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf-8').write(s)

# ── CloudEngine: a second instance serves the local agent (loopback only, no key, no redaction needed) ──
patch('CloudEngine.cs', [
    ('    public CloudEngine(SpecEngine docs, ChatEngine chat, string stateDir, string mediaDir, Action<string> log)\n    {',
     '    private readonly bool _localOnly;   // the "local agent" instance: loopback endpoints only, no API key\n\n    public CloudEngine(SpecEngine docs, ChatEngine chat, string stateDir, string mediaDir, Action<string> log, string name = "cloud")\n    {\n        _localOnly = name != "cloud";'),
    ('        _configPath = Path.Combine(stateDir, "cloud.json");\n        _secrets = new Secrets(Path.Combine(stateDir, "cloud.key"));',
     '        _configPath = Path.Combine(stateDir, name + ".json");\n        _secrets = new Secrets(Path.Combine(stateDir, name + ".key"));'),
    ('        if (ep.Length > 0) ValidateEndpoint(ep);\n',
     '        if (ep.Length > 0) ValidateEndpoint(ep);\n        if (_localOnly && ep.Length > 0 && !(Uri.TryCreate(ep, UriKind.Absolute, out var lu) && IsLocalHost(lu))) throw new ArgumentException("A local agent must use a localhost address (for example http://127.0.0.1:60084/v1). Use Settings > Cloud for remote services.");\n        if (_localOnly) c.Provider = "compatible";\n'),
    ('    public bool Configured => _cfg.Endpoint.Length > 0',
     '    public bool IsLocalOnly => _localOnly;\n    public bool Configured => _cfg.Endpoint.Length > 0'),
    # stream_options only for remote services (local servers may reject unknown fields and the usage numbers aren't needed)
    ('            var body = new JsonObject { ["messages"] = outMsgs, ["stream"] = true, ["stream_options"] = new JsonObject { ["include_usage"] = true } };',
     '            var body = new JsonObject { ["messages"] = outMsgs, ["stream"] = true };\n            if (!_localOnly) body["stream_options"] = new JsonObject { ["include_usage"] = true };'),
])

# helper methods appended before the image section marker
p = os.path.join(R, 'CloudEngine.cs')
s = open(p, encoding='utf-8').read()
marker = '    // ── cloud image generation (optional fallback when the on-device generator isn\'t available) ──'
assert marker in s
helpers = '''    // ── local servers: which models are available, and does tool calling work? ──
    public async Task<(List<string> models, string? error)> ListModelsAsync()
    {
        if (_cfg.Endpoint.Length == 0) return (new(), "Enter the server address first.");
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var rq = new HttpRequestMessage(HttpMethod.Get, _cfg.Endpoint + "/models");
            using var rp = await _http.SendAsync(rq, cts.Token);
            var text = await rp.Content.ReadAsStringAsync(cts.Token);
            if (!rp.IsSuccessStatusCode) return (new(), $"The server answered HTTP {(int)rp.StatusCode} for {_cfg.Endpoint}/models.");
            var arr = JsonNode.Parse(text)?["data"]?.AsArray();
            var ids = arr == null ? new List<string>() : arr.Select(n => n?["id"]?.ToString() ?? "").Where(x => x.Length > 0).ToList();
            return (ids, null);
        }
        catch (Exception ex) { return (new(), "Couldn’t reach the server: " + ex.Message); }
    }

    public async Task<CloudTestResult> ToolProbeAsync()
    {
        var r = new CloudTestResult { Model = _cfg.Model };
        if (!Configured) { r.Error = "Pick a model first."; r.ErrorKind = "config"; return r; }
        var sw = Stopwatch.StartNew();
        try
        {
            var calc = new JsonObject { ["type"] = "function", ["function"] = new JsonObject { ["name"] = "calculate", ["description"] = "Evaluate an arithmetic expression exactly.", ["parameters"] = new JsonObject { ["type"] = "object", ["properties"] = new JsonObject { ["expression"] = new JsonObject { ["type"] = "string", ["description"] = "e.g. 2+2" } }, ["required"] = new JsonArray("expression") } } };
            var body = new JsonObject
            {
                ["messages"] = new JsonArray(new JsonObject { ["role"] = "system", ["content"] = "You are an agent. Always use a tool when one fits." }, new JsonObject { ["role"] = "user", ["content"] = "What is 17 times 23? Use the calculate tool." }),
                ["tools"] = new JsonArray(calc),
            };
            AddLimit(body, Math.Min(_cfg.MaxTokens, 400));
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(180));
            using var resp = await PostAsync("chat/completions", _cfg.Model, body, HttpCompletionOption.ResponseContentRead, cts.Token);
            var text = await resp.Content.ReadAsStringAsync(cts.Token);
            r.Ms = sw.ElapsedMilliseconds;
            if (!resp.IsSuccessStatusCode)
            {
                r.ErrorKind = "http";
                r.Error = text.Contains("not loaded", StringComparison.OrdinalIgnoreCase) ? "The model isn’t loaded in the server yet. For Foundry Local run, in your own terminal:  foundry model load <model alias>" : $"The server answered HTTP {(int)resp.StatusCode}: {ApiMessage(text)}";
                return r;
            }
            var msg = JsonNode.Parse(text)?["choices"]?.AsArray().FirstOrDefault()?["message"];
            var tc = msg?["tool_calls"]?.AsArray();
            if (tc != null && tc.Count > 0 && tc[0]?["function"]?["name"]?.ToString() == "calculate") { r.Ok = true; return r; }
            r.ErrorKind = "tools";
            r.Error = "The model answered in plain text instead of calling the tool — it (or this server build) doesn’t support tool calling reliably. Try another model, ideally one marked “Tools” in `foundry model list`.";
        }
        catch (Exception ex) { r.Ms = sw.ElapsedMilliseconds; r.ErrorKind = "unreachable"; r.Error = "Couldn’t reach the server: " + ex.Message; }
        return r;
    }

'''
s = s.replace(marker, helpers + marker, 1)
open(p, 'w', encoding='utf-8').write(s)

# ── AgentEngine: compact mode for small-context models ──
patch('AgentEngine.cs', [
    ('    [JsonPropertyName("privacy")] public string Privacy { get; set; } = "redact";  // redact | block\n}',
     '    [JsonPropertyName("privacy")] public string Privacy { get; set; } = "redact";  // redact | block\n    [JsonPropertyName("compact")] public bool Compact { get; set; }              // small-context (local) models: shorter tool results\n}'),
    ('        public Redactor Redactor = new();\n        public string Privacy = "redact";',
     '        public Redactor Redactor = new();\n        public int MaxChars = 14000;\n        public string Privacy = "redact";'),
    ('        var s = new Session { Privacy = req.Privacy == "block" ? "block" : "redact" };',
     '        var s = new Session { Privacy = req.Privacy == "block" ? "block" : "redact", MaxChars = req.Compact ? 3000 : MaxToolChars };'),
    ('            if (r.Result.Length > MaxToolChars + 200) r.Result = r.Result.Substring(0, MaxToolChars) + "…[truncated]";',
     '            if (r.Result.Length > s.MaxChars + 200) r.Result = r.Result.Substring(0, s.MaxChars) + "…[truncated]";'),
    ('        maxChars = Math.Clamp(maxChars, 500, MaxToolChars);', '        maxChars = Math.Clamp(maxChars, 500, s.MaxChars);'),
])
# AgentStepReq: which engine runs the step
patch('AgentEngine.cs', [
    ('    [JsonPropertyName("tools")] public bool Tools { get; set; } = true;\n}',
     '    [JsonPropertyName("tools")] public bool Tools { get; set; } = true;\n    [JsonPropertyName("profile")] public string Profile { get; set; } = "cloud";   // cloud | local\n}'),
])

# ── MainWindow: second engine + bridge ops ──
patch('MainWindow.xaml.cs', [
    ('    private readonly CloudEngine _cloud;\n', '    private readonly CloudEngine _cloud;\n    private readonly CloudEngine _localAgent;\n'),
    ('        _cloud = new CloudEngine(_engine, _chat, local, Path.Combine(local, "media"), Log);',
     '        _cloud = new CloudEngine(_engine, _chat, local, Path.Combine(local, "media"), Log);\n        _localAgent = new CloudEngine(_engine, _chat, local, Path.Combine(local, "media"), Log, "localagent");'),
    ('                        resp = rd == null ? Fail(req.Id, "The agent session has ended.") : Ok(req.Id, JsonSerializer.Serialize(await _cloud.AgentStepAsync(st, rd, req.N != 0), BridgeJsonContext.Default.AgentStepResult));',
     '                        var engine = st.Profile == "local" ? _localAgent : _cloud;\n                        resp = rd == null ? Fail(req.Id, "The agent session has ended.") : Ok(req.Id, JsonSerializer.Serialize(await engine.AgentStepAsync(st, rd, req.N != 0), BridgeJsonContext.Default.AgentStepResult));'),
    ('                case "cloudConfigGet":',
     '''                // ── local agent (a local OpenAI-compatible server such as Foundry Local; loopback only) ──
                case "localAgentGet": resp = Ok(req.Id, JsonSerializer.Serialize(_localAgent.GetConfig(), BridgeJsonContext.Default.CloudConfigDto)); break;
                case "localAgentSet":
                    {
                        var lc = JsonSerializer.Deserialize(req.Data ?? "{}", BridgeJsonContext.Default.CloudConfigDto)!;
                        await _localAgent.SetConfigAsync(lc);
                        resp = Ok(req.Id, JsonSerializer.Serialize(_localAgent.GetConfig(), BridgeJsonContext.Default.CloudConfigDto));
                        break;
                    }
                case "localAgentModels":
                    {
                        var (ids, err) = await _localAgent.ListModelsAsync();
                        resp = Ok(req.Id, JsonSerializer.Serialize(new { models = ids, error = err }));
                        break;
                    }
                case "localAgentTest": resp = Ok(req.Id, JsonSerializer.Serialize(await _localAgent.ToolProbeAsync(), BridgeJsonContext.Default.CloudTestResult)); break;
                case "cloudConfigGet":'''),
])
print('patched')
