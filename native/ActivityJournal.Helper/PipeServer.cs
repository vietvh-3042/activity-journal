using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace ActivityJournal.Helper;

public sealed class PipeServer : IAsyncDisposable
{
    public const string PipeName = "activity-journal-v1";
    private const int MaxRequestBytes = 1024 * 1024;
    private readonly ActivityProcessor processor;
    private readonly EncryptedRepository repository;
    private readonly ActivityCollector collector;
    private readonly CancellationTokenSource cancellation = new();
    private Task? listenTask;
    private DateTimeOffset? extensionConnectedAtUtc;

    public PipeServer(ActivityProcessor processor, EncryptedRepository repository, ActivityCollector collector)
    {
        this.processor = processor;
        this.repository = repository;
        this.collector = collector;
    }

    public void Start() => listenTask = ListenAsync(cancellation.Token);

    private async Task ListenAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var server = new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly,
                MaxRequestBytes,
                MaxRequestBytes);
            try
            {
                await server.WaitForConnectionAsync(cancellationToken);
                _ = Task.Run(() => HandleClientAsync(server, cancellationToken), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                await server.DisposeAsync();
                break;
            }
            catch
            {
                await server.DisposeAsync();
            }
        }
    }

    private async Task HandleClientAsync(NamedPipeServerStream stream, CancellationToken cancellationToken)
    {
        await using (stream)
        using (var reader = new StreamReader(stream, new UTF8Encoding(false), false, 4096, true))
        using (var writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, true) { AutoFlush = true })
        {
            PipeRequest? request = null;
            try
            {
                var line = await reader.ReadLineAsync(cancellationToken);
                if (line is null || Encoding.UTF8.GetByteCount(line) > MaxRequestBytes) throw new InvalidDataException("Request is empty or too large");
                request = JsonSerializer.Deserialize<PipeRequest>(line, JsonDefaults.Options) ?? throw new InvalidDataException("Invalid request");
                if (request.ApiVersion != 1) throw new InvalidOperationException("Unsupported API version");
                var result = await DispatchAsync(request.Command, request.Payload);
                await writer.WriteLineAsync(JsonSerializer.Serialize(new PipeResponse(request.Id, true, result, null), JsonDefaults.Options));
            }
            catch (Exception error)
            {
                var id = request?.Id ?? "unknown";
                await writer.WriteLineAsync(JsonSerializer.Serialize(new PipeResponse(id, false, null, SafeError(error)), JsonDefaults.Options));
            }
        }
    }

    private Task<object?> DispatchAsync(string command, JsonElement? payload)
    {
        object? result = command switch
        {
            "status" => processor.GetStatus(extensionConnectedAtUtc),
            "timeline" => repository.Timeline(Deserialize<RangeRequest>(payload)),
            "search" => repository.Search(Deserialize<SearchRequest>(payload)),
            "weeklyStats" => repository.WeeklyStats(Deserialize<RangeRequest>(payload)),
            "getSettings" => repository.GetSettings(),
            "updateSettings" => processor.UpdateSettings(ValidateSettings(Deserialize<JournalSettings>(payload))),
            "annotateSegments" => new { updated = repository.AnnotateSegments(Deserialize<AnnotateSegmentsRequest>(payload)) },
            "pause" => Pause(payload),
            "resume" => Resume(),
            "delete" => new { deleted = processor.Delete(Deserialize<DeleteRequest>(payload)) },
            "browserActivity" => RecordBrowser(payload),
            _ => throw new InvalidOperationException("Unknown command")
        };
        return Task.FromResult<object?>(result);
    }

    private object Pause(JsonElement? payload)
    {
        var request = payload is null || payload.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
            ? new PauseRequest(null)
            : Deserialize<PauseRequest>(payload);
        return processor.Pause(request.Minutes, extensionConnectedAtUtc);
    }

    private object Resume()
    {
        var status = processor.Resume(extensionConnectedAtUtc);
        collector.CaptureForeground();
        return status;
    }

    private object RecordBrowser(JsonElement? payload)
    {
        var activity = Deserialize<BrowserActivity>(payload);
        var accepted = processor.RecordBrowser(activity);
        if (accepted) extensionConnectedAtUtc = DateTimeOffset.UtcNow;
        return new { accepted };
    }

    private static JournalSettings ValidateSettings(JournalSettings settings)
    {
        if (settings.Exclusions.Count > 200 || (settings.ClassificationRules?.Count ?? 0) > 200) throw new ArgumentException("Too many rules");
        return settings with
        {
            IdleThresholdSeconds = Math.Clamp(settings.IdleThresholdSeconds, 60, 3600),
            RetentionDays = Math.Clamp(settings.RetentionDays, 1, 3650)
        };
    }

    private static T Deserialize<T>(JsonElement? payload)
    {
        if (payload is null || payload.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            throw new ArgumentException("Request payload is required");
        return payload.Value.Deserialize<T>(JsonDefaults.Options) ?? throw new ArgumentException("Invalid request payload");
    }

    private static string SafeError(Exception error) => error switch
    {
        ArgumentException or InvalidDataException or InvalidOperationException => error.Message,
        _ => "Collector request failed"
    };

    public async ValueTask DisposeAsync()
    {
        cancellation.Cancel();
        if (listenTask is not null)
        {
            try { await listenTask; }
            catch (OperationCanceledException) { }
        }
        cancellation.Dispose();
    }
}
