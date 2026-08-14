namespace ActivityJournal.Helper;

public sealed class ActivityProcessor
{
    private readonly EncryptedRepository repository;
    private readonly PrivacyFilter privacy;
    private readonly object gate = new();
    private CurrentSegment? current;
    private bool pauseIndefinitely;
    private DateTimeOffset? pausedUntilUtc;
    private JournalSettings settings;

    private sealed record CurrentSegment(long Id, DateTimeOffset StartUtc, ActivityInput Input);

    public ActivityProcessor(EncryptedRepository repository)
    {
        this.repository = repository;
        settings = repository.GetSettings();
        privacy = new PrivacyFilter(settings.Exclusions);
        (pauseIndefinitely, pausedUntilUtc) = repository.GetPauseState();
        ExpirePauseIfNeeded();
    }

    public int IdleThresholdSeconds
    {
        get { lock (gate) return settings.IdleThresholdSeconds; }
    }

    public bool IsPaused
    {
        get
        {
            lock (gate)
            {
                ExpirePauseIfNeeded();
                return pauseIndefinitely || pausedUntilUtc > DateTimeOffset.UtcNow;
            }
        }
    }

    public (bool Indefinite, DateTimeOffset? Until) PauseState
    {
        get { lock (gate) return (pauseIndefinitely, pausedUntilUtc); }
    }

    public void Record(ActivityInput input)
    {
        lock (gate)
        {
            ExpirePauseIfNeeded();
            if (pauseIndefinitely || pausedUntilUtc > DateTimeOffset.UtcNow)
            {
                EnsurePaused(input.AtUtc);
                return;
            }

            var filtered = privacy.Apply(input);
            if (filtered.Kind is ActivityKind.AppOpen or ActivityKind.AppClose)
            {
                repository.Insert(filtered);
                return;
            }
            if (filtered.Kind == ActivityKind.FileHint)
            {
                AttachFileHint(filtered);
                return;
            }
            RecordCore(filtered);
        }
    }

    public bool RecordBrowser(BrowserActivity activity)
    {
        lock (gate)
        {
            ExpirePauseIfNeeded();
            if (pauseIndefinitely || pausedUntilUtc > DateTimeOffset.UtcNow) return false;
            if (current?.Input.App is not ("Google Chrome" or "Microsoft Edge")) return false;

            var timestamp = activity.Timestamp?.ToUniversalTime() ?? DateTimeOffset.UtcNow;
            if (Math.Abs((DateTimeOffset.UtcNow - timestamp).TotalMinutes) > 2) return false;
            var hostname = BrowserSanitizer.NormalizeHostname(activity.Hostname);
            var title = BrowserSanitizer.NormalizeTitle(activity.Title);
            if (hostname is null && title is null) return false;

            RecordCore(privacy.Apply(new ActivityInput(
                timestamp,
                ActivityKind.Browser,
                current.Input.App,
                title,
                hostname,
                null,
                "browser_extension",
                Confidence.High)));
            return true;
        }
    }

    public CollectorStatus GetStatus(DateTimeOffset? extensionConnectedAtUtc)
    {
        lock (gate)
        {
            ExpirePauseIfNeeded();
            return new CollectorStatus(1, true, pauseIndefinitely || pausedUntilUtc > DateTimeOffset.UtcNow, pausedUntilUtc, pauseIndefinitely, repository.IsEncrypted, extensionConnectedAtUtc);
        }
    }

    public CollectorStatus Pause(int? minutes, DateTimeOffset? extensionConnectedAtUtc)
    {
        lock (gate)
        {
            pauseIndefinitely = minutes is null;
            pausedUntilUtc = minutes is null ? null : DateTimeOffset.UtcNow.AddMinutes(Math.Clamp(minutes.Value, 1, 1440));
            repository.SetPauseState(pauseIndefinitely, pausedUntilUtc);
            EnsurePaused(DateTimeOffset.UtcNow);
            return GetStatus(extensionConnectedAtUtc);
        }
    }

    public CollectorStatus Resume(DateTimeOffset? extensionConnectedAtUtc)
    {
        lock (gate)
        {
            pauseIndefinitely = false;
            pausedUntilUtc = null;
            repository.SetPauseState(false, null);
            EndCurrent(DateTimeOffset.UtcNow);
            return GetStatus(extensionConnectedAtUtc);
        }
    }

    public void Heartbeat(DateTimeOffset atUtc)
    {
        lock (gate)
        {
            ExpirePauseIfNeeded();
            if (pauseIndefinitely || pausedUntilUtc > atUtc) EnsurePaused(atUtc);
            if (current is not null) repository.UpdateEnd(current.Id, atUtc);
        }
    }

    public JournalSettings UpdateSettings(JournalSettings settings)
    {
        var updated = repository.UpdateSettings(settings);
        lock (gate)
        {
            this.settings = updated;
            privacy.ReplaceRules(updated.Exclusions);
        }
        return updated;
    }

    public int Delete(DeleteRequest request)
    {
        lock (gate)
        {
            current = null;
            return repository.Delete(request);
        }
    }

    private void RecordCore(ActivityInput input)
    {
        var at = current is null || input.AtUtc >= current.StartUtc ? input.AtUtc : current.StartUtc;
        input = input with { AtUtc = at };
        if (current is not null && SameIdentity(current.Input, input))
        {
            repository.UpdateEnd(current.Id, at);
            return;
        }
        EndCurrent(at);
        current = new CurrentSegment(repository.Insert(input), at, input);
    }

    private void EnsurePaused(DateTimeOffset atUtc)
    {
        var paused = new ActivityInput(atUtc, ActivityKind.Paused, null, null, null, null, "user_pause", Confidence.High);
        if (current?.Input.Kind == ActivityKind.Paused) repository.UpdateEnd(current.Id, atUtc);
        else RecordCore(paused);
    }

    private void AttachFileHint(ActivityInput input)
    {
        if (current is null || input.Path is null) return;
        if ((input.AtUtc - current.StartUtc).TotalSeconds > 30) return;
        if (current.Input.Kind is not (ActivityKind.Active or ActivityKind.Browser)) return;
        var filtered = privacy.Apply(current.Input with { Path = input.Path });
        if (filtered.Kind == ActivityKind.Excluded)
        {
            repository.Redact(current.Id);
            current = new CurrentSegment(current.Id, current.StartUtc, filtered with { AtUtc = current.StartUtc });
            return;
        }
        repository.AttachPath(current.Id, input.Path);
        current = current with { Input = current.Input with { Path = input.Path, Confidence = Confidence.Low } };
    }

    private void EndCurrent(DateTimeOffset atUtc)
    {
        if (current is null) return;
        repository.UpdateEnd(current.Id, atUtc < current.StartUtc ? current.StartUtc : atUtc);
        current = null;
    }

    private void ExpirePauseIfNeeded()
    {
        if (!pauseIndefinitely && pausedUntilUtc is not null && pausedUntilUtc <= DateTimeOffset.UtcNow)
        {
            pausedUntilUtc = null;
            repository.SetPauseState(false, null);
            if (current?.Input.Kind == ActivityKind.Paused) EndCurrent(DateTimeOffset.UtcNow);
        }
    }

    public static bool SameIdentity(ActivityInput left, ActivityInput right) =>
        left.Kind == right.Kind
        && string.Equals(left.App, right.App, StringComparison.Ordinal)
        && string.Equals(left.Title, right.Title, StringComparison.Ordinal)
        && string.Equals(left.Domain, right.Domain, StringComparison.Ordinal)
        && string.Equals(left.Path, right.Path, StringComparison.Ordinal)
        && string.Equals(left.Source, right.Source, StringComparison.Ordinal);
}
