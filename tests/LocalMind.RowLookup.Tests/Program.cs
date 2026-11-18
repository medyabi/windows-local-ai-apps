using LocalMindApp;

// A made-up price list ("Acme Server Licensing SKU list"): header lines, prose, and part-number rows, split into overlapping passages
// the way the app chunks a PDF. None of these codes are real.
const string Doc = "C:\\kb\\Acme SKU list.pdf", Name = "Acme SKU list.pdf";
var chunks = new List<RowChunk>
{
    new(Doc, Name, "p. 1", "Acme Server Offers\nThree editions of Acme Server 2025 are available: Datacenter, Standard and Essentials.\nContact your reseller for pricing."),
    new(Doc, Name, "p. 3", "SKU | SKU Description\nAB1-0001 | Acme Server 2025 Datacenter,16CORE,FI,No Media\nAB1-0002 | Acme Server 2025 Datacenter,Add License,16CORE,NO MEDIA/KEY\nAB1-0003 | Acme Server 2025 Standard,16CORE,FI,No Media"),
    new(Doc, Name, "p. 3", "AB1-0003 | Acme Server 2025 Standard,16CORE,FI,No Media\nAB1-0004 | Acme Server 2025 Standard,Add License,2CORE,NO MEDIA/KEY\nAB1-0005 | Acme Server 2025 Essentials,10CORE,FI,No Media"),
    new(Doc, Name, "p. 4", "AB2-0101 | Acme Server 2025,Datacenter, ROK,16CORE (for Distributor sale only)\nAB2-0102 | Acme Server 2025,Standard, ROK,16CORE (for Distributor sale only)\nAB2-0103 | Acme Server 2025,DataCtr w/re-assignment rights,ROK,16CORE (for Distributor sale only)"),
    new(Doc, Name, "p. 5", "Can I transfer my OEM license to another server?\nNo. An OEM license is tied to the first server it is installed on.\nHyper-V role enabled with pre-installed Standard or Datacenter OS"),
};

int fails = 0;
void Check(string name, bool ok, string detail = "") { Console.WriteLine($"  [{(ok ? "PASS" : "FAIL")}] {name} {detail}"); if (!ok) fails++; }
RowLookupResult? Find(string q, string? prev = null, int max = 1900) => RowLookup.Find(chunks, q, prev, max);
bool Has(RowLookupResult? r, string code) => r != null && r.Lines.Any(l => l.StartsWith(code));

// 1. the shape of the original failure: "SKU" is only in the table header, the rows name the edition
var dc = Find("provide me with Acme Server 2025 datacenter edition SKU");
Check("finds Datacenter rows", dc != null && Has(dc, "AB1-0001") && Has(dc, "AB1-0002") && Has(dc, "AB2-0101"));
Check("includes the abbreviation DataCtr (alias)", Has(dc, "AB2-0103"));
Check("excludes Standard/Essentials rows", dc != null && !Has(dc, "AB1-0003") && !Has(dc, "AB1-0005") && !Has(dc, "AB2-0102"));
Check("overlapping passages do not duplicate a row", dc != null && dc.Lines.Count == dc.Lines.Distinct().Count());
Check("reports the page range", dc != null && dc.Loc == "pp. 3–5" || dc != null && dc.Loc == "pp. 3–4", dc?.Loc ?? "");

// 2. every named word must match; narrower questions give shorter lists
var narrow = Find("what is the SKU for Acme Server 2025 Datacenter ROK 16CORE");
Check("all named words required", narrow != null && narrow.Lines.All(l => l.Contains("ROK", StringComparison.OrdinalIgnoreCase)) && Has(narrow, "AB2-0101"));
Check("narrow question is a short exact list", narrow != null && narrow.Total <= 3, "total=" + narrow?.Total);
// ...but if nothing matches them all, relax one at a time instead of giving up
var relaxed = Find("SKU for Acme Server 2025 Essentials ROK 16CORE");
Check("relaxes when no row matches every word", relaxed != null && relaxed.Total >= 1);

// 3. broad question: a sample plus an honest "more not shown" footer
var broad = Find("Acme Server 2025 SKU", null, 160);
Check("broad question is capped and says so", broad != null && broad.Total > broad.Lines.Count && RowLookup.ToText(broad).Contains("more matching rows not shown"));

// 4. follow-up keeps the intent, takes its own subject
var f = Find("and for Standard?", "provide me the Datacenter SKU");
Check("follow-up uses Standard, not Datacenter", f != null && f.Lines.All(l => l.Contains("Standard", StringComparison.OrdinalIgnoreCase)) && Has(f, "AB1-0003"));

// 5. other phrasings of the same intent
Check("'part number' phrasing", Find("what is the part number of Acme Server 2025 Essentials") != null);
Check("'SKUs' plural", Find("list the SKUs for Acme Server 2025 Standard") != null);

// 6. questions that are not about codes must be left alone
Check("licensing question untouched", Find("How do I license Acme Server 2025?") == null);
Check("transfer question untouched", Find("Can I transfer my OEM license to another server?") == null);
Check("empty question untouched", Find("   ") == null);

// 7. Fit keeps whole rows and an accurate footer
var text = RowLookup.ToText(dc!);
var fit = RowLookup.Fit(text, 200);
Check("Fit shrinks to the budget", fit.Length <= 400 && fit.Length < text.Length);
Check("Fit keeps a footer that counts the dropped rows", fit.Contains("more matching rows not shown"));
Check("Fit leaves a short text alone", RowLookup.Fit("AB1-0001 | x", 200) == "AB1-0001 | x");

Console.WriteLine(fails == 0 ? "ALL PASSED" : fails + " FAILED");
return fails;
