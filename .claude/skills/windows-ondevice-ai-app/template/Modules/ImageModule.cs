using System.Text.Json.Nodes;
using Microsoft.Graphics.Imaging;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Imaging;

namespace AiApp;

// Picture features of Windows AI, each with its own Windows-managed model (downloaded through Windows Update on first use;
// the generator took 15+ minutes on one PC, so progress events are pushed and a retry is expected to work).
//   imageGenerate { prompt, style?: default|coloring, seed? }   text -> picture
//   imageRestyle  { base64, prompt, seed? }                      picture + prompt -> restyled picture
//   imageUpscale  { base64 }                                     2x upscale (limited by the model's MaxSupportedScaleFactor)
//   imageCutout   { base64 }                                     removes the background (transparent PNG)
// All return { png: <base64 PNG>, width, height, status }. Moderation can refuse a prompt: the status is in the error text.
internal sealed class ImageModule : IBridgeModule
{
    public string Name => "images";
    public IReadOnlyCollection<string> Ops => new[] { "imageGenerate", "imageRestyle", "imageUpscale", "imageCutout" };

    private static ImageGenerator? _gen;
    private static ImageScaler? _scaler;
    private static ImageForegroundExtractor? _fg;

    public IEnumerable<(string feature, string state)> Status()
    {
        yield return ("ImageGenerator", ImageGenerator.GetReadyState().ToString());
        yield return ("ImageScaler", ImageScaler.GetReadyState().ToString());
        yield return ("ImageForegroundExtractor", ImageForegroundExtractor.GetReadyState().ToString());
    }

    public async Task<JsonObject> HandleAsync(BridgeContext ctx, BridgeRequest req)
    {
        Action<double> prog(string what) => p => ctx.Event(req.Id, "status", $"Downloading {what}... {(int)(p * 100)}%");
        string? err;
        ImageBuffer? outBuf = null;
        string status = "Success";

        switch (req.Type)
        {
            case "imageGenerate":
            case "imageRestyle":
            {
                var prompt = req.Str("prompt") ?? "";
                if (prompt.Length == 0) return R.Fail(req.Id, "Empty prompt");
                err = await Ai.EnsureReadyAsync("the on-device image generator", ImageGenerator.GetReadyState, ImageGenerator.EnsureReadyAsync, prog("the image generator"), 20);
                if (err != null) return R.Fail(req.Id, err);
                _gen ??= await ImageGenerator.CreateAsync();
                int seed = req.Int("seed") ?? Random.Shared.Next(1, int.MaxValue);
                ctx.Event(req.Id, "status", "Painting on the NPU... this can take a minute");
                ImageBuffer? src = req.Type == "imageRestyle" && !string.IsNullOrEmpty(req.Str("base64"))
                    ? await ImageUtil.FromBase64Async(req.Str("base64")!, 1024) : null;
                if (req.Type == "imageRestyle" && src == null) return R.Fail(req.Id, "Attach a picture to restyle");
                var style = (req.Str("style") ?? "").Equals("coloring", StringComparison.OrdinalIgnoreCase)
                    ? ImageFromTextGenerationStyle.ColoringBook : ImageFromTextGenerationStyle.Default;
                var r = await Task.Run(() =>
                {
                    var o = new ImageGenerationOptions();
                    try { o.Seed = seed; } catch { }
                    return src != null
                        ? _gen!.GenerateImageFromImageBuffer(src, prompt, o, new ImageFromImageGenerationOptions { Style = ImageFromImageGenerationStyle.Restyle })
                        : _gen!.GenerateImageFromTextPrompt(prompt, o, new ImageFromTextGenerationOptions { Style = style });
                });
                src?.Dispose();
                status = r.Status.ToString();
                if (r.Status != ImageGeneratorResultStatus.Success || r.Image == null)
                    return R.Fail(req.Id, "The image generator could not make a picture (status: " + status + ")" +
                        (status.Contains("Moderation") ? ". Windows content safety declined it: describe something different." : ""));
                outBuf = r.Image;
                break;
            }
            case "imageUpscale":
            {
                if (string.IsNullOrEmpty(req.Str("base64"))) return R.Fail(req.Id, "Attach a picture");
                err = await Ai.EnsureReadyAsync("the on-device image upscaler", ImageScaler.GetReadyState, ImageScaler.EnsureReadyAsync, prog("the upscaler"), 20);
                if (err != null) return R.Fail(req.Id, err);
                _scaler ??= await ImageScaler.CreateAsync();
                using var src = await ImageUtil.FromBase64Async(req.Str("base64")!, 2048);
                float k = Math.Min(2f, _scaler.MaxSupportedScaleFactor);
                if (k < 1.01f) return R.Fail(req.Id, "This picture is already as large as the upscaler allows");
                int w = (int)(src.PixelWidth * k), h = (int)(src.PixelHeight * k);
                outBuf = await Task.Run(() => _scaler.ScaleImageBuffer(src, w, h));
                break;
            }
            case "imageCutout":
            {
                if (string.IsNullOrEmpty(req.Str("base64"))) return R.Fail(req.Id, "Attach a picture");
                err = await Ai.EnsureReadyAsync("the on-device background remover", ImageForegroundExtractor.GetReadyState, ImageForegroundExtractor.EnsureReadyAsync, prog("the background remover"), 20);
                if (err != null) return R.Fail(req.Id, err);
                _fg ??= await ImageForegroundExtractor.CreateAsync();
                using var src = await ImageUtil.FromBase64Async(req.Str("base64")!, 2048);
                outBuf = await Task.Run(() => { using var mask = _fg!.GetMaskFromImageBuffer(src); return ApplyMask(src, mask); });
                break;
            }
            default:
                return R.Fail(req.Id, "Unknown image op");
        }

        using (outBuf)
        {
            var res = R.Ok(req.Id);
            res["png"] = await ImageUtil.ToPngBase64Async(outBuf!);
            res["width"] = (int)outBuf!.PixelWidth;
            res["height"] = (int)outBuf.PixelHeight;
            res["status"] = status;
            ctx.Log($"{req.Type} {res["width"]}x{res["height"]}");
            return res;
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
        return ImageBuffer.CreateForBuffer(System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsBuffer(o), ImageBufferPixelFormat.Bgra8, w, h, stride);
    }
}
