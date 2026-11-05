#if DEBUG
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Windows.Storage;

namespace LocalMindApp;

// Debug-only end-to-end test. Drop LocalState\selftest.json next to the app and it runs at startup, logging to bridge.log:
//   { "system": "...", "index": ["C:\\files"], "turns": [ { "user": "...", "scope": true, "inline": ["C:\\files\\a.txt"] } ],
//     "bg": [ { "name": "memory", "text": "..." } ], "skills": [ { "name": "summarize", "text": "..." } ],
//     "ui": [ "javascript to run in the page, returns when window.__t.done" ] }
public sealed partial class MainWindow
{
    private async Task RunSelfTestAsync()
    {
        var cfgPath = Path.Combine(ApplicationData.Current.LocalFolder.Path, "selftest.json");
        if (!File.Exists(cfgPath)) return;
        try
        {
            await Task.Delay(2500);
            using var doc = JsonDocument.Parse(File.ReadAllText(cfgPath));
            var root = doc.RootElement;
            Log("SELFTEST start");
            var scope = new List<string>();
            if (root.TryGetProperty("index", out var ixEl))
            {
                var paths = ixEl.EnumerateArray().Select(e => e.GetString()!).ToList();
                var sum = await Task.Run(() => _engine.IndexPaths(paths, p => { }, root.TryGetProperty("describe", out var d) && d.GetBoolean()));
                scope = sum.Paths;
                foreach (var dd in _engine.GetLibrary().Docs) Log($"SELFTEST doc {dd.Name} status={dd.Status} chunks={dd.Chunks} note={dd.Note}");
                Log("SELFTEST indexed: " + JsonSerializer.Serialize(sum, BridgeJsonContext.Default.IndexSummary));
                for (int i = 0; i < 8; i++) { var st = await _engine.GetStatusAsync(); if (st.Idle) break; await Task.Delay(2500); }
            }
            var system = root.TryGetProperty("system", out var sEl) ? sEl.GetString()! : "You are LocalMind, a helpful assistant running on the user's PC. Be concise.";

            if (root.TryGetProperty("turns", out var turnsEl))
            {
                var history = new List<ChatMsg>();
                int n = 0;
                foreach (var t in turnsEl.EnumerateArray())
                {
                    var user = t.GetProperty("user").GetString()!;
                    var req = new ChatRequest { Rid = "st" + (++n), System = system, User = user, History = new List<ChatMsg>(history) };
                    if (t.TryGetProperty("system", out var sysEl)) req.System = sysEl.GetString()!;
                    if (t.TryGetProperty("scope", out var sc) && sc.ValueKind == JsonValueKind.True) req.Scope = scope;
                    if (t.TryGetProperty("inline", out var inl)) req.InlineDocs = inl.EnumerateArray().Select(e => e.GetString()!).ToList();
                    if (t.TryGetProperty("notes", out var nts)) req.Notes = nts.EnumerateArray().Select(e => e.GetString()!).ToList();
                    if (t.TryGetProperty("recall", out var rcl)) req.Recall = rcl.EnumerateArray().Select(e => e.GetString()!).ToList();
                    if (t.TryGetProperty("summary", out var sm)) req.Summary = sm.GetString();
                    if (t.TryGetProperty("fakeHistory", out var fh)) req.History = fh.EnumerateArray().Select(e => new ChatMsg { Role = e.GetProperty("role").GetString()!, Content = e.GetProperty("content").GetString()! }).ToList();
                    var r = await _chat.ChatAsync(req);
                    Log($"SELFTEST Q{n}: {user}");
                    Log($"SELFTEST A{n}: {r.Text.Replace('\n', ' ')}");
                    Log($"SELFTEST   ok={r.Ok} status={r.Status} err={r.Error} prompt={r.PromptChars}/{r.LimitChars} hist={r.HistoryUsed}+{r.HistoryDropped} sources={r.Sources.Count(h => h.SentToModel)} inline=[{string.Join(",", r.InlineDocs)}] first={r.FirstTokenMs}ms gen={r.GenMs}ms retr={r.RetrievalMs}ms");
                    foreach (var h in r.Sources.Where(h => h.SentToModel)) Log($"SELFTEST   src [{h.N}] {h.DocName} {h.Loc}");
                    history.Add(new ChatMsg { Role = "user", Content = user });
                    history.Add(new ChatMsg { Role = "assistant", Content = r.Text });
                }
            }

            if (root.TryGetProperty("bg", out var bgEl))
                foreach (var b in bgEl.EnumerateArray())
                {
                    var req = new SkillRequest { Name = b.GetProperty("name").GetString()!, Text = b.GetProperty("text").GetString()! };
                    if (b.TryGetProperty("existing", out var ex)) req.Existing = ex.EnumerateArray().Select(e => e.GetString()!).ToList();
                    if (b.TryGetProperty("summary", out var sm)) req.Summary = sm.GetString();
                    var r = await _chat.BackgroundAsync(req);
                    Log($"SELFTEST BG {req.Name}: ok={r.Ok} ms={r.Ms} text=[{r.Text.Replace('\n', ' ')}] facts=[{string.Join(" ¦ ", r.Facts)}] err={r.Error}");
                }

            if (root.TryGetProperty("skills", out var skEl))
                foreach (var s in skEl.EnumerateArray())
                {
                    var req = new SkillRequest { Rid = "sk" + Guid.NewGuid().ToString("N")[..4], Name = s.GetProperty("name").GetString()!, Text = s.GetProperty("text").GetString()! };
                    if (s.TryGetProperty("tone", out var tn)) req.Tone = tn.GetString();
                    var r = await _chat.SkillAsync(req);
                    Log($"SELFTEST SKILL {req.Name}: ok={r.Ok} ms={r.Ms} trunc={r.Truncated} err={r.Error} text=[{r.Text.Replace('\n', '¶')}]");
                }

            if (root.TryGetProperty("images", out var imEl))
                foreach (var im in imEl.EnumerateArray())
                {
                    var req = new ImageRequest { Rid = "im" + Guid.NewGuid().ToString("N")[..4], Op = im.GetProperty("op").GetString()!, Prompt = im.TryGetProperty("prompt", out var pr) ? pr.GetString()! : "" };
                    if (im.TryGetProperty("source", out var so)) req.Source = so.GetString();
                    if (im.TryGetProperty("style", out var stl)) req.Style = stl.GetString();
                    var r = await _images.RunAsync(req);
                    Log($"SELFTEST IMAGE {req.Op}: ok={r.Ok} status={r.Status} {r.Width}x{r.Height} ms={r.Ms} path={r.Path} err={r.Error}");
                }

            if (root.TryGetProperty("ui", out var uiEl))
            {
                await Task.Delay(1500);
                int k = 0;
                foreach (var js in uiEl.EnumerateArray().Select(e => e.GetString()!))
                {
                    k++;
                    await Web.CoreWebView2.ExecuteScriptAsync("window.__t={done:false};(async()=>{try{" + js + "}catch(e){window.__t={done:true,error:String(e&&e.stack||e)}}})()");
                    for (int i = 0; i < 150; i++)
                    {
                        await Task.Delay(2000);
                        var r = await Web.CoreWebView2.ExecuteScriptAsync("window.__t&&window.__t.done?JSON.stringify(window.__t):'pending'");
                        if (r != "\"pending\"") { Log($"SELFTEST UI{k} => " + JsonSerializer.Deserialize<string>(r)); break; }
                    }
                }
            }
            if (root.TryGetProperty("shots", out var shEl))
            {
                var dir = Path.Combine(ApplicationData.Current.LocalFolder.Path, "shots");
                Directory.CreateDirectory(dir);
                foreach (var sh in shEl.EnumerateArray())
                {
                    var js = sh.GetProperty("js").GetString()!;
                    var file = sh.GetProperty("file").GetString()!;
                    await Web.CoreWebView2.ExecuteScriptAsync("window.__t={done:false};(async()=>{try{" + js + ";window.__t={done:true}}catch(e){window.__t={done:true,error:String(e&&e.stack||e)}}})()");
                    for (int i = 0; i < 60; i++)
                    {
                        await Task.Delay(500);
                        var r = await Web.CoreWebView2.ExecuteScriptAsync("window.__t&&window.__t.done?JSON.stringify(window.__t):'pending'");
                        if (r != "\"pending\"") { if (r.Contains("error")) Log("SELFTEST SHOT script error: " + r); break; }
                    }
                    await Task.Delay(700);
                    using var ms = new Windows.Storage.Streams.InMemoryRandomAccessStream();
                    await Web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, ms);
                    var bytes = new byte[ms.Size];
                    using (var rd = new Windows.Storage.Streams.DataReader(ms.GetInputStreamAt(0))) { await rd.LoadAsync((uint)ms.Size); rd.ReadBytes(bytes); }
                    await File.WriteAllBytesAsync(Path.Combine(dir, file), bytes);
                    Log("SELFTEST SHOT " + file + " " + bytes.Length + " bytes");
                }
            }
            File.Move(cfgPath, cfgPath + ".done", true);
            Log("SELFTEST complete");
        }
        catch (Exception ex) { Log("SELFTEST EXCEPTION: " + ex); }
    }
}
#endif
