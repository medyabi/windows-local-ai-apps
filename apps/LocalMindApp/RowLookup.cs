using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace LocalMindApp;

internal sealed record RowChunk(string DocPath, string DocName, string Loc, string Text);

internal sealed class RowLookupResult
{
    public string DocPath = "";
    public string DocName = "";
    public string Loc = "";                       // e.g. "p. 3–5"
    public List<string> Lines = new();            // rows that fit the budget, in document order
    public int Total;                             // all matching rows found in that document
    public List<string> Terms = new();            // the question terms the rows were matched on
}

// Deterministic "give me the part numbers / SKUs for X" lookup.
//
// Why it exists: a price list or SKU table is hundreds of near-identical rows ("634-CVDG | Windows Server 2025,Datacenter,ROK,…").
// Top-k passage retrieval cannot answer "list the Datacenter SKUs": the rows of interest are spread over many passages, the word
// "SKU" itself appears only in table headers (not in the rows), and the model's context holds only a handful of passages.
// So when the question asks for codes, code scans every row of the files in scope, keeps the rows that mention what the user
// named (e.g. Datacenter), and hands them to the model as one compact, exact excerpt.
internal static class RowLookup
{
    private static readonly Regex WordRx = new(@"[\p{L}\p{N}]+", RegexOptions.Compiled);
    private static readonly Regex CodeIntentRx = new(
        @"\b(?:skus?|mpns?|pns?|p/n|(?:part|item|order(?:ing)?|catalog(?:ue)?|material|product|article|reference)\s*(?:numbers?|nos?\.?|codes?|#|ids?))\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    // a part-number-looking token: letters+digits joined by hyphens (634-CVDG, P73-08123, AB-1234-X)
    private static readonly Regex CodeRx = new(@"\b[A-Za-z0-9]{2,}(?:-[A-Za-z0-9]{2,})+\b", RegexOptions.Compiled);

    // words that carry no selection power for a row lookup
    private static readonly HashSet<string> Ignore = new(StringComparer.OrdinalIgnoreCase)
    {
        // question glue
        "the","and","for","are","what","which","who","how","does","with","that","this","from","have","has","can","its","into","per","your","you",
        "any","all","not","was","were","will","would","should","could","about","there","their","than","then","them","when","where","why","also",
        "use","used","using","get","list","show","tell","give","please","is","in","of","to","a","an","on","at","by","or","it","as","be","do","if",
        "me","my","we","provide","find","need","want","look","search","retrieve","display","return","send","share","know","see","got","give",
        // the "I want codes" intent itself
        "sku","skus","part","parts","number","numbers","no","nos","pn","pns","mpn","code","codes","item","items","order","ordering",
        "catalog","catalogue","material","product","products","article","reference","references","id","ids",
        // generic nouns that qualify a name but are rarely printed in the rows ("Datacenter edition")
        "edition","editions","version","versions","license","licenses","licence","licences","licensing","release","type","kind","model","models",
    };

    // abbreviations that price lists print instead of the full word ("Windows Server 2025,DataCtr w/re-assignment rights,ROK")
    private static readonly Dictionary<string, string[]> Alias = new(StringComparer.OrdinalIgnoreCase)
    {
        ["datacenter"] = new[] { "datactr" },
    };

    private static bool Has(HashSet<string> toks, string term) =>
        toks.Contains(term) || (Alias.TryGetValue(term, out var alts) && alts.Any(toks.Contains));

    public static bool WantsCodes(string text) => CodeIntentRx.IsMatch(text);

    private static string Norm(string s) => Regex.Replace(s.ToLowerInvariant(), @"\s+", " ").Trim();

    private static HashSet<string> TokenSet(string s)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match m in WordRx.Matches(s)) { set.Add(m.Value); if (m.Value.Length > 3 && m.Value.EndsWith("s", StringComparison.OrdinalIgnoreCase)) set.Add(m.Value[..^1]); }
        return set;
    }

    private static bool LooksLikeRow(string line)
    {
        foreach (Match m in CodeRx.Matches(line))
        {
            var v = m.Value;
            if (v.Any(char.IsDigit) && v.Any(char.IsLetter)) return true;   // 634-CVDG, but not 2025-2026 or Hyper-V
        }
        return false;
    }

    private static int PageOf(string loc)
    {
        var m = Regex.Match(loc ?? "", @"\d+");
        return m.Success && int.TryParse(m.Value, out var p) ? p : -1;
    }

    /// <param name="chunks">all passages of the files in scope, in document order</param>
    public static RowLookupResult? Find(IReadOnlyList<RowChunk> chunks, string question, string? previousQuestion, int maxChars)
    {
        if (chunks.Count == 0 || string.IsNullOrWhiteSpace(question)) return null;
        // a short follow-up ("and for Standard?") inherits the intent of the previous question, but names its own subject
        bool followUp = !string.IsNullOrWhiteSpace(previousQuestion) && question.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length <= 5;
        if (!WantsCodes(question) && !(followUp && WantsCodes(previousQuestion!))) return null;

        // 1. every row-looking line of the files in scope (chunks overlap, so de-duplicate)
        var seen = new HashSet<string>();
        var all = new List<(int order, string line, HashSet<string> toks, string docPath, string docName, string loc)>();
        int order = 0;
        foreach (var c in chunks)
            foreach (var raw in c.Text.Split((char)10))
            {
                var line = raw.Trim();
                if (line.Length < 8 || !LooksLikeRow(line) || !seen.Add(Norm(line))) continue;
                all.Add((order++, line.Length > 170 ? line[..170] + "…" : line, TokenSet(line), c.DocPath, c.DocName, c.Loc));
            }
        if (all.Count == 0) return null;

        // 2. what did the user name? Drop glue, the intent words themselves, words no row contains, and words nearly every row
        //    contains ("Windows Server 2025"): neither can tell the rows apart.
        List<string> NamedTerms(string text)
        {
            var list = new List<string>();
            foreach (Match m in WordRx.Matches(text))
            {
                var t = m.Value.ToLowerInvariant();
                if (Ignore.Contains(t) || list.Contains(t)) continue;
                if (t.Length < 3 && !t.Any(char.IsDigit)) continue;
                int inRows = all.Count(r => Has(r.toks, t));
                if (inRows == 0 || inRows > all.Count * 0.85) continue;
                list.Add(t);
            }
            return list;
        }
        var terms = NamedTerms(question);
        if (terms.Count == 0 && followUp) terms = NamedTerms(previousQuestion + " " + question);

        // 3. A term found in most rows ("Windows", "Server", "2025") is context, not a selector: it only ranks.
        //    The other terms ("Datacenter", "ROK", "16CORE") select: rows must mention ALL of them; only if none does,
        //    relax one at a time (never below half of them).
        var specific = terms.Where(t => all.Count(r => Has(r.toks, t)) <= all.Count * 0.5).ToList();
        var context = terms.Except(specific).ToList();
        int Rank(HashSet<string> toks) => specific.Count(t => Has(toks, t)) * 10 + context.Count(t => Has(toks, t));

        var found = all.Select(r => (r.order, matched: Rank(r.toks), r.line, r.docPath, r.docName, r.loc)).ToList();
        if (specific.Count > 0)
        {
            found = new();
            for (int need = specific.Count; need >= Math.Max(1, (specific.Count + 1) / 2) && found.Count == 0; need--)
                found = all.Where(r => specific.Count(t => Has(r.toks, t)) >= need)
                           .Select(r => (r.order, matched: Rank(r.toks), r.line, r.docPath, r.docName, r.loc)).ToList();
            if (found.Count == 0) return null;
        }

        // 4. one document: the one with the most matching rows
        var main = found.GroupBy(f => f.docPath, StringComparer.OrdinalIgnoreCase).OrderByDescending(g => g.Count()).First();
        var rows = main.OrderByDescending(f => f.matched).ThenBy(f => f.order).ToList();
        var res = new RowLookupResult { DocPath = main.Key, DocName = rows[0].docName, Total = rows.Count, Terms = terms };
        var pages = rows.Select(r => PageOf(r.loc)).Where(p => p > 0).ToList();
        res.Loc = pages.Count == 0 ? "matching rows" : (pages.Min() == pages.Max() ? $"p. {pages.Min()}" : $"pp. {pages.Min()}–{pages.Max()}");

        int used = 0;
        foreach (var r in rows)
        {
            if (res.Lines.Count > 0 && used + r.line.Length + 1 > maxChars) break;
            res.Lines.Add(r.line); used += r.line.Length + 1;
        }
        // keep document order inside what fits
        var keep = new HashSet<string>(res.Lines);
        res.Lines = rows.Where(r => keep.Contains(r.line)).OrderBy(r => r.order).Select(r => r.line).ToList();
        return res;
    }

    /// <summary>Text of the synthetic excerpt: the rows plus an honest "N more not shown" footer.</summary>
    public static string ToText(RowLookupResult r)
    {
        var s = string.Join("\n", r.Lines);
        int more = r.Total - r.Lines.Count;
        if (more > 0) s += $"\n(+{more} more matching rows not shown; ask for a narrower set, for example by adding the exact edition or media type)";
        return s;
    }

    /// <summary>Shrink a rows excerpt to a character budget, keeping whole rows and an accurate footer.</summary>
    public static string Fit(string text, int max)
    {
        if (text.Length <= max) return text;
        var lines = text.Split('\n').ToList();
        int moreBefore = 0;
        if (lines.Count > 0 && lines[^1].StartsWith("(+"))
        {
            var m = Regex.Match(lines[^1], @"\(\+(\d+)");
            if (m.Success) moreBefore = int.Parse(m.Groups[1].Value);
            lines.RemoveAt(lines.Count - 1);
        }
        int used = 0, keep = 0;
        foreach (var l in lines) { if (keep > 0 && used + l.Length + 1 > max) break; used += l.Length + 1; keep++; }
        int more = moreBefore + (lines.Count - keep);
        var body = string.Join("\n", lines.Take(keep));
        return more > 0 ? body + $"\n(+{more} more matching rows not shown; ask for a narrower set)" : body;
    }
}
