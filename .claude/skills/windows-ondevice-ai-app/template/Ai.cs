using System.Collections.Concurrent;
using System.Diagnostics;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Text;
using Windows.Foundation;

namespace AiApp;

// Shared helpers for every Windows AI feature: readiness, the single language-model instance, cancellation.
internal static class Ai
{
    // The NPU runs one language-model request at a time: take this gate around GenerateResponseAsync and the text skills.
    public static readonly SemaphoreSlim ModelGate = new(1, 1);

    private static LanguageModel? _model;
    private static readonly SemaphoreSlim CreateLock = new(1, 1);

    // ── cancellation by request id (the page calls the "cancel" op with the id of the running request) ──
    private static readonly ConcurrentDictionary<string, CancellationTokenSource> Running = new();
    public static CancellationTokenSource Register(string id) { var c = new CancellationTokenSource(); Running[id] = c; return c; }
    public static void Unregister(string id) { if (Running.TryRemove(id, out var c)) c.Dispose(); }
    public static bool Cancel(string id) { if (Running.TryGetValue(id, out var c)) { try { c.Cancel(); } catch { } return true; } return false; }

    public static string Explain(AIFeatureReadyState st, string what) => st switch
    {
        AIFeatureReadyState.DisabledByUser => $"{what} is turned off. Enable it in Settings > System > AI components.",
        AIFeatureReadyState.NotSupportedOnCurrentSystem => $"This PC does not support {what} (it needs a Copilot+ PC).",
        _ => $"{what} is not ready ({st}).",
    };

    // Make a Windows AI feature ready. If its model is not on the PC yet, Windows downloads it (first use only; a few
    // minutes for the language model, much longer for some image models). Returns null when ready, otherwise a message.
    // `progress` receives 0..1 while downloading. Gives up if Windows makes no progress for `stallMinutes`.
    public static async Task<string?> EnsureReadyAsync(
        string what,
        Func<AIFeatureReadyState> getState,
        Func<IAsyncOperationWithProgress<AIFeatureReadyResult, double>> ensure,
        Action<double>? progress = null,
        int stallMinutes = 8)
    {
        var st = getState();
        if (st == AIFeatureReadyState.Ready) return null;
        if (st != AIFeatureReadyState.NotReady) return Explain(st, what);

        var op = ensure();
        var lastChange = Stopwatch.StartNew();
        double last = -1;
        op.Progress = (i, p) => { if (p != last) { last = p; lastChange.Restart(); progress?.Invoke(p); } };
        var done = new TaskCompletionSource();
        op.Completed = (o, status) => done.TrySetResult();
        while (!done.Task.IsCompleted)
        {
            await Task.WhenAny(done.Task, Task.Delay(3000));
            if (!done.Task.IsCompleted && lastChange.Elapsed > TimeSpan.FromMinutes(stallMinutes))
            {
                try { op.Cancel(); } catch { }
                return $"Windows has not finished preparing {what} on this PC (no progress for {stallMinutes} minutes). " +
                       "These components arrive through Windows Update: check Settings > Windows Update, then try again.";
            }
        }
        AIFeatureReadyResult r;
        try { r = op.GetResults(); } catch (Exception ex) { return $"Could not set up {what}: {ex.Message}"; }
        if (r.Status != AIFeatureReadyResultState.Success)
            return $"Could not set up {what}: {r.Status}{(r.ExtendedError != null ? " - " + r.ExtendedError.Message : "")}";
        var after = getState();
        return after == AIFeatureReadyState.Ready ? null : Explain(after, what);
    }

    // The shared Phi Silica instance. Returns (model, null) or (null, message).
    public static async Task<(LanguageModel? model, string? error)> GetModelAsync(Action<double>? progress = null)
    {
        if (_model != null) return (_model, null);
        await CreateLock.WaitAsync();
        try
        {
            if (_model != null) return (_model, null);
            var err = await EnsureReadyAsync("the on-device language model", LanguageModel.GetReadyState, LanguageModel.EnsureReadyAsync, progress);
            if (err != null) return (null, err);
            _model = await LanguageModel.CreateAsync();
            return (_model, null);
        }
        finally { CreateLock.Release(); }
    }
}
