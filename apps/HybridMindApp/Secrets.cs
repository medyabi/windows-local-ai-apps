using System;
using System.IO;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Threading.Tasks;
using Windows.Security.Cryptography;
using Windows.Security.Cryptography.DataProtection;

namespace HybridMindApp;

// The cloud API key lives only in the host process and on disk encrypted with Windows DPAPI for the current user
// (via the WinRT DataProtectionProvider). The web page can save a key but can never read it back.
internal sealed class Secrets
{
    private readonly string _path;
    private string? _cached;

    public Secrets(string path) { _path = path; }

    public bool Has => File.Exists(_path);

    public async Task SaveAsync(string secret)
    {
        var provider = new DataProtectionProvider("LOCAL=user");
        var buf = CryptographicBuffer.ConvertStringToBinary(secret, BinaryStringEncoding.Utf8);
        var protectedBuf = await provider.ProtectAsync(buf);
        await File.WriteAllBytesAsync(_path, protectedBuf.ToArray());
        _cached = secret;
    }

    public async Task<string?> LoadAsync()
    {
        if (_cached != null) return _cached;
        if (!File.Exists(_path)) return null;
        try
        {
            var provider = new DataProtectionProvider();
            var bytes = await File.ReadAllBytesAsync(_path);
            var clear = await provider.UnprotectAsync(bytes.AsBuffer());
            _cached = CryptographicBuffer.ConvertBinaryToString(BinaryStringEncoding.Utf8, clear);
            return _cached;
        }
        catch { return null; }
    }

    public void Clear()
    {
        _cached = null;
        if (File.Exists(_path)) File.Delete(_path);
    }
}
