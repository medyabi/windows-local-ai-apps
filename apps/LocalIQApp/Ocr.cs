using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Graphics.Imaging;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.ContentSafety;
using Microsoft.Windows.AI.Imaging;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace LocalIQApp;

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

    public static ImageBuffer ToBuffer(IRandomAccessStream stream)
    {
        var decoder = Wait(BitmapDecoder.CreateAsync(stream));
        using SoftwareBitmap bitmap = Wait(decoder.GetSoftwareBitmapAsync());
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
