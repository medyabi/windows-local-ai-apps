#if DEBUG
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Text;
using Windows.Storage;

namespace LocalMindApp;

// Debug-only probe of the on-device model's behaviour (streaming, context window, speed). Triggered by LocalState\probe.flag.
public sealed partial class MainWindow
{
    private async Task RunProbe3Async()
    {
        var flag = Path.Combine(ApplicationData.Current.LocalFolder.Path, "probe3.flag");
        if (!File.Exists(flag)) return;
        try
        {
            await Task.Delay(1500);
            Log("PROBE3 start");
            void Ready(string name, Func<AIFeatureReadyState> f) { try { Log("PROBE3 " + name + " ready=" + f()); } catch (Exception ex) { Log("PROBE3 " + name + " EXC " + ex.Message); } }
            Ready("ImageGenerator", Microsoft.Windows.AI.Imaging.ImageGenerator.GetReadyState);
            Ready("ImageScaler", Microsoft.Windows.AI.Imaging.ImageScaler.GetReadyState);
            Ready("ImageForegroundExtractor", Microsoft.Windows.AI.Imaging.ImageForegroundExtractor.GetReadyState);
            Ready("ImageDescriptionGenerator", Microsoft.Windows.AI.Imaging.ImageDescriptionGenerator.GetReadyState);
            Ready("TextRecognizer", Microsoft.Windows.AI.Imaging.TextRecognizer.GetReadyState);

            // describe real photos, with the status
            var err = Ocr.EnsureDescriber();
            Log("PROBE3 describer: " + (err ?? "ok"));
            foreach (var f in Directory.GetFiles("C:/Windows/Web/Wallpaper/Dell", "*.jpg").Take(3))
            {
                try
                {
                    var sw = Stopwatch.StartNew();
                    using var fs = File.OpenRead(f);
                    var ras = System.IO.WindowsRuntimeStreamExtensions.AsRandomAccessStream(fs);
                    var buf = Ocr.ToBuffer(ras);
                    var r = await Ocr.DescribeRawAsync(buf);
                    Log($"PROBE3 describe {Path.GetFileName(f)} ({sw.ElapsedMilliseconds}ms) status={r.status} text=[{r.text}]");
                }
                catch (Exception ex) { Log("PROBE3 describe EXC " + Path.GetFileName(f) + ": " + ex.Message); }
            }

            // generate an image
            try
            {
                var st = Microsoft.Windows.AI.Imaging.ImageGenerator.GetReadyState();
                if (st == AIFeatureReadyState.NotReady)
                {
                    Log("PROBE3 ImageGenerator EnsureReadyAsync...");
                    var er = await Microsoft.Windows.AI.Imaging.ImageGenerator.EnsureReadyAsync();
                    Log("PROBE3 ImageGenerator ensure=" + er.Status + " " + er.ExtendedError?.Message);
                }
                if (Microsoft.Windows.AI.Imaging.ImageGenerator.GetReadyState() == AIFeatureReadyState.Ready)
                {
                    using var gen = await Microsoft.Windows.AI.Imaging.ImageGenerator.CreateAsync();
                    var sw = Stopwatch.StartNew();
                    var res = await Task.Run(() => gen.GenerateImageFromTextPrompt("a friendly red bicycle leaning on a blue wall, flat illustration", new Microsoft.Windows.AI.Imaging.ImageGenerationOptions()));
                    Log($"PROBE3 generate ({sw.ElapsedMilliseconds}ms) status={res.Status} img={(res.Image == null ? "null" : res.Image.PixelWidth + "x" + res.Image.PixelHeight + " " + res.Image.PixelFormat)}");
                    if (res.Image != null)
                    {
                        var path = Path.Combine(ApplicationData.Current.LocalFolder.Path, "probe-generated.png");
                        await Ocr.SavePngAsync(res.Image, path);
                        Log("PROBE3 saved " + path + " " + new FileInfo(path).Length + " bytes");
                    }
                }
            }
            catch (Exception ex) { Log("PROBE3 generate EXC " + ex); }
            File.Move(flag, flag + ".done", true);
            Log("PROBE3 complete");
        }
        catch (Exception ex) { Log("PROBE3 EXCEPTION: " + ex); }
    }

    private async Task RunProbe2Async()
    {
        var flag = Path.Combine(ApplicationData.Current.LocalFolder.Path, "probe2.flag");
        if (!File.Exists(flag)) return;
        try
        {
            await Task.Delay(1500);
            Log("PROBE2 start");
            await HandleEnsureReadyAsync("probe2");
            var model = await LanguageModel.CreateAsync();
            const string text = "The quarterly review meeting took place on Tuesday. Revenue grew 12% over the previous quarter, driven mostly by the new subscription tier. Churn fell from 7.1% to 5.8%. The team agreed to hire two more support engineers and to postpone the mobile redesign until January. Marta will circulate the final budget by Friday, and Tomas will present the roadmap at the all-hands on October 20.";
            try
            {
                var sum = new TextSummarizer(model);
                var sw = Stopwatch.StartNew();
                var r = await sum.SummarizeAsync(text);
                Log($"PROBE2 summarize({sw.ElapsedMilliseconds}ms) {r.Status}: {r.Text?.Replace('\n', '|')}");
                var r2 = await sum.SummarizeParagraphAsync(text);
                Log($"PROBE2 summarizeParagraph {r2.Status}: {r2.Text?.Replace('\n', '|')}");
            }
            catch (Exception ex) { Log("PROBE2 summarizer EXC " + ex.Message); }
            try
            {
                var rw = new TextRewriter(model);
                var r = await rw.RewriteAsync("hey, can u send me the report asap, thx", TextRewriteTone.Formal);
                Log($"PROBE2 rewrite formal {r.Status}: {r.Text}");
                var r2 = await rw.RewriteCustomAsync("hey, can u send me the report asap, thx", "like a pirate");
                Log($"PROBE2 rewrite pirate {r2.Status}: {r2.Text}");
            }
            catch (Exception ex) { Log("PROBE2 rewriter EXC " + ex.Message); }
            try
            {
                var tb = new TextToTableConverter(model);
                var r = await tb.ConvertAsync("Apples cost 2 dollars and weigh 150g. Bananas cost 1 dollar and weigh 120g. Cherries cost 5 dollars and weigh 8g.");
                Log($"PROBE2 table {r.Status}: " + string.Join(" || ", r.GetRows().Select(row => string.Join(" | ", row.GetColumns()))));
            }
            catch (Exception ex) { Log("PROBE2 table EXC " + ex.Message); }
            try
            {
                var ev = model.GenerateEmbeddingVectors("hello world");
                Log($"PROBE2 embeddings status={ev.Status} count={ev.EmbeddingVectors?.Count} first={(ev.EmbeddingVectors?.Count > 0 ? ev.EmbeddingVectors[0].GetType().Name : "-")}");
            }
            catch (Exception ex) { Log("PROBE2 embeddings EXC " + ex.Message); }

            // transcript experiments
            foreach (var variant in new[] { "plain", "cue" })
            {
                var transcript = "Conversation so far:\nUser: Hi! I'm planning a trip to Lisbon in May.\nAssistant: Great choice! Lisbon in May is warm and sunny. What would you like to know?\nUser: Which neighbourhoods are best for food?\nAssistant: Try Alfama for traditional fado houses and tascas, Bairro Alto for nightlife and small plates, and Mouraria for multicultural food.\n\n";
                var prompt = transcript + "User: And how many days should I stay?" + (variant == "cue" ? "\nAssistant:" : "");
                var ctx = model.CreateContext("You are LocalMind, a helpful assistant running on the user's PC. Be concise. Reply to the last user message only.");
                var sw = Stopwatch.StartNew();
                var r = await model.GenerateResponseAsync(ctx, prompt, new LanguageModelOptions());
                Log($"PROBE2 transcript[{variant}] ({sw.ElapsedMilliseconds}ms) {r.Status}: {r.Text?.Replace('\n', '|')}");
            }
            File.Move(flag, flag + ".done", true);
            Log("PROBE2 complete");
        }
        catch (Exception ex) { Log("PROBE2 EXCEPTION: " + ex); }
    }

    private async Task RunProbeAsync()
    {
        var flag = Path.Combine(ApplicationData.Current.LocalFolder.Path, "probe.flag");
        if (!File.Exists(flag)) return;
        try
        {
            await Task.Delay(1500);
            Log("PROBE start");
            var ready = await HandleEnsureReadyAsync("probe");
            Log("PROBE ready=" + ready.Ok + " " + ready.State);
            var model = await LanguageModel.CreateAsync();

            // 1. streaming semantics
            var sw = Stopwatch.StartNew();
            var parts = new System.Collections.Generic.List<string>();
            var times = new System.Collections.Generic.List<long>();
            var ctx0 = model.CreateContext("You are a helpful assistant.");
            var op = model.GenerateResponseAsync(ctx0, "Explain in three sentences why the sky is blue.", new LanguageModelOptions());
            op.Progress = (info, p) => { lock (parts) { parts.Add(p); times.Add(sw.ElapsedMilliseconds); } };
            var res = await op;
            Log($"PROBE stream: status={res.Status} total={sw.ElapsedMilliseconds}ms progressCalls={parts.Count} firstAt={(times.Count > 0 ? times[0] : -1)}ms textLen={res.Text?.Length}");
            Log("PROBE stream first5=" + string.Join("¦", parts.Take(5)));
            Log("PROBE stream last2=" + string.Join("¦", parts.TakeLast(2).Select(s => s.Length > 80 ? s[..80] + "…(" + s.Length + ")" : s)));
            Log("PROBE final text=" + res.Text?.Replace('\n', ' '));

            // 2. usable prompt length
            foreach (var n in new[] { 500, 2000, 4000, 6000, 8000, 12000, 16000, 24000 })
            {
                var prompt = string.Join(" ", Enumerable.Range(0, n / 6).Select(i => "alpha" + (i % 10)));
                try
                {
                    var ctx = model.CreateContext("You are a helpful assistant.");
                    var u = model.GetUsablePromptLength(ctx, prompt);
                    Log($"PROBE usable: promptChars={prompt.Length} usable={u}");
                }
                catch (Exception ex) { Log($"PROBE usable promptChars={prompt.Length} EXC {ex.Message}"); }
            }

            // 3. does a context remember earlier turns?
            var c2 = model.CreateContext("You are a helpful assistant. Keep answers short.");
            var r1 = await model.GenerateResponseAsync(c2, "My favourite colour is teal. Remember that.", new LanguageModelOptions());
            Log("PROBE ctx turn1: " + r1.Status + " " + r1.Text?.Replace('\n', ' '));
            var r2 = await model.GenerateResponseAsync(c2, "What is my favourite colour?", new LanguageModelOptions());
            Log("PROBE ctx turn2: " + r2.Status + " " + r2.Text?.Replace('\n', ' '));

            // 4. long generation: how long can a reply be?
            sw.Restart();
            int chars = 0;
            var c3 = model.CreateContext("You are a helpful assistant.");
            var op3 = model.GenerateResponseAsync(c3, "Write a detailed 600-word essay about the history of the bicycle.", new LanguageModelOptions());
            op3.Progress = (i, p) => chars += p.Length;
            var r3 = await op3;
            Log($"PROBE long: status={r3.Status} textLen={r3.Text?.Length} progressChars={chars} ms={sw.ElapsedMilliseconds}");

            File.Move(flag, flag + ".done", true);
            Log("PROBE complete");
        }
        catch (Exception ex) { Log("PROBE EXCEPTION: " + ex); }
    }
}
#endif
