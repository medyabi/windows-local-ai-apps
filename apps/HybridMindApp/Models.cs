using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace HybridMindApp;

public sealed class BridgeRequest
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("prompt")] public string? Prompt { get; set; }
    [JsonPropertyName("data")] public string? Data { get; set; }
    [JsonPropertyName("hist")] public string? Hist { get; set; }
    [JsonPropertyName("n")] public int? N { get; set; }
}

public sealed class BridgeResponse
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("text")] public string? Text { get; set; }
    [JsonPropertyName("state")] public string? State { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
}

public sealed class DocInfo
{
    [JsonPropertyName("path")] public string Path { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("ext")] public string Ext { get; set; } = "";
    [JsonPropertyName("sizeBytes")] public long SizeBytes { get; set; }
    [JsonPropertyName("modifiedTicks")] public long ModifiedTicks { get; set; }
    [JsonPropertyName("pages")] public int Pages { get; set; }
    [JsonPropertyName("chunks")] public int Chunks { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "indexed";
    [JsonPropertyName("note")] public string Note { get; set; } = "";
}

public sealed class ChunkRec
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("doc")] public string DocPath { get; set; } = "";
    [JsonPropertyName("loc")] public string Loc { get; set; } = "";
    [JsonPropertyName("text")] public string Text { get; set; } = "";
}

public sealed class StoreFile
{
    [JsonPropertyName("docs")] public List<DocInfo> Docs { get; set; } = new();
    [JsonPropertyName("chunks")] public List<ChunkRec> Chunks { get; set; } = new();
    [JsonPropertyName("lastFolder")] public string? LastFolder { get; set; }
}

public sealed class LibraryInfo
{
    [JsonPropertyName("docs")] public List<DocInfo> Docs { get; set; } = new();
    [JsonPropertyName("totalChunks")] public int TotalChunks { get; set; }
    [JsonPropertyName("lastFolder")] public string? LastFolder { get; set; }
}

public sealed class IndexSummary
{
    [JsonPropertyName("added")] public int Added { get; set; }
    [JsonPropertyName("updated")] public int Updated { get; set; }
    [JsonPropertyName("unchanged")] public int Unchanged { get; set; }
    [JsonPropertyName("skipped")] public int Skipped { get; set; }
    [JsonPropertyName("failed")] public int Failed { get; set; }
    [JsonPropertyName("filesSeen")] public int FilesSeen { get; set; }
    [JsonPropertyName("chunksAdded")] public int ChunksAdded { get; set; }
    [JsonPropertyName("seconds")] public double Seconds { get; set; }
    [JsonPropertyName("messages")] public List<string> Messages { get; set; } = new();
    [JsonPropertyName("paths")] public List<string> Paths { get; set; } = new();
}

public sealed class IndexStatus
{
    [JsonPropertyName("idle")] public bool Idle { get; set; }
    [JsonPropertyName("semantic")] public string Semantic { get; set; } = "unknown";
    [JsonPropertyName("lexical")] public string Lexical { get; set; } = "unknown";
    [JsonPropertyName("indexReady")] public bool IndexReady { get; set; }
    [JsonPropertyName("detail")] public string Detail { get; set; } = "";
    [JsonPropertyName("items")] public long Items { get; set; }
    [JsonPropertyName("completed")] public long Completed { get; set; }
    [JsonPropertyName("pending")] public long Pending { get; set; }
    [JsonPropertyName("errors")] public long Errors { get; set; }
}

public sealed class ProgressEvent
{
    [JsonPropertyName("event")] public string Event { get; set; } = "progress";
    [JsonPropertyName("stage")] public string Stage { get; set; } = "";
    [JsonPropertyName("current")] public int Current { get; set; }
    [JsonPropertyName("total")] public int Total { get; set; }
    [JsonPropertyName("file")] public string File { get; set; } = "";
}

public sealed class Hit
{
    [JsonPropertyName("n")] public int N { get; set; }
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("docPath")] public string DocPath { get; set; } = "";
    [JsonPropertyName("docName")] public string DocName { get; set; } = "";
    [JsonPropertyName("loc")] public string Loc { get; set; } = "";
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("score")] public double Score { get; set; }
    [JsonPropertyName("viaIndex")] public bool ViaIndex { get; set; }
    [JsonPropertyName("viaKeyword")] public bool ViaKeyword { get; set; }
    [JsonPropertyName("sent")] public bool SentToModel { get; set; }
    [JsonPropertyName("keyLines")] public List<string> KeyLines { get; set; } = new();
}

public sealed class SearchResult
{
    [JsonPropertyName("hits")] public List<Hit> Hits { get; set; } = new();
    [JsonPropertyName("indexMatches")] public int IndexMatches { get; set; }
    [JsonPropertyName("keywordMatches")] public int KeywordMatches { get; set; }
    [JsonPropertyName("retrievalMs")] public long RetrievalMs { get; set; }
    [JsonPropertyName("note")] public string Note { get; set; } = "";
}

public sealed class AskResult
{
    [JsonPropertyName("answer")] public string Answer { get; set; } = "";
    [JsonPropertyName("notFound")] public bool NotFound { get; set; }
    [JsonPropertyName("hits")] public List<Hit> Hits { get; set; } = new();
    [JsonPropertyName("numbersFound")] public List<string> NumbersFound { get; set; } = new();
    [JsonPropertyName("numbersMissing")] public List<string> NumbersMissing { get; set; } = new();
    [JsonPropertyName("indexMatches")] public int IndexMatches { get; set; }
    [JsonPropertyName("keywordMatches")] public int KeywordMatches { get; set; }
    [JsonPropertyName("retrievalMs")] public long RetrievalMs { get; set; }
    [JsonPropertyName("generationMs")] public long GenerationMs { get; set; }
    [JsonPropertyName("attempts")] public int Attempts { get; set; }
    [JsonPropertyName("excerptsSent")] public int ExcerptsSent { get; set; }
    [JsonPropertyName("modelError")] public string? ModelError { get; set; }
    [JsonPropertyName("autoCited")] public bool AutoCited { get; set; }
    [JsonPropertyName("citationsFixed")] public bool CitationsFixed { get; set; }
    [JsonPropertyName("rescued")] public bool Rescued { get; set; }
    [JsonPropertyName("unknownTerms")] public List<string> UnknownTerms { get; set; } = new();
}

[JsonSerializable(typeof(BridgeRequest))]
[JsonSerializable(typeof(BridgeResponse))]
[JsonSerializable(typeof(StoreFile))]
[JsonSerializable(typeof(LibraryInfo))]
[JsonSerializable(typeof(IndexSummary))]
[JsonSerializable(typeof(IndexStatus))]
[JsonSerializable(typeof(ProgressEvent))]
[JsonSerializable(typeof(SearchResult))]
[JsonSerializable(typeof(AskResult))]
[JsonSerializable(typeof(List<string>))]
[JsonSerializable(typeof(ChatRequest))]
[JsonSerializable(typeof(ChatResult))]
[JsonSerializable(typeof(ChatEvent))]
[JsonSerializable(typeof(SkillRequest))]
[JsonSerializable(typeof(SkillResult))]
[JsonSerializable(typeof(SystemInfo))]
[JsonSerializable(typeof(List<SkillFileInfo>))]
[JsonSerializable(typeof(AgentConfigDto))]
[JsonSerializable(typeof(AgentStartReq))]
[JsonSerializable(typeof(AgentStepReq))]
[JsonSerializable(typeof(AgentStepResult))]
[JsonSerializable(typeof(AgentToolReq))]
[JsonSerializable(typeof(AgentToolResult))]
[JsonSerializable(typeof(CloudConfigDto))]
[JsonSerializable(typeof(CloudPrep))]
[JsonSerializable(typeof(CloudChoice))]
[JsonSerializable(typeof(CloudTestResult))]
[JsonSerializable(typeof(ImageRequest))]
[JsonSerializable(typeof(ImageResult))]
internal partial class BridgeJsonContext : JsonSerializerContext
{
}
