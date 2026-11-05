using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace HybridMindApp;

// Deterministic scanner for data that should not leave the PC by accident: secrets (keys, tokens, passwords, private keys,
// payment cards) and personal identifiers (e-mail, phone, IBAN, national-ID-like numbers). It swaps each value for a stable
// placeholder such as [EMAIL_1] before a cloud call and puts the originals back into the reply. This is pattern matching,
// not understanding: it does NOT detect names, addresses, health details or confidential business text.
internal sealed class Redactor
{
    public sealed class Finding
    {
        public string Kind = "";
        public string Level = "pii";      // secret | pii
        public int Count;
        public List<string> Samples = new();
    }

    private sealed record Rule(string Kind, string Level, Regex Rx, Func<Match, bool>? Accept = null);

    private static bool Luhn(string digits)
    {
        int sum = 0; bool alt = false;
        for (int i = digits.Length - 1; i >= 0; i--)
        {
            int d = digits[i] - '0';
            if (alt) { d *= 2; if (d > 9) d -= 9; }
            sum += d; alt = !alt;
        }
        return sum % 10 == 0;
    }

    private static readonly Rule[] Rules =
    {
        new("PRIVATE_KEY", "secret", new Regex(@"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)", RegexOptions.Compiled)),
        new("API_KEY", "secret", new Regex(@"\b(?:sk-[A-Za-z0-9_\-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9\-]{10,}|AIza[0-9A-Za-z_\-]{30,}|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})\b", RegexOptions.Compiled)),
        new("SECRET", "secret", new Regex(@"(?i)\b(?:password|passwd|pwd|secret|api[_\- ]?key|access[_\- ]?token|auth[_\- ]?token|client[_\- ]?secret|connection[_\- ]?string)\b\s*[:=]\s*[""']?([^\s""',;]{3,}[^\s""',;.!?)\]])", RegexOptions.Compiled), null),
        new("BEARER", "secret", new Regex(@"(?i)\bBearer\s+([A-Za-z0-9._\-]{20,})", RegexOptions.Compiled)),
        new("CARD", "secret", new Regex(@"\b\d(?:[ \-]?\d){12,18}\b", RegexOptions.Compiled), m => { var d = new string(m.Value.Where(char.IsDigit).ToArray()); return d.Length is >= 13 and <= 19 && Luhn(d); }),
        new("IBAN", "pii", new Regex(@"\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){2,7}[A-Z0-9]{1,4}\b", RegexOptions.Compiled), m => m.Value.Replace(" ", "").Length is >= 15 and <= 34),
        new("SSN", "pii", new Regex(@"\b\d{3}-\d{2}-\d{4}\b", RegexOptions.Compiled)),
        new("EMAIL", "pii", new Regex(@"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b", RegexOptions.Compiled)),
        new("PHONE", "pii", new Regex(@"(?<![\w.])(?:\+\d{1,3}[ .\-]?)?(?:\(\d{2,4}\)[ .\-]?)?\d{2,4}[ .\-]\d{3,4}[ .\-]?\d{3,4}(?![\w])", RegexOptions.Compiled), m => new string(m.Value.Where(char.IsDigit).ToArray()).Length is >= 9 and <= 15),
    };

    private readonly Dictionary<string, string> _toPlaceholder = new();      // original -> [KIND_n]
    private readonly Dictionary<string, string> _toOriginal = new();         // [KIND_n] -> original
    private readonly Dictionary<string, Finding> _findings = new();
    private readonly Dictionary<string, int> _counters = new();

    public IReadOnlyCollection<Finding> Findings => _findings.Values;
    public bool Any => _findings.Count > 0;
    public int Distinct => _toPlaceholder.Count;   // different values replaced (the same value re-scanned in later agent steps isn't counted again)

    private static string Mask(string v)
    {
        if (v.Length <= 4) return new string('•', v.Length);
        return v.Substring(0, Math.Min(2, v.Length / 4 + 1)) + new string('•', Math.Min(8, v.Length - 3)) + v.Substring(v.Length - 2);
    }

    // Replace sensitive values in the text. Secrets are redacted first so a key inside "password: …" isn't also read as a phone number.
    public string Redact(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        foreach (var rule in Rules)
        {
            text = rule.Rx.Replace(text, m =>
            {
                if (m.Value.StartsWith("[") && m.Value.EndsWith("]")) return m.Value;
                if (rule.Accept != null && !rule.Accept(m)) return m.Value;
                // for "password: value" style rules only the value is replaced
                var valueGroup = m.Groups.Count > 1 && m.Groups[1].Success ? m.Groups[1] : null;
                var original = valueGroup != null ? valueGroup.Value : m.Value;
                if (original.StartsWith("[") && original.EndsWith("]")) return m.Value;
                if (!_toPlaceholder.TryGetValue(original, out var ph))
                {
                    _counters.TryGetValue(rule.Kind, out var n); _counters[rule.Kind] = ++n;
                    ph = $"[{rule.Kind}_{n}]";
                    _toPlaceholder[original] = ph; _toOriginal[ph] = original;
                }
                if (!_findings.TryGetValue(rule.Kind, out var f)) _findings[rule.Kind] = f = new Finding { Kind = rule.Kind, Level = rule.Level };
                f.Count++;
                if (f.Samples.Count < 3 && !f.Samples.Contains(Mask(original))) f.Samples.Add(Mask(original));
                return valueGroup != null ? m.Value.Substring(0, valueGroup.Index - m.Index) + ph + m.Value.Substring(valueGroup.Index - m.Index + valueGroup.Length) : ph;
            });
        }
        return text;
    }

    // Count what a scan would find without keeping placeholders for later (used for the "contains sensitive data" check on the original text).
    public string Restore(string text)
    {
        if (string.IsNullOrEmpty(text) || _toOriginal.Count == 0) return text;
        return Regex.Replace(text, @"\[[A-Z_]+_\d+\]", m => _toOriginal.TryGetValue(m.Value, out var o) ? o : m.Value);
    }
}
