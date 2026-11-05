using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace LocalMindApp;

public sealed class SkillExtra
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("text")] public string Text { get; set; } = "";
}

public sealed class SkillFileInfo
{
    [JsonPropertyName("dir")] public string Dir { get; set; } = "";
    [JsonPropertyName("md")] public string Md { get; set; } = "";
    [JsonPropertyName("files")] public List<SkillExtra> Files { get; set; } = new();
}

// Skills are folders under LocalState\skills, each with a SKILL.md (front matter: name, description, …; body: instructions) and
// optional reference text files. Plain files, so they can also be edited outside the app. The page parses and applies them;
// the host only lists, saves, deletes, imports and seeds a few starters — it never runs anything from a skill folder.
internal sealed class SkillStore
{
    private readonly string _root;
    private readonly Action<string> _log;
    private static readonly Regex NameRx = new(@"^[a-z0-9][a-z0-9-]{0,39}$", RegexOptions.Compiled);
    private static readonly HashSet<string> RefExt = new(StringComparer.OrdinalIgnoreCase) { ".md", ".txt", ".csv", ".json", ".yaml", ".yml", ".tsv" };
    private const int MaxMd = 40 * 1024, MaxExtra = 20 * 1024, MaxExtraFiles = 5;

    public SkillStore(string root, Action<string> log)
    {
        _root = root; _log = log;
        Directory.CreateDirectory(_root);
        Seed();
    }

    public string Root => _root;
    public static bool ValidName(string n) => NameRx.IsMatch(n ?? "");
    public static string Slug(string s)
    {
        var t = Regex.Replace((s ?? "").ToLowerInvariant(), @"[^a-z0-9]+", "-").Trim('-');
        if (t.Length > 40) t = t.Substring(0, 40).Trim('-');
        return t.Length == 0 ? "skill" : t;
    }

    private string DirFor(string name)
    {
        if (!ValidName(name)) throw new ArgumentException("Skill names use lowercase letters, digits and dashes (up to 40 characters).");
        return Path.Combine(_root, name);
    }

    public List<SkillFileInfo> List()
    {
        var res = new List<SkillFileInfo>();
        foreach (var d in Directory.EnumerateDirectories(_root).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
        {
            var name = Path.GetFileName(d);
            var md = Path.Combine(d, "SKILL.md");
            if (!ValidName(name) || !File.Exists(md) || new FileInfo(md).Length > MaxMd) continue;
            var info = new SkillFileInfo { Dir = name, Md = File.ReadAllText(md, Encoding.UTF8) };
            foreach (var f in Directory.EnumerateFiles(d).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
            {
                if (info.Files.Count >= MaxExtraFiles) break;
                if (Path.GetFileName(f).Equals("SKILL.md", StringComparison.OrdinalIgnoreCase) || !RefExt.Contains(Path.GetExtension(f))) continue;
                if (new FileInfo(f).Length > MaxExtra) continue;
                info.Files.Add(new SkillExtra { Name = Path.GetFileName(f), Text = File.ReadAllText(f, Encoding.UTF8) });
            }
            res.Add(info);
        }
        return res;
    }

    public void Save(string name, string md)
    {
        if (md.Length > MaxMd) throw new ArgumentException("That skill is too long.");
        var d = DirFor(name);
        Directory.CreateDirectory(d);
        File.WriteAllText(Path.Combine(d, "SKILL.md"), md, new UTF8Encoding(false));
    }

    public void Delete(string name)
    {
        var d = Path.GetFullPath(DirFor(name));
        if (!d.StartsWith(Path.GetFullPath(_root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Invalid skill.");
        if (Directory.Exists(d)) Directory.Delete(d, true);
    }

    private string UniqueName(string wanted)
    {
        var n = wanted; int i = 2;
        while (Directory.Exists(Path.Combine(_root, n))) n = (wanted.Length > 36 ? wanted.Substring(0, 36) : wanted) + "-" + i++;
        return n;
    }

    // a folder that is itself a skill (has SKILL.md), or a folder of skill folders
    public int ImportFolder(string path)
    {
        if (!Directory.Exists(path)) throw new DirectoryNotFoundException("Folder not found.");
        var candidates = File.Exists(Path.Combine(path, "SKILL.md")) ? new List<string> { path }
            : Directory.EnumerateDirectories(path).Where(d => File.Exists(Path.Combine(d, "SKILL.md"))).ToList();
        int n = 0;
        foreach (var src in candidates)
        {
            var name = UniqueName(Slug(Path.GetFileName(src.TrimEnd(Path.DirectorySeparatorChar))));
            var dst = Path.Combine(_root, name);
            Directory.CreateDirectory(dst);
            int copied = 0;
            foreach (var f in Directory.EnumerateFiles(src))
            {
                var fn = Path.GetFileName(f);
                bool isSkill = fn.Equals("SKILL.md", StringComparison.OrdinalIgnoreCase);
                if (!isSkill && !RefExt.Contains(Path.GetExtension(f))) continue;          // scripts and binaries are never copied
                if (new FileInfo(f).Length > (isSkill ? MaxMd : MaxExtra)) continue;
                if (!isSkill && copied >= MaxExtraFiles) continue;
                File.Copy(f, Path.Combine(dst, isSkill ? "SKILL.md" : fn), true);
                if (!isSkill) copied++;
            }
            n++;
        }
        if (n == 0) throw new InvalidDataException("No SKILL.md found in that folder.");
        return n;
    }

    public string ImportFile(string path)
    {
        var fi = new FileInfo(path);
        if (!fi.Exists || fi.Length > MaxMd) throw new InvalidDataException("That file is missing or too large.");
        var md = File.ReadAllText(path, Encoding.UTF8);
        var m = Regex.Match(md, @"(?m)^name:\s*(.+?)\s*$");
        var name = UniqueName(Slug(m.Success ? m.Groups[1].Value : Path.GetFileNameWithoutExtension(path)));
        Save(name, md);
        return name;
    }

    // a few starters on first run; deleting them is fine and they are not recreated
    private void Seed()
    {
        var marker = Path.Combine(_root, ".seeded");
        if (File.Exists(marker)) return;
        foreach (var (name, md) in Starters())
            if (!Directory.Exists(Path.Combine(_root, name))) { try { Save(name, md); } catch (Exception ex) { _log("Seed skill failed: " + ex.Message); } }
        File.WriteAllText(marker, "1");
    }

    private static IEnumerable<(string, string)> Starters()
    {
        yield return ("meeting-minutes", "---\nname: meeting-minutes\ndescription: Turn rough meeting notes or a transcript into clean minutes with decisions and action items\nargument-hint: paste your meeting notes\nauto: true\n---\nRewrite the user's notes as meeting minutes with these sections: **Summary** (2–3 sentences), **Decisions** (bullets), **Action items** (bullets written as \"Owner — task — due date\"; write \"not stated\" when an owner or date is missing), and **Open questions**. Use only what is in the notes; never invent names, dates or decisions. Leave out a section that would be empty.\n");
        yield return ("email-reply", "---\nname: email-reply\ndescription: Draft a polite reply to an email the user pastes\nargument-hint: paste the email and say what you want to answer\nauto: true\n---\nDraft a reply to the email the user pasted. Be polite and concise (under 120 words unless asked), answer every question in the email, and end with a clear next step. If the user gives instructions such as tone or a yes/no decision, follow them. Output only the email text, starting with the greeting.\n");
        yield return ("proofread", "---\nname: proofread\ndescription: Proofread text and fix spelling, grammar and punctuation while keeping the author's voice\nargument-hint: paste the text to proofread\nauto: true\n---\nProofread the user's text. First give the corrected text in full, then a short list of the changes you made (at most 6). Fix spelling, grammar, punctuation and clarity only; keep the author's meaning and voice.\n");
        yield return ("eli5", "---\nname: eli5\ndescription: Explain a topic simply, as to a curious ten-year-old\nargument-hint: the topic to explain\nauto: false\n---\nExplain the user's topic to a curious ten-year-old: short sentences, everyday analogies, no jargon, under 150 words. End with one fun question that checks understanding.\n");
    }
}
