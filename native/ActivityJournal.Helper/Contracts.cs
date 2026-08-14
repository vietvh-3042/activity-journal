using System.Text.Json;
using System.Text.Json.Serialization;

namespace ActivityJournal.Helper;

public enum ActivityKind
{
    Active,
    Browser,
    Idle,
    Locked,
    Suspended,
    Paused,
    Excluded,
    AppOpen,
    AppClose,
    FileHint
}

public enum Confidence { High, Medium, Low }

public sealed record ActivityInput(
    DateTimeOffset AtUtc,
    ActivityKind Kind,
    string? App,
    string? Title,
    string? Domain,
    string? Path,
    string Source,
    Confidence Confidence);

public sealed record ActivitySegment(
    long Id,
    DateTimeOffset StartUtc,
    DateTimeOffset EndUtc,
    ActivityKind Kind,
    string? App,
    string? Title,
    string? Domain,
    string? Path,
    string Source,
    Confidence Confidence,
    string? Category = null,
    string? Project = null,
    string? Note = null)
{
    public double DurationSeconds => Math.Max(0, (EndUtc - StartUtc).TotalSeconds);
}

public sealed record ExclusionRule(long? Id, string Type, string Pattern);
public sealed record ClassificationRule(long? Id, string MatchType, string Pattern, string? Category, string? Project);

public sealed record JournalSettings(
    bool AutoStart,
    int IdleThresholdSeconds,
    int RetentionDays,
    IReadOnlyList<ExclusionRule> Exclusions,
    IReadOnlyList<ClassificationRule>? ClassificationRules = null);

public sealed record CollectorStatus(
    int ApiVersion,
    bool Running,
    bool Paused,
    DateTimeOffset? PausedUntilUtc,
    bool PauseIndefinitely,
    bool DatabaseEncrypted,
    DateTimeOffset? ExtensionConnectedAtUtc);

public sealed record SearchRequest(
    string? Query,
    DateTimeOffset? FromUtc,
    DateTimeOffset? ToUtc,
    IReadOnlyList<ActivityKind>? Kinds,
    string? App,
    string? Domain,
    int? Limit,
    int? Offset);

public sealed record RangeRequest(DateTimeOffset FromUtc, DateTimeOffset ToUtc);
public sealed record PauseRequest(int? Minutes);
public sealed record DeleteRequest(DateTimeOffset? FromUtc, DateTimeOffset? ToUtc, bool? All);
public sealed record AnnotateSegmentsRequest(IReadOnlyList<long> Ids, string? Category, string? Project, string? Note);
public sealed record BrowserActivity(string? Browser, string? Title, string? Hostname, DateTimeOffset? Timestamp);
public sealed record WeeklyStat(string Label, string Category, double DurationSeconds);

public sealed record PipeRequest(string Id, int ApiVersion, string Command, JsonElement? Payload);
public sealed record PipeResponse(string Id, bool Ok, object? Result, string? Error);

public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DictionaryKeyPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) }
    };
}
