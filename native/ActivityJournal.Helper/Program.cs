using System.Threading;

namespace ActivityJournal.Helper;

internal static class Program
{
    internal static EncryptedRepository? Repository { get; private set; }

    [STAThread]
    private static async Task<int> Main(string[] args)
    {
        if (args.Contains("--native-messaging") || !args.Contains("--collector"))
            return await NativeMessagingHost.RunAsync(CancellationToken.None);

        ApplicationConfiguration.Initialize();
        var dataDirectory = Environment.GetEnvironmentVariable("ACTIVITY_JOURNAL_DATA");
        if (string.IsNullOrWhiteSpace(dataDirectory))
            dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Activity Journal");

        using var mutex = new Mutex(true, "Local\\ActivityJournalCollector", out var ownsMutex);
        if (!ownsMutex) return 0;

        Repository = new EncryptedRepository(dataDirectory);
        Repository.Cleanup(Repository.GetSettings().RetentionDays);
        var processor = new ActivityProcessor(Repository);
        using var collector = new ActivityCollector(processor);
        await using var pipeServer = new PipeServer(processor, Repository, collector);
        pipeServer.Start();

        using var cleanupTimer = new System.Threading.Timer(
            _ => Repository.Cleanup(Repository.GetSettings().RetentionDays),
            null,
            TimeSpan.FromHours(24),
            TimeSpan.FromHours(24));

        Application.Run();
        Repository.Dispose();
        Repository = null;
        return 0;
    }
}
