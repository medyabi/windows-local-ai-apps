using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Text;
using Microsoft.Windows.Search.AppContentIndex;
using Windows.Storage;
using UglyToad.PdfPig;

namespace HRRecruiterApp;

public sealed partial class MainWindow : Window
{
    private LanguageModel? _model;
    private AppContentIndexer? _resumeIndex;

    private static readonly HttpClient _http = CreateHttpClient();
    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true })
        {
            Timeout = TimeSpan.FromSeconds(20),
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
        client.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        return client;
    }

    private static readonly string LogPath = Path.Combine(ApplicationData.Current.LocalFolder.Path, "bridge.log");

    private static void Log(string msg)
    {
        try { File.AppendAllText(LogPath, $"{DateTime.Now:HH:mm:ss.fff} {msg}\n"); } catch { }
    }

    public MainWindow()
    {
        InitializeComponent();
        Title = "HR Recruiter Agent — on-device AI, nothing leaves this device";
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
            Web.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "hrrecruiter.local", www, CoreWebView2HostResourceAccessKind.Allow);

            Web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            Web.CoreWebView2.NavigationCompleted += (s, e) => Log($"NavigationCompleted success={e.IsSuccess} status={e.WebErrorStatus}");
            Web.CoreWebView2.ProcessFailed += (s, e) => Log($"ProcessFailed kind={e.ProcessFailedKind} reason={e.Reason} exitCode={e.ExitCode}");

            Web.CoreWebView2.Navigate("https://hrrecruiter.local/index.html");
            Log("Navigate() called");
        }
        catch (Exception ex)
        {
            Log("InitWebViewAsync EXCEPTION: " + ex);
        }
    }

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        string json = args.WebMessageAsJson;
        Log("WebMessage IN: " + TrimForLog(json));
        BridgeRequest? req;
        try
        {
            req = JsonSerializer.Deserialize(json, BridgeJsonContext.Default.BridgeRequest);
        }
        catch (Exception ex)
        {
            Log("Deserialize EXCEPTION: " + ex);
            return;
        }
        if (req is null) return;

        var resp = new BridgeResponse { Id = req.Id };

        try
        {
            switch (req.Type)
            {
                case "ensureReady":
                    resp = await HandleEnsureReadyAsync(req.Id);
                    break;

                case "generate":
                    resp = await HandleGenerateAsync(req.Id, req.Prompt ?? "");
                    break;

                case "pdfText":
                    resp = HandlePdfText(req.Id, req.Base64 ?? "");
                    break;

                case "indexResume":
                    resp = await System.Threading.Tasks.Task.Run(() => HandleIndexResume(req.Id, req.ContentId ?? "", req.Prompt ?? ""));
                    break;

                case "queryResume":
                    resp = await System.Threading.Tasks.Task.Run(() => HandleQueryResume(req.Id, req.Prompt ?? ""));
                    break;

                case "fetchUrl":
                    resp = await HandleFetchUrlAsync(req.Id, req.Url ?? "");
                    break;

                default:
                    resp.Ok = false;
                    resp.Error = "Unknown bridge request type: " + req.Type;
                    break;
            }
        }
        catch (Exception ex)
        {
            Log("Handler EXCEPTION: " + ex);
            resp.Ok = false;
            resp.Error = ex.Message;
        }

        string outJson = JsonSerializer.Serialize(resp, BridgeJsonContext.Default.BridgeResponse);
        Log("WebMessage OUT: " + TrimForLog(outJson));
        Web.CoreWebView2.PostWebMessageAsJson(outJson);
    }

    private static string TrimForLog(string s) => s.Length > 400 ? s.Substring(0, 400) + "...(" + s.Length + " chars)" : s;

    private async System.Threading.Tasks.Task<BridgeResponse> HandleEnsureReadyAsync(string id)
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
                resp.Ok = false;
                resp.State = readyState.ToString();
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
                AIFeatureReadyState.NotSupportedOnCurrentSystem => "This PC's hardware doesn't support the on-device language model.",
                _ => "Model not ready: " + readyState,
            };
        }
        return resp;
    }

    private async System.Threading.Tasks.Task<BridgeResponse> HandleGenerateAsync(string id, string prompt)
    {
        var resp = new BridgeResponse { Id = id };

        var readyState = LanguageModel.GetReadyState();
        if (readyState != AIFeatureReadyState.Ready)
        {
            var ready = await HandleEnsureReadyAsync(id);
            if (!ready.Ok)
            {
                return ready;
            }
        }

        if (_model is null)
        {
            Log("Creating LanguageModel...");
            _model = await LanguageModel.CreateAsync();
            Log("LanguageModel created");
        }

        Log("GenerateResponseAsync prompt len=" + prompt.Length);
        var result = await _model.GenerateResponseAsync(prompt);
        Log("GenerateResponseAsync result len=" + (result.Text?.Length ?? 0) + " status=" + result.Status);

        if (string.IsNullOrEmpty(result.Text))
        {
            resp.Ok = false;
            resp.Error = "Model returned no text (status: " + result.Status + ")";
            return resp;
        }

        resp.Ok = true;
        resp.Text = result.Text;
        return resp;
    }

    // Local, deterministic PDF text extraction (PdfPig) — job descriptions and résumés.
    private BridgeResponse HandlePdfText(string id, string base64)
    {
        var resp = new BridgeResponse { Id = id };
        try
        {
            var bytes = Convert.FromBase64String(base64);
            using var ms = new MemoryStream(bytes);
            using var doc = PdfDocument.Open(ms);
            var sb = new StringBuilder();
            foreach (var page in doc.GetPages())
            {
                sb.AppendLine(page.Text);
            }
            resp.Ok = true;
            resp.Text = sb.ToString();
            Log("HandlePdfText OK, pages=" + doc.NumberOfPages + " chars=" + resp.Text.Length);
        }
        catch (Exception ex)
        {
            Log("HandlePdfText EXCEPTION: " + ex);
            resp.Ok = false;
            resp.Error = "PDF extraction failed: " + ex.Message;
        }
        return resp;
    }

    // Fetches a job-posting page's raw HTML using a native HTTP request — not subject to the
    // browser CORS restrictions that would block a fetch() from the WebView2 page itself, since
    // CORS is enforced by browsers, not by the server or by .NET's HttpClient. Returns raw HTML;
    // the JS side parses it with DOMParser to pull out readable text.
    private async System.Threading.Tasks.Task<BridgeResponse> HandleFetchUrlAsync(string id, string url)
    {
        var resp = new BridgeResponse { Id = id };
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
        {
            resp.Ok = false;
            resp.Error = "That doesn't look like a valid web address.";
            return resp;
        }
        try
        {
            using var response = await _http.GetAsync(uri);
            if (!response.IsSuccessStatusCode)
            {
                Log("HandleFetchUrl non-success status=" + response.StatusCode + " url=" + url);
                resp.Ok = false;
                resp.Error = $"The site returned {(int)response.StatusCode} {response.ReasonPhrase} — it may be blocking automated requests.";
                return resp;
            }
            var html = await response.Content.ReadAsStringAsync();
            if (html.Length > 3_000_000) html = html.Substring(0, 3_000_000);
            resp.Ok = true;
            resp.Text = html;
            Log("HandleFetchUrl OK, chars=" + html.Length + " url=" + url);
        }
        catch (TaskCanceledException)
        {
            Log("HandleFetchUrl TIMEOUT url=" + url);
            resp.Ok = false;
            resp.Error = "The request timed out.";
        }
        catch (Exception ex)
        {
            Log("HandleFetchUrl EXCEPTION: " + ex);
            resp.Ok = false;
            resp.Error = "Couldn't fetch that page (" + ex.Message + ").";
        }
        return resp;
    }

    private AppContentIndexer? GetResumeIndex()
    {
        if (_resumeIndex is not null) return _resumeIndex;
        var result = AppContentIndexer.GetOrCreateIndex("resumeindex");
        if (!result.Succeeded)
        {
            Log("GetOrCreateIndex FAILED: Status=" + result.Status + " Error=" + result.ExtendedError);
            return null;
        }
        Log("GetOrCreateIndex OK: " + result.Status);
        _resumeIndex = result.Indexer;
        return _resumeIndex;
    }

    // RAG indexing — add one candidate's fingerprint text (name + key skills/history) to the
    // on-device semantic index, so it can later be matched against other candidates to detect
    // the same person having applied for a different role before.
    private BridgeResponse HandleIndexResume(string id, string contentId, string text)
    {
        var resp = new BridgeResponse { Id = id };
        var indexer = GetResumeIndex();
        if (indexer is null)
        {
            resp.Ok = false;
            resp.Error = "Could not open résumé index";
            return resp;
        }
        try
        {
            var content = AppManagedIndexableAppContent.CreateFromString(contentId, text);
            indexer.AddOrUpdate(content);
            resp.Ok = true;
            Log("HandleIndexResume OK, id=" + contentId + " chars=" + text.Length);
        }
        catch (Exception ex)
        {
            Log("HandleIndexResume EXCEPTION: " + ex);
            resp.Ok = false;
            resp.Error = ex.Message;
        }
        return resp;
    }

    // RAG retrieval — semantic query against indexed candidate fingerprints. Returns JSON array
    // of {contentId, offset, length} for the top matches.
    private BridgeResponse HandleQueryResume(string id, string query)
    {
        var resp = new BridgeResponse { Id = id };
        var indexer = GetResumeIndex();
        if (indexer is null)
        {
            resp.Ok = false;
            resp.Error = "Could not open résumé index";
            return resp;
        }
        try
        {
            var textQuery = indexer.CreateTextQuery(query);
            var matches = textQuery.GetNextMatches(8);
            var results = matches
                .OfType<AppManagedTextQueryMatch>()
                .Select(m => new ResumeMatch { ContentId = m.ContentId, Offset = m.TextOffset, Length = m.TextLength })
                .ToList();
            resp.Ok = true;
            resp.Text = JsonSerializer.Serialize(results, BridgeJsonContext.Default.ListResumeMatch);
            Log("HandleQueryResume OK, matches=" + results.Count);
        }
        catch (Exception ex)
        {
            Log("HandleQueryResume EXCEPTION: " + ex);
            resp.Ok = false;
            resp.Error = ex.Message;
        }
        return resp;
    }
}

public sealed class BridgeRequest
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("prompt")]
    public string? Prompt { get; set; }

    [JsonPropertyName("base64")]
    public string? Base64 { get; set; }

    [JsonPropertyName("contentId")]
    public string? ContentId { get; set; }

    [JsonPropertyName("url")]
    public string? Url { get; set; }
}

public sealed class BridgeResponse
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("text")]
    public string? Text { get; set; }

    [JsonPropertyName("state")]
    public string? State { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

public sealed class ResumeMatch
{
    [JsonPropertyName("contentId")]
    public string ContentId { get; set; } = "";

    [JsonPropertyName("offset")]
    public int Offset { get; set; }

    [JsonPropertyName("length")]
    public int Length { get; set; }
}

[JsonSerializable(typeof(BridgeRequest))]
[JsonSerializable(typeof(BridgeResponse))]
[JsonSerializable(typeof(System.Collections.Generic.List<ResumeMatch>))]
internal partial class BridgeJsonContext : JsonSerializerContext
{
}
