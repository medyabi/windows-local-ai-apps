import os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'SelfTest.cs')
t = open(p, encoding='utf-8').read()
marker = '            if (root.TryGetProperty("ui", out var uiEl))'
add = r'''            if (root.TryGetProperty("cloud", out var clEl))
                foreach (var cl in clEl.EnumerateArray())
                {
                    var op = cl.GetProperty("op").GetString();
                    if (op == "config")
                    {
                        var cfg = JsonSerializer.Deserialize(cl.GetProperty("cfg").GetRawText(), BridgeJsonContext.Default.CloudConfigDto)!;
                        try { await _cloud.SetConfigAsync(cfg); Log("SELFTEST CLOUD config ok: " + JsonSerializer.Serialize(_cloud.GetConfig(), BridgeJsonContext.Default.CloudConfigDto)); }
                        catch (Exception ex) { Log("SELFTEST CLOUD config rejected: " + ex.Message); }
                    }
                    else if (op == "test") Log("SELFTEST CLOUD test: " + JsonSerializer.Serialize(await _cloud.TestAsync(), BridgeJsonContext.Default.CloudTestResult));
                    else if (op == "chat")
                    {
                        var creq = new ChatRequest { Rid = "cl" + Guid.NewGuid().ToString("N")[..4], System = cl.TryGetProperty("system", out var sy) ? sy.GetString()! : "You are a helpful assistant.", User = cl.GetProperty("user").GetString()! };
                        if (cl.TryGetProperty("history", out var hh)) creq.History = hh.EnumerateArray().Select(e => new ChatMsg { Role = e.GetProperty("role").GetString()!, Content = e.GetProperty("content").GetString()! }).ToList();
                        if (cl.TryGetProperty("scope", out var scp) && scp.ValueKind == JsonValueKind.True) creq.Scope = scope;
                        if (cl.TryGetProperty("inline", out var inl2)) creq.InlineDocs = inl2.EnumerateArray().Select(e => e.GetString()!).ToList();
                        if (cl.TryGetProperty("images", out var ims)) creq.Images = ims.EnumerateArray().Select(e => e.GetString()!).ToList();
                        var prep = await _cloud.PrepareAsync(creq);
                        Log($"SELFTEST CLOUD prep ok={prep.Ok} err={prep.Error} chars={prep.Chars} findings=[{string.Join(", ", prep.Findings.Select(f => f.Kind + "x" + f.Count + ":" + string.Join("/", f.Samples)))}] sources={prep.Sources.Count(h => h.SentToModel)} inline=[{string.Join(",", prep.InlineDocs)}] msgs={prep.Messages.Count}");
                        if (!prep.Ok) continue;
                        bool redact = !cl.TryGetProperty("redact", out var rd) || rd.GetBoolean();
                        var r = await _cloud.ChatAsync(new CloudChoice { PrepId = prep.PrepId, Rid = creq.Rid, Redacted = redact });
                        Log($"SELFTEST CLOUD chat redact={redact}: ok={r.Ok} kind={r.ErrorKind} err={r.Error} sentChars={r.SentChars} redactions={r.Redactions} tokens={r.TokensIn}/{r.TokensOut} text=[{r.Text.Replace('\n', ' ')}]");
                    }
                    else if (op == "image")
                    {
                        var r = await _cloud.ImageAsync(new ImageRequest { Rid = "ci" + Guid.NewGuid().ToString("N")[..4], Prompt = cl.GetProperty("prompt").GetString()! });
                        Log($"SELFTEST CLOUD image: ok={r.Ok} err={r.Error} path={r.Path}");
                    }
                }

'''
assert marker in t
if 'SELFTEST CLOUD' not in t:
    t = t.replace(marker, add + marker, 1)
    open(p, 'w', encoding='utf-8').write(t)
print('patched')
