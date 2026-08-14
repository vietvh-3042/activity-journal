using System.Buffers.Binary;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace ActivityJournal.Helper;

public static class NativeMessagingHost
{
    private const int MaxBrowserMessageBytes = 1024 * 1024;

    public static async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        using var input = Console.OpenStandardInput();
        using var output = Console.OpenStandardOutput();
        while (!cancellationToken.IsCancellationRequested)
        {
            var message = await ReadMessageAsync(input, cancellationToken);
            if (message is null) return 0;
            object response;
            try
            {
                var browserActivity = JsonSerializer.Deserialize<BrowserActivity>(message, JsonDefaults.Options)
                    ?? throw new InvalidDataException("Invalid browser payload");
                var pipeResponse = await ForwardAsync(browserActivity, cancellationToken);
                response = new { ok = pipeResponse.Ok, error = pipeResponse.Error };
            }
            catch (Exception error)
            {
                response = new { ok = false, error = error.Message };
            }
            await WriteMessageAsync(output, JsonSerializer.Serialize(response, JsonDefaults.Options), cancellationToken);
        }
        return 0;
    }

    private static async Task<PipeResponse> ForwardAsync(BrowserActivity activity, CancellationToken cancellationToken)
    {
        await using var client = new NamedPipeClientStream(".", PipeServer.PipeName, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        await client.ConnectAsync(2_000, cancellationToken);
        using var reader = new StreamReader(client, new UTF8Encoding(false), false, 4096, true);
        using var writer = new StreamWriter(client, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
        var request = new { id = Guid.NewGuid().ToString("N"), apiVersion = 1, command = "browserActivity", payload = activity };
        await writer.WriteLineAsync(JsonSerializer.Serialize(request, JsonDefaults.Options));
        var responseLine = await reader.ReadLineAsync(cancellationToken) ?? throw new EndOfStreamException();
        return JsonSerializer.Deserialize<PipeResponse>(responseLine, JsonDefaults.Options) ?? throw new InvalidDataException("Invalid collector response");
    }

    private static async Task<string?> ReadMessageAsync(Stream input, CancellationToken cancellationToken)
    {
        var lengthBytes = new byte[4];
        var first = await input.ReadAsync(lengthBytes.AsMemory(0, 4), cancellationToken);
        if (first == 0) return null;
        while (first < 4)
        {
            var read = await input.ReadAsync(lengthBytes.AsMemory(first, 4 - first), cancellationToken);
            if (read == 0) throw new EndOfStreamException();
            first += read;
        }
        var length = BinaryPrimitives.ReadInt32LittleEndian(lengthBytes);
        if (length is <= 0 or > MaxBrowserMessageBytes) throw new InvalidDataException("Browser message exceeds size limit");
        var payload = new byte[length];
        var offset = 0;
        while (offset < length)
        {
            var read = await input.ReadAsync(payload.AsMemory(offset, length - offset), cancellationToken);
            if (read == 0) throw new EndOfStreamException();
            offset += read;
        }
        return Encoding.UTF8.GetString(payload);
    }

    private static async Task WriteMessageAsync(Stream output, string value, CancellationToken cancellationToken)
    {
        var payload = Encoding.UTF8.GetBytes(value);
        var length = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(length, payload.Length);
        await output.WriteAsync(length, cancellationToken);
        await output.WriteAsync(payload, cancellationToken);
        await output.FlushAsync(cancellationToken);
    }
}
