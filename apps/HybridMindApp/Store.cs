using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace HybridMindApp;

// A tiny key → JSON file store for the page's data (chats, memories, settings…), kept in the app's own data folder.
// Writes are atomic (write a temp file, then swap), and a value must be valid JSON so one bad write can't poison a read.
internal sealed class KvStore
{
    private readonly string _dir;
    private readonly object _lock = new();
    private static readonly Regex KeyRx = new(@"^[A-Za-z0-9._-]{1,90}$", RegexOptions.Compiled);

    public KvStore(string dir)
    {
        _dir = dir;
        Directory.CreateDirectory(_dir);
    }

    public static bool ValidKey(string key) => KeyRx.IsMatch(key) && !key.Contains("..");
    private string PathFor(string key) => Path.Combine(_dir, key + ".json");

    public string? Get(string key)
    {
        if (!ValidKey(key)) throw new ArgumentException("Invalid key.");
        lock (_lock)
        {
            var p = PathFor(key);
            return File.Exists(p) ? File.ReadAllText(p, Encoding.UTF8) : null;
        }
    }

    public void Put(string key, string json)
    {
        if (!ValidKey(key)) throw new ArgumentException("Invalid key.");
        using (JsonDocument.Parse(json)) { }   // throws if it isn't JSON
        lock (_lock)
        {
            var p = PathFor(key);
            var tmp = p + ".tmp";
            File.WriteAllText(tmp, json, new UTF8Encoding(false));
            File.Move(tmp, p, true);
        }
    }

    public void Delete(string key)
    {
        if (!ValidKey(key)) throw new ArgumentException("Invalid key.");
        lock (_lock) { var p = PathFor(key); if (File.Exists(p)) File.Delete(p); }
    }

    public List<string> List(string prefix)
    {
        lock (_lock)
            return Directory.EnumerateFiles(_dir, "*.json")
                .Select(f => Path.GetFileNameWithoutExtension(f))
                .Where(k => k.StartsWith(prefix, StringComparison.Ordinal))
                .OrderBy(k => k, StringComparer.Ordinal).ToList();
    }

    // {"key": value, …} for every key with the prefix — values are the stored JSON, embedded as is.
    public string GetAll(string prefix)
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms))
        {
            w.WriteStartObject();
            foreach (var k in List(prefix))
            {
                string? v;
                try { v = Get(k); } catch { continue; }
                if (v == null) continue;
                w.WritePropertyName(k);
                w.WriteRawValue(v, skipInputValidation: true);
            }
            w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    public long SizeBytes()
    {
        lock (_lock) return Directory.EnumerateFiles(_dir, "*.json").Sum(f => new FileInfo(f).Length);
    }
}
