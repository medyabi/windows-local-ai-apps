using System.Reflection;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Windows.Storage;

namespace AiApp;

// The whole native side of the app: one WebView2 plus the bridge dispatcher.
// Features live in Modules/*.cs (one IBridgeModule per Windows AI component); this file rarely changes.
public sealed partial class MainWindow : Window
{
    private const string VirtualHost = "__HOST__";

    private readonly Dictionary<string, IBridgeModule> _ops = new();
    private readonly List<IBridgeModule> _modules = new();
    private readonly string _local = ApplicationData.Current.LocalFolder.Path;
    private readonly string _logPath;
    private BridgeContext _ctx = null!;

    // bridge.log: operation names, sizes, statuses. NEVER prompts, documents, keys or model output.
    private void Log(string msg)
    {
        try { File.AppendAllText(_logPath, $"{DateTime.Now:HH:mm:ss.fff} {msg}\n"); } catch { }
    }

    public MainWindow()
    {
        InitializeComponent();
        _logPath = Path.Combine(_local, "bridge.log");
        Title = "__DISPLAYNAME__";
        try { AppWindow.Resize(new Windows.Graphics.SizeInt32(1360, 900)); } catch { }
        Log("=== MainWindow constructed ===");

        _ctx = new BridgeContext
        {
            LocalFolder = _local,
            Log = Log,
            Post = PostToPage,
            AppName = "__DISPLAYNAME__",
        };
        LoadModules();
        _ctx.Modules = _modules;
        InitWebViewAsync();
    }

    private void LoadModules()
    {
        foreach (var t in Assembly.GetExecutingAssembly().GetTypes())
        {
            if (!t.IsClass || t.IsAbstract || !typeof(IBridgeModule).IsAssignableFrom(t)) continue;
            if (t.GetConstructor(Type.EmptyTypes) is null) continue;
            var m = (IBridgeModule)Activator.CreateInstance(t)!;
            _modules.Add(m);
            foreach (var op in m.Ops) _ops[op] = m;
        }
        Log("Modules: " + string.Join(", ", _modules.Select(m => m.Name)));
    }

    private async void InitWebViewAsync()
    {
        try
        {
            await Web.EnsureCoreWebView2Async();
            var www = Path.Combine(AppContext.BaseDirectory, "www");
            Web.CoreWebView2.SetVirtualHostNameToFolderMapping(VirtualHost, www, CoreWebView2HostResourceAccessKind.Allow);
            Web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            Web.CoreWebView2.NavigationCompleted += (s, e) =>
            {
                Log($"NavigationCompleted success={e.IsSuccess} status={e.WebErrorStatus}");
                // Headless self-test: creating <LocalState>\autotest.flag makes the page run its checks on start-up
                // and write selftest-report.json next to bridge.log.
                var flag = Path.Combine(_local, "autotest.flag");
                if (e.IsSuccess && File.Exists(flag))
                {
                    string options = "";
                    try { options = File.ReadAllText(flag).Trim(); File.Delete(flag); } catch { }
                    PostToPage(new JsonObject { ["event"] = "autotest", ["options"] = options });
                }
            };
            Web.CoreWebView2.Navigate($"https://{VirtualHost}/index.html");
        }
        catch (Exception ex) { Log("InitWebViewAsync EXCEPTION: " + ex); }
    }

    // Safe from any thread (progress callbacks run on pool threads).
    private void PostToPage(JsonObject msg)
    {
        var json = msg.ToJsonString();
        void Send() { try { Web.CoreWebView2.PostWebMessageAsJson(json); } catch (Exception ex) { Log("Post EXCEPTION: " + ex.Message); } }
        if (DispatcherQueue.HasThreadAccess) Send(); else DispatcherQueue.TryEnqueue(Send);
    }

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        BridgeRequest req;
        try { req = new BridgeRequest((JsonNode.Parse(args.WebMessageAsJson) as JsonObject)!); }
        catch (Exception ex) { Log("Bad message: " + ex.Message); return; }
        if (req.Type != "log") Log($"IN type={req.Type} size={args.WebMessageAsJson.Length}");

        JsonObject resp;
        try
        {
            resp = _ops.TryGetValue(req.Type, out var module)
                ? await module.HandleAsync(_ctx, req)
                : R.Fail(req.Id, "Unknown bridge request type: " + req.Type);
        }
        catch (Exception ex)
        {
            Log($"Handler EXCEPTION ({req.Type}): " + ex);
            resp = R.Fail(req.Id, ex.Message);
        }
        resp["id"] = req.Id;
        if (req.Type != "log") Log($"OUT type={req.Type} ok={resp["ok"]} size={resp.ToJsonString().Length}");
        PostToPage(resp);
    }
}
