using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace HybridMindApp;

public sealed class ChatMsg
{
    [JsonPropertyName("role")] public string Role { get; set; } = "user";
    [JsonPropertyName("content")] public string Content { get; set; } = "";
}

// One chat turn. The page assembles the personalisation (system text, memories, recalled snippets, tool notes);
// the host fits everything to the model's real context window, retrieves from the attached files and streams the reply.
public sealed class ChatRequest
{
    [JsonPropertyName("rid")] public string Rid { get; set; } = "";
    [JsonPropertyName("system")] public string System { get; set; } = "";
    [JsonPropertyName("summary")] public string? Summary { get; set; }
    [JsonPropertyName("history")] public List<ChatMsg> History { get; set; } = new();
    [JsonPropertyName("user")] public string User { get; set; } = "";
    [JsonPropertyName("inlineDocs")] public List<string> InlineDocs { get; set; } = new();
    [JsonPropertyName("scope")] public List<string> Scope { get; set; } = new();
    [JsonPropertyName("recall")] public List<string> Recall { get; set; } = new();
    [JsonPropertyName("notes")] public List<string> Notes { get; set; } = new();
    [JsonPropertyName("temperature")] public double? Temperature { get; set; }
    [JsonPropertyName("maxPrompt")] public int? MaxPrompt { get; set; }
    [JsonPropertyName("images")] public List<string> Images { get; set; } = new();   // attached pictures to send to a vision-capable cloud model (only when the user allows it)
}

public sealed class ChatResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("cancelled")] public bool Cancelled { get; set; }
    [JsonPropertyName("sources")] public List<Hit> Sources { get; set; } = new();
    [JsonPropertyName("promptChars")] public int PromptChars { get; set; }
    [JsonPropertyName("limitChars")] public int LimitChars { get; set; }
    [JsonPropertyName("historyUsed")] public int HistoryUsed { get; set; }
    [JsonPropertyName("historyDropped")] public int HistoryDropped { get; set; }
    [JsonPropertyName("userTruncated")] public bool UserTruncated { get; set; }
    [JsonPropertyName("firstTokenMs")] public long FirstTokenMs { get; set; }
    [JsonPropertyName("genMs")] public long GenMs { get; set; }
    [JsonPropertyName("retrievalMs")] public long RetrievalMs { get; set; }
    [JsonPropertyName("inlineDocs")] public List<string> InlineDocs { get; set; } = new();
    [JsonPropertyName("notes")] public List<string> Notes { get; set; } = new();
    [JsonPropertyName("route")] public string Route { get; set; } = "device";   // device | cloud
    [JsonPropertyName("model")] public string Model { get; set; } = "";
    [JsonPropertyName("tokensIn")] public int TokensIn { get; set; }
    [JsonPropertyName("tokensOut")] public int TokensOut { get; set; }
    [JsonPropertyName("errorKind")] public string? ErrorKind { get; set; }        // unreachable | auth | rate | filter | context | config | http
    [JsonPropertyName("sentChars")] public int SentChars { get; set; }
    [JsonPropertyName("redactions")] public int Redactions { get; set; }
}

// A streamed update pushed to the page while a reply is being written.
public sealed class ChatEvent
{
    [JsonPropertyName("event")] public string Event { get; set; } = "chat";
    [JsonPropertyName("rid")] public string Rid { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "delta";   // delta | status
    [JsonPropertyName("text")] public string Text { get; set; } = "";
}

// Text skills built into Windows (summarise / rewrite / text-to-table) and small background jobs (title, memory, summary).
public sealed class SkillRequest
{
    [JsonPropertyName("rid")] public string Rid { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";   // summarize | summarize-paragraph | rewrite | table | title | summary | memory
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("tone")] public string? Tone { get; set; }
    [JsonPropertyName("docPath")] public string? DocPath { get; set; }
    [JsonPropertyName("assistant")] public string? Assistant { get; set; }
    [JsonPropertyName("summary")] public string? Summary { get; set; }
    [JsonPropertyName("existing")] public List<string> Existing { get; set; } = new();
}

public sealed class SkillResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("facts")] public List<string> Facts { get; set; } = new();
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("truncated")] public bool Truncated { get; set; }
    [JsonPropertyName("cancelled")] public bool Cancelled { get; set; }
    [JsonPropertyName("ms")] public long Ms { get; set; }
}

public sealed class SystemInfo
{
    [JsonPropertyName("model")] public string Model { get; set; } = "";
    [JsonPropertyName("dataFolder")] public string DataFolder { get; set; } = "";
    [JsonPropertyName("dataBytes")] public long DataBytes { get; set; }
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("ocr")] public string Ocr { get; set; } = "";
    [JsonPropertyName("describe")] public string Describe { get; set; } = "";
    [JsonPropertyName("imageGen")] public string ImageGen { get; set; } = "";
    [JsonPropertyName("scaler")] public string Scaler { get; set; } = "";
    [JsonPropertyName("cutout")] public string Cutout { get; set; } = "";
}

// On-device image generation / editing (Windows AI ImageGenerator, ImageScaler, ImageForegroundExtractor).
public sealed class ImageRequest
{
    [JsonPropertyName("rid")] public string Rid { get; set; } = "";
    [JsonPropertyName("op")] public string Op { get; set; } = "generate";   // generate | restyle | upscale | cutout
    [JsonPropertyName("prompt")] public string Prompt { get; set; } = "";
    [JsonPropertyName("style")] public string? Style { get; set; }          // default | coloring
    [JsonPropertyName("source")] public string? Source { get; set; }        // path of an attached picture (restyle / upscale / cutout)
    [JsonPropertyName("seed")] public int? Seed { get; set; }
}

public sealed class ImageResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("url")] public string Url { get; set; } = "";         // relative to the media host
    [JsonPropertyName("path")] public string Path { get; set; } = "";
    [JsonPropertyName("width")] public int Width { get; set; }
    [JsonPropertyName("height")] public int Height { get; set; }
    [JsonPropertyName("seed")] public int Seed { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("cancelled")] public bool Cancelled { get; set; }
    [JsonPropertyName("unavailable")] public bool Unavailable { get; set; }
    [JsonPropertyName("ms")] public long Ms { get; set; }
}

// ── cloud (OpenAI-compatible / Azure OpenAI) ──
public sealed class CloudConfigDto
{
    [JsonPropertyName("provider")] public string Provider { get; set; } = "azure";      // azure | openai | compatible
    [JsonPropertyName("endpoint")] public string Endpoint { get; set; } = "";
    [JsonPropertyName("model")] public string Model { get; set; } = "";                // Azure: deployment name
    [JsonPropertyName("apiVersion")] public string ApiVersion { get; set; } = "";
    [JsonPropertyName("imageModel")] public string ImageModel { get; set; } = "";      // optional: image-generation deployment/model
    [JsonPropertyName("maxTokens")] public int MaxTokens { get; set; } = 3000;
    [JsonPropertyName("vision")] public bool Vision { get; set; }                      // the model accepts images
    [JsonPropertyName("hasKey")] public bool HasKey { get; set; }                      // output only
    [JsonPropertyName("apiKey")] public string? ApiKey { get; set; }                   // input only: written to the encrypted store, never returned
    [JsonPropertyName("clearKey")] public bool ClearKey { get; set; }
}

public sealed class CloudMsg
{
    [JsonPropertyName("role")] public string Role { get; set; } = "";
    [JsonPropertyName("content")] public string Content { get; set; } = "";
    [JsonPropertyName("images")] public int Images { get; set; }
}

public sealed class CloudFindingDto
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("level")] public string Level { get; set; } = "";
    [JsonPropertyName("count")] public int Count { get; set; }
    [JsonPropertyName("samples")] public List<string> Samples { get; set; } = new();
}

public sealed class CloudPrep
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("prepId")] public string PrepId { get; set; } = "";
    [JsonPropertyName("model")] public string Model { get; set; } = "";
    [JsonPropertyName("host")] public string Host { get; set; } = "";
    [JsonPropertyName("messages")] public List<CloudMsg> Messages { get; set; } = new();
    [JsonPropertyName("redacted")] public List<CloudMsg> Redacted { get; set; } = new();
    [JsonPropertyName("findings")] public List<CloudFindingDto> Findings { get; set; } = new();
    [JsonPropertyName("chars")] public int Chars { get; set; }
    [JsonPropertyName("sources")] public List<Hit> Sources { get; set; } = new();
    [JsonPropertyName("inlineDocs")] public List<string> InlineDocs { get; set; } = new();
    [JsonPropertyName("historyDropped")] public int HistoryDropped { get; set; }
}

public sealed class CloudChoice
{
    [JsonPropertyName("prepId")] public string PrepId { get; set; } = "";
    [JsonPropertyName("rid")] public string Rid { get; set; } = "";
    [JsonPropertyName("redacted")] public bool Redacted { get; set; }
}

public sealed class CloudTestResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("ms")] public long Ms { get; set; }
    [JsonPropertyName("model")] public string Model { get; set; } = "";
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("errorKind")] public string? ErrorKind { get; set; }
}
