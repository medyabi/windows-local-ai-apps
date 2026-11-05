using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Windows.Search.AppContentIndex;

namespace LocalIQApp;

internal sealed class GenResult
{
    public string Text = "";
    public string Status = "";
    public string? Error;
}

// The whole "ask your documents" backend: library store, extraction + chunking, the local
// AppContentIndexer index, hybrid retrieval, grounded prompting, and deterministic verification.
internal sealed class SpecEngine
{
    private const string IndexName = "localiq-index";

    private readonly string _storePath;
    private readonly Action<string> _log;
    private readonly object _lock = new();

    private readonly Dictionary<string, DocInfo> _docs = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, ChunkRec> _chunks = new();
    private readonly Dictionary<string, List<string>> _docChunks = new(StringComparer.OrdinalIgnoreCase);
    private string? _lastFolder;
    private AppContentIndexer? _index;
    private bool _indexing;

    // lexical (keyword) index, rebuilt lazily after the library changes
    private bool _lexDirty = true;
    private Dictionary<string, int> _df = new();
    private Dictionary<string, Dictionary<string, int>> _tf = new();
    private Dictionary<string, int> _len = new();
    private double _avgLen = 1;
    private readonly Dictionary<string, HashSet<string>> _nameTokens = new(StringComparer.OrdinalIgnoreCase);

    public SpecEngine(string storePath, Action<string> log)
    {
        _storePath = storePath;
        _log = log;
        Load();
    }

    // ── persistence ────────────────────────────────────────────────────────
    private void Load()
    {
        try
        {
            if (!File.Exists(_storePath)) return;
            var sf = JsonSerializer.Deserialize(File.ReadAllText(_storePath), BridgeJsonContext.Default.StoreFile);
            if (sf == null) return;
            foreach (var d in sf.Docs) _docs[d.Path] = d;
            foreach (var c in sf.Chunks)
            {
                _chunks[c.Id] = c;
                if (!_docChunks.TryGetValue(c.DocPath, out var l)) _docChunks[c.DocPath] = l = new List<string>();
                l.Add(c.Id);
            }
            _lastFolder = sf.LastFolder;
            _log($"Store loaded: {_docs.Count} docs, {_chunks.Count} chunks");
        }
        catch (Exception ex) { _log("Store load failed: " + ex.Message); }
    }

    private void Save()
    {
        try
        {
            StoreFile sf;
            lock (_lock) { sf = new StoreFile { Docs = _docs.Values.ToList(), Chunks = _chunks.Values.ToList(), LastFolder = _lastFolder }; }
            var tmp = _storePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(sf, BridgeJsonContext.Default.StoreFile));
            File.Move(tmp, _storePath, true);
        }
        catch (Exception ex) { _log("Store save failed: " + ex.Message); }
    }

    public LibraryInfo GetLibrary()
    {
        lock (_lock)
            return new LibraryInfo
            {
                Docs = _docs.Values.OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase).ToList(),
                TotalChunks = _chunks.Count,
                LastFolder = _lastFolder,
            };
    }

    public bool HasDoc(string path) { lock (_lock) return _docs.ContainsKey(path); }

    // ── the AppContentIndexer ──────────────────────────────────────────────
    // Microsoft's docs warn against calling this API on the UI thread — callers always go through Task.Run.
    private AppContentIndexer GetIndex()
    {
        lock (_lock)
        {
            if (_index != null) return _index;
            var r = AppContentIndexer.GetOrCreateIndex(IndexName);
            if (!r.Succeeded) throw new InvalidOperationException($"Could not open the local index ({r.Status}: {r.ExtendedError}).");
            _index = r.Indexer;
            _log("Index opened: " + r.Status);
            if (_docs.Count == 0)
            {
                try { _index.RemoveAllContentItems(); } catch (Exception ex) { _log("RemoveAll failed: " + ex.Message); }
            }
            return _index;
        }
    }

    public async Task<IndexStatus> GetStatusAsync()
    {
        return await Task.Run(() =>
        {
            var st = new IndexStatus();
            try
            {
                var ix = GetIndex();
                st.IndexReady = true;
                try
                {
                    var caps = ix.GetIndexCapabilities();
                    st.Semantic = caps.GetCapabilityState(IndexCapability.TextSemantic).InitializationStatus.ToString();
                    st.Lexical = caps.GetCapabilityState(IndexCapability.TextLexical).InitializationStatus.ToString();
                }
                catch (Exception ex) { st.Detail = "capabilities: " + ex.Message; }
                try
                {
                    var stats = ix.GetIndexStatistics();
                    st.Items = Convert.ToInt64(stats.ItemCount);
                    st.Completed = Convert.ToInt64(stats.CompletedCount);
                    st.Pending = Convert.ToInt64(stats.NotStartedCount) + Convert.ToInt64(stats.InProgressCount);
                    st.Errors = Convert.ToInt64(stats.ErrorsCount);
                    st.Idle = !stats.IndexingInProgress && st.Pending == 0;
                }
                catch (Exception ex) { st.Detail += " stats: " + ex.Message; }
            }
            catch (Exception ex) { st.Detail = ex.Message; }
            return st;
        });
    }

    // ── indexing ───────────────────────────────────────────────────────────
    private static string DocKey(string path) =>
        Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(path.ToLowerInvariant())))[..10].ToLowerInvariant();

    private static readonly HashSet<string> SkipDirs = new(StringComparer.OrdinalIgnoreCase)
        { "node_modules", ".git", "__pycache__", ".venv", "venv", ".vs", "$RECYCLE.BIN", "System Volume Information" };
    private const int MaxFiles = 5000;
    private bool _describePhotos;

    private List<string> Enumerate(IEnumerable<string> roots, IndexSummary sum)
    {
        var files = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        bool capped = false;
        void AddFile(string f)
        {
            var name = Path.GetFileName(f);
            if (name.StartsWith("~$")) return;
            var kind = Extractor.Classify(f);
            if (kind == FileKind.Skip) { sum.Skipped++; return; }
            if (kind == FileKind.Unknown && !Extractor.LooksLikeText(f)) { sum.Skipped++; return; }
            if (!seen.Add(f)) return;
            if (files.Count >= MaxFiles) { capped = true; return; }
            files.Add(f);
        }
        void Walk(string dir, int depth)
        {
            if (depth > 12) return;
            try
            {
                foreach (var f in Directory.EnumerateFiles(dir)) AddFile(f);
                foreach (var d in Directory.EnumerateDirectories(dir))
                    if (!SkipDirs.Contains(Path.GetFileName(d))) Walk(d, depth + 1);
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException || ex is IOException) { sum.Messages.Add($"Could not read folder {dir}: {ex.Message}"); }
        }
        foreach (var raw in roots)
        {
            var r = raw.Trim().Trim('"');
            if (r.Length == 0) continue;
            try { r = Path.GetFullPath(r); } catch { sum.Messages.Add("Invalid path: " + raw); continue; }
            if (Directory.Exists(r)) { Walk(r, 0); lock (_lock) _lastFolder = r; }
            else if (File.Exists(r)) AddFile(r);
            else sum.Messages.Add("Path not found: " + r);
        }
        if (capped) sum.Messages.Add($"Stopped after {MaxFiles} files — index a narrower folder (or run it again on subfolders) for the rest.");
        return files;
    }

    public IndexSummary IndexPaths(IEnumerable<string> roots, Action<ProgressEvent> progress, bool describePhotos = false)
    {
        lock (_lock)
        {
            if (_indexing) throw new InvalidOperationException("Indexing is already running — wait for it to finish.");
            _indexing = true;
        }
        try
        {
            _describePhotos = describePhotos;
            var sw = Stopwatch.StartNew();
            var sum = new IndexSummary();
            progress(new ProgressEvent { Stage = "scanning" });
            var files = Enumerate(roots, sum);
            sum.FilesSeen = files.Count;
            if (files.Count == 0 && sum.Messages.Count == 0) sum.Messages.Add("No indexable files found (documents, PDFs, spreadsheets, slides, notes, code, images…).");
            var ix = GetIndex();
            int i = 0;
            foreach (var f in files)
            {
                i++;
                var name = Path.GetFileName(f);
                int cur = i;
                progress(new ProgressEvent { Stage = "indexing", Current = cur, Total = files.Count, File = name });
                Action<string> status = s => progress(new ProgressEvent { Stage = "indexing", Current = cur, Total = files.Count, File = name + " — " + s });
                try
                {
                    var (outcome, nChunks) = IndexOne(ix, f, status);
                    switch (outcome)
                    {
                        case "added": sum.Added++; sum.ChunksAdded += nChunks; break;
                        case "updated": sum.Updated++; sum.ChunksAdded += nChunks; break;
                        case "unchanged": sum.Unchanged++; break;
                        default: sum.Skipped++; break;
                    }
                }
                catch (NotSupportedException nse)
                {
                    sum.Skipped++;
                    RecordOutcome(f, "skipped", nse.Message);
                }
                catch (Exception ex)
                {
                    sum.Failed++;
                    var msg = $"{name}: {ex.Message}";
                    if (sum.Messages.Count < 25) sum.Messages.Add(msg);
                    _log("Index failed — " + msg);
                    RecordOutcome(f, "error", ex.Message);
                }
                if (i % 15 == 0) Save();
            }
            lock (_lock) _lexDirty = true;
            Save();
            sum.Seconds = Math.Round(sw.Elapsed.TotalSeconds, 1);
            _log($"IndexPaths done: +{sum.Added} ~{sum.Updated} ={sum.Unchanged} skip={sum.Skipped} fail={sum.Failed} chunks+={sum.ChunksAdded} in {sum.Seconds}s");
            return sum;
        }
        finally { lock (_lock) _indexing = false; }
    }

    private void RecordOutcome(string path, string status, string note)
    {
        try
        {
            var fi = new FileInfo(path);
            lock (_lock)
            {
                RemoveChunksLocked(path, _index);
                _docs[path] = new DocInfo { Path = path, Name = fi.Name, Ext = fi.Extension.ToLowerInvariant(), SizeBytes = fi.Length, ModifiedTicks = fi.LastWriteTimeUtc.Ticks, Status = status, Note = note };
            }
        }
        catch { }
    }

    private void RemoveChunksLocked(string path, AppContentIndexer? ix)
    {
        if (_docChunks.TryGetValue(path, out var ids))
        {
            if (ix != null && ids.Count > 0)
            {
                try { ix.RemoveContentItems(ids); }
                catch { foreach (var id in ids) { try { ix.RemoveContentItem(id); } catch { } } }
            }
            foreach (var id in ids) _chunks.Remove(id);
            _docChunks.Remove(path);
        }
    }

    private (string outcome, int chunks) IndexOne(AppContentIndexer ix, string path, Action<string> status)
    {
        var fi = new FileInfo(path);
        var kind = Extractor.Classify(path);
        if (kind == FileKind.Unknown) kind = FileKind.Text;
        DocInfo? existing;
        lock (_lock) _docs.TryGetValue(path, out existing);

        // an image skipped earlier for having no text should be revisited when the user turns on photo descriptions
        bool revisitPhoto = existing != null && existing.Status == "skipped" && kind == FileKind.Image && _describePhotos && !existing.Note.Contains("described");
        // files skipped by an older size rule (Office files over 250 MB) get another chance
        bool revisitSize = existing != null && existing.Status == "skipped" && existing.Note.StartsWith("File is larger than 250 MB") && kind is FileKind.Docx or FileKind.Pptx or FileKind.Xlsx or FileKind.Odf or FileKind.Epub;
        if (existing != null && (existing.Status == "indexed" || existing.Status == "skipped") && existing.SizeBytes == fi.Length && existing.ModifiedTicks == fi.LastWriteTimeUtc.Ticks && !revisitPhoto && !revisitSize)
            return ("unchanged", 0);

        var info = new DocInfo { Path = path, Name = fi.Name, Ext = fi.Extension.ToLowerInvariant(), SizeBytes = fi.Length, ModifiedTicks = fi.LastWriteTimeUtc.Ticks };
        // Office/ODF/EPUB files are zip archives read entry by entry (only the XML parts), so embedded media never
        // gets loaded and their size does not matter; the cap applies only to formats that are read in one piece.
        bool readsWholeFile = kind is FileKind.Pdf or FileKind.Image or FileKind.Ipynb;
        if (readsWholeFile && fi.Length > Extractor.MaxFileBytes)
        {
            info.Status = "skipped"; info.Note = "File is larger than 250 MB.";
            lock (_lock) { RemoveChunksLocked(path, ix); _docs[path] = info; }
            return ("skipped", 0);
        }

        var res = Extractor.Extract(path, kind, new ExtractOptions { DescribePhotos = _describePhotos, Status = status });
        info.Pages = res.Pages;
        var recs = new List<ChunkRec>();
        var key = DocKey(path);
        int n = 0;
        bool capped = false;
        foreach (var u in res.Units)
            foreach (var (loc, text) in Extractor.Chunk(u))
            {
                if (n >= Extractor.MaxChunksPerDoc) { capped = true; break; }
                recs.Add(new ChunkRec { Id = $"{key}_{n++}", DocPath = path, Loc = loc, Text = text });
            }

        if (recs.Count == 0)
        {
            info.Status = "skipped";
            info.Note = kind switch
            {
                FileKind.Image => _describePhotos ? "No text found and no description could be generated." : "No text found in this image (turn on “Describe photos” to index it by description).",
                FileKind.Pdf => "No text could be read from this PDF.",
                _ => "No readable text found.",
            };
            lock (_lock) { RemoveChunksLocked(path, ix); _docs[path] = info; }
            return ("skipped", 0);
        }

        lock (_lock) RemoveChunksLocked(path, ix);
        foreach (var c in recs)
        {
            var content = AppManagedIndexableAppContent.CreateFromString(c.Id, $"{info.Name} | {c.Loc}\n{c.Text}");
            ix.AddOrUpdate(content);
        }
        info.Chunks = recs.Count;
        info.Status = "indexed";
        info.Note = (res.Note + (capped ? $" Only the first {Extractor.MaxChunksPerDoc} passages were indexed." : "")).Trim();
        lock (_lock)
        {
            _docs[path] = info;
            _docChunks[path] = recs.Select(r => r.Id).ToList();
            foreach (var c in recs) _chunks[c.Id] = c;
        }
        return (existing == null || existing.Status != "indexed" ? "added" : "updated", recs.Count);
    }

    public void RemoveDoc(string path)
    {
        var ix = GetIndex();
        lock (_lock) { RemoveChunksLocked(path, ix); _docs.Remove(path); _lexDirty = true; }
        Save();
    }

    public void ClearAll()
    {
        var ix = GetIndex();
        try { ix.RemoveAllContentItems(); } catch (Exception ex) { _log("RemoveAll failed: " + ex.Message); }
        lock (_lock) { _docs.Clear(); _chunks.Clear(); _docChunks.Clear(); _lexDirty = true; }
        Save();
    }

    // ── tokenising / keyword scoring ───────────────────────────────────────
    private static readonly Regex TokRx = new(@"[\p{L}\p{N}][\p{L}\p{N}\.\-_/+%°µ]*", RegexOptions.Compiled);
    private static readonly Regex UnitJoinRx = new(@"(?<=\d)\s+(?=(?:v|mv|kv|a|ma|ua|na|w|mw|hz|khz|mhz|ghz|ms|us|ns|pf|nf|uf|db|dbm|ppm|kb|mb|gb|mbps|kbps)\b)", RegexOptions.Compiled);
    private static readonly Regex NumUnitRx = new(@"^(\d+(?:\.\d+)?)(?:v|mv|kv|ma|a|ua|na|w|mw|hz|khz|mhz|ghz|ms|us|ns|pf|nf|uf|db|dbm|ppm|%|°?c)$", RegexOptions.Compiled);
    private static readonly HashSet<string> Stop = new(StringComparer.OrdinalIgnoreCase)
    {
        "the","and","for","are","what","which","who","how","does","with","that","this","from","have","has","can","its","into","per",
        "your","you","any","all","not","was","were","will","would","should","could","about","there","their","than","then","them",
        "when","where","why","also","use","used","using","get","list","show","tell","give","please","is","in","of","to","a","an","on",
        "at","by","or","it","as","be","do","if","me","my","we","of","between","compare","difference","value","values",
    };

    internal static List<string> Tokens(string text)
    {
        var t = UnitJoinRx.Replace(text.ToLowerInvariant().Replace('µ', 'u'), "");
        var res = new List<string>();
        foreach (Match m in TokRx.Matches(t))
        {
            var tok = m.Value.TrimEnd('.', '-', '_', '/', '+');
            if (tok.Length < 2) continue;
            res.Add(tok);
            if (tok.IndexOfAny(new[] { '-', '_', '/' }) >= 0)
                foreach (var p in tok.Split('-', '_', '/')) if (p.Length >= 2) res.Add(p);
            var nu = NumUnitRx.Match(tok);
            if (nu.Success) res.Add(nu.Groups[1].Value);
        }
        return res;
    }

    private static List<string> QueryTokens(string q) =>
        Tokens(q).Where(t => !Stop.Contains(t)).Distinct().ToList();

    private void EnsureLex()
    {
        lock (_lock)
        {
            if (!_lexDirty) return;
            var df = new Dictionary<string, int>();
            var tf = new Dictionary<string, Dictionary<string, int>>(_chunks.Count);
            var len = new Dictionary<string, int>(_chunks.Count);
            long total = 0;
            foreach (var c in _chunks.Values)
            {
                var d = new Dictionary<string, int>();
                var nm = _docs.TryGetValue(c.DocPath, out var di) ? Path.GetFileNameWithoutExtension(di.Name) : "";
                var toks = Tokens(nm + "\n" + c.Text);
                foreach (var t in toks) d[t] = d.TryGetValue(t, out var v) ? v + 1 : 1;
                foreach (var t in d.Keys) df[t] = df.TryGetValue(t, out var v) ? v + 1 : 1;
                tf[c.Id] = d; len[c.Id] = toks.Count; total += toks.Count;
            }
            _df = df; _tf = tf; _len = len;
            _avgLen = _chunks.Count > 0 ? Math.Max(1, (double)total / _chunks.Count) : 1;
            _nameTokens.Clear();
            foreach (var d in _docs.Values) _nameTokens[d.Path] = new HashSet<string>(Tokens(Path.GetFileNameWithoutExtension(d.Name)));
            _lexDirty = false;
        }
    }

    private List<(string id, double score)> Bm25(List<string> qt, string? docFilter, int take)
    {
        var res = new List<(string, double)>();
        if (qt.Count == 0) return res;
        int N = Math.Max(1, _chunks.Count);
        foreach (var (id, tf) in _tf)
        {
            if (docFilter != null && !_chunks[id].DocPath.Equals(docFilter, StringComparison.OrdinalIgnoreCase)) continue;
            double s = 0;
            foreach (var t in qt)
            {
                if (!tf.TryGetValue(t, out var f)) continue;
                int df = _df.TryGetValue(t, out var dv) ? dv : 1;
                double idf = Math.Log(1 + (N - df + 0.5) / (df + 0.5));
                s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * _len[id] / _avgLen));
            }
            if (s > 0) res.Add((id, s));
        }
        return res.OrderByDescending(x => x.Item2).Take(take).ToList();
    }

    // ── hybrid retrieval ───────────────────────────────────────────────────
    public SearchResult Search(string question, string? docFilter, int topK, string? previousQuestion)
    {
        var sw = Stopwatch.StartNew();
        var result = new SearchResult();
        if (string.IsNullOrWhiteSpace(docFilter)) docFilter = null;

        var retrievalQuery = question;
        if (!string.IsNullOrWhiteSpace(previousQuestion) && question.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length <= 5)
            retrievalQuery = previousQuestion + " " + question;

        EnsureLex();
        var qt = QueryTokens(retrievalQuery);
        List<(string id, double score)> lex;
        lock (_lock) lex = Bm25(qt, docFilter, 25);

        var idxIds = new List<string>();
        try
        {
            var ix = GetIndex();
            var tq = ix.CreateTextQuery(retrievalQuery);
            var matches = tq.GetNextMatches(60);
            foreach (var m in matches.OfType<AppManagedTextQueryMatch>())
            {
                var id = m.ContentId;
                bool ok;
                lock (_lock) ok = _chunks.TryGetValue(id, out var c) && (docFilter == null || c.DocPath.Equals(docFilter, StringComparison.OrdinalIgnoreCase));
                if (ok && !idxIds.Contains(id)) idxIds.Add(id);
            }
            result.IndexMatches = idxIds.Count;
            if (idxIds.Count > 25) idxIds = idxIds.Take(25).ToList();
        }
        catch (Exception ex) { result.Note = "Semantic index unavailable (" + ex.Message + ") — used keyword search only."; _log("Index query failed: " + ex.Message); }

        result.KeywordMatches = lex.Count;

        var fused = new Dictionary<string, double>();
        var viaIdx = new HashSet<string>(idxIds);
        var viaLex = new HashSet<string>(lex.Select(l => l.id));
        for (int r = 0; r < idxIds.Count; r++) fused[idxIds[r]] = (fused.TryGetValue(idxIds[r], out var a) ? a : 0) + 1.0 / (12 + r);
        for (int r = 0; r < lex.Count; r++) fused[lex[r].id] = (fused.TryGetValue(lex[r].id, out var a) ? a : 0) + 1.0 / (12 + r);

        // a question that names a part/doc (e.g. "HM3300") should favour that document's passages
        var strongQ = new HashSet<string>(qt.Where(t => t.Any(char.IsDigit) || t.Length >= 5));
        lock (_lock)
            foreach (var id in fused.Keys.ToList())
                if (_nameTokens.TryGetValue(_chunks[id].DocPath, out var nt) && nt.Overlaps(strongQ)) fused[id] += 0.002;

        var perDoc = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        int n = 0;
        foreach (var (id, score) in fused.OrderByDescending(kv => kv.Value).Select(kv => (kv.Key, kv.Value)))
        {
            ChunkRec c;
            DocInfo? d;
            lock (_lock) { c = _chunks[id]; _docs.TryGetValue(c.DocPath, out d); }
            perDoc.TryGetValue(c.DocPath, out var cnt);
            if (cnt >= 3) continue;
            perDoc[c.DocPath] = cnt + 1;
            result.Hits.Add(new Hit
            {
                N = ++n, Id = id, DocPath = c.DocPath, DocName = d?.Name ?? Path.GetFileName(c.DocPath), Loc = c.Loc, Text = c.Text,
                Score = Math.Round(score * 1000, 2), ViaIndex = viaIdx.Contains(id), ViaKeyword = viaLex.Contains(id),
            });
            if (n >= topK) break;
        }
        result.RetrievalMs = sw.ElapsedMilliseconds;
        return result;
    }

    // ── key lines (deterministic) ──────────────────────────────────────────
    // For each retrieved passage, pick the 1–2 lines that best match the question (idf-weighted term overlap).
    // They're shown to the user and marked for the model, so the exact spec row stands out even in a long passage.
    private void AttachKeyLines(List<Hit> hits, string question, string? previousQuestion)
    {
        var rq = question;
        if (!string.IsNullOrWhiteSpace(previousQuestion) && question.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length <= 5) rq = previousQuestion + " " + question;
        var qt = new HashSet<string>(QueryTokens(rq));
        if (qt.Count == 0) return;
        int N;
        Dictionary<string, int> df;
        lock (_lock) { N = Math.Max(1, _chunks.Count); df = _df; }
        double Idf(string t) { int d = df.TryGetValue(t, out var v) ? v : 1; return Math.Log(1 + (N - d + 0.5) / (d + 0.5)); }
        foreach (var h in hits)
        {
            var scored = new List<(string line, double sc)>();
            foreach (var line in h.Text.Split('\n'))
            {
                if (line.Trim().Length < 6) continue;
                var toks = new HashSet<string>(Tokens(line));
                double sc = 0; int hit = 0;
                foreach (var t in qt) if (toks.Contains(t)) { sc += Idf(t); hit++; }
                if (hit >= Math.Min(2, qt.Count)) scored.Add((line, sc));
            }
            if (scored.Count == 0) continue;
            double max = scored.Max(x => x.sc);
            h.KeyLines = scored.Where(x => x.sc >= max * 0.6).OrderByDescending(x => x.sc).Take(2).Select(x => x.line).ToList();
        }
    }

    // ── grounded answer ────────────────────────────────────────────────────
    internal static int PromptStyle = 3;   // 1 = original, 2 = plain-sentence rules, 3 = plain-sentence rules + » markers on key lines

    private static string BuildPrompt(string question, string? previousQuestion, List<Hit> sent, int style)
    {
        var sb = new StringBuilder();
        if (style == 1)
        {
            sb.Append("You answer questions using ONLY the numbered excerpts from the user's own files below.\n");
            sb.Append("Rules:\n- Use only facts stated in the excerpts. Do not use outside knowledge.\n- Copy numbers, units and conditions (min/typ/max, temperature, voltage) exactly as written.\n");
            sb.Append("- After each fact, add the excerpt number in brackets, like [2].\n- If the excerpts do not contain the answer, reply exactly: Not found in the indexed documents.\n- Be concise: at most 5 short sentences or a short bullet list.\n\nEXCERPTS:\n");
            foreach (var h in sent) sb.Append($"[{h.N}] {h.DocName}, {h.Loc}\n{h.Text}\n\n");
            if (!string.IsNullOrWhiteSpace(previousQuestion)) sb.Append($"PREVIOUS QUESTION (context only): {previousQuestion}\n");
            sb.Append($"QUESTION: {question}\nANSWER:");
            return sb.ToString();
        }

        sb.Append("Below are numbered excerpts from the user's own files. Table rows use \" | \" between columns (the first row of a table usually names the columns), and \"—\" means empty or not specified.");
        if (style == 3) sb.Append(" Lines starting with » are the best matches for the question.");
        sb.Append("\n\n");
        foreach (var h in sent)
        {
            sb.Append($"[{h.N}] {h.DocName}, {h.Loc}\n");
            foreach (var line in h.Text.Split('\n'))
                sb.Append(style == 3 && h.KeyLines.Contains(line) ? "» " : "").Append(line).Append('\n');
            sb.Append('\n');
        }
        if (!string.IsNullOrWhiteSpace(previousQuestion)) sb.Append($"(Previous question, for context: {previousQuestion})\n");
        sb.Append($"Question: {question}\n\n");
        sb.Append("Answer using only the excerpts above. Write one or two complete sentences (or one bullet per item for a list) that give each value with its unit and any condition that applies (for example min/typ/max, a date, a currency). Never paste raw table rows. ");
        sb.Append("End every sentence or bullet with the number of the excerpt it came from, like [2]. When you mention a file, use its file name (shown after the excerpt number), not the excerpt number. ");
        sb.Append("Only if no excerpt mentions the topic at all, write exactly: Not found in the indexed documents.\nAnswer:");
        return sb.ToString();
    }

    private static double OverlapRatio(string a, string b)
    {
        var la = a.Split('\n').Where(l => l.Trim().Length > 0).ToList();
        if (la.Count == 0) return 1;
        var lb = new HashSet<string>(b.Split('\n'));
        return la.Count(l => lb.Contains(l)) / (double)la.Count;
    }

    // Pick the excerpts to send: best-first, at most 2 per document on the first pass (so cross-document
    // questions get breadth), skipping passages that mostly repeat an already-chosen one, within a char budget.
    private static List<Hit> SelectExcerpts(List<Hit> hits, int budget, int max)
    {
        var sent = new List<Hit>();
        int used = 0;
        var perDoc = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var pass in new[] { 2, 3 })
            foreach (var h in hits)
            {
                if (sent.Count >= max || sent.Contains(h)) continue;
                perDoc.TryGetValue(h.DocPath, out var c);
                if (c >= pass) continue;
                if (sent.Any(x => OverlapRatio(h.Text, x.Text) > 0.6)) continue;
                if (sent.Count > 0 && used + h.Text.Length > budget) continue;
                sent.Add(h); used += h.Text.Length; perDoc[h.DocPath] = c + 1;
            }
        return sent.OrderBy(h => h.N).ToList();
    }

    public async Task<AskResult> AskAsync(string question, string? docFilter, string? previousQuestion, Func<string, Task<GenResult>> generate, int? styleOverride = null)
    {
        var ar = new AskResult();
        var sr = await Task.Run(() => Search(question, docFilter, 8, previousQuestion));
        ar.Hits = sr.Hits; ar.IndexMatches = sr.IndexMatches; ar.KeywordMatches = sr.KeywordMatches; ar.RetrievalMs = sr.RetrievalMs;
        if (sr.Hits.Count == 0)
        {
            ar.Answer = "Not found in the indexed documents."; ar.NotFound = true;
            return ar;
        }
        AttachKeyLines(sr.Hits, question, previousQuestion);

        // The on-device model has a small context window, and numeric text is token-dense — shrink the
        // excerpt budget and retry if the prompt is rejected as too large.
        var sw = Stopwatch.StartNew();
        foreach (var budget in new[] { 2600, 1800, 1000 })
        {
            ar.Attempts++;
            var sent = SelectExcerpts(sr.Hits, budget, 5);
            // number the excerpts 1..k in the order sent; the UI shows the same numbers on the source cards
            var order = sent.Concat(sr.Hits.Where(h => !sent.Contains(h))).ToList();
            for (int i = 0; i < order.Count; i++) { order[i].N = i + 1; order[i].SentToModel = i < sent.Count; }
            ar.Hits = order;
            ar.ExcerptsSent = sent.Count;

            var gen = await generate(BuildPrompt(question, previousQuestion, sent, styleOverride ?? PromptStyle));
            if (!string.IsNullOrWhiteSpace(gen.Text))
            {
                ar.Answer = CleanAnswer(gen.Text);
                ar.ModelError = null;
                VerifyNumbers(ar.Answer, string.Join("\n", sent.Select(x => x.Text)), ar);
                AutoCite(ar, sent);
                FixCitations(ar, sent);
                break;
            }
            ar.ModelError = gen.Error ?? ("Model returned no text (" + gen.Status + ")");
            if (!gen.Status.Contains("Larger", StringComparison.OrdinalIgnoreCase)) break;
        }
        ar.NotFound = IsNotFound(ar.Answer);

        // Guard: a key term that appears in none of the documents means the question can't be grounded. If the model
        // still produced an answer with no verified numbers, don't present it — report "not found" instead.
        ar.UnknownTerms = ar.Hits.Any(h => h.KeyLines.Count > 0) ? new List<string>() : UnknownTerms(question);   // lines that match the question beat a missing everyday word
        if (ar.UnknownTerms.Count > 0 && !ar.NotFound && ar.ModelError == null && ar.NumbersFound.Count == 0)
        {
            ar.Answer = "Not found in the indexed documents.";
            ar.NotFound = true; ar.AutoCited = false; ar.CitationsFixed = false;
        }

        // Evidence check: a yes/no answer that quotes no fact from the sources (only echoing numbers from the question)
        // is an unsupported judgment, however confident it sounds — don't present it as an answer.
        if (!ar.NotFound && ar.ModelError == null && Regex.IsMatch(question.TrimStart(), @"^(can|could|does|do|did|is|are|was|will|would|should|may|might)\b", RegexOptions.IgnoreCase)
            && !HasNewFacts(ar.Answer, question, ar.Hits.Where(h => h.SentToModel)))
        {
            ar.Answer = "Not found in the indexed documents.";
            ar.NotFound = true; ar.AutoCited = false; ar.CitationsFixed = false; ar.NumbersFound.Clear(); ar.NumbersMissing.Clear();
        }


        // Rescue pass: a small model sometimes refuses out of caution even though strongly matching lines were retrieved.
        // Retry once with the key-line passages first, but only accept an answer that actually contains facts (numbers,
        // addresses) from those key lines that weren't already in the question — otherwise it is just fluent noise.
        if (ar.NotFound && ar.ModelError == null && ar.UnknownTerms.Count == 0 && ar.Hits.Any(h => h.KeyLines.Count > 0))
        {
            var keyed = ar.Hits.Where(h => h.KeyLines.Count > 0).Concat(ar.Hits.Where(h => h.KeyLines.Count == 0)).Take(4).ToList();
            var order = keyed.Concat(ar.Hits.Where(h => !keyed.Contains(h))).ToList();
            for (int i = 0; i < order.Count; i++) { order[i].N = i + 1; order[i].SentToModel = i < keyed.Count; }
            ar.Hits = order; ar.ExcerptsSent = keyed.Count; ar.Attempts++;
            var gen2 = await generate(BuildPrompt(question, previousQuestion, keyed, 2));
            var cand = string.IsNullOrWhiteSpace(gen2.Text) ? "" : CleanAnswer(gen2.Text);
            if (cand.Length > 0 && !IsNotFound(cand) && SharesKeyLineFacts(cand, keyed, question))
            {
                ar.Answer = cand;
                ar.NumbersFound.Clear(); ar.NumbersMissing.Clear();
                VerifyNumbers(ar.Answer, string.Join("\n", keyed.Select(x => x.Text)), ar);
                AutoCite(ar, keyed);
                FixCitations(ar, keyed);
                ar.NotFound = false; ar.Rescued = true;
            }
        }
        ar.GenerationMs = sw.ElapsedMilliseconds;
        return ar;
    }

    // Small models sometimes append the refusal sentence after a perfectly good answer — drop it.
    private static string CleanAnswer(string text)
    {
        var t = text.Trim();
        var stripped = Regex.Replace(t, @"[\s.]*not found in (the )?indexed documents\.?(\s*\[\d+(?:\s*,\s*\d+)*\])*\s*$", "", RegexOptions.IgnoreCase).TrimEnd();
        if (stripped.Length >= 15 && stripped.Any(char.IsDigit)) t = stripped;

        // Self-contradicting tail: after a sentence that already states a value, a later sentence claiming there is
        // "no reference" / "cannot provide" is hedging noise — cut from there.
        var parts = Regex.Split(t, @"(?<=[.!?])\s+");
        for (int i = 1; i < parts.Length; i++)
            if (Regex.IsMatch(parts[i], @"^\s*note:|no reference|no information|cannot provide|can't provide|not mentioned|did not (directly|specifically)|does not (contain|mention)|is not (specified|provided|stated)", RegexOptions.IgnoreCase)
                && parts.Take(i).Any(p => p.Any(char.IsDigit)))
            { t = string.Join(" ", parts.Take(i)).Trim(); break; }
        return t;
    }

    // Content words from the question that occur in no indexed passage (prefix-matched so plurals/endings don't count as missing).
    private List<string> UnknownTerms(string question)
    {
        EnsureLex();
        var res = new List<string>();
        var all = QueryTokens(question);
        lock (_lock)
            foreach (var t in all)
            {
                if (t.Length < 4 || t.Any(char.IsDigit) || !t.All(char.IsLetter)) continue;
                var stem = Regex.Replace(t, "(ing|ed|es|s)$", "");
                if (stem.Length < 4) stem = t;
                if (!_df.Keys.Any(k => k.StartsWith(stem, StringComparison.Ordinal))) res.Add(t);
            }
        // one unfamiliar everyday word ("tied" for "connected") must not sink an otherwise well-grounded question
        if (res.Count == 0 || res.Count / (double)Math.Max(1, all.Count) < 0.3) return new List<string>();
        return res.Distinct().Take(4).ToList();
    }

    // Digit-bearing tokens (numbers, hex addresses, part codes) in the answer that are in the excerpts but not in the question.
    private static bool HasNewFacts(string answer, string question, IEnumerable<Hit> sent)
    {
        var q = new HashSet<string>(Tokens(question));
        var src = new HashSet<string>(sent.SelectMany(h => Tokens(h.Text)));
        return Tokens(CiteRx.Replace(answer, " ")).Any(t => t.Any(char.IsDigit) && !q.Contains(t) && src.Contains(t));
    }

    private static bool SharesKeyLineFacts(string answer, List<Hit> keyed, string question)
    {
        var qTok = new HashSet<string>(Tokens(question));
        var lineTokens = keyed.SelectMany(h => h.KeyLines).SelectMany(Tokens).Where(t => !qTok.Contains(t) && !Stop.Contains(t)).ToList();
        var aTok = new HashSet<string>(Tokens(answer));
        // numbers, dates and codes are the strongest evidence; for purely textual lines fall back to distinctive words
        var facts = new HashSet<string>(lineTokens.Where(t => t.Any(char.IsDigit)));
        if (facts.Count == 0) facts = new HashSet<string>(lineTokens.Where(t => t.Length >= 5));
        return facts.Overlaps(aTok);
    }

    private static bool IsNotFound(string text) =>
        text.Contains("not found in the indexed documents", StringComparison.OrdinalIgnoreCase) && text.Length < 80;

    // If the model forgot to cite, attribute the answer to the excerpts that contain its (verified) numbers — plain code.
    private static void AutoCite(AskResult ar, List<Hit> sent)
    {
        if (CiteRx.IsMatch(ar.Answer) || ar.Answer.Contains("not found in the indexed", StringComparison.OrdinalIgnoreCase)) return;
        var ns = new SortedSet<int>();
        foreach (var label in ar.NumbersFound)
        {
            var num = label.Split(' ')[0];
            var rx = new Regex(@"(?<![\d.])" + Regex.Escape(num) + @"(?![\d])");
            var h = sent.FirstOrDefault(x => rx.IsMatch(x.Text.Replace(",", "")));
            if (h != null) ns.Add(h.N);
        }
        if (ns.Count == 0 && sent.Count > 0) ns.Add(sent[0].N);
        ar.Answer += " " + string.Join("", ns.Take(3).Select(n => $"[{n}]"));
        ar.AutoCited = true;
    }

    // Citations from a small model are sometimes attached to the wrong excerpt. For every sentence that contains numbers,
    // make sure at least one cited excerpt actually contains them; if not, point the citation at the excerpt that does.
    private static void FixCitations(AskResult ar, List<Hit> sent)
    {
        if (ar.NotFound || sent.Count == 0) return;
        var pieces = Regex.Split(ar.Answer, @"((?<=[.!?])\s+|
+)");
        var sb = new StringBuilder();
        bool changed = false;
        foreach (var piece in pieces)
        {
            if (piece.Length == 0 || string.IsNullOrWhiteSpace(piece) || piece.Trim().Length == 0) { sb.Append(piece); continue; }
            var cited = CiteRx.Matches(piece).SelectMany(m => Regex.Matches(m.Value, @"\d+").Select(x => int.Parse(x.Value))).Distinct().ToList();
            var body = CiteRx.Replace(piece, "").TrimEnd();
            var nums = new List<string>();
            foreach (Match m in NumRx.Matches(body))
            {
                var n = NormNum(m.Groups[1].Value);
                if ((m.Groups[2].Value.Length > 0 || n.Contains('.') || n.Length >= 2) && !nums.Contains(n)) nums.Add(n);
            }
            if (nums.Count == 0) { sb.Append(piece); continue; }
            var scores = sent.Select(h =>
            {
                var t = h.Text.Replace(",", "");
                return (h, c: nums.Count(nm => Regex.IsMatch(t, @"(?<![\d.])" + Regex.Escape(nm) + @"(?![\d])")));
            }).ToList();
            int best = scores.Max(x => x.c);
            if (best == 0) { sb.Append(piece); continue; }
            bool ok = cited.Any(c => scores.Any(x => x.h.N == c && x.c == best));
            if (ok) { sb.Append(piece); continue; }
            var good = scores.Where(x => x.c == best).Select(x => x.h.N).Take(2);
            sb.Append(body).Append(' ').Append(string.Join("", good.Select(n => $"[{n}]")));
            changed = true;
        }
        if (changed) { ar.Answer = sb.ToString().Trim(); ar.CitationsFixed = true; }
    }

    // Deterministic guardrail: every number the model wrote must appear verbatim in the excerpts it was given.
    private static readonly Regex CiteRx = new(@"\[\d+(?:\s*,\s*\d+)*\]", RegexOptions.Compiled);
    private static readonly Regex NumRx = new(
        @"(?<![\w.\-:])(\d+(?:[.,]\d+)*)\s?(mV|µV|uV|kV|V|mA|µA|uA|nA|A|mW|kW|W|kHz|MHz|GHz|Hz|ms|µs|us|ns|s|°C|°F|dBm|dB|ppm|pF|nF|µF|uF|Ω|kΩ|MΩ|ohms?|bits?|kB|MB|GB|Mbps|kbps|dps|mm|%)?(?![\w:])",
        RegexOptions.Compiled);

    private static string NormNum(string s) => s.Replace(",", "");

    private static void VerifyNumbers(string answer, string sources, AskResult ar)
    {
        var a = CiteRx.Replace(answer, " ");
        var src = sources.Replace(",", "");
        var seen = new HashSet<string>();
        foreach (Match m in NumRx.Matches(a))
        {
            var num = NormNum(m.Groups[1].Value);
            var unit = m.Groups[2].Value;
            bool significant = unit.Length > 0 || num.Contains('.') || num.Length >= 2;
            if (!significant) continue;
            var label = unit.Length > 0 ? $"{num} {unit}" : num;
            if (!seen.Add(label) || seen.Count > 14) continue;
            bool found = Regex.IsMatch(src, @"(?<![\d.])" + Regex.Escape(num) + @"(?![\d])");
            (found ? ar.NumbersFound : ar.NumbersMissing).Add(label);
        }
    }
}
