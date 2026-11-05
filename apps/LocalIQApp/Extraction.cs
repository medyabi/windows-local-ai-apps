using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace LocalIQApp;

// One "unit" of a document: a PDF page, a slide, a sheet, or the whole of a text file.
internal sealed class DocUnit
{
    public string Label = "";            // "p. 3", "slide 2", "sheet Pins", or "" (=> report line numbers)
    public List<(int no, string text)> Lines = new();
}

internal sealed class ExtractOptions
{
    public bool DescribePhotos;
    public Action<string>? Status;
}

internal sealed class ExtractResult
{
    public List<DocUnit> Units = new();
    public int Pages;
    public string Note = "";
}

internal enum FileKind { Skip, Legacy, Pdf, Docx, Pptx, Xlsx, Odf, Epub, Rtf, Ipynb, Html, Image, Text, Unknown }

internal static class Extractor
{
    private static readonly HashSet<string> TextExt = new(StringComparer.OrdinalIgnoreCase)
    {
        ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".log", ".ini", ".cfg", ".conf", ".yaml", ".yml", ".toml", ".rst", ".tex",
        ".srt", ".vtt", ".eml", ".svg", ".css", ".scss", ".less", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".java", ".kt", ".c", ".h", ".cpp",
        ".hpp", ".cc", ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".sql", ".sh", ".bash", ".ps1", ".psm1", ".bat", ".cmd", ".lua", ".r", ".pl", ".scala",
        ".dart", ".vue", ".svelte", ".gradle", ".properties", ".env", ".gitignore", ".dockerfile", ".csproj", ".sln", ".resx", ".xaml", ".config", ".ics", ".vcf", ".bib",
    };
    private static readonly HashSet<string> ImageExt = new(StringComparer.OrdinalIgnoreCase) { ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff", ".webp", ".heic" };
    private static readonly HashSet<string> LegacyExt = new(StringComparer.OrdinalIgnoreCase) { ".doc", ".xls", ".ppt", ".msg", ".pub", ".vsd" };
    private static readonly HashSet<string> BinaryExt = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".dll", ".sys", ".msi", ".iso", ".zip", ".7z", ".rar", ".gz", ".tar", ".bz2", ".xz", ".cab", ".jar", ".class", ".pyc", ".o", ".obj", ".a", ".lib",
        ".so", ".dylib", ".bin", ".dat", ".db", ".sqlite", ".mdb", ".accdb", ".ttf", ".otf", ".woff", ".woff2", ".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a",
        ".wma", ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".psd", ".ai", ".eps", ".indd", ".dwg", ".lnk", ".pdb", ".pak", ".nupkg", ".vhd", ".vhdx", ".pages", ".numbers", ".key", ".ico",
    };

    public const long MaxFileBytes = 250L * 1024 * 1024;
    public const long MaxTextBytes = 20L * 1024 * 1024;
    public const int MaxPdfPages = 1500;
    public const int MaxOcrPages = 80;

    public static FileKind Classify(string path)
    {
        var ext = Path.GetExtension(path);
        if (ext.Equals(".pdf", StringComparison.OrdinalIgnoreCase)) return FileKind.Pdf;
        if (ext.Equals(".docx", StringComparison.OrdinalIgnoreCase) || ext.Equals(".dotx", StringComparison.OrdinalIgnoreCase)) return FileKind.Docx;
        if (ext.Equals(".pptx", StringComparison.OrdinalIgnoreCase)) return FileKind.Pptx;
        if (ext.Equals(".xlsx", StringComparison.OrdinalIgnoreCase)) return FileKind.Xlsx;
        if (ext.Equals(".odt", StringComparison.OrdinalIgnoreCase) || ext.Equals(".ods", StringComparison.OrdinalIgnoreCase) || ext.Equals(".odp", StringComparison.OrdinalIgnoreCase)) return FileKind.Odf;
        if (ext.Equals(".epub", StringComparison.OrdinalIgnoreCase)) return FileKind.Epub;
        if (ext.Equals(".rtf", StringComparison.OrdinalIgnoreCase)) return FileKind.Rtf;
        if (ext.Equals(".ipynb", StringComparison.OrdinalIgnoreCase)) return FileKind.Ipynb;
        if (ext.Equals(".html", StringComparison.OrdinalIgnoreCase) || ext.Equals(".htm", StringComparison.OrdinalIgnoreCase) || ext.Equals(".xhtml", StringComparison.OrdinalIgnoreCase)) return FileKind.Html;
        if (ImageExt.Contains(ext)) return FileKind.Image;
        if (LegacyExt.Contains(ext)) return FileKind.Legacy;
        if (BinaryExt.Contains(ext)) return FileKind.Skip;
        if (TextExt.Contains(ext)) return FileKind.Text;
        return FileKind.Unknown;   // no / unfamiliar extension — sniff the content
    }

    // Unfamiliar extension: treat as text if the first few KB look like text (no NUL bytes, few control characters).
    public static bool LooksLikeText(string path)
    {
        try
        {
            using var fs = File.OpenRead(path);
            var buf = new byte[8192];
            int n = fs.Read(buf, 0, buf.Length);
            if (n == 0) return false;
            int bad = 0;
            for (int i = 0; i < n; i++)
            {
                if (buf[i] == 0) return false;
                if (buf[i] < 9 || (buf[i] > 13 && buf[i] < 32)) bad++;
            }
            return bad * 50 < n;
        }
        catch { return false; }
    }

    public static ExtractResult Extract(string path, FileKind kind, ExtractOptions opt)
    {
        var res = new ExtractResult();
        switch (kind)
        {
            case FileKind.Pdf: ExtractPdf(path, res, opt); break;
            case FileKind.Docx: res.Units = Wrap(ExtractDocx(path)); break;
            case FileKind.Pptx: res.Units = ExtractPptx(path); res.Pages = res.Units.Count; break;
            case FileKind.Xlsx: res.Units = ExtractXlsx(path); res.Pages = res.Units.Count; break;
            case FileKind.Odf: res.Units = Wrap(ExtractOdf(path)); break;
            case FileKind.Epub: res.Units = ExtractEpub(path); res.Pages = res.Units.Count; break;
            case FileKind.Rtf: res.Units = Wrap(SplitLines(StripRtf(ReadText(path, res)))); break;
            case FileKind.Ipynb: res.Units = Wrap(ExtractIpynb(path)); break;
            case FileKind.Html: res.Units = Wrap(SplitLines(StripHtml(ReadText(path, res)))); break;
            case FileKind.Image: ExtractImage(path, res, opt); break;
            case FileKind.Legacy:
                throw new NotSupportedException($"Legacy Office format ({Path.GetExtension(path).ToLowerInvariant()}) — open it and save as .docx / .xlsx / .pptx.");
            default: res.Units = Wrap(SplitLines(ReadText(path, res))); break;
        }
        return res;
    }

    // ── PDF ────────────────────────────────────────────────────────────────
    private static void ExtractPdf(string path, ExtractResult res, ExtractOptions opt)
    {
        int totalPages = 0;
        try
        {
            using var doc = PdfDocument.Open(path, new ParsingOptions { UseLenientParsing = true, SkipMissingFonts = true });
            totalPages = doc.NumberOfPages;
            foreach (var page in doc.GetPages())
            {
                if (page.Number > MaxPdfPages) { res.Note = $"Only the first {MaxPdfPages} of {totalPages} pages were indexed."; break; }
                var lines = PageToLines(page);
                if (lines.Count == 0) continue;
                var u = new DocUnit { Label = "p. " + page.Number };
                for (int i = 0; i < lines.Count; i++) u.Lines.Add((i + 1, lines[i]));
                res.Units.Add(u);
            }
        }
        catch (Exception ex) when (res.Units.Count == 0 && !(ex is OutOfMemoryException))
        {
            // fall through to OCR for PDFs PdfPig can't read at all
            opt.Status?.Invoke("Trying OCR");
        }
        res.Pages = totalPages > 0 ? Math.Min(totalPages, MaxPdfPages) : res.Units.Count;
        if (res.Units.Count > 0) return;

        // No text layer: scanned / image-only PDF — render pages and read them with on-device OCR.
        var err = Ocr.EnsureRecognizer();
        if (err != null) throw new InvalidOperationException("Scanned PDF — " + err);
        var (units, total) = Ocr.OcrPdf(path, MaxOcrPages, opt.Status);
        res.Units = units; res.Pages = total;
        if (units.Count > 0)
            res.Note = total > MaxOcrPages ? $"Scanned PDF — read with on-device OCR (first {MaxOcrPages} of {total} pages)." : "Scanned PDF — read with on-device OCR.";
    }

    // PdfPig's Page.Text runs lines together with no separators, which wrecks tables. Rebuild lines
    // from word positions instead, and mark wide horizontal gaps (table columns) with " | ".
    private static List<string> PageToLines(Page page)
    {
        var words = page.GetWords().Where(w => !string.IsNullOrWhiteSpace(w.Text)).ToList();
        if (words.Count == 0) return new List<string>();
        var sorted = words.OrderByDescending(w => w.BoundingBox.Bottom).ThenBy(w => w.BoundingBox.Left).ToList();
        var groups = new List<List<Word>>();
        foreach (var w in sorted)
        {
            var last = groups.Count > 0 ? groups[^1] : null;
            if (last != null)
            {
                var r = last[0];
                double tol = Math.Max(2.0, r.BoundingBox.Height * 0.55);
                if (Math.Abs(w.BoundingBox.Bottom - r.BoundingBox.Bottom) <= tol) { last.Add(w); continue; }
            }
            groups.Add(new List<Word> { w });
        }
        var result = new List<string>();
        foreach (var g in groups)
        {
            var ordered = g.OrderBy(w => w.BoundingBox.Left).ToList();
            var sb = new StringBuilder();
            for (int i = 0; i < ordered.Count; i++)
            {
                if (i > 0)
                {
                    double gap = ordered[i].BoundingBox.Left - ordered[i - 1].BoundingBox.Right;
                    double h = Math.Max(ordered[i].BoundingBox.Height, 6);
                    sb.Append(gap > Math.Max(12, h * 1.5) ? " | " : " ");
                }
                sb.Append(ordered[i].Text);
            }
            var line = sb.ToString().Trim();
            if (line.Length > 0) result.Add(line);
        }
        return result;
    }

    // ── Images (OCR, optionally a generated description) ───────────────────
    private static void ExtractImage(string path, ExtractResult res, ExtractOptions opt)
    {
        var err = Ocr.EnsureRecognizer();
        if (err != null) throw new InvalidOperationException(err);
        opt.Status?.Invoke("OCR");
        using var fs = File.OpenRead(path);
        var ras = System.IO.WindowsRuntimeStreamExtensions.AsRandomAccessStream(fs);
        var buffer = Ocr.ToBuffer(ras);
        var lines = Ocr.Recognize(buffer);
        if (lines.Sum(l => l.Length) >= 12)
        {
            var u = new DocUnit { Label = "image text" };
            for (int i = 0; i < lines.Count; i++) u.Lines.Add((i + 1, lines[i]));
            res.Units.Add(u);
            res.Note = "Text read from the image with on-device OCR.";
            return;
        }
        if (!opt.DescribePhotos) return;
        var derr = Ocr.EnsureDescriber();
        if (derr != null) throw new InvalidOperationException(derr);
        opt.Status?.Invoke("describing photo");
        var desc = Ocr.Describe(buffer).Trim();
        if (desc.Length == 0) return;
        var d = new DocUnit { Label = "photo description" };
        d.Lines.Add((1, "Photo description (generated by on-device AI, may be inaccurate): " + desc));
        res.Units.Add(d);
        res.Note = "Photo with no text — described by on-device AI (may be inaccurate).";
    }

    // ── Office Open XML ────────────────────────────────────────────────────
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static readonly XNamespace A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    private static readonly XNamespace S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace PR = "http://schemas.openxmlformats.org/package/2006/relationships";

    private const long MaxXmlEntryBytes = 300L * 1024 * 1024;   // one XML part (a slide, a sheet, a chapter), not the file

    private static XDocument LoadXml(ZipArchiveEntry e)
    {
        if (e.Length > MaxXmlEntryBytes) throw new InvalidDataException($"'{e.FullName}' is too large to read ({e.Length / (1024 * 1024)} MB).");
        using var s = e.Open();
        return XDocument.Load(s);
    }

    private static List<string> ExtractDocx(string path)
    {
        using var zip = ZipFile.OpenRead(path);
        var entry = zip.GetEntry("word/document.xml") ?? throw new InvalidDataException("Not a valid .docx (no word/document.xml).");
        var xd = LoadXml(entry);
        var body = xd.Root?.Element(W + "body");
        var lines = new List<string>();
        if (body == null) return lines;

        string Para(XElement p)
        {
            var sb = new StringBuilder();
            foreach (var el in p.Descendants())
            {
                if (el.Name == W + "t") sb.Append(el.Value);
                else if (el.Name == W + "tab") sb.Append('\t');
                else if (el.Name == W + "br") sb.Append(' ');
            }
            return sb.ToString().Trim();
        }

        void Walk(XElement container)
        {
            foreach (var el in container.Elements())
            {
                if (el.Name == W + "p") { var t = Para(el); if (t.Length > 0) lines.Add(t); }
                else if (el.Name == W + "tbl")
                {
                    foreach (var tr in el.Elements(W + "tr"))
                    {
                        var cells = tr.Elements(W + "tc").Select(tc => string.Join(" ", tc.Descendants(W + "p").Select(Para).Where(x => x.Length > 0)).Trim());
                        var row = string.Join(" | ", cells);
                        if (row.Replace("|", "").Trim().Length > 0) lines.Add(row);
                    }
                }
                else if (el.Name == W + "sdt") { var c = el.Element(W + "sdtContent"); if (c != null) Walk(c); }
            }
        }
        Walk(body);
        return lines;
    }

    private static List<DocUnit> ExtractPptx(string path)
    {
        using var zip = ZipFile.OpenRead(path);
        var slides = zip.Entries
            .Select(e => (e, m: Regex.Match(e.FullName, @"^ppt/slides/slide(\d+)\.xml$")))
            .Where(x => x.m.Success)
            .OrderBy(x => int.Parse(x.m.Groups[1].Value))
            .ToList();
        var units = new List<DocUnit>();
        foreach (var (e, m) in slides)
        {
            var xd = LoadXml(e);
            var u = new DocUnit { Label = "slide " + m.Groups[1].Value };
            int n = 0;
            foreach (var p in xd.Descendants(A + "p"))
            {
                var t = string.Concat(p.Descendants(A + "t").Select(x => x.Value)).Trim();
                if (t.Length > 0) u.Lines.Add((++n, t));
            }
            if (u.Lines.Count > 0) units.Add(u);
        }
        return units;
    }

    private static List<DocUnit> ExtractXlsx(string path)
    {
        using var zip = ZipFile.OpenRead(path);
        var shared = new List<string>();
        var ss = zip.GetEntry("xl/sharedStrings.xml");
        if (ss != null)
            foreach (var si in LoadXml(ss).Descendants(S + "si"))
                shared.Add(string.Concat(si.Descendants(S + "t").Select(t => t.Value)));

        var sheetNames = new Dictionary<string, string>();
        var wb = zip.GetEntry("xl/workbook.xml");
        var rels = zip.GetEntry("xl/_rels/workbook.xml.rels");
        if (wb != null && rels != null)
        {
            var relMap = LoadXml(rels).Descendants(PR + "Relationship")
                .ToDictionary(r => (string?)r.Attribute("Id") ?? "", r => (string?)r.Attribute("Target") ?? "");
            foreach (var sh in LoadXml(wb).Descendants(S + "sheet"))
            {
                var rid = (string?)sh.Attribute(R + "id") ?? "";
                if (relMap.TryGetValue(rid, out var target))
                    sheetNames["xl/" + target.TrimStart('/').Replace("xl/", "")] = (string?)sh.Attribute("name") ?? "";
            }
        }

        var units = new List<DocUnit>();
        var sheets = zip.Entries.Where(e => Regex.IsMatch(e.FullName, @"^xl/worksheets/sheet\d+\.xml$"))
            .OrderBy(e => int.Parse(Regex.Match(e.FullName, @"(\d+)\.xml$").Groups[1].Value)).ToList();
        foreach (var e in sheets)
        {
            sheetNames.TryGetValue(e.FullName, out var nm);
            var u = new DocUnit { Label = "sheet " + (string.IsNullOrEmpty(nm) ? Regex.Match(e.FullName, @"(\d+)\.xml$").Groups[1].Value : nm) };
            int rowNo = 0;
            foreach (var row in LoadXml(e).Descendants(S + "row").Take(6000))
            {
                var cells = new List<string>();
                foreach (var c in row.Elements(S + "c"))
                {
                    var t = (string?)c.Attribute("t");
                    string val;
                    if (t == "s" && int.TryParse(c.Element(S + "v")?.Value, out var idx) && idx >= 0 && idx < shared.Count) val = shared[idx];
                    else if (t == "inlineStr") val = string.Concat(c.Descendants(S + "t").Select(x => x.Value));
                    else val = c.Element(S + "v")?.Value ?? "";
                    val = val.Trim();
                    if (val.Length > 0) cells.Add(val);
                }
                rowNo++;
                if (cells.Count > 0) u.Lines.Add((rowNo, string.Join(" | ", cells)));
            }
            if (u.Lines.Count > 0) units.Add(u);
        }
        return units;
    }

    // ── OpenDocument (.odt / .ods / .odp), EPUB, RTF, notebooks ─────────────
    private static List<string> ExtractOdf(string path)
    {
        XNamespace T = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
        XNamespace TB = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
        using var zip = ZipFile.OpenRead(path);
        var entry = zip.GetEntry("content.xml") ?? throw new InvalidDataException("Not a valid OpenDocument file (no content.xml).");
        var xd = LoadXml(entry);
        var lines = new List<string>();
        string Text(XElement e) => string.Join(" ", e.Descendants().Where(x => x.Name == T + "p" || x.Name == T + "h").Select(x => x.Value.Trim()).Where(x => x.Length > 0));
        foreach (var el in xd.Descendants())
        {
            if (lines.Count > 60000) break;
            if (el.Name == TB + "table-row")
            {
                var cells = el.Elements(TB + "table-cell").Select(Text).Where(t => t.Length > 0).ToList();
                if (cells.Count > 0) lines.Add(string.Join(" | ", cells));
            }
            else if ((el.Name == T + "p" || el.Name == T + "h") && !el.Ancestors(TB + "table-row").Any())
            {
                var t = el.Value.Trim();
                if (t.Length > 0) lines.Add(t);
            }
        }
        return lines;
    }

    private static List<DocUnit> ExtractEpub(string path)
    {
        using var zip = ZipFile.OpenRead(path);
        var units = new List<DocUnit>();
        foreach (var e in zip.Entries.Where(e => Regex.IsMatch(e.FullName, @"\.(xhtml|html|htm)$", RegexOptions.IgnoreCase)).OrderBy(e => e.FullName).Take(2000))
        {
            using var sr = new StreamReader(e.Open());
            var lines = SplitLines(StripHtml(sr.ReadToEnd()));
            var u = new DocUnit { Label = Path.GetFileNameWithoutExtension(e.FullName) };
            for (int i = 0; i < lines.Count; i++) if (lines[i].Length > 0) u.Lines.Add((i + 1, lines[i]));
            if (u.Lines.Count > 0) units.Add(u);
        }
        return units;
    }

    private static string StripRtf(string rtf)
    {
        var skip = new HashSet<string> { "fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "themedata", "colorschememapping", "latentstyles", "datastore" };
        var sb = new StringBuilder();
        var skipDepth = new Stack<int>();
        int depth = 0;
        for (int i = 0; i < rtf.Length; i++)
        {
            char c = rtf[i];
            if (c == '{')
            {
                depth++;
                if (i + 1 < rtf.Length && rtf[i + 1] == '\\')
                {
                    var m = Regex.Match(rtf.Substring(i + 1, Math.Min(24, rtf.Length - i - 1)), @"^\\(\*|[a-zA-Z]+)");
                    if (m.Success && (m.Groups[1].Value == "*" || skip.Contains(m.Groups[1].Value))) skipDepth.Push(depth);
                }
            }
            else if (c == '}')
            {
                if (skipDepth.Count > 0 && skipDepth.Peek() == depth) skipDepth.Pop();
                depth--;
            }
            else if (skipDepth.Count > 0) continue;
            else if (c == '\\' && i + 1 < rtf.Length)
            {
                char n = rtf[i + 1];
                if (n == '\\' || n == '{' || n == '}') { sb.Append(n); i++; }
                else if (n == '\'' && i + 3 < rtf.Length) { try { sb.Append((char)Convert.ToInt32(rtf.Substring(i + 2, 2), 16)); } catch { } i += 3; }
                else if (char.IsLetter(n))
                {
                    int j = i + 1;
                    while (j < rtf.Length && char.IsLetter(rtf[j])) j++;
                    var word = rtf.Substring(i + 1, j - i - 1);
                    int k = j;
                    if (k < rtf.Length && (rtf[k] == '-' || char.IsDigit(rtf[k]))) { k++; while (k < rtf.Length && char.IsDigit(rtf[k])) k++; }
                    var param = rtf.Substring(j, k - j);
                    if (word == "par" || word == "line" || word == "sect" || word == "page" || word == "row") sb.Append('\n');
                    else if (word == "tab" || word == "cell") sb.Append(" | ");
                    else if (word == "u" && int.TryParse(param, out var code)) { sb.Append((char)(code < 0 ? code + 65536 : code)); if (k < rtf.Length && rtf[k] == '?') k++; }
                    i = (k < rtf.Length && rtf[k] == ' ') ? k : k - 1;
                }
                else i++;
            }
            else if (c != '\r' && c != '\n') sb.Append(c);
        }
        return sb.ToString();
    }

    private static List<string> ExtractIpynb(string path)
    {
        var lines = new List<string>();
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        if (!doc.RootElement.TryGetProperty("cells", out var cells)) return lines;
        string Src(JsonElement e) => e.ValueKind == JsonValueKind.Array ? string.Concat(e.EnumerateArray().Select(x => x.GetString())) : e.GetString() ?? "";
        foreach (var cell in cells.EnumerateArray())
        {
            if (cell.TryGetProperty("source", out var src)) lines.AddRange(Src(src).Replace("\r", "").Split('\n'));
            if (cell.TryGetProperty("outputs", out var outs) && outs.ValueKind == JsonValueKind.Array)
                foreach (var o in outs.EnumerateArray())
                {
                    string? txt = null;
                    if (o.TryGetProperty("text", out var t)) txt = Src(t);
                    else if (o.TryGetProperty("data", out var d) && d.TryGetProperty("text/plain", out var tp)) txt = Src(tp);
                    if (!string.IsNullOrWhiteSpace(txt)) lines.Add("output: " + (txt.Length > 500 ? txt.Substring(0, 500) : txt).Replace("\n", " "));
                }
            lines.Add("");
        }
        return lines.Select(l => l.TrimEnd()).ToList();
    }

    // ── Plain text & HTML ──────────────────────────────────────────────────
    private static string ReadText(string path, ExtractResult res)
    {
        var len = new FileInfo(path).Length;
        string text;
        bool truncated = len > MaxTextBytes;
        if (truncated)
        {
            using var fs = File.OpenRead(path);
            var buf = new byte[MaxTextBytes];
            int n = fs.Read(buf, 0, buf.Length);
            text = new StreamReader(new MemoryStream(buf, 0, n), Encoding.UTF8, true).ReadToEnd();
            res.Note = $"Only the first {MaxTextBytes / 1048576} MB of this {len / 1048576} MB file was indexed.";
        }
        else text = File.ReadAllText(path);
        if (text.Count(c => c == '�') > Math.Max(5, text.Length / 200)) text = File.ReadAllText(path, Encoding.Latin1);
        return text;
    }

    private static string StripHtml(string html)
    {
        html = Regex.Replace(html, @"<(script|style|noscript)[^>]*>.*?</\1>", " ", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        html = Regex.Replace(html, @"<!--.*?-->", " ", RegexOptions.Singleline);
        html = Regex.Replace(html, @"</(td|th)\s*>", " | ", RegexOptions.IgnoreCase);
        html = Regex.Replace(html, @"<br\s*/?>|</(p|div|tr|li|h[1-6]|table|section|article|pre)\s*>", "\n", RegexOptions.IgnoreCase);
        html = Regex.Replace(html, @"<[^>]+>", " ");
        return WebUtility.HtmlDecode(html);
    }

    private static List<string> SplitLines(string text) =>
        text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n').Select(l => Regex.Replace(l, @"[ \t]+", " ").Trim()).ToList();

    // For line-oriented content, keep original line numbers (blank lines are retained as gaps in numbering).
    private static List<DocUnit> Wrap(List<string> lines)
    {
        var u = new DocUnit();
        for (int i = 0; i < lines.Count; i++)
            if (lines[i].Length > 0) u.Lines.Add((i + 1, lines[i]));
        return u.Lines.Count > 0 ? new List<DocUnit> { u } : new List<DocUnit>();
    }

    // ── Chunking ───────────────────────────────────────────────────────────
    public const int TargetChars = 700;
    public const int OverlapChars = 110;
    public const int MaxChunksPerDoc = 4000;

    public static List<(string loc, string text)> Chunk(DocUnit unit)
    {
        // break up pathologically long lines so a single line can't blow the budget
        var lines = new List<(int no, string text)>();
        foreach (var (no, text) in unit.Lines)
        {
            var t = text;
            while (t.Length > TargetChars + 150)
            {
                int cut = t.LastIndexOf(' ', TargetChars);
                if (cut < TargetChars / 2) cut = TargetChars;
                lines.Add((no, t.Substring(0, cut).Trim()));
                t = t.Substring(cut).Trim();
            }
            if (t.Length > 0) lines.Add((no, t));
        }

        var chunks = new List<(string loc, string text)>();
        var cur = new List<(int no, string text)>();
        int len = 0, fresh = 0;

        string Loc(List<(int no, string text)> c)
        {
            if (!string.IsNullOrEmpty(unit.Label)) return unit.Label;
            int a = c[0].no, b = c[^1].no;
            return a == b ? $"line {a}" : $"lines {a}–{b}";
        }
        void Flush()
        {
            if (fresh == 0 || cur.Count == 0) return;
            var text = string.Join("\n", cur.Select(x => x.text));
            if (text.Count(char.IsLetterOrDigit) >= 25) chunks.Add((Loc(cur), text));
        }

        foreach (var l in lines)
        {
            if (len + l.text.Length + 1 > TargetChars && cur.Count > 0)
            {
                Flush();
                var keep = new List<(int, string)>();
                int k = 0;
                for (int i = cur.Count - 1; i >= 0 && k < OverlapChars; i--) { keep.Insert(0, cur[i]); k += cur[i].text.Length + 1; }
                cur = keep; len = k; fresh = 0;
            }
            cur.Add(l); len += l.text.Length + 1; fresh++;
        }
        Flush();
        return chunks;
    }
}
