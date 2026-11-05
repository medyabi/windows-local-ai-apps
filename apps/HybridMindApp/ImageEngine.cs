using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Graphics.Imaging;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Imaging;
using Windows.Foundation;

namespace HybridMindApp;

// On-device picture features from Windows AI: text-to-image and restyle (ImageGenerator), upscaling (ImageScaler)
// and background removal (ImageForegroundExtractor). Each needs its own Windows-managed model, downloaded on first use.
internal sealed class ImageEngine
{
    private readonly ChatEngine _chat;
    private readonly string _mediaDir;
    private readonly Action<string> _log;
    private ImageGenerator? _gen;
    private ImageScaler? _scaler;
    private ImageForegroundExtractor? _fg;

    public ImageEngine(ChatEngine chat, string mediaDir, Action<string> log)
    {
        _chat = chat; _mediaDir = mediaDir; _log = log;
        Directory.CreateDirectory(Path.Combine(_mediaDir, "generated"));
        Directory.CreateDirectory(Path.Combine(_mediaDir, "thumbs"));
    }

    public string MediaDir => _mediaDir;

    private static string Explain(AIFeatureReadyState st, string what) => st switch
    {
        AIFeatureReadyState.DisabledByUser => $"{what} is turned off. Enable it in Settings > System > AI components.",
        AIFeatureReadyState.NotSupportedOnCurrentSystem => $"This PC doesn’t support {what} (it needs a Copilot+ PC).",
        _ => $"{what} isn’t ready ({st}).",
    };

    // Make a Windows AI feature ready, downloading its model on first use and reporting progress to the page.
    // If Windows makes no progress for a while (the component isn't offered for this PC / OS build) give up with a clear message.
    private async Task<string?> EnsureAsync(string rid, string what, Func<AIFeatureReadyState> state, Func<IAsyncOperationWithProgress<AIFeatureReadyResult, double>> ensure, ImageResult res)
    {
        var e = await EnsureOnceAsync(rid, what, state, ensure, res);
        if (e != null && e.StartsWith("Couldn’t set up")) { _log(what + ": setup failed once, retrying"); e = await EnsureOnceAsync(rid, what, state, ensure, res); }
        return e;
    }

    private async Task<string?> EnsureOnceAsync(string rid, string what, Func<AIFeatureReadyState> state, Func<IAsyncOperationWithProgress<AIFeatureReadyResult, double>> ensure, ImageResult res)
    {
        var st = state();
        if (st == AIFeatureReadyState.Ready) return null;
        res.Unavailable = true;
        if (st != AIFeatureReadyState.NotReady) return Explain(st, what);
        _chat.Post(rid, "status", $"Preparing {what} — Windows is downloading it (first use only)…");
        var op = ensure();
        int last = -1;
        var lastChange = Stopwatch.StartNew();
        op.Progress = (i, p) => { int pct = (int)(p * 100); if (pct != last) { last = pct; lastChange.Restart(); _log($"{what} download {pct}%"); _chat.Post(rid, "status", $"Downloading {what}… {pct}%"); } };
        var tcs = new TaskCompletionSource();
        op.Completed = (o, status) => tcs.TrySetResult();
        while (!tcs.Task.IsCompleted)
        {
            await Task.WhenAny(tcs.Task, Task.Delay(3000));
            if (!tcs.Task.IsCompleted && lastChange.Elapsed > TimeSpan.FromMinutes(8))
            {
                try { op.Cancel(); } catch { }
                _log($"{what}: no download progress for {lastChange.Elapsed.TotalSeconds:0}s — giving up");
                return $"Windows hasn’t finished downloading {what} on this PC. LocalMind can’t speed that up — Windows delivers these AI components through Windows Update, and may need a while (or an update). Try again in a few minutes; Settings → Windows Update shows progress.";
            }
        }
        AIFeatureReadyResult r;
        try { r = op.GetResults(); } catch (Exception ex) { return $"Couldn’t set up {what}: {ex.Message}"; }
        _log($"{what} ensure => {r.Status} {r.ExtendedError?.Message}");
        if (r.Status != AIFeatureReadyResultState.Success) return $"Couldn’t set up {what}: {r.Status}{(r.ExtendedError != null ? " — " + r.ExtendedError.Message : "")}";
        if (state() != AIFeatureReadyState.Ready) return Explain(state(), what);
        res.Unavailable = false;
        return null;
    }

    private static ImageBuffer Load(string path, int maxSide)
    {
        using var fs = File.OpenRead(path);
        return Ocr.ToBuffer(System.IO.WindowsRuntimeStreamExtensions.AsRandomAccessStream(fs), maxSide);
    }

    public async Task<ImageResult> RunAsync(ImageRequest req)
    {
        var res = new ImageResult();
        var sw = Stopwatch.StartNew();
        _chat.PreemptBackground();
        var cts = _chat.Register(req.Rid);
        try
        {
            try { await _chat.Gate.WaitAsync(cts.Token); }
            catch (OperationCanceledException) { res.Ok = true; res.Cancelled = true; return res; }
            bool released = false;
            void Release() { if (!released) { released = true; _chat.Gate.Release(); } }
            try
            {
                if (!string.IsNullOrEmpty(req.Source) && !File.Exists(req.Source)) { res.Error = "That picture is no longer available."; return res; }
                var work = Task.Run(() => DoAsync(req, res));
                var cancelled = new TaskCompletionSource();
                using var reg = cts.Token.Register(() => cancelled.TrySetResult());
                // the image models can't be interrupted mid-step: let the user walk away, and keep the NPU gate until the step really ends
                var first = await Task.WhenAny(work, cancelled.Task);
                if (first == work) { await work; Release(); }
                else { res.Ok = true; res.Cancelled = true; _ = work.ContinueWith(_ => Release()); }
            }
            catch { Release(); throw; }
        }
        catch (Exception ex)
        {
            _log("Image EXCEPTION: " + ex);
            res.Ok = false; res.Error = ex.Message;
        }
        finally { _chat.Unregister(req.Rid); }
        res.Ms = sw.ElapsedMilliseconds;
        return res;
    }

    private string NewPath(string stem) => Path.Combine(_mediaDir, "generated", $"{stem}-{DateTime.Now:yyyyMMdd-HHmmss}-{Guid.NewGuid().ToString("N")[..4]}.png");

    private async Task DoAsync(ImageRequest req, ImageResult res)
    {
        switch (req.Op)
        {
            case "generate":
            case "restyle":
                {
                    var err = await EnsureAsync(req.Rid, "the on-device image generator", ImageGenerator.GetReadyState, ImageGenerator.EnsureReadyAsync, res);
                    if (err != null) { res.Error = err; return; }
                    _gen ??= await ImageGenerator.CreateAsync();
                    _chat.Post(req.Rid, "status", "Painting on your NPU… this can take a minute");
                    var opts = new ImageGenerationOptions();
                    int seed = req.Seed ?? Random.Shared.Next(1, int.MaxValue);
                    try { opts.Seed = seed; } catch { }
                    res.Seed = seed;
                    ImageGeneratorResult r;
                    if (req.Op == "restyle")
                    {
                        if (string.IsNullOrEmpty(req.Source)) { res.Error = "Attach a picture to restyle."; return; }
                        using var src = Load(req.Source, 1024);
                        r = _gen.GenerateImageFromImageBuffer(src, req.Prompt, opts, new ImageFromImageGenerationOptions { Style = ImageFromImageGenerationStyle.Restyle });
                    }
                    else
                    {
                        var style = (req.Style ?? "").Equals("coloring", StringComparison.OrdinalIgnoreCase) ? ImageFromTextGenerationStyle.ColoringBook : ImageFromTextGenerationStyle.Default;
                        r = _gen.GenerateImageFromTextPrompt(req.Prompt, opts, new ImageFromTextGenerationOptions { Style = style });
                    }
                    res.Status = r.Status.ToString();
                    if (r.Status != ImageGeneratorResultStatus.Success || r.Image == null)
                    {
                        res.Error = r.Status switch
                        {
                            ImageGeneratorResultStatus.TextBlockedByContentModeration => "Windows’ on-device content safety declined that prompt. Try describing something different.",
                            ImageGeneratorResultStatus.ImageBlockedByContentModeration => "Windows’ on-device content safety blocked the generated picture. Try a different prompt.",
                            ImageGeneratorResultStatus.BlockedByPolicy => "Image generation is blocked by policy on this PC.",
                            _ => "The image generator couldn’t make a picture from that (" + r.Status + "). Try a simpler, more concrete description.",
                        };
                        return;
                    }
                    await Finish(r.Image, NewPath(req.Op == "restyle" ? "restyle" : "gen"), res);
                    return;
                }
            case "upscale":
                {
                    if (string.IsNullOrEmpty(req.Source)) { res.Error = "Attach a picture to upscale."; return; }
                    var err = await EnsureAsync(req.Rid, "the on-device image upscaler", ImageScaler.GetReadyState, ImageScaler.EnsureReadyAsync, res);
                    if (err != null) { res.Error = err; return; }
                    _scaler ??= await ImageScaler.CreateAsync();
                    _chat.Post(req.Rid, "status", "Upscaling…");
                    using var src = Load(req.Source, 2048);
                    float k = Math.Min(2f, _scaler.MaxSupportedScaleFactor);
                    int w = (int)(src.PixelWidth * k), h = (int)(src.PixelHeight * k);
                    if (k < 1.01f) { res.Error = "This picture is already as large as the upscaler allows."; return; }
                    using var outBuf = _scaler.ScaleImageBuffer(src, w, h);
                    await Finish(outBuf, NewPath("upscaled"), res);
                    return;
                }
            case "cutout":
                {
                    if (string.IsNullOrEmpty(req.Source)) { res.Error = "Attach a picture to cut out."; return; }
                    var err = await EnsureAsync(req.Rid, "the on-device background remover", ImageForegroundExtractor.GetReadyState, ImageForegroundExtractor.EnsureReadyAsync, res);
                    if (err != null) { res.Error = err; return; }
                    _fg ??= await ImageForegroundExtractor.CreateAsync();
                    _chat.Post(req.Rid, "status", "Finding the subject…");
                    using var src = Load(req.Source, 2048);
                    using var mask = _fg.GetMaskFromImageBuffer(src);
                    using var cut = ApplyMask(src, mask);
                    await Finish(cut, NewPath("cutout"), res);
                    return;
                }
            default: res.Error = "Unknown picture operation: " + req.Op; return;
        }
    }

    // colour channels of the source with the mask as alpha (premultiplied BGRA)
    private static ImageBuffer ApplyMask(ImageBuffer src, ImageBuffer mask)
    {
        int w = (int)src.PixelWidth, h = (int)src.PixelHeight;
        var s = new byte[src.RowStride * h];
        src.CopyToByteArray(s);
        var m = new byte[mask.RowStride * mask.PixelHeight];
        mask.CopyToByteArray(m);
        int mpp = mask.PixelFormat switch { ImageBufferPixelFormat.Gray8 => 1, ImageBufferPixelFormat.Rgb8 or ImageBufferPixelFormat.Bgr8 => 3, _ => 4 };
        int stride = w * 4;
        var o = new byte[stride * h];
        for (int y = 0; y < h; y++)
        {
            int my = (int)((long)y * mask.PixelHeight / h);
            for (int x = 0; x < w; x++)
            {
                int mx = (int)((long)x * mask.PixelWidth / w);
                int a = m[my * mask.RowStride + mx * mpp];
                int si = y * src.RowStride + x * 4, oi = y * stride + x * 4;
                o[oi] = (byte)(s[si] * a / 255); o[oi + 1] = (byte)(s[si + 1] * a / 255); o[oi + 2] = (byte)(s[si + 2] * a / 255); o[oi + 3] = (byte)a;
            }
        }
        return ImageBuffer.CreateForBuffer(o.AsBuffer(), ImageBufferPixelFormat.Bgra8, w, h, stride);
    }

    private async Task Finish(ImageBuffer img, string path, ImageResult res)
    {
        await Ocr.SaveImageAsync(img, path, Windows.Graphics.Imaging.BitmapEncoder.PngEncoderId);
        res.Ok = true; res.Path = path; res.Width = (int)img.PixelWidth; res.Height = (int)img.PixelHeight;
        res.Url = "generated/" + Path.GetFileName(path);
        res.Status = "Success";
        _log($"Image saved: {path} {res.Width}x{res.Height}");
    }

    // small JPEG thumbnail for the chat (cached by path + timestamp)
    public async Task<string> ThumbAsync(string path)
    {
        var fi = new FileInfo(path);
        if (!fi.Exists) throw new FileNotFoundException("File not found.");
        var key = Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(path.ToLowerInvariant() + fi.LastWriteTimeUtc.Ticks)))[..14].ToLowerInvariant();
        var rel = "thumbs/" + key + ".jpg";
        var full = Path.Combine(_mediaDir, "thumbs", key + ".jpg");
        if (File.Exists(full)) return rel;
        await Task.Run(async () =>
        {
            Ocr.EnsureRecognizer();
            using var buf = Load(path, 360);
            await Ocr.SaveImageAsync(buf, full, Windows.Graphics.Imaging.BitmapEncoder.JpegEncoderId);
        });
        return rel;
    }

    public void ClearGenerated()
    {
        foreach (var sub in new[] { "generated", "thumbs" })
        {
            var d = Path.Combine(_mediaDir, sub);
            if (Directory.Exists(d)) foreach (var f in Directory.GetFiles(d)) { try { File.Delete(f); } catch { } }
        }
    }

    public long GeneratedBytes()
    {
        long n = 0;
        foreach (var sub in new[] { "generated", "thumbs" })
        {
            var d = Path.Combine(_mediaDir, sub);
            if (Directory.Exists(d)) foreach (var f in Directory.GetFiles(d)) n += new FileInfo(f).Length;
        }
        return n;
    }
}
