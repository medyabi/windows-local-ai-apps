using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Text;
using Windows.Storage;

namespace LocalIQApp;

public sealed partial class MainWindow : Window
{
    private LanguageModel? _model;
    private readonly SpecEngine _engine;
    internal static float? Temperature = null;   // null = model default

    private static readonly string LogPath = Path.Combine(ApplicationData.Current.LocalFolder.Path, "bridge.log");

    private static void Log(string msg)
    {
        try { File.AppendAllText(LogPath, $"{DateTime.Now:HH:mm:ss.fff} {msg}\n"); } catch { }
    }

    public MainWindow()
    {
        InitializeComponent();
        Title = "LocalIQ by Dyabi";
        try
        {
            AppWindow.Resize(new Windows.Graphics.SizeInt32(1360, 880));
            var ico = Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico");
            if (File.Exists(ico)) AppWindow.SetIcon(ico);
        }
        catch (Exception ex) { Log("Window setup: " + ex.Message); }

        _engine = new SpecEngine(Path.Combine(ApplicationData.Current.LocalFolder.Path, "library.json"), Log);
        Log("=== MainWindow constructed ===");
        InitWebViewAsync();
    }

    private async void InitWebViewAsync()
    {
        try
        {
            await Web.EnsureCoreWebView2Async();
            Log("CoreWebView2 ready");

            var www = Path.Combine(AppContext.BaseDirectory, "www");
            Web.CoreWebView2.SetVirtualHostNameToFolderMapping("localiq.local", www, CoreWebView2HostResourceAccessKind.Allow);

            Web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            Web.CoreWebView2.NavigationCompleted += (s, e) => Log($"NavigationCompleted success={e.IsSuccess} status={e.WebErrorStatus}");
            Web.CoreWebView2.ProcessFailed += (s, e) => Log($"ProcessFailed kind={e.ProcessFailedKind} reason={e.Reason} exitCode={e.ExitCode}");

            Web.CoreWebView2.Navigate("https://localiq.local/index.html");
            Log("Navigate() called");
#if DEBUG
            _ = RunSelfTestAsync();
#endif
        }
        catch (Exception ex)
        {
            Log("InitWebViewAsync EXCEPTION: " + ex);
        }
    }

    private void PostToPage(string json)
    {
        DispatcherQueue.TryEnqueue(() => { try { Web.CoreWebView2.PostWebMessageAsJson(json); } catch (Exception ex) { Log("Post failed: " + ex.Message); } });
    }

    private static BridgeResponse Ok(string id, string? text = null) => new() { Id = id, Ok = true, Text = text };
    private static BridgeResponse Fail(string id, string msg) => new() { Id = id, Ok = false, Error = msg };

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        string json = args.WebMessageAsJson;
        Log("WebMessage IN: " + TrimForLog(json));

        var dropped = new List<string>();
        try
        {
            var extras = args.AdditionalObjects;
            if (extras != null) foreach (var o in extras) if (o is CoreWebView2File f) dropped.Add(f.Path);
        }
        catch (Exception ex) { Log("AdditionalObjects: " + ex.Message); }

        BridgeRequest? req;
        try { req = JsonSerializer.Deserialize(json, BridgeJsonContext.Default.BridgeRequest); }
        catch (Exception ex) { Log("Deserialize EXCEPTION: " + ex); return; }
        if (req is null) return;

        BridgeResponse resp;
        try
        {
            switch (req.Type)
            {
                case "ensureReady": resp = await HandleEnsureReadyAsync(req.Id); break;

                case "generate":
                    {
                        var g = await GenerateRawAsync(req.Prompt ?? "");
                        resp = string.IsNullOrEmpty(g.Text) ? Fail(req.Id, g.Error ?? ("Model returned no text (" + g.Status + ")")) : Ok(req.Id, g.Text);
                        break;
                    }

                case "getLibrary":
                    resp = Ok(req.Id, JsonSerializer.Serialize(_engine.GetLibrary(), BridgeJsonContext.Default.LibraryInfo));
                    break;

                case "pickFolder":
                    {
                        var picked = await PickFolderAsync();
                        resp = picked == null ? Ok(req.Id, "") : Ok(req.Id, picked);
                        break;
                    }

                case "indexPaths":
                case "dropPaths":
                    {
                        var roots = new List<string>(dropped);
                        if (!string.IsNullOrWhiteSpace(req.Prompt))
                        {
                            if (req.Prompt!.TrimStart().StartsWith("[")) roots.AddRange(JsonSerializer.Deserialize(req.Prompt, BridgeJsonContext.Default.ListString) ?? new());
                            else roots.Add(req.Prompt!);
                        }
                        if (roots.Count == 0) { resp = Fail(req.Id, "No folder or file path was received. Type a folder path or use Browse."); break; }
                        var sum = await Task.Run(() => _engine.IndexPaths(roots, p => PostToPage(JsonSerializer.Serialize(p, BridgeJsonContext.Default.ProgressEvent)), req.N == 1));
                        resp = Ok(req.Id, JsonSerializer.Serialize(sum, BridgeJsonContext.Default.IndexSummary));
                        break;
                    }

                case "indexStatus":
                    resp = Ok(req.Id, JsonSerializer.Serialize(await _engine.GetStatusAsync(), BridgeJsonContext.Default.IndexStatus));
                    break;

                case "search":
                    {
                        var sr = await Task.Run(() => _engine.Search(req.Prompt ?? "", req.Data, req.N ?? 8, req.Hist));
                        resp = Ok(req.Id, JsonSerializer.Serialize(sr, BridgeJsonContext.Default.SearchResult));
                        break;
                    }

                case "ask":
                    {
                        var ar = await _engine.AskAsync(req.Prompt ?? "", req.Data, req.Hist, GenerateRawAsync);
                        resp = Ok(req.Id, JsonSerializer.Serialize(ar, BridgeJsonContext.Default.AskResult));
                        break;
                    }

                case "openPath":
                    resp = OpenPath(req.Id, req.Prompt ?? "", req.N == 1);
                    break;

                case "removeDoc":
                    await Task.Run(() => _engine.RemoveDoc(req.Prompt ?? ""));
                    resp = Ok(req.Id);
                    break;

                case "clearLibrary":
                    await Task.Run(() => _engine.ClearAll());
                    resp = Ok(req.Id);
                    break;

                default: resp = Fail(req.Id, "Unknown bridge request type: " + req.Type); break;
            }
        }
        catch (Exception ex)
        {
            Log("Handler EXCEPTION: " + ex);
            resp = Fail(req.Id, ex.Message);
        }

        string outJson = JsonSerializer.Serialize(resp, BridgeJsonContext.Default.BridgeResponse);
        Log("WebMessage OUT: " + TrimForLog(outJson));
        Web.CoreWebView2.PostWebMessageAsJson(outJson);
    }

    private static string TrimForLog(string s) => s.Length > 400 ? s.Substring(0, 400) + "...(" + s.Length + " chars)" : s;

    private async Task<string?> PickFolderAsync()
    {
        var picker = new Windows.Storage.Pickers.FolderPicker();
        picker.FileTypeFilter.Add("*");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var folder = await picker.PickSingleFolderAsync();
        return folder?.Path;
    }

    // Only files the library already knows about can be opened — the page can't ask us to launch arbitrary paths.
    private BridgeResponse OpenPath(string id, string path, bool reveal)
    {
        if (!_engine.HasDoc(path) || !File.Exists(path)) return Fail(id, "That file is no longer available.");
        if (reveal) Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
        else Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        return Ok(id);
    }

    // ── on-device model ────────────────────────────────────────────────────
    private async Task<BridgeResponse> HandleEnsureReadyAsync(string id)
    {
        var resp = new BridgeResponse { Id = id };
        var readyState = LanguageModel.GetReadyState();
        Log("GetReadyState = " + readyState);

        if (readyState == AIFeatureReadyState.NotReady)
        {
            Log("Calling EnsureReadyAsync...");
            var ensureResult = await LanguageModel.EnsureReadyAsync();
            Log("EnsureReadyAsync.Status = " + ensureResult.Status);
            if (ensureResult.Status != AIFeatureReadyResultState.Success)
            {
                resp.Ok = false; resp.State = readyState.ToString();
                resp.Error = "Model download/setup failed: " + ensureResult.Status;
                return resp;
            }
            readyState = LanguageModel.GetReadyState();
        }

        resp.State = readyState.ToString();
        resp.Ok = readyState == AIFeatureReadyState.Ready;
        if (!resp.Ok)
        {
            resp.Error = readyState switch
            {
                AIFeatureReadyState.DisabledByUser => "The on-device AI model is disabled. Enable it in Settings > System > AI components.",
                AIFeatureReadyState.NotSupportedOnCurrentSystem => "This PC's hardware doesn't support the on-device language model (a Copilot+ PC is required).",
                _ => "Model not ready: " + readyState,
            };
        }
        return resp;
    }

    private async Task<GenResult> GenerateRawAsync(string prompt)
    {
        try
        {
            if (LanguageModel.GetReadyState() != AIFeatureReadyState.Ready)
            {
                var ready = await HandleEnsureReadyAsync("ready");
                if (!ready.Ok) return new GenResult { Status = ready.State ?? "NotReady", Error = ready.Error };
            }
            if (_model is null)
            {
                Log("Creating LanguageModel...");
                _model = await LanguageModel.CreateAsync();
                Log("LanguageModel created");
            }
            Log("GenerateResponseAsync prompt len=" + prompt.Length);
            var result = Temperature.HasValue
                ? await _model.GenerateResponseAsync(prompt, new LanguageModelOptions { Temperature = Temperature.Value })
                : await _model.GenerateResponseAsync(prompt);
            Log("GenerateResponseAsync result len=" + (result.Text?.Length ?? 0) + " status=" + result.Status);
            return new GenResult { Text = result.Text ?? "", Status = result.Status.ToString() };
        }
        catch (Exception ex)
        {
            Log("Generate EXCEPTION: " + ex.Message);
            return new GenResult { Status = "Exception", Error = ex.Message };
        }
    }

#if DEBUG
    // Debug-only: drop a selftest.json ({"paths":[...],"questions":[...]}) into the app's LocalState folder and the
    // whole pipeline (index → hybrid retrieval → on-device answer → number check) runs at startup, logging to bridge.log.
    private async Task RunSelfTestAsync()
    {
        var cfgPath = Path.Combine(ApplicationData.Current.LocalFolder.Path, "selftest.json");
        if (!File.Exists(cfgPath)) return;
        try
        {
            await Task.Delay(2500);
            using var doc = JsonDocument.Parse(File.ReadAllText(cfgPath));
            var paths = doc.RootElement.GetProperty("paths").EnumerateArray().Select(e => e.GetString()!).ToList();
            var qs = doc.RootElement.GetProperty("questions").EnumerateArray().Select(e => e.GetString()!).ToList();
            Log("SELFTEST start: paths=" + string.Join(";", paths));
            var sum = await Task.Run(() => _engine.IndexPaths(paths, p => { if (p.Current % 5 == 0 || p.Current == p.Total) Log($"SELFTEST progress {p.Stage} {p.Current}/{p.Total} {p.File}"); }, doc.RootElement.TryGetProperty("describe", out var dEl) && dEl.GetBoolean()));
            Log("SELFTEST index summary: " + JsonSerializer.Serialize(sum, BridgeJsonContext.Default.IndexSummary));
            for (int i = 0; i < 6; i++)
            {
                var st = await _engine.GetStatusAsync();
                Log("SELFTEST status: " + JsonSerializer.Serialize(st, BridgeJsonContext.Default.IndexStatus));
                if (st.Idle) break;
                await Task.Delay(3000);
            }
            if (doc.RootElement.TryGetProperty("temperature", out var tEl)) { Temperature = (float)tEl.GetDouble(); Log("SELFTEST temperature=" + Temperature); }
            var styles = doc.RootElement.TryGetProperty("styles", out var stEl) ? stEl.EnumerateArray().Select(e => e.GetInt32()).ToList() : new List<int> { SpecEngine.PromptStyle };
            string? prev = null;
            foreach (var q in qs)
            {
                foreach (var style in styles)
                {
                    var ar = await _engine.AskAsync(q, null, prev, GenerateRawAsync, style);
                    Log($"SELFTEST Q: {q}  [style {style}]");
                    Log($"SELFTEST A: {ar.Answer.Replace('\n', ' ')}");
                    Log($"SELFTEST   sources: " + string.Join(" | ", ar.Hits.Select(h => $"[{h.N}{(h.SentToModel ? "*" : "")}] {h.DocName} {h.Loc} idx={(h.ViaIndex ? 1 : 0)} kw={(h.ViaKeyword ? 1 : 0)} key={h.KeyLines.Count}")));
                    Log($"SELFTEST   numbers ok=[{string.Join(", ", ar.NumbersFound)}] missing=[{string.Join(", ", ar.NumbersMissing)}] notFound={ar.NotFound} autoCited={ar.AutoCited} retrieval={ar.RetrievalMs}ms gen={ar.GenerationMs}ms attempts={ar.Attempts} sent={ar.ExcerptsSent} err={ar.ModelError}");
                }
                prev = q;
            }
            if (doc.RootElement.TryGetProperty("uiPath", out var uiPathEl) && doc.RootElement.TryGetProperty("uiQuestions", out var uiQsEl))
            {
                await Task.Delay(2500);
                var uiPath = uiPathEl.GetString()!;
                foreach (var uq in uiQsEl.EnumerateArray().Select(e => e.GetString()!))
                {
                    var js = "(async()=>{window.__t={done:false};try{" +
                        "document.getElementById('pathInput').value=" + JsonSerializer.Serialize(uiPath) + ";document.getElementById('indexBtn').click();" +
                        "while(state.indexing)await new Promise(r=>setTimeout(r,200));" +
                        "await ask(" + JsonSerializer.Serialize(uq) + ");" +
                        "const m=[...document.querySelectorAll('.msg')].pop();" +
                        "window.__t={done:true,lib:document.getElementById('libTitle').textContent,rows:document.querySelectorAll('.doc').length,pill:document.getElementById('pillIndex').innerText,model:document.getElementById('pillModel').innerText," +
                        "head:m.querySelector('.a-head')?.innerText,body:m.querySelector('.a-body')?.innerText,cites:m.querySelectorAll('.a-body .cite').length," +
                        "verify:[...m.querySelectorAll('.vchip')].map(x=>x.innerText.slice(0,110)),srcs:m.querySelectorAll('.src').length,keys:m.querySelectorAll('.kline').length,meta:m.querySelector('.meta')?.innerText};" +
                        "}catch(e){window.__t={done:true,error:String(e)}}})()";
                    await Web.CoreWebView2.ExecuteScriptAsync(js);
                    for (int i = 0; i < 90; i++)
                    {
                        await Task.Delay(2000);
                        var r = await Web.CoreWebView2.ExecuteScriptAsync("window.__t&&window.__t.done?JSON.stringify(window.__t):'pending'");
                        if (r != "\"pending\"") { Log("SELFTEST UI " + uq + " => " + JsonSerializer.Deserialize<string>(r)); break; }
                    }
                }
            }
            File.Move(cfgPath, cfgPath + ".done", true);
            Log("SELFTEST complete");
        }
        catch (Exception ex) { Log("SELFTEST EXCEPTION: " + ex); }
    }
#endif
}
