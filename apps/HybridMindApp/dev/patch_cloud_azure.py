import re, os
p = r'C:\Users\MohamedDYABI\HybridMindApp\CloudEngine.cs'
s = open(p, encoding='utf-8').read()

def sub(old, new, count=1):
    global s
    assert old in s, old[:80]
    s = s.replace(old, new, count)

# 1. config: no default api-version (empty = Azure v1 API); normalise Azure endpoints; reset learned style
sub('''ApiVersion = string.IsNullOrWhiteSpace(c.ApiVersion) ? "2024-10-21" : c.ApiVersion.Trim(),''', '''ApiVersion = (c.ApiVersion ?? "").Trim(),''')
sub('''        var ep = (c.Endpoint ?? "").Trim();
        if (ep.Length > 0) ValidateEndpoint(ep);''', '''        var ep = (c.Endpoint ?? "").Trim();
        if (ep.Length > 0) ValidateEndpoint(ep);
        // Azure: people paste the Foundry "Project endpoint" (.../api/projects/<name>) or a full OpenAI URL; the chat API lives on the resource itself
        if (c.Provider == "azure" && Uri.TryCreate(ep, UriKind.Absolute, out var azUri)) ep = azUri.GetLeftPart(UriPartial.Authority);
        _azureLegacy = null;''')

# 2. replace ChatUrl with the Azure-aware sender
a = s.index('    private string ChatUrl()')
b = s.index('    private async Task<HttpRequestMessage> BuildRequestAsync')
send = '''    // Azure OpenAI has two API styles: the v1 API (/openai/v1/..., no api-version) and the older per-deployment route with an api-version query.
    // An empty API-version field means v1. If Azure rejects the configured style (unsupported api-version, or no v1 route) the other style is
    // tried once and remembered for this session.
    private bool? _azureLegacy;
    private bool ConfiguredLegacy => !string.IsNullOrWhiteSpace(_cfg.ApiVersion) && !_cfg.ApiVersion.Equals("v1", StringComparison.OrdinalIgnoreCase);

    private string UrlFor(string op, string deployment, bool legacy) => legacy
        ? $"{_cfg.Endpoint}/openai/deployments/{Uri.EscapeDataString(deployment)}/{op}?api-version={Uri.EscapeDataString(ConfiguredLegacy ? _cfg.ApiVersion : "2024-10-21")}"
        : $"{_cfg.Endpoint}/openai/v1/{op}";

    private async Task<HttpResponseMessage> PostAsync(string op, string deployment, JsonObject body, HttpCompletionOption opt, CancellationToken ct)
    {
        body["model"] = deployment;   // required by v1 and generic servers; the legacy Azure route ignores it
        async Task<HttpResponseMessage> Send(string url) { var rq = await BuildRequestAsync(url, body); return await _http.SendAsync(rq, opt, ct); }
        if (_cfg.Provider != "azure") return await Send($"{_cfg.Endpoint}/{op}");

        bool legacy = _azureLegacy ?? ConfiguredLegacy;
        var resp = await Send(UrlFor(op, deployment, legacy));
        if (resp.IsSuccessStatusCode) return resp;
        var text = await resp.Content.ReadAsStringAsync(ct);
        int code = (int)resp.StatusCode;
        bool badVersion = legacy && code == 400 && Regex.IsMatch(text, "api.?version", RegexOptions.IgnoreCase);
        bool noV1 = !legacy && code == 404;
        if (badVersion || noV1)
        {
            _log($"Azure {(legacy ? "legacy" : "v1")} route failed (HTTP {code}); trying the {(legacy ? "v1" : "legacy")} route");
            var second = await Send(UrlFor(op, deployment, !legacy));
            if (second.IsSuccessStatusCode) { _azureLegacy = !legacy; resp.Dispose(); return second; }
            second.Dispose();
        }
        var again = new HttpResponseMessage(resp.StatusCode) { Content = new StringContent(text, Encoding.UTF8, "application/json") };
        resp.Dispose();
        return again;
    }

'''
s = s[:a] + send + s[b:]

# 3. test connection
sub('''            if (_cfg.Provider != "azure") body["model"] = _cfg.Model;
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            using var req = await BuildRequestAsync(ChatUrl(), body);
            using var resp = await _http.SendAsync(req, cts.Token);
            var text = await resp.Content.ReadAsStringAsync(cts.Token);
            r.Ms = sw.ElapsedMilliseconds;
            if (resp.IsSuccessStatusCode) { r.Ok = true; return r; }
            r.ErrorKind = KindFor((int)resp.StatusCode, text); r.Error = Explain(r.ErrorKind, (int)resp.StatusCode, text);''', '''            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            using var resp = await PostAsync("chat/completions", _cfg.Model, body, HttpCompletionOption.ResponseContentRead, cts.Token);
            var text = await resp.Content.ReadAsStringAsync(cts.Token);
            r.Ms = sw.ElapsedMilliseconds;
            if (resp.IsSuccessStatusCode) { r.Ok = true; return r; }
            r.ErrorKind = KindFor((int)resp.StatusCode, text); r.Error = Explain(r.ErrorKind, (int)resp.StatusCode, text);
            _log($"Cloud test failed: HTTP {(int)resp.StatusCode} kind={r.ErrorKind} apiCode={ApiCode(text)}");''')

# 4. chat call
sub('''            if (_cfg.Provider != "azure") body["model"] = _cfg.Model;
            if (p.Temperature.HasValue) body["temperature"] = p.Temperature.Value;''', '''            if (p.Temperature.HasValue) body["temperature"] = p.Temperature.Value;''')
sub('''            using var req = await BuildRequestAsync(ChatUrl(), body);
            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, headerCts.Token);
            if (!resp.IsSuccessStatusCode)
            {
                var errBody = await resp.Content.ReadAsStringAsync(cts.Token);
                res.ErrorKind = KindFor((int)resp.StatusCode, errBody); res.Error = Explain(res.ErrorKind, (int)resp.StatusCode, errBody);
                return res;''', '''            using var resp = await PostAsync("chat/completions", _cfg.Model, body, HttpCompletionOption.ResponseHeadersRead, headerCts.Token);
            if (!resp.IsSuccessStatusCode)
            {
                var errBody = await resp.Content.ReadAsStringAsync(cts.Token);
                res.ErrorKind = KindFor((int)resp.StatusCode, errBody); res.Error = Explain(res.ErrorKind, (int)resp.StatusCode, errBody);
                _log($"Cloud chat failed: HTTP {(int)resp.StatusCode} kind={res.ErrorKind} apiCode={ApiCode(errBody)}");
                return res;''')

# 5. reasoning models that spend the whole budget thinking
sub('''            else if (res.Text.Length == 0) res.Error = "The cloud model returned no text.";''', '''            else if (res.Text.Length == 0 && finish == "length") { res.ErrorKind = "context"; res.Error = $"The model used its whole output budget ({_cfg.MaxTokens} tokens) before writing an answer — reasoning models spend tokens thinking. Raise “Max output tokens” in Settings → Cloud (try 4000 or more)."; }
            else if (res.Text.Length == 0) res.Error = "The cloud model returned no text.";''')

# 6. images
sub('''            var url = _cfg.Provider == "azure"
                ? $"{_cfg.Endpoint}/openai/deployments/{Uri.EscapeDataString(_cfg.ImageModel)}/images/generations?api-version={Uri.EscapeDataString(_cfg.ApiVersion)}"
                : $"{_cfg.Endpoint}/images/generations";
''', '')
sub('''            if (_cfg.Provider != "azure") body["model"] = _cfg.ImageModel;
''', '')
sub('''            using var r = await BuildRequestAsync(url, body);
            using var resp = await _http.SendAsync(r, lim.Token);''', '''            using var resp = await PostAsync("images/generations", _cfg.ImageModel, body, HttpCompletionOption.ResponseContentRead, lim.Token);''')

# 7. error classification / messages / helper
sub('''        if (status == 404) return "config";''', '''        if (status == 404) return "config";
        if (status == 400 && Regex.IsMatch(body, "api.?version", RegexOptions.IgnoreCase)) return "config";''')
sub('''        "config" => "The cloud service couldn’t find that endpoint or model/deployment (HTTP 404). Check the endpoint, deployment name and API version in Settings → Cloud.",''', '''        "config" when status == 400 && Regex.IsMatch(body, "api.?version", RegexOptions.IgnoreCase) => "Azure says that API version isn’t supported. The date shown in the deployments table (for example 2026-03-05) is the MODEL version, not the API version. Leave “API version” empty to use the Azure v1 API, or try 2024-10-21.",
        "config" => "The cloud service couldn’t find that endpoint or model/deployment (HTTP " + status + "). Check the endpoint (the resource endpoint, not a full URL), the deployment name and the API version in Settings → Cloud.",''')
sub('''    private static string ApiMessage(string body)''', '''    private static string ApiCode(string body)
    {
        try { var n = JsonNode.Parse(body); var c = n?["error"]?["code"]?.ToString(); return string.IsNullOrEmpty(c) ? "-" : (c!.Length > 40 ? c.Substring(0, 40) : c); } catch { return "-"; }
    }

    private static string ApiMessage(string body)''')
sub('using System.Text.Json.Nodes;', 'using System.Text.Json.Nodes;\nusing System.Text.RegularExpressions;')
open(p, 'w', encoding='utf-8').write(s)

# DTO default api version -> empty
m = r'C:\Users\MohamedDYABI\HybridMindApp\ChatModels.cs'
t = open(m, encoding='utf-8').read()
t = t.replace('public string ApiVersion { get; set; } = "2024-10-21";', 'public string ApiVersion { get; set; } = "";').replace('public int MaxTokens { get; set; } = 1500;', 'public int MaxTokens { get; set; } = 3000;')
open(m, 'w', encoding='utf-8').write(t)
print('patched')
