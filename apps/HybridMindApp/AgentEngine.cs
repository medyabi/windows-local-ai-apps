using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Enumeration;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace HybridMindApp;

public sealed class AgentConfigDto
{
    [JsonPropertyName("roots")] public List<string> Roots { get; set; } = new();          // folders the agent may read (added only through a native folder picker)
    [JsonPropertyName("workspace")] public string Workspace { get; set; } = "";           // the one folder the agent may write to
    [JsonPropertyName("allowIndexed")] public bool AllowIndexed { get; set; } = true;     // files you already indexed in the app are readable too
    [JsonPropertyName("maxSteps")] public int MaxSteps { get; set; } = 12;
}

public sealed class AgentToolCall
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("argsRaw")] public string ArgsRaw { get; set; } = "{}";   // as the model wrote it (placeholders intact) — goes back into the history
    [JsonPropertyName("args")] public string Args { get; set; } = "{}";         // placeholders restored — used to run the tool locally
}

public sealed class AgentStepReq
{
    [JsonPropertyName("sessionId")] public string SessionId { get; set; } = "";
    [JsonPropertyName("rid")] public string Rid { get; set; } = "";
    [JsonPropertyName("messages")] public string Messages { get; set; } = "[]";   // JSON array of OpenAI-style messages
    [JsonPropertyName("tools")] public bool Tools { get; set; } = true;
    [JsonPropertyName("profile")] public string Profile { get; set; } = "cloud";   // cloud | local
    [JsonPropertyName("compact")] public bool Compact { get; set; }               // small-context model: fewer, shorter tool descriptions
}

public sealed class AgentStepResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("errorKind")] public string? ErrorKind { get; set; }
    [JsonPropertyName("cancelled")] public bool Cancelled { get; set; }
    [JsonPropertyName("content")] public string Content { get; set; } = "";
    [JsonPropertyName("contentRaw")] public string ContentRaw { get; set; } = "";
    [JsonPropertyName("toolCalls")] public List<AgentToolCall> ToolCalls { get; set; } = new();
    [JsonPropertyName("finish")] public string Finish { get; set; } = "";
    [JsonPropertyName("tokensIn")] public int TokensIn { get; set; }
    [JsonPropertyName("tokensOut")] public int TokensOut { get; set; }
    [JsonPropertyName("sentChars")] public int SentChars { get; set; }
    [JsonPropertyName("redactions")] public int Redactions { get; set; }
    [JsonPropertyName("model")] public string Model { get; set; } = "";
    [JsonPropertyName("ms")] public long Ms { get; set; }
}

public sealed class AgentToolReq
{
    [JsonPropertyName("sessionId")] public string SessionId { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("args")] public string Args { get; set; } = "{}";
    [JsonPropertyName("token")] public string? Token { get; set; }              // approval token for a write the user allowed
    [JsonPropertyName("allowAll")] public bool AllowAll { get; set; }           // "allow all writes in this task"
}

public sealed class AgentApproval
{
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("path")] public string Path { get; set; } = "";
    [JsonPropertyName("replacing")] public bool Replacing { get; set; }
    [JsonPropertyName("bytes")] public long Bytes { get; set; }
    [JsonPropertyName("preview")] public string Preview { get; set; } = "";
    [JsonPropertyName("token")] public string Token { get; set; } = "";
}

public sealed class AgentToolResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("result")] public string Result { get; set; } = "";      // text handed back to the model
    [JsonPropertyName("summary")] public string Summary { get; set; } = "";    // one line for the user
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("needsApproval")] public bool NeedsApproval { get; set; }
    [JsonPropertyName("approval")] public AgentApproval? Approval { get; set; }
    [JsonPropertyName("withheld")] public bool Withheld { get; set; }
}

public sealed class AgentStartReq
{
    [JsonPropertyName("paths")] public List<string> Paths { get; set; } = new();   // files attached to this message (readable even outside the roots)
    [JsonPropertyName("privacy")] public string Privacy { get; set; } = "redact";  // redact | block
    [JsonPropertyName("compact")] public bool Compact { get; set; }              // small-context (local) models: shorter tool results
}

// The agent's hands. The cloud model only ever sees tool descriptions and tool results; every call is executed here, in the host, and
// every path is checked here — not in the page. Reads are limited to folders the user added with a native picker (plus attached and
// indexed files); the only place anything can be written is the working folder, and each write needs the user's approval.
internal sealed class AgentEngine
{
    private readonly SpecEngine _docs;
    private readonly string _cfgPath;
    private readonly Action<string> _log;
    private AgentConfigDto _cfg = new();

    private sealed class Session
    {
        public string Id = Guid.NewGuid().ToString("N");
        public Redactor Redactor = new();
        public int MaxChars = 14000;
        public string Privacy = "redact";
        public bool AllowWrites;
        public int Writes;
        public HashSet<string> ExtraReadable = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, string> TextCache = new(StringComparer.OrdinalIgnoreCase);
        public DateTime Created = DateTime.UtcNow;
    }
    private readonly ConcurrentDictionary<string, Session> _sessions = new();
    private readonly ConcurrentDictionary<string, (string session, string name, string hash, DateTime exp)> _tokens = new();

    private const int MaxToolChars = 14000, MaxWriteBytes = 1024 * 1024, MaxWritesPerTask = 20;
    private static readonly string[] DenyDirs = { ".ssh", ".aws", ".gnupg", ".azure", "appdata", ".kube", "$recycle.bin", "system volume information" };
    private static readonly string[] DenyFileGlobs = { ".env", ".env.*", "id_rsa*", "id_ed25519*", "id_ecdsa*", "*.pem", "*.key", "*.pfx", "*.p12", "*.kdbx", "*.ovpn", "credentials", "credentials.*", "secrets.*", "*.keystore", ".npmrc", ".pypirc", ".netrc", "*.rdp" };
    private static readonly HashSet<string> NeverWrite = new(StringComparer.OrdinalIgnoreCase) { ".exe", ".dll", ".msi", ".bat", ".cmd", ".ps1", ".psm1", ".psd1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".lnk", ".scr", ".com", ".jar", ".reg", ".url", ".appx", ".msix", ".sys", ".cpl", ".inf", ".pif", ".gadget", ".application", ".msc" };
    private static readonly HashSet<string> TextWriteExt = new(StringComparer.OrdinalIgnoreCase) { ".md", ".txt", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".css", ".svg", ".log", ".sql", ".py", ".ts", ".cs", ".java", ".c", ".cpp", ".h", ".go", ".rs", ".ini", ".toml" };
    private static readonly string[] Reserved = { "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "lpt1", "lpt2", "lpt3" };

    public AgentEngine(SpecEngine docs, string stateDir, Action<string> log)
    {
        _docs = docs; _log = log; _cfgPath = Path.Combine(stateDir, "agent.json");
        try { if (File.Exists(_cfgPath)) _cfg = JsonSerializer.Deserialize(File.ReadAllText(_cfgPath), BridgeJsonContext.Default.AgentConfigDto) ?? new(); } catch (Exception ex) { _log("Agent config load failed: " + ex.Message); }
        if (string.IsNullOrWhiteSpace(_cfg.Workspace)) _cfg.Workspace = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "HybridMind Workspace");
    }

    // ── configuration (folders can only be added through a native picker the user operates) ──
    public AgentConfigDto GetConfig() => new() { Roots = _cfg.Roots.ToList(), Workspace = _cfg.Workspace, AllowIndexed = _cfg.AllowIndexed, MaxSteps = _cfg.MaxSteps };
    private void Save() { try { File.WriteAllText(_cfgPath, JsonSerializer.Serialize(_cfg, BridgeJsonContext.Default.AgentConfigDto)); } catch (Exception ex) { _log("Agent config save failed: " + ex.Message); } }
    public void AddRoot(string path)
    {
        var full = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
        if (full.Length <= 3) throw new ArgumentException("Pick a folder, not a whole drive.");
        if (DenyDirs.Any(d => full.Split(Path.DirectorySeparatorChar).Any(seg => seg.Equals(d, StringComparison.OrdinalIgnoreCase)))) throw new ArgumentException("That folder holds application data or credentials and can’t be shared with the agent.");
        if (!_cfg.Roots.Contains(full, StringComparer.OrdinalIgnoreCase)) _cfg.Roots.Add(full);
        Save();
    }
    public void RemoveRoot(string path) { _cfg.Roots.RemoveAll(r => r.Equals(path, StringComparison.OrdinalIgnoreCase)); Save(); }
    public void SetWorkspace(string path) { _cfg.Workspace = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar); Save(); }
    public void SetOptions(bool allowIndexed, int maxSteps) { _cfg.AllowIndexed = allowIndexed; _cfg.MaxSteps = Math.Clamp(maxSteps, 2, 30); Save(); }
    public string Workspace => _cfg.Workspace;

    // ── sessions ──
    public (string id, Redactor redactor) Start(AgentStartReq req)
    {
        foreach (var old in _sessions.Where(kv => DateTime.UtcNow - kv.Value.Created > TimeSpan.FromHours(3)).Select(kv => kv.Key).ToList()) _sessions.TryRemove(old, out _);
        var s = new Session { Privacy = req.Privacy == "block" ? "block" : "redact", MaxChars = req.Compact ? 3000 : MaxToolChars };
        foreach (var p in req.Paths) { try { s.ExtraReadable.Add(Path.GetFullPath(p)); } catch { } }
        _sessions[s.Id] = s;
        return (s.Id, s.Redactor);
    }
    public Redactor? RedactorOf(string id) => _sessions.TryGetValue(id, out var s) ? s.Redactor : null;
    public void End(string id) => _sessions.TryRemove(id, out _);

    // ── path rules ──
    private static bool IsUnder(string root, string full) => full.Equals(root, StringComparison.OrdinalIgnoreCase) || full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    private IEnumerable<string> ReadRoots() => _cfg.Roots.Concat(new[] { _cfg.Workspace });

    private static bool Denied(string full)
    {
        var segs = full.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        if (segs.Any(sg => DenyDirs.Contains(sg, StringComparer.OrdinalIgnoreCase))) return true;
        var name = Path.GetFileName(full);
        return DenyFileGlobs.Any(g => FileSystemName.MatchesSimpleExpression(g, name, true));
    }

    // a path below the root must not pass through a junction / symlink (it could lead outside the root)
    private static bool HasReparse(string root, string full)
    {
        try
        {
            var cur = full;
            while (cur.Length > root.Length && IsUnder(root, cur))
            {
                var fi = new FileInfo(cur);
                if ((fi.Exists || Directory.Exists(cur)) && (File.GetAttributes(cur) & FileAttributes.ReparsePoint) != 0) return true;
                cur = Path.GetDirectoryName(cur) ?? "";
                if (cur.Length == 0) break;
            }
        }
        catch { return true; }
        return false;
    }

    private string? ResolveReadable(Session s, string input, out string error)
    {
        error = "";
        if (string.IsNullOrWhiteSpace(input)) { error = "No path given."; return null; }
        string? full = null;
        try
        {
            if (Path.IsPathRooted(input)) full = Path.GetFullPath(input);
            else
            {
                foreach (var r in ReadRoots()) { var c = Path.GetFullPath(Path.Combine(r, input)); if (IsUnder(r, c) && (File.Exists(c) || Directory.Exists(c))) { full = c; break; } }
                full ??= Path.GetFullPath(Path.Combine(_cfg.Workspace, input));
            }
        }
        catch { error = "That isn’t a valid path."; return null; }
        if (Denied(full)) { error = "Access denied: that location looks like it holds credentials or application data."; return null; }
        string? root = ReadRoots().FirstOrDefault(r => IsUnder(r, full));
        bool ok = root != null || s.ExtraReadable.Contains(full) || (_cfg.AllowIndexed && _docs.HasDoc(full));
        if (!ok) { error = "Access denied: that path is outside the folders you allowed for the agent."; return null; }
        if (root != null && HasReparse(root, full)) { error = "Access denied: the path passes through a link (junction/symlink)."; return null; }
        return full;
    }

    // ── tool descriptions sent to the model ──
    // Small local models do better with a short list: the five file tools with one-line descriptions.
    public static JsonArray ToolSpecs(bool compact)
    {
        var all = ToolSpecs();
        if (!compact) return all;
        var keep = new Dictionary<string, string>
        {
            ["search_files"] = "Search the user's indexed files. Returns passages with file path.",
            ["list_folder"] = "List a folder (empty path = the allowed folders).",
            ["find_files"] = "Find files by name pattern like *.pdf.",
            ["read_file"] = "Read a file's text (use offset to continue).",
            ["write_file"] = "Create a text file in the working folder (user approves).",
        };
        var res = new JsonArray();
        foreach (var t in all)
        {
            var name = t!["function"]!["name"]!.ToString();
            if (!keep.TryGetValue(name, out var d)) continue;
            var o = JsonNode.Parse(t.ToJsonString())!.AsObject();
            o["function"]!["description"] = d;
            // drop the long per-parameter descriptions too
            if (o["function"]!["parameters"]!["properties"] is JsonObject props) foreach (var kv in props.ToList()) if (kv.Value is JsonObject po) po.Remove("description");
            res.Add(o);
        }
        return res;
    }

    public static JsonArray ToolSpecs()
    {
        JsonObject Fn(string name, string desc, JsonObject props, params string[] required) => new()
        {
            ["type"] = "function",
            ["function"] = new JsonObject { ["name"] = name, ["description"] = desc, ["parameters"] = new JsonObject { ["type"] = "object", ["properties"] = props, ["required"] = new JsonArray(required.Select(r => (JsonNode)r).ToArray()) } },
        };
        JsonObject P(string type, string desc) => new() { ["type"] = type, ["description"] = desc };
        return new JsonArray
        {
            Fn("search_files", "Search the user's indexed files by meaning and keywords. Returns the best-matching passages with file path and location.", new JsonObject { ["query"] = P("string", "What to look for"), ["max_results"] = P("integer", "1-10, default 6") }, "query"),
            Fn("list_folder", "List the files and sub-folders in a folder. Leave path empty to list the folders you may read.", new JsonObject { ["path"] = P("string", "Folder path (absolute, or relative to an allowed folder)") }),
            Fn("find_files", "Find files by name pattern (wildcards like *.pdf or report*) in the allowed folders.", new JsonObject { ["pattern"] = P("string", "File-name pattern"), ["folder"] = P("string", "Optional folder to search in"), ["max_results"] = P("integer", "default 50") }, "pattern"),
            Fn("read_file", "Read a file's text (PDF, Word, Excel, PowerPoint, text and code; pictures are read with OCR plus a description). Long files are paged with offset.", new JsonObject { ["path"] = P("string", "File path"), ["offset"] = P("integer", "Character offset to start at (default 0)"), ["max_chars"] = P("integer", "Up to 14000 (default 8000)") }, "path"),
            Fn("write_file", "Create or replace a text file in the working folder. The user must approve every write. Use a relative path such as notes/summary.md.", new JsonObject { ["path"] = P("string", "Relative path inside the working folder"), ["content"] = P("string", "Full file content"), ["overwrite"] = P("boolean", "Set true to replace an existing file (the old copy is kept in .history)") }, "path", "content"),
            Fn("copy_to_workspace", "Copy one readable file into the working folder (never modifies the original). The user must approve.", new JsonObject { ["source"] = P("string", "Path of the file to copy"), ["dest"] = P("string", "Optional relative name in the working folder") }, "source"),
            Fn("calculate", "Evaluate an arithmetic expression exactly (+ - * / ^ %, parentheses, sqrt, abs, round, min, max…).", new JsonObject { ["expression"] = P("string", "e.g. (1250*1.2)/4") }, "expression"),
            Fn("current_datetime", "Get the user's current local date and time.", new JsonObject()),
        };
    }

    // ── execution ──
    private static string Json(object o) => JsonSerializer.Serialize(o, new JsonSerializerOptions { WriteIndented = false, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
    private static string Clip(string s, int n) => s.Length <= n ? s : s.Substring(0, n) + "…";

    public async Task<AgentToolResult> RunAsync(AgentToolReq req)
    {
        if (!_sessions.TryGetValue(req.SessionId, out var s)) return new AgentToolResult { Error = "The agent session has ended." };
        JsonNode? a;
        try { a = JsonNode.Parse(string.IsNullOrWhiteSpace(req.Args) ? "{}" : req.Args); } catch { return new AgentToolResult { Error = "The tool arguments weren’t valid JSON." }; }
        a ??= new JsonObject();
        string Str(string k) => a[k]?.ToString() ?? "";
        int Int(string k, int d) => int.TryParse(a[k]?.ToString(), out var v) ? v : d;
        try
        {
            AgentToolResult r = req.Name switch
            {
                "search_files" => await Task.Run(() => SearchFiles(s, Str("query"), Int("max_results", 6))),
                "list_folder" => ListFolder(s, Str("path")),
                "find_files" => FindFiles(s, Str("pattern"), Str("folder"), Int("max_results", 50)),
                "read_file" => await Task.Run(() => ReadFile(s, Str("path"), Int("offset", 0), Int("max_chars", 8000))),
                "write_file" => await WriteFileAsync(s, req, Str("path"), Str("content"), (a["overwrite"]?.ToString() ?? "").Equals("true", StringComparison.OrdinalIgnoreCase)),
                "copy_to_workspace" => await CopyAsync(s, req, Str("source"), Str("dest")),
                _ => new AgentToolResult { Error = "Unknown tool: " + req.Name },
            };
            // tool output is data that is about to be sent to the cloud: apply the privacy policy to it as well
            if (r.Ok && s.Privacy == "block" && req.Name is "read_file" or "search_files" or "list_folder" or "find_files")
            {
                var probe = new Redactor(); probe.Redact(r.Result);
                if (probe.Any) { _log($"Agent: {req.Name} output withheld (sensitive-looking data: {string.Join(",", probe.Findings.Select(f => f.Kind))})"); return new AgentToolResult { Ok = false, Withheld = true, Error = "Withheld: the result contains sensitive-looking data (" + string.Join(", ", probe.Findings.Select(f => f.Kind.ToLowerInvariant().Replace('_', ' '))) + ") and your privacy setting keeps such data on this PC.", Summary = "withheld — sensitive-looking data" }; }
            }
            if (r.Result.Length > s.MaxChars + 200) r.Result = r.Result.Substring(0, s.MaxChars) + "…[truncated]";
            return r;
        }
        catch (Exception ex) { _log($"Agent tool {req.Name} failed: {ex.GetType().Name}: {ex.Message}"); return new AgentToolResult { Error = ex.Message }; }
    }

    private AgentToolResult SearchFiles(Session s, string query, int max)
    {
        if (string.IsNullOrWhiteSpace(query)) return new AgentToolResult { Error = "Give a query." };
        var readable = new HashSet<string>(_docs.GetLibrary().Docs.Where(d => d.Status == "indexed" && ResolveReadable(s, d.Path, out _) != null).Select(d => d.Path), StringComparer.OrdinalIgnoreCase);
        if (readable.Count == 0) return new AgentToolResult { Ok = true, Result = "[]", Summary = "no indexed files available — try find_files / list_folder" };
        var sr = _docs.Search(query, null, Math.Clamp(max, 1, 10), null, readable);
        var rows = sr.Hits.Take(Math.Clamp(max, 1, 10)).Select(h => new { file = h.DocName, path = h.DocPath, location = h.Loc, excerpt = Clip(h.Text.Trim(), 700) }).ToList();
        return new AgentToolResult { Ok = true, Result = Json(rows), Summary = rows.Count + " passage" + (rows.Count == 1 ? "" : "s") + (rows.Count > 0 ? " from " + rows.Select(r => r.file).Distinct().Count() + " file(s)" : "") };
    }

    private AgentToolResult ListFolder(Session s, string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            var roots = _cfg.Roots.Select(r => new { path = r, type = "folder (read-only)" }).Concat(new[] { new { path = _cfg.Workspace, type = "working folder (read + write)" } }).ToList();
            return new AgentToolResult { Ok = true, Result = Json(roots), Summary = roots.Count + " allowed folder(s)" };
        }
        var full = ResolveReadable(s, path, out var err);
        if (full == null) return new AgentToolResult { Error = err };
        if (!Directory.Exists(full)) return new AgentToolResult { Error = "That folder doesn’t exist." };
        var items = new List<object>();
        foreach (var d in Directory.EnumerateDirectories(full).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
        {
            if (Denied(d) || items.Count >= 200) continue;
            items.Add(new { name = Path.GetFileName(d), type = "folder" });
        }
        foreach (var f in Directory.EnumerateFiles(full).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
        {
            if (Denied(f) || items.Count >= 200) continue;
            var fi = new FileInfo(f);
            items.Add(new { name = fi.Name, type = "file", size = fi.Length, modified = fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm") });
        }
        return new AgentToolResult { Ok = true, Result = Json(items), Summary = items.Count + " item(s) in " + Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar)) };
    }

    private AgentToolResult FindFiles(Session s, string pattern, string folder, int max)
    {
        if (string.IsNullOrWhiteSpace(pattern)) return new AgentToolResult { Error = "Give a pattern like *.pdf." };
        var starts = new List<string>();
        if (string.IsNullOrWhiteSpace(folder)) starts.AddRange(ReadRoots());
        else { var f = ResolveReadable(s, folder, out var err); if (f == null) return new AgentToolResult { Error = err }; starts.Add(f); }
        var found = new List<object>();
        int cap = Math.Clamp(max, 1, 100);
        void Walk(string dir, int depth)
        {
            if (depth > 6 || found.Count >= cap) return;
            try
            {
                foreach (var f in Directory.EnumerateFiles(dir))
                {
                    if (found.Count >= cap) return;
                    if (Denied(f) || !FileSystemName.MatchesSimpleExpression(pattern, Path.GetFileName(f), true)) continue;
                    var fi = new FileInfo(f);
                    found.Add(new { path = f, size = fi.Length, modified = fi.LastWriteTime.ToString("yyyy-MM-dd") });
                }
                foreach (var d in Directory.EnumerateDirectories(dir))
                {
                    var n = Path.GetFileName(d);
                    if (Denied(d) || n.Equals("node_modules", StringComparison.OrdinalIgnoreCase) || n.Equals(".git", StringComparison.OrdinalIgnoreCase) || (File.GetAttributes(d) & FileAttributes.ReparsePoint) != 0) continue;
                    Walk(d, depth + 1);
                }
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException || ex is IOException) { }
        }
        foreach (var st in starts.Where(Directory.Exists)) Walk(st, 0);
        return new AgentToolResult { Ok = true, Result = Json(found), Summary = found.Count + " file(s) match " + pattern };
    }

    private AgentToolResult ReadFile(Session s, string path, int offset, int maxChars)
    {
        var full = ResolveReadable(s, path, out var err);
        if (full == null) return new AgentToolResult { Error = err };
        if (!File.Exists(full)) return new AgentToolResult { Error = "That file doesn’t exist." };
        var fi = new FileInfo(full);
        if (fi.Length > 60L * 1024 * 1024) return new AgentToolResult { Error = "That file is larger than 60 MB." };
        var key = full + "|" + fi.LastWriteTimeUtc.Ticks;
        if (!s.TextCache.TryGetValue(key, out var text))
        {
            var kind = Extractor.Classify(full);
            if (kind == FileKind.Unknown && Extractor.LooksLikeText(full)) kind = FileKind.Text;
            if (kind is FileKind.Skip or FileKind.Unknown) return new AgentToolResult { Error = "That file type can’t be read as text." };
            if (kind == FileKind.Legacy) return new AgentToolResult { Error = "Old .doc/.xls/.ppt files aren’t supported; save as the modern format." };
            var res = Extractor.Extract(full, kind, new ExtractOptions { DescribePhotos = true });
            var sb = new StringBuilder();
            foreach (var u in res.Units)
            {
                if (!string.IsNullOrEmpty(u.Label)) sb.Append("--- ").Append(u.Label).Append(" ---\n");
                foreach (var (_, t) in u.Lines) sb.Append(t).Append('\n');
            }
            text = sb.ToString();
            if (!string.IsNullOrEmpty(res.Note)) text = "[" + res.Note + "]\n" + text;
            s.TextCache[key] = text;
        }
        offset = Math.Clamp(offset, 0, text.Length);
        maxChars = Math.Clamp(maxChars, 500, s.MaxChars);
        var piece = text.Substring(offset, Math.Min(maxChars, text.Length - offset));
        int next = offset + piece.Length;
        var o = new { name = fi.Name, path = full, total_chars = text.Length, offset, returned_chars = piece.Length, next_offset = next < text.Length ? (int?)next : null, text = piece };
        return new AgentToolResult { Ok = true, Result = Json(o), Summary = $"{fi.Name}: {piece.Length:N0} of {text.Length:N0} chars" };
    }

    // ── writes (working folder only, each one approved) ──
    private string? ResolveWorkspaceTarget(string rel, out string error, bool dataExtensions = false)
    {
        error = "";
        if (string.IsNullOrWhiteSpace(rel) || Path.IsPathRooted(rel) || rel.Contains(':') || rel.StartsWith("\\\\") || rel.Contains("..")) { error = "Use a relative path inside the working folder (no drive letters, no “..”)."; return null; }
        var segs = rel.Replace('/', '\\').Split('\\', StringSplitOptions.RemoveEmptyEntries);
        if (segs.Length == 0 || segs.Any(sg => sg.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || Reserved.Contains(Path.GetFileNameWithoutExtension(sg).ToLowerInvariant()) || sg.EndsWith('.') || sg.EndsWith(' ') || sg.Equals(".history", StringComparison.OrdinalIgnoreCase))) { error = "That file name isn’t allowed."; return null; }
        var ext = Path.GetExtension(segs[^1]);
        if (NeverWrite.Contains(ext)) { error = $"Files of type {ext} (programs and scripts that Windows can run) can’t be written by the agent."; return null; }
        if (!dataExtensions && !TextWriteExt.Contains(ext)) { error = $"The agent can write text files only ({string.Join(" ", TextWriteExt.Take(10))} …); {ext} isn’t allowed."; return null; }
        var ws = Path.GetFullPath(_cfg.Workspace);
        var full = Path.GetFullPath(Path.Combine(ws, string.Join(Path.DirectorySeparatorChar, segs)));
        if (!IsUnder(ws, full)) { error = "That path is outside the working folder."; return null; }
        if (Directory.Exists(ws) && HasReparse(ws, full)) { error = "The path passes through a link (junction/symlink)."; return null; }
        return full;
    }

    private (AgentToolResult? needs, bool go) Gate(Session s, AgentToolReq req, string title, string path, bool replacing, long bytes, string preview)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(req.Name + "\n" + req.Args)));
        if (!string.IsNullOrEmpty(req.Token) && _tokens.TryRemove(req.Token, out var t) && t.session == s.Id && t.name == req.Name && t.hash == hash && t.exp > DateTime.UtcNow)
        {
            if (req.AllowAll) s.AllowWrites = true;
            return (null, true);
        }
        if (s.AllowWrites) return (null, true);
        var token = Guid.NewGuid().ToString("N");
        foreach (var old in _tokens.Where(kv => kv.Value.exp < DateTime.UtcNow).Select(kv => kv.Key).ToList()) _tokens.TryRemove(old, out _);
        _tokens[token] = (s.Id, req.Name, hash, DateTime.UtcNow.AddMinutes(10));
        return (new AgentToolResult { NeedsApproval = true, Approval = new AgentApproval { Title = title, Path = path, Replacing = replacing, Bytes = bytes, Preview = Clip(preview, 2500), Token = token }, Summary = "waiting for your approval" }, false);
    }

    private async Task<AgentToolResult> WriteFileAsync(Session s, AgentToolReq req, string rel, string content, bool overwrite)
    {
        if (s.Writes >= MaxWritesPerTask) return new AgentToolResult { Error = $"Limit reached: at most {MaxWritesPerTask} files per task." };
        var full = ResolveWorkspaceTarget(rel, out var err);
        if (full == null) return new AgentToolResult { Error = err };
        var bytes = Encoding.UTF8.GetByteCount(content);
        if (bytes > MaxWriteBytes) return new AgentToolResult { Error = "That content is larger than 1 MB." };
        bool exists = File.Exists(full);
        if (exists && !overwrite) return new AgentToolResult { Error = "That file already exists. Pick another name, or pass overwrite:true to replace it (the user must approve, and the old copy is kept in .history)." };
        var (needs, go) = Gate(s, req, exists ? "Allow the agent to REPLACE a file?" : "Allow the agent to create a file?", full, exists, bytes, content);
        if (!go) return needs!;
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        if (exists)
        {
            var hist = Path.Combine(_cfg.Workspace, ".history"); Directory.CreateDirectory(hist);
            File.Copy(full, Path.Combine(hist, Path.GetFileNameWithoutExtension(full) + "." + DateTime.Now.ToString("yyyyMMdd-HHmmss") + Path.GetExtension(full)), true);
        }
        await File.WriteAllTextAsync(full, content, new UTF8Encoding(false));
        s.Writes++;
        _log($"Agent wrote {Path.GetFileName(full)} ({bytes} bytes, replaced={exists})");
        return new AgentToolResult { Ok = true, Result = Json(new { written = full, bytes, replaced = exists }), Summary = (exists ? "replaced " : "created ") + rel + $" ({bytes:N0} bytes)" };
    }

    private async Task<AgentToolResult> CopyAsync(Session s, AgentToolReq req, string source, string dest)
    {
        if (s.Writes >= MaxWritesPerTask) return new AgentToolResult { Error = $"Limit reached: at most {MaxWritesPerTask} files per task." };
        var src = ResolveReadable(s, source, out var err);
        if (src == null) return new AgentToolResult { Error = err };
        if (!File.Exists(src)) return new AgentToolResult { Error = "The source file doesn’t exist." };
        var fi = new FileInfo(src);
        if (fi.Length > 50L * 1024 * 1024) return new AgentToolResult { Error = "That file is larger than 50 MB." };
        var full = ResolveWorkspaceTarget(string.IsNullOrWhiteSpace(dest) ? fi.Name : dest, out err, dataExtensions: true);
        if (full == null) return new AgentToolResult { Error = err };
        if (File.Exists(full)) return new AgentToolResult { Error = "A file with that name already exists in the working folder." };
        var (needs, go) = Gate(s, req, "Allow the agent to copy a file into the working folder?", full, false, fi.Length, "Copy of:\n" + src);
        if (!go) return needs!;
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await Task.Run(() => File.Copy(src, full, false));
        s.Writes++;
        return new AgentToolResult { Ok = true, Result = Json(new { copied = full, bytes = fi.Length }), Summary = "copied " + fi.Name + " to the working folder" };
    }
}
