using Microsoft.Graphics.Imaging;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace AiApp;

// Image plumbing shared by OCR, image description and the picture features.
internal static class ImageUtil
{
    // base64 (or a data: URL) -> ImageBuffer. Honours EXIF orientation (phone photos) and shrinks so the longest
    // side is at most maxSide (0 = keep). Models work on modest resolutions, so shrinking is also faster.
    public static async Task<ImageBuffer> FromBase64Async(string base64, int maxSide = 0)
    {
        int comma = base64.IndexOf(',');
        if (base64.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && comma > 0) base64 = base64[(comma + 1)..];
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
        return await FromStreamAsync(stream, maxSide);
    }

    public static async Task<ImageBuffer> FromStreamAsync(IRandomAccessStream stream, int maxSide = 0)
    {
        var decoder = await BitmapDecoder.CreateAsync(stream);
        uint w = decoder.PixelWidth, h = decoder.PixelHeight;
        var tr = new BitmapTransform();
        if (maxSide > 0 && Math.Max(w, h) > maxSide)
        {
            double k = (double)maxSide / Math.Max(w, h);
            tr.ScaledWidth = (uint)Math.Max(1, w * k);
            tr.ScaledHeight = (uint)Math.Max(1, h * k);
        }
        using SoftwareBitmap bitmap = await decoder.GetSoftwareBitmapAsync(
            BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, tr,
            ExifOrientationMode.RespectExifOrientation, ColorManagementMode.DoNotColorManage);
        return ImageBuffer.CreateForSoftwareBitmap(bitmap);
    }

    // ImageBuffer -> PNG bytes -> base64 (for sending a generated picture back to the page).
    public static async Task<string> ToPngBase64Async(ImageBuffer image)
    {
        using var raw = image.CopyToSoftwareBitmap();
        using var bmp = SoftwareBitmap.Convert(raw, BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
        using var ms = new InMemoryRandomAccessStream();
        var enc = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, ms);
        enc.SetSoftwareBitmap(bmp);
        await enc.FlushAsync();
        var bytes = new byte[ms.Size];
        using (var rd = new DataReader(ms.GetInputStreamAt(0))) { await rd.LoadAsync((uint)ms.Size); rd.ReadBytes(bytes); }
        return Convert.ToBase64String(bytes);
    }
}
