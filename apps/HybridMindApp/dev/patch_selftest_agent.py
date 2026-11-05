import os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'SelfTest.cs')
t = open(p, encoding='utf-8').read()
if 'SELFTEST AGENT' not in t:
    m1 = '            if (root.TryGetProperty("cloud", out var clEl))'
    a1 = r'''            if (root.TryGetProperty("agent", out var agEl))
            {
                foreach (var rp in agEl.GetProperty("roots").EnumerateArray()) _agent.AddRoot(rp.GetString()!);
                if (agEl.TryGetProperty("workspace", out var wsEl)) _agent.SetWorkspace(wsEl.GetString()!);
                Log("SELFTEST AGENT config: " + JsonSerializer.Serialize(_agent.GetConfig(), BridgeJsonContext.Default.AgentConfigDto));
            }
'''
    assert m1 in t
    t = t.replace(m1, a1 + m1, 1)
    m2 = '            if (root.TryGetProperty("shots", out var shEl))'
    a2 = r'''            if (root.TryGetProperty("files", out var flEl))
                foreach (var fp in flEl.EnumerateArray().Select(e => e.GetString()!))
                    Log("SELFTEST AGENT file " + fp + " exists=" + File.Exists(fp) + (File.Exists(fp) ? " content=[" + File.ReadAllText(fp).Replace('\n', ' ') + "]" : ""));
'''
    assert m2 in t
    t = t.replace(m2, a2 + m2, 1)
    open(p, 'w', encoding='utf-8').write(t)
print('selftest patched')
