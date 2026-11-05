using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Microsoft.Graphics.Imaging;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Text;
using Microsoft.Windows.AI.Imaging;
using Microsoft.Windows.AI.ContentSafety;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using Windows.Storage;
using FellowOakDicom;
using FellowOakDicom.Imaging;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;

namespace ReadingRoomAssistantApp;

public sealed partial class MainWindow : Window
{
    private LanguageModel? _model;
    private ImageDescriptionGenerator? _describer;
    private static bool _dicomInitialized;

    private static readonly string LogPath = Path.Combine(ApplicationData.Current.LocalFolder.Path, "bridge.log");

    private static void Log(string msg)
    {
        try { File.AppendAllText(LogPath, $"{DateTime.Now:HH:mm:ss.fff} {msg}\n"); } catch { }
    }

    public MainWindow()
    {
        InitializeComponent();
        Title = "Reading Room Assistant — on-device AI, nothing leaves this device";
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
                "readingroom.local", www, CoreWebView2HostResourceAccessKind.Allow);

            Web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            Web.CoreWebView2.NavigationCompleted += (s, e) => Log($"NavigationCompleted success={e.IsSuccess} status={e.WebErrorStatus}");
            Web.CoreWebView2.ProcessFailed += (s, e) => Log($"ProcessFailed kind={e.ProcessFailedKind} reason={e.Reason} exitCode={e.ExitCode}");

            Web.CoreWebView2.Navigate("https://readingroom.local/index.html");
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

                case "describeImage":
                    resp = await HandleDescribeImageAsync(req.Id, req.Base64 ?? "");
                    break;

                case "parseDicom":
                    resp = await System.Threading.Tasks.Task.Run(() => HandleParseDicom(req.Id, req.Base64 ?? ""));
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

    // Real on-device image captioning (Windows AI ImageDescriptionGenerator) for imported studies.
    // This is a general-purpose vision model, NOT a radiology-specific detection model — the caption
    // it returns is shown to the user labeled as such, never as a clinical finding.
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

    // Real DICOM parsing (fo-dicom) for imported studies — extracts standard metadata tags and
    // renders actual pixel data to a displayable PNG. No AI/detection involved: this is deterministic
    // file parsing, exactly like the PdfPig text-extraction used in this app family's other apps.
    private BridgeResponse HandleParseDicom(string id, string base64)
    {
        var resp = new BridgeResponse { Id = id };
        try
        {
            if (!_dicomInitialized)
            {
                new DicomSetupBuilder().RegisterServices(s => s.AddImageManager<ImageSharpImageManager>()).Build();
                _dicomInitialized = true;
                Log("DICOM setup initialized (ImageSharpImageManager)");
            }

            var bytes = Convert.FromBase64String(base64);
            using var ms = new MemoryStream(bytes);
            var dicomFile = DicomFile.Open(ms);
            var ds = dicomFile.Dataset;

            var meta = new DicomImportResult
            {
                PatientId = ds.GetSingleValueOrDefault(DicomTag.PatientID, ""),
                Age = ParseDicomAge(ds.GetSingleValueOrDefault(DicomTag.PatientAge, "")),
                Sex = NormalizeSex(ds.GetSingleValueOrDefault(DicomTag.PatientSex, "")),
                Modality = ds.GetSingleValueOrDefault(DicomTag.Modality, ""),
                StudyDescription = ds.GetSingleValueOrDefault(DicomTag.StudyDescription, ""),
                BodyPart = ds.GetSingleValueOrDefault(DicomTag.BodyPartExamined, ""),
                Accession = ds.GetSingleValueOrDefault(DicomTag.AccessionNumber, ""),
                StudyDate = FormatDicomDate(ds.GetSingleValueOrDefault(DicomTag.StudyDate, "")),
            };

            var dicomImage = new DicomImage(ds);
            var rendered = dicomImage.RenderImage().AsSharpImage();
            using var pngStream = new MemoryStream();
            rendered.Save(pngStream, new PngEncoder());
            meta.PngBase64 = Convert.ToBase64String(pngStream.ToArray());

            resp.Ok = true;
            resp.Text = JsonSerializer.Serialize(meta, BridgeJsonContext.Default.DicomImportResult);
            Log("HandleParseDicom OK, patientId=" + meta.PatientId + " modality=" + meta.Modality + " pngBytes=" + pngStream.Length);
        }
        catch (Exception ex)
        {
            Log("HandleParseDicom EXCEPTION: " + ex);
            resp.Ok = false;
            resp.Error = "Couldn't read this DICOM file (" + ex.Message + "). Try exporting/converting it to PNG or JPG instead.";
        }
        return resp;
    }

    private static int ParseDicomAge(string dicomAge)
    {
        if (string.IsNullOrWhiteSpace(dicomAge) || dicomAge.Length < 4) return 0;
        if (!int.TryParse(dicomAge.Substring(0, 3), out var n)) return 0;
        return dicomAge[3] switch
        {
            'Y' => n,
            'M' => Math.Max(0, n / 12),
            'W' => Math.Max(0, n / 52),
            'D' => Math.Max(0, n / 365),
            _ => n,
        };
    }

    private static string NormalizeSex(string s) => s.Trim().ToUpperInvariant() switch { "M" => "M", "F" => "F", _ => "U" };

    private static string FormatDicomDate(string yyyymmdd)
    {
        if (yyyymmdd.Length != 8) return "";
        return $"{yyyymmdd.Substring(0, 4)}-{yyyymmdd.Substring(4, 2)}-{yyyymmdd.Substring(6, 2)}";
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

public sealed class DicomImportResult
{
    [JsonPropertyName("patientId")]
    public string PatientId { get; set; } = "";

    [JsonPropertyName("age")]
    public int Age { get; set; }

    [JsonPropertyName("sex")]
    public string Sex { get; set; } = "U";

    [JsonPropertyName("modality")]
    public string Modality { get; set; } = "";

    [JsonPropertyName("studyDescription")]
    public string StudyDescription { get; set; } = "";

    [JsonPropertyName("bodyPart")]
    public string BodyPart { get; set; } = "";

    [JsonPropertyName("accession")]
    public string Accession { get; set; } = "";

    [JsonPropertyName("studyDate")]
    public string StudyDate { get; set; } = "";

    [JsonPropertyName("pngBase64")]
    public string PngBase64 { get; set; } = "";
}

[JsonSerializable(typeof(BridgeRequest))]
[JsonSerializable(typeof(BridgeResponse))]
[JsonSerializable(typeof(DicomImportResult))]
internal partial class BridgeJsonContext : JsonSerializerContext
{
}
