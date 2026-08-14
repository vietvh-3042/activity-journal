using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace ActivityJournal.Helper;

public sealed class ActivityCollector : IDisposable
{
    private readonly ActivityProcessor processor;
    private readonly NativeMethods.WinEventDelegate winEventDelegate;
    private readonly NativeMethods.EnumWindowsDelegate enumWindowsDelegate;
    private readonly System.Threading.Timer idleTimer;
    private readonly System.Threading.Timer heartbeatTimer;
    private readonly System.Threading.Timer appScanTimer;
    private readonly FileSystemWatcher? recentWatcher;
    private readonly object appGate = new();
    private HashSet<string> visibleApps = new(StringComparer.OrdinalIgnoreCase);
    private IntPtr foregroundHook;
    private IntPtr nameHook;
    private bool isIdle;
    private bool isLocked;

    public ActivityCollector(ActivityProcessor processor)
    {
        this.processor = processor;
        winEventDelegate = HandleWinEvent;
        enumWindowsDelegate = VisitWindow;
        foregroundHook = NativeMethods.SetWinEventHook(NativeMethods.EventSystemForeground, NativeMethods.EventSystemForeground, IntPtr.Zero, winEventDelegate, 0, 0, NativeMethods.WineventOutOfContext | NativeMethods.WineventSkipOwnProcess);
        nameHook = NativeMethods.SetWinEventHook(NativeMethods.EventObjectNameChange, NativeMethods.EventObjectNameChange, IntPtr.Zero, winEventDelegate, 0, 0, NativeMethods.WineventOutOfContext | NativeMethods.WineventSkipOwnProcess);

        SystemEvents.SessionSwitch += HandleSessionSwitch;
        SystemEvents.PowerModeChanged += HandlePowerModeChanged;
        idleTimer = new System.Threading.Timer(_ => CheckIdle(), null, TimeSpan.Zero, TimeSpan.FromSeconds(1));
        heartbeatTimer = new System.Threading.Timer(_ => processor.Heartbeat(DateTimeOffset.UtcNow), null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
        appScanTimer = new System.Threading.Timer(_ => ScanVisibleApps(), null, TimeSpan.Zero, TimeSpan.FromSeconds(3));

        var recentPath = Environment.GetFolderPath(Environment.SpecialFolder.Recent);
        if (Directory.Exists(recentPath))
        {
            recentWatcher = new FileSystemWatcher(recentPath, "*.lnk") { NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite };
            recentWatcher.Created += HandleRecentItem;
            recentWatcher.Changed += HandleRecentItem;
            recentWatcher.EnableRaisingEvents = true;
        }
        CaptureForeground();
    }

    public void CaptureForeground()
    {
        var hwnd = NativeMethods.GetForegroundWindow();
        var window = DescribeWindow(hwnd);
        if (window is null) return;
        var (app, title) = window.Value;
        var isBrowser = app is "Google Chrome" or "Microsoft Edge";
        processor.Record(new ActivityInput(
            DateTimeOffset.UtcNow,
            ActivityKind.Active,
            app,
            isBrowser ? null : title,
            null,
            null,
            isBrowser ? "win_event_browser_fallback" : "win_event",
            isBrowser ? Confidence.Medium : Confidence.High));
    }

    private void HandleWinEvent(IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint eventThread, uint eventTime)
    {
        if (hwnd == IntPtr.Zero) return;
        if (eventType == NativeMethods.EventObjectNameChange && idObject != NativeMethods.ObjidWindow) return;
        if (eventType == NativeMethods.EventObjectNameChange && hwnd != NativeMethods.GetForegroundWindow()) return;
        CaptureForeground();
    }

    private void CheckIdle()
    {
        if (isLocked) return;
        var info = new NativeMethods.LastInputInfo { Size = (uint)Marshal.SizeOf<NativeMethods.LastInputInfo>() };
        if (!NativeMethods.GetLastInputInfo(ref info)) return;
        var elapsedMilliseconds = unchecked((uint)Environment.TickCount - info.Time);
        var threshold = processor.IdleThresholdSeconds;
        var idleNow = elapsedMilliseconds >= threshold * 1000L;
        if (idleNow && !isIdle)
        {
            isIdle = true;
            processor.Record(new ActivityInput(DateTimeOffset.UtcNow.AddMilliseconds(-elapsedMilliseconds + threshold * 1000L), ActivityKind.Idle, null, null, null, null, "last_input", Confidence.High));
        }
        else if (!idleNow && isIdle)
        {
            isIdle = false;
            CaptureForeground();
        }
    }

    private void HandleSessionSwitch(object sender, SessionSwitchEventArgs args)
    {
        if (args.Reason == SessionSwitchReason.SessionLock)
        {
            isLocked = true;
            processor.Record(new ActivityInput(DateTimeOffset.UtcNow, ActivityKind.Locked, null, null, null, null, "session_event", Confidence.High));
        }
        else if (args.Reason == SessionSwitchReason.SessionUnlock)
        {
            isLocked = false;
            isIdle = false;
            CaptureForeground();
        }
    }

    private void HandlePowerModeChanged(object sender, PowerModeChangedEventArgs args)
    {
        if (args.Mode == PowerModes.Suspend)
            processor.Record(new ActivityInput(DateTimeOffset.UtcNow, ActivityKind.Suspended, null, null, null, null, "power_event", Confidence.High));
        else if (args.Mode == PowerModes.Resume)
            CaptureForeground();
    }

    private void ScanVisibleApps()
    {
        var next = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        lock (appGate)
        {
            scanTarget = next;
            NativeMethods.EnumWindows(enumWindowsDelegate, IntPtr.Zero);
            scanTarget = null;
            foreach (var opened in next.Except(visibleApps))
                processor.Record(new ActivityInput(DateTimeOffset.UtcNow, ActivityKind.AppOpen, opened, null, null, null, "visible_window_scan", Confidence.Medium));
            foreach (var closed in visibleApps.Except(next))
                processor.Record(new ActivityInput(DateTimeOffset.UtcNow, ActivityKind.AppClose, closed, null, null, null, "visible_window_scan", Confidence.Medium));
            visibleApps = next;
        }
    }

    private HashSet<string>? scanTarget;
    private bool VisitWindow(IntPtr hwnd, IntPtr parameter)
    {
        if (!NativeMethods.IsWindowVisible(hwnd) || NativeMethods.GetWindow(hwnd, NativeMethods.GwOwner) != IntPtr.Zero) return true;
        var window = DescribeWindow(hwnd);
        if (window is not null && window.Value.App != "ActivityJournal.Helper") scanTarget?.Add(window.Value.App);
        return true;
    }

    private static (string App, string? Title)? DescribeWindow(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return null;
        NativeMethods.GetWindowThreadProcessId(hwnd, out var processId);
        if (processId == 0) return null;
        try
        {
            using var process = Process.GetProcessById((int)processId);
            var app = NormalizeAppName(process.ProcessName);
            var length = Math.Min(NativeMethods.GetWindowTextLength(hwnd), 2048);
            var builder = new StringBuilder(length + 1);
            NativeMethods.GetWindowText(hwnd, builder, builder.Capacity);
            return (app, string.IsNullOrWhiteSpace(builder.ToString()) ? null : builder.ToString().Trim());
        }
        catch (ArgumentException) { return null; }
        catch (InvalidOperationException) { return null; }
    }

    private static string NormalizeAppName(string processName) => processName.ToLowerInvariant() switch
    {
        "chrome" => "Google Chrome",
        "msedge" => "Microsoft Edge",
        "explorer" => "File Explorer",
        "code" => "Visual Studio Code",
        "league of legends" => "League of Legends",
        "leagueclient" or "leagueclientux" or "leagueclientuxrender" => "League of Legends Client",
        "riotclientservices" or "riotclientux" or "riotclientuxrender" => "Riot Client",
        _ => processName
    };

    private void HandleRecentItem(object sender, FileSystemEventArgs args)
    {
        _ = Task.Run(async () =>
        {
            await Task.Delay(300);
            var target = ResolveShortcut(args.FullPath);
            if (target is null || !File.Exists(target)) return;
            processor.Record(new ActivityInput(DateTimeOffset.UtcNow, ActivityKind.FileHint, null, null, null, target, "recent_items", Confidence.Low));
        });
    }

    private static string? ResolveShortcut(string shortcutPath)
    {
        object? shell = null;
        object? shortcut = null;
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null) return null;
            shell = Activator.CreateInstance(shellType);
            shortcut = shellType.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, [shortcutPath]);
            return shortcut?.GetType().InvokeMember("TargetPath", System.Reflection.BindingFlags.GetProperty, null, shortcut, null) as string;
        }
        catch { return null; }
        finally
        {
            if (shortcut is not null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (shell is not null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    public void Dispose()
    {
        idleTimer.Dispose();
        heartbeatTimer.Dispose();
        appScanTimer.Dispose();
        recentWatcher?.Dispose();
        SystemEvents.SessionSwitch -= HandleSessionSwitch;
        SystemEvents.PowerModeChanged -= HandlePowerModeChanged;
        if (foregroundHook != IntPtr.Zero) NativeMethods.UnhookWinEvent(foregroundHook);
        if (nameHook != IntPtr.Zero) NativeMethods.UnhookWinEvent(nameHook);
    }
}
