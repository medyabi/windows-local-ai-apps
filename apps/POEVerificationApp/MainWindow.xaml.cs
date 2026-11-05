using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Microsoft.Graphics.Imaging;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Text;
using Microsoft.Windows.AI.Imaging;
using Microsoft.Windows.AI.ContentSafety;
using Microsoft.Windows.Search.AppContentIndex;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using Windows.Storage;
using UglyToad.PdfPig;

namespace POEVerificationApp;

public sealed partial class MainWindow : Window
{
    private LanguageModel? _model;
    private TextRecognizer? _ocr;
    private ImageDescriptionGenerator? _describer;
    private AppContentIndexer? _poeIndex;

    private static readonly string LogPath = Path.Combine(ApplicationData.Current.LocalFolder.Path, "bridge.log");

    private static void Log(string msg)
    {
        try { File.AppendAllText(LogPath, $"{DateTime.Now:HH:mm:ss.fff} {msg}\n"); } catch { }
    }

    public MainWindow()
    {
        InitializeComponent();
        Title = "POE Verification Analyst — on-device AI, nothing leaves this device";
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
                "poeverify.local", www, CoreWebView2HostResourceAccessKind.Allow);

            Web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            Web.CoreWebView2.NavigationCompleted += (s, e) => Log($"NavigationCompleted success={e.IsSuccess} status={e.WebErrorStatus}");
            Web.CoreWebView2.ProcessFailed += (s, e) => Log($"ProcessFailed kind={e.ProcessFailedKind} reason={e.Reason} exitCode={e.ExitCode}");

            Web.CoreWebView2.Navigate("https://poeverify.local/index.html");
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

                case "ocr":
                    resp = await HandleOcrAsync(req.Id, req.Base64 ?? "");
                    break;

                case "describeImage":
                    resp = await HandleDescribeImageAsync(req.Id, req.Base64 ?? "");
                    break;

                case "indexPoe":
                    resp = await System.Threading.Tasks.Task.Run(() => HandleIndexPoe(req.Id, req.ContentId ?? "", req.Prompt ?? ""));
                    break;

                case "queryPoe":
                    resp = await System.Threading.Tasks.Task.Run(() => HandleQueryPoe(req.Id, req.Prompt ?? ""));
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

    // Local, deterministic PDF text extraction (PdfPig) — POs, invoices, POE/delivery reports.
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

    // On-device OCR (Windows AI TextRecognizer) — scanned/photographed documents.
    private async System.Threading.Tasks.Task<BridgeResponse> HandleOcrAsync(string id, string base64)
    {
        var resp = new BridgeResponse { Id = id };
        try
        {
            var readyState = TextRecognizer.GetReadyState();
            Log("TextRecognizer.GetReadyState = " + readyState);
            if (readyState == AIFeatureReadyState.NotReady)
            {
                var ensureResult = await TextRecognizer.EnsureReadyAsync();
                Log("TextRecognizer.EnsureReadyAsync.Status = " + ensureResult.Status);
                if (ensureResult.Status != AIFeatureReadyResultState.Success)
                {
                    resp.Ok = false;
                    resp.Error = "OCR model setup failed: " + ensureResult.Status;
                    return resp;
                }
            }

            var imageBuffer = await DecodeImageBufferAsync(base64);

            _ocr ??= await TextRecognizer.CreateAsync();
            var recognized = _ocr.RecognizeTextFromImage(imageBuffer);
            var text = string.Join("\n", recognized.Lines.Select(l => l.Text));

            resp.Ok = true;
            resp.Text = text;
            Log("HandleOcr OK, chars=" + text.Length);
        }
        catch (Exception ex)
        {
            Log("HandleOcr EXCEPTION: " + ex);
            resp.Ok = false;
            resp.Error = "OCR failed: " + ex.Message;
        }
        return resp;
    }

    // On-device image captioning (Windows AI ImageDescriptionGenerator) — used to estimate
    // visible unit counts in POE photos. There's no real object-counting model available
    // on-device, so the reasoning model estimates a count from this real description
    // instead of a random/synthetic figure; the UI must present this as an estimate.
    private async System.Threading.Tasks.Task<BridgeResponse> HandleDescribeImageAsync(string id, string base64)
    {
        var resp = new BridgeResponse { Id = id };
        try
        {
            var readyState = ImageDescriptionGenerator.GetReadyState();
            Log("ImageDescriptionGenerator.GetReadyState = " + readyState);
            if (readyState == AIFeatureReadyState.NotReady)
            {
                var ensureResult = await ImageDescriptionGenerator.EnsureReadyAsync();
                Log("ImageDescriptionGenerator.EnsureReadyAsync.Status = " + ensureResult.Status);
                if (ensureResult.Status != AIFeatureReadyResultState.Success)
                {
                    resp.Ok = false;
                    resp.Error = "Image description model setup failed: " + ensureResult.Status;
                    return resp;
                }
            }

            var imageBuffer = await DecodeImageBufferAsync(base64);

            _describer ??= await ImageDescriptionGenerator.CreateAsync();
            var result = await _describer.DescribeAsync(imageBuffer, ImageDescriptionKind.DetailedDescription, new ContentFilterOptions());

            if (string.IsNullOrEmpty(result.Description))
            {
                resp.Ok = false;
                resp.Error = "Image description returned no text (status: " + result.Status + ")";
                return resp;
            }

            resp.Ok = true;
            resp.Text = result.Description;
            Log("HandleDescribeImage OK, chars=" + result.Description.Length);
        }
        catch (Exception ex)
        {
            Log("HandleDescribeImage EXCEPTION: " + ex);
            resp.Ok = false;
            resp.Error = "Image description failed: " + ex.Message;
        }
        return resp;
    }

    private static async System.Threading.Tasks.Task<ImageBuffer> DecodeImageBufferAsync(string base64)
    {
        var bytes = Convert.FromBase64String(base64);
        using var stream = new InMemoryRandomAccessStream();
        using (var writer = new DataWriter(stream))
        {
            writer.WriteBytes(bytes);
            await writer.StoreAsync();
            await writer.FlushAsync();
            writer.DetachStream();
        }
        stream.Seek(0);

        var decoder = await BitmapDecoder.CreateAsync(stream);
        using SoftwareBitmap bitmap = await decoder.GetSoftwareBitmapAsync();
        return ImageBuffer.CreateForSoftwareBitmap(bitmap);
    }

    private AppContentIndexer? GetPoeIndex()
    {
        if (_poeIndex is not null) return _poeIndex;
        var result = AppContentIndexer.GetOrCreateIndex("poeindex");
        if (!result.Succeeded)
        {
            Log("GetOrCreateIndex FAILED: Status=" + result.Status + " Error=" + result.ExtendedError);
            return null;
        }
        Log("GetOrCreateIndex OK: " + result.Status);
        _poeIndex = result.Indexer;
        return _poeIndex;
    }

    // RAG indexing — add one POE's fingerprint text (structured fields + photo description)
    // to the on-device semantic index, so it can later be matched against other invoices'
    // submitted "evidence" to detect reused/duplicate proof of execution.
    private BridgeResponse HandleIndexPoe(string id, string contentId, string text)
    {
        var resp = new BridgeResponse { Id = id };
        var indexer = GetPoeIndex();
        if (indexer is null)
        {
            resp.Ok = false;
            resp.Error = "Could not open POE index";
            return resp;
        }
        try
        {
            var content = AppManagedIndexableAppContent.CreateFromString(contentId, text);
            indexer.AddOrUpdate(content);
            resp.Ok = true;
            Log("HandleIndexPoe OK, id=" + contentId + " chars=" + text.Length);
        }
        catch (Exception ex)
        {
            Log("HandleIndexPoe EXCEPTION: " + ex);
            resp.Ok = false;
            resp.Error = ex.Message;
        }
        return resp;
    }

    // RAG retrieval — semantic query against indexed POE fingerprints. Returns JSON array of
    // {contentId, offset, length} for the top matches; JS keeps the fingerprint text keyed by
    // contentId, so this just reports which POE(s) matched and where within their text.
    private BridgeResponse HandleQueryPoe(string id, string query)
    {
        var resp = new BridgeResponse { Id = id };
        var indexer = GetPoeIndex();
        if (indexer is null)
        {
            resp.Ok = false;
            resp.Error = "Could not open POE index";
            return resp;
        }
        try
        {
            var textQuery = indexer.CreateTextQuery(query);
            var matches = textQuery.GetNextMatches(8);
            var results = matches
                .OfType<AppManagedTextQueryMatch>()
                .Select(m => new PoeMatch { ContentId = m.ContentId, Offset = m.TextOffset, Length = m.TextLength })
                .ToList();
            resp.Ok = true;
            resp.Text = JsonSerializer.Serialize(results, BridgeJsonContext.Default.ListPoeMatch);
            Log("HandleQueryPoe OK, matches=" + results.Count);
        }
        catch (Exception ex)
        {
            Log("HandleQueryPoe EXCEPTION: " + ex);
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

public sealed class PoeMatch
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
[JsonSerializable(typeof(System.Collections.Generic.List<PoeMatch>))]
internal partial class BridgeJsonContext : JsonSerializerContext
{
}
