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

namespace LocalMindApp;

public sealed partial class MainWindow : Window
{
    private LanguageModel? _model;
    private readonly SpecEngine _engine;
    private readonly ChatEngine _chat;
    private readonly ImageEngine _images;
    private readonly SkillStore _skills;
    private readonly KvStore _kv;

    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hWnd);

    private static readonly string LogPath = Path.Combine(ApplicationData.Current.LocalFolder.Path, "bridge.log");

    private static void Log(string msg)
    {
        try { File.AppendAllText(LogPath, $"{DateTime.Now:HH:mm:ss.fff} {msg}\n"); } catch { }
    }

    public MainWindow()
    {
        InitializeComponent();
        Title = "LocalMind by Dyabi";
        try
        {
            // size the window in device-independent pixels so a 175% display doesn't squeeze the page into its compact layout
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            double scale = GetDpiForWindow(hwnd) / 96.0;
            AppWindow.Resize(new Windows.Graphics.SizeInt32((int)(1320 * scale), (int)(860 * scale)));
            var ico = Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico");
            if (File.Exists(ico)) AppWindow.SetIcon(ico);
        }
        catch (Exception ex) { Log("Window setup: " + ex.Message); }

        var local = ApplicationData.Current.LocalFolder.Path;
        _engine = new SpecEngine(Path.Combine(local, "library.json"), Log);
        _kv = new KvStore(Path.Combine(local, "data"));
        _chat = new ChatEngine(_engine, GetModelAsync, Log, PostToPage);
        _skills = new SkillStore(Path.Combine(local, "skills"), Log);
        _images = new ImageEngine(_chat, Path.Combine(local, "media"), Log);
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
            Web.CoreWebView2.SetVirtualHostNameToFolderMapping("localmind.local", www, CoreWebView2HostResourceAccessKind.Allow);
            // generated pictures and thumbnails are served to the page from their own host (read access to that one folder only)
            Web.CoreWebView2.SetVirtualHostNameToFolderMapping("media.localmind.local", _images.MediaDir, CoreWebView2HostResourceAccessKind.Allow);

            Web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            Web.CoreWebView2.NavigationCompleted += (s, e) => Log($"NavigationCompleted success={e.IsSuccess} status={e.WebErrorStatus}");
            Web.CoreWebView2.ProcessFailed += (s, e) => Log($"ProcessFailed kind={e.ProcessFailedKind} reason={e.Reason} exitCode={e.ExitCode}");
            // links and window.open never navigate the app window; the page asks the host to open http(s) links explicitly
            Web.CoreWebView2.NewWindowRequested += (s, e) => e.Handled = true;
            Web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            Web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            Web.CoreWebView2.Settings.IsZoomControlEnabled = true;

            Web.CoreWebView2.Navigate("https://localmind.local/index.html");
            Log("Navigate() called");
#if DEBUG
            _ = RunSelfTestAsync();
            _ = RunProbeAsync();
            _ = RunProbe2Async();
            _ = RunProbe3Async();
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

                // ── chat ──
                case "chat":
                    {
                        var cr = JsonSerializer.Deserialize(req.Data ?? "{}", BridgeJsonContext.Default.ChatRequest)!;
                        var result = await _chat.ChatAsync(cr);
                        resp = Ok(req.Id, JsonSerializer.Serialize(result, BridgeJsonContext.Default.ChatResult));
                        break;
                    }
                case "cancel": _chat.Cancel(req.Prompt ?? ""); resp = Ok(req.Id); break;
                case "image":
                    {
                        var ir = JsonSerializer.Deserialize(req.Data ?? "{}", BridgeJsonContext.Default.ImageRequest)!;
                        resp = Ok(req.Id, JsonSerializer.Serialize(await _images.RunAsync(ir), BridgeJsonContext.Default.ImageResult));
                        break;
                    }
                case "thumb":
                    {
                        var ext = Path.GetExtension(req.Prompt ?? "").ToLowerInvariant();
                        if (ext is not (".png" or ".jpg" or ".jpeg" or ".bmp" or ".gif" or ".webp" or ".tif" or ".tiff" or ".heic")) { resp = Fail(req.Id, "Not a picture."); break; }
                        resp = Ok(req.Id, await _images.ThumbAsync(req.Prompt!));
                        break;
                    }
                case "saveImageAs": resp = await SaveImageAsAsync(req.Id, req.Prompt ?? ""); break;
                case "openMedia": resp = OpenMedia(req.Id, req.Prompt ?? ""); break;
                case "saveBytes":
                    {
                        var picker = new Windows.Storage.Pickers.FileSavePicker { SuggestedFileName = Path.GetFileNameWithoutExtension(req.Prompt ?? "picture") };
                        picker.FileTypeChoices.Add("PNG picture", new List<string> { ".png" });
                        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
                        var f = await picker.PickSaveFileAsync();
                        if (f == null) { resp = Ok(req.Id, ""); break; }
                        await File.WriteAllBytesAsync(f.Path, Convert.FromBase64String(req.Data ?? ""));
                        resp = Ok(req.Id, f.Path);
                        break;
                    }
                case "skillsList": resp = Ok(req.Id, JsonSerializer.Serialize(_skills.List(), BridgeJsonContext.Default.ListSkillFileInfo)); break;
                case "skillSave": _skills.Save(req.Prompt ?? "", req.Data ?? ""); resp = Ok(req.Id); break;
                case "skillDelete": _skills.Delete(req.Prompt ?? ""); resp = Ok(req.Id); break;
                case "skillImportFolder":
                    {
                        var folder = await PickFolderAsync();
                        resp = folder == null ? Ok(req.Id, "") : Ok(req.Id, _skills.ImportFolder(folder).ToString());
                        break;
                    }
                case "skillImportFile":
                    {
                        var picker = new Windows.Storage.Pickers.FileOpenPicker();
                        picker.FileTypeFilter.Add(".md");
                        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
                        var f = await picker.PickSingleFileAsync();
                        resp = f == null ? Ok(req.Id, "") : Ok(req.Id, _skills.ImportFile(f.Path));
                        break;
                    }
                case "skillsFolder": Process.Start(new ProcessStartInfo("explorer.exe", $"\"{_skills.Root}\"") { UseShellExecute = true }); resp = Ok(req.Id); break;
                case "mediaInfo": resp = Ok(req.Id, _images.GeneratedBytes().ToString()); break;
                case "clearMedia": _images.ClearGenerated(); resp = Ok(req.Id); break;
                case "skill":
                    {
                        var sr = JsonSerializer.Deserialize(req.Data ?? "{}", BridgeJsonContext.Default.SkillRequest)!;
                        resp = Ok(req.Id, JsonSerializer.Serialize(await _chat.SkillAsync(sr), BridgeJsonContext.Default.SkillResult));
                        break;
                    }
                case "bg":
                    {
                        var sr = JsonSerializer.Deserialize(req.Data ?? "{}", BridgeJsonContext.Default.SkillRequest)!;
                        resp = Ok(req.Id, JsonSerializer.Serialize(await _chat.BackgroundAsync(sr), BridgeJsonContext.Default.SkillResult));
                        break;
                    }

                // ── page data ──
                case "kvGet": resp = Ok(req.Id, _kv.Get(req.Prompt ?? "") ?? ""); break;
                case "kvPut": _kv.Put(req.Prompt ?? "", req.Data ?? "null"); resp = Ok(req.Id); break;
                case "kvDelete": _kv.Delete(req.Prompt ?? ""); resp = Ok(req.Id); break;
                case "kvList": resp = Ok(req.Id, JsonSerializer.Serialize(_kv.List(req.Prompt ?? ""), BridgeJsonContext.Default.ListString)); break;
                case "kvGetAll": resp = Ok(req.Id, _kv.GetAll(req.Prompt ?? "")); break;

                // ── files / knowledge ──
                case "getLibrary":
                    resp = Ok(req.Id, JsonSerializer.Serialize(_engine.GetLibrary(), BridgeJsonContext.Default.LibraryInfo));
                    break;

                case "pickFolder":
                    {
                        var picked = await PickFolderAsync();
                        resp = Ok(req.Id, picked ?? "");
                        break;
                    }

                case "pickFiles":
                    {
                        var picker = new Windows.Storage.Pickers.FileOpenPicker();
                        picker.FileTypeFilter.Add("*");
                        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
                        var files = await picker.PickMultipleFilesAsync();
                        resp = Ok(req.Id, JsonSerializer.Serialize((files ?? (IReadOnlyList<StorageFile>)new List<StorageFile>()).Select(f => f.Path).ToList(), BridgeJsonContext.Default.ListString));
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
                        if (roots.Count == 0) { resp = Fail(req.Id, "No folder or file path was received."); break; }
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

                case "openPath": resp = OpenPath(req.Id, req.Prompt ?? "", req.N == 1); break;
                case "removeDoc": await Task.Run(() => _engine.RemoveDoc(req.Prompt ?? "")); resp = Ok(req.Id); break;
                case "clearLibrary": await Task.Run(() => _engine.ClearAll()); resp = Ok(req.Id); break;

                case "saveAttachment": resp = SaveAttachment(req.Id, req.Prompt ?? "png", req.Data ?? ""); break;

                // ── export / import / misc ──
                case "saveFile": resp = await SaveFileAsync(req.Id, req.Prompt ?? "export.txt", req.Data ?? ""); break;
                case "importFile": resp = await ImportFileAsync(req.Id); break;
                case "openUrl": resp = OpenUrl(req.Id, req.Prompt ?? ""); break;
                case "sysInfo": resp = Ok(req.Id, JsonSerializer.Serialize(BuildSysInfo(), BridgeJsonContext.Default.SystemInfo)); break;
                case "revealData": Process.Start(new ProcessStartInfo("explorer.exe", $"\"{ApplicationData.Current.LocalFolder.Path}\"") { UseShellExecute = true }); resp = Ok(req.Id); break;

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

    private async Task<BridgeResponse> SaveFileAsync(string id, string suggestedName, string content)
    {
        var ext = Path.GetExtension(suggestedName);
        if (string.IsNullOrEmpty(ext)) ext = ".txt";
        var picker = new Windows.Storage.Pickers.FileSavePicker { SuggestedFileName = Path.GetFileNameWithoutExtension(suggestedName) };
        picker.FileTypeChoices.Add(ext.TrimStart('.').ToUpperInvariant() + " file", new List<string> { ext });
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSaveFileAsync();
        if (file == null) return Ok(id, "");
        await File.WriteAllTextAsync(file.Path, content, new System.Text.UTF8Encoding(false));
        return Ok(id, file.Path);
    }

    // only files inside the media folder can be saved elsewhere or opened
    private string? MediaPath(string rel)
    {
        var full = Path.GetFullPath(Path.Combine(_images.MediaDir, rel.Replace('/', Path.DirectorySeparatorChar)));
        return full.StartsWith(Path.GetFullPath(_images.MediaDir) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && File.Exists(full) ? full : null;
    }

    private async Task<BridgeResponse> SaveImageAsAsync(string id, string rel)
    {
        var src = MediaPath(rel);
        if (src == null) return Fail(id, "That picture is no longer available.");
        var picker = new Windows.Storage.Pickers.FileSavePicker { SuggestedFileName = Path.GetFileNameWithoutExtension(src) };
        picker.FileTypeChoices.Add("PNG picture", new List<string> { ".png" });
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSaveFileAsync();
        if (file == null) return Ok(id, "");
        File.Copy(src, file.Path, true);
        return Ok(id, file.Path);
    }

    private BridgeResponse OpenMedia(string id, string rel)
    {
        var src = MediaPath(rel);
        if (src == null) return Fail(id, "That picture is no longer available.");
        Process.Start(new ProcessStartInfo(src) { UseShellExecute = true });
        return Ok(id);
    }

    private async Task<BridgeResponse> ImportFileAsync(string id)
    {
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        picker.FileTypeFilter.Add(".json");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSingleFileAsync();
        if (file == null) return Ok(id, "");
        var fi = new FileInfo(file.Path);
        if (fi.Length > 200L * 1024 * 1024) return Fail(id, "That file is too large to import.");
        return Ok(id, await File.ReadAllTextAsync(file.Path));
    }

    // Pasted or dropped images arrive as base64; they become files so the same OCR / description / indexing pipeline handles them.
    private BridgeResponse SaveAttachment(string id, string ext, string base64)
    {
        ext = new string(ext.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
        if (ext is not ("png" or "jpg" or "jpeg" or "gif" or "bmp" or "webp" or "txt")) return Fail(id, "Unsupported attachment type.");
        var dir = Path.Combine(ApplicationData.Current.LocalFolder.Path, "attachments");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, $"pasted-{DateTime.Now:yyyyMMdd-HHmmss}-{Guid.NewGuid().ToString("N")[..6]}.{ext}");
        File.WriteAllBytes(path, Convert.FromBase64String(base64));
        return Ok(id, path);
    }

    private BridgeResponse OpenUrl(string id, string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps)) return Fail(id, "Only http(s) links can be opened.");
        Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
        return Ok(id);
    }

    // Only files the library already knows about can be opened — the page can't ask us to launch arbitrary paths.
    private BridgeResponse OpenPath(string id, string path, bool reveal)
    {
        if (!_engine.HasDoc(path) || !File.Exists(path)) return Fail(id, "That file is no longer available.");
        if (reveal) Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
        else Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        return Ok(id);
    }

    private SystemInfo BuildSysInfo()
    {
        string Safe(Func<AIFeatureReadyState> f) { try { return f().ToString(); } catch (Exception ex) { return "error: " + ex.Message; } }
        var folder = ApplicationData.Current.LocalFolder.Path;
        long size = 0;
        try { size = new DirectoryInfo(folder).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length); } catch { }
        return new SystemInfo
        {
            Model = Safe(LanguageModel.GetReadyState),
            Ocr = Safe(Microsoft.Windows.AI.Imaging.TextRecognizer.GetReadyState),
            Describe = Safe(Microsoft.Windows.AI.Imaging.ImageDescriptionGenerator.GetReadyState),
            ImageGen = Safe(Microsoft.Windows.AI.Imaging.ImageGenerator.GetReadyState),
            Scaler = Safe(Microsoft.Windows.AI.Imaging.ImageScaler.GetReadyState),
            Cutout = Safe(Microsoft.Windows.AI.Imaging.ImageForegroundExtractor.GetReadyState),
            DataFolder = folder,
            DataBytes = size,
            Version = Windows.ApplicationModel.Package.Current.Id.Version is var v ? $"{v.Major}.{v.Minor}.{v.Build}.{v.Revision}" : "",
        };
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

    private readonly System.Threading.SemaphoreSlim _modelLock = new(1, 1);

    private async Task<(LanguageModel? model, string? error)> GetModelAsync()
    {
        try
        {
            await _modelLock.WaitAsync();
            try
            {
                if (_model != null) return (_model, null);
                if (LanguageModel.GetReadyState() != AIFeatureReadyState.Ready)
                {
                    var ready = await HandleEnsureReadyAsync("ready");
                    if (!ready.Ok) return (null, ready.Error);
                }
                Log("Creating LanguageModel...");
                _model = await LanguageModel.CreateAsync();
                Log("LanguageModel created");
                return (_model, null);
            }
            finally { _modelLock.Release(); }
        }
        catch (Exception ex)
        {
            Log("GetModel EXCEPTION: " + ex.Message);
            return (null, ex.Message);
        }
    }
}
