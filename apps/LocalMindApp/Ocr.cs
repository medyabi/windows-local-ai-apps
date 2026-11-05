using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Graphics.Imaging;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.ContentSafety;
using Microsoft.Windows.AI.Imaging;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace LocalMindApp;

// On-device OCR (TextRecognizer) and photo captioning (ImageDescriptionGenerator), used while indexing images and
// scanned PDFs. All calls are made from background threads, so the WinRT async APIs are waited on synchronously.
internal static class Ocr
{
    private static readonly object L = new();
    private static TextRecognizer? _rec;
    private static ImageDescriptionGenerator? _desc;
    private static string? _recError;
    private static string? _descError;

    private static T Wait<T>(Windows.Foundation.IAsyncOperation<T> op) => op.AsTask().GetAwaiter().GetResult();
    private static T Wait<T, P>(Windows.Foundation.IAsyncOperationWithProgress<T, P> op) => op.AsTask().GetAwaiter().GetResult();

    public static string? EnsureRecognizer()
    {
        lock (L)
        {
            if (_rec != null) return null;
            if (_recError != null) return _recError;
            try
            {
                if (TextRecognizer.GetReadyState() == AIFeatureReadyState.NotReady)
                {
                    var r = Wait(TextRecognizer.EnsureReadyAsync());
                    if (r.Status != AIFeatureReadyResultState.Success) throw new InvalidOperationException("OCR model setup failed: " + r.Status);
                }
                _rec = Wait(TextRecognizer.CreateAsync());
                return null;
            }
            catch (Exception ex) { _recError = "On-device OCR unavailable (" + ex.Message + ")"; return _recError; }
        }
    }

    public static string? EnsureDescriber()
    {
        lock (L)
        {
            if (_desc != null) return null;
            if (_descError != null) return _descError;
            try
            {
                if (ImageDescriptionGenerator.GetReadyState() == AIFeatureReadyState.NotReady)
                {
                    var r = Wait(ImageDescriptionGenerator.EnsureReadyAsync());
                    if (r.Status != AIFeatureReadyResultState.Success) throw new InvalidOperationException("Image description model setup failed: " + r.Status);
                }
                _desc = Wait(ImageDescriptionGenerator.CreateAsync());
                return null;
            }
            catch (Exception ex) { _descError = "On-device image description unavailable (" + ex.Message + ")"; return _descError; }
        }
    }

    // Decode to an ImageBuffer, honouring EXIF orientation (phone photos) and optionally shrinking so the longest side is at most maxSide.
    public static ImageBuffer ToBuffer(IRandomAccessStream stream, int maxSide = 0)
    {
        var decoder = Wait(BitmapDecoder.CreateAsync(stream));
        uint w = decoder.PixelWidth, h = decoder.PixelHeight;
        var tr = new BitmapTransform();
        if (maxSide > 0 && Math.Max(w, h) > maxSide)
        {
            double k = (double)maxSide / Math.Max(w, h);
            tr.ScaledWidth = (uint)Math.Max(1, w * k);
            tr.ScaledHeight = (uint)Math.Max(1, h * k);
        }
        using SoftwareBitmap bitmap = Wait(decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, tr, ExifOrientationMode.RespectExifOrientation, ColorManagementMode.DoNotColorManage));
        return ImageBuffer.CreateForSoftwareBitmap(bitmap);
    }

    public static List<string> Recognize(ImageBuffer buffer)
    {
        lock (L)
        {
            var result = _rec!.RecognizeTextFromImage(buffer);
            if (result?.Lines == null) return new List<string>();   // an image with no text comes back with no lines
            return result.Lines.Select(l => (l?.Text ?? "").Trim()).Where(t => t.Length > 0).ToList();
        }
    }

    public static string Describe(ImageBuffer buffer)
    {
        lock (L)
        {
            var r = Wait(_desc!.DescribeAsync(buffer, ImageDescriptionKind.DetailedDescription, new ContentFilterOptions()));
            return r.Description ?? "";
        }
    }

    // Like Describe, but reports the status (the description can be refused: too much text, content moderation, policy).
    public static (string status, string text) DescribeRaw(ImageBuffer buffer, ImageDescriptionKind kind = ImageDescriptionKind.DetailedDescription)
    {
        lock (L)
        {
            var r = Wait(_desc!.DescribeAsync(buffer, kind, new ContentFilterOptions()));
            return (r.Status.ToString(), r.Description ?? "");
        }
    }

    public static Task<(string status, string text)> DescribeRawAsync(ImageBuffer buffer) => Task.Run(() => DescribeRaw(buffer));

    // Encode an ImageBuffer (e.g. a generated image) with the given BitmapEncoder id.
    public static async Task SaveImageAsync(ImageBuffer image, string path, Guid encoderId)
    {
        bool jpeg = encoderId == BitmapEncoder.JpegEncoderId;
        using var raw = image.CopyToSoftwareBitmap();
        using var bmp = SoftwareBitmap.Convert(raw, BitmapPixelFormat.Bgra8, jpeg ? BitmapAlphaMode.Ignore : BitmapAlphaMode.Premultiplied);
        using var ms = new InMemoryRandomAccessStream();
        var enc = await BitmapEncoder.CreateAsync(encoderId, ms);
        enc.SetSoftwareBitmap(bmp);
        await enc.FlushAsync();
        var bytes = new byte[ms.Size];
        using (var rd = new DataReader(ms.GetInputStreamAt(0))) { await rd.LoadAsync((uint)ms.Size); rd.ReadBytes(bytes); }
        await File.WriteAllBytesAsync(path, bytes);
    }

    public static Task SavePngAsync(ImageBuffer image, string path) => SaveImageAsync(image, path, BitmapEncoder.PngEncoderId);

    // Render PDF pages with the Windows PDF renderer and OCR them (for scanned / image-only PDFs).
    public static (List<DocUnit> units, int totalPages) OcrPdf(string path, int maxPages, Action<string>? status)
    {
        var units = new List<DocUnit>();
        using var fs = File.OpenRead(path);
        var ras = System.IO.WindowsRuntimeStreamExtensions.AsRandomAccessStream(fs);
        var pdf = Wait(Windows.Data.Pdf.PdfDocument.LoadFromStreamAsync(ras));
        int total = (int)pdf.PageCount;
        int n = Math.Min(total, maxPages);
        for (uint i = 0; i < n; i++)
        {
            status?.Invoke($"OCR page {i + 1}/{n}");
            using var page = pdf.GetPage(i);
            using var ms = new InMemoryRandomAccessStream();
            Wait2(page.RenderToStreamAsync(ms, new Windows.Data.Pdf.PdfPageRenderOptions { DestinationWidth = 1800 }));
            ms.Seek(0);
            var lines = Recognize(ToBuffer(ms));
            if (lines.Count == 0) continue;
            var u = new DocUnit { Label = "p. " + (i + 1) };
            for (int k = 0; k < lines.Count; k++) u.Lines.Add((k + 1, lines[k]));
            units.Add(u);
        }
        return (units, total);
    }

    private static void Wait2(Windows.Foundation.IAsyncAction op) => op.AsTask().GetAwaiter().GetResult();
}
