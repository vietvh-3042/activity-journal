using System.Globalization;
using System.Text.RegularExpressions;

namespace ActivityJournal.Helper;

public static partial class BrowserSanitizer
{
    [GeneratedRegex("^[a-zA-Z0-9.-]+$")]
    private static partial Regex HostPattern();

    public static string? NormalizeHostname(string? hostname)
    {
        if (string.IsNullOrWhiteSpace(hostname) || hostname.Length > 253) return null;
        var host = hostname.Trim().Trim('.').ToLowerInvariant();
        try { host = new IdnMapping().GetAscii(host); }
        catch (ArgumentException) { return null; }
        return HostPattern().IsMatch(host) && !host.Contains("..", StringComparison.Ordinal) ? host : null;
    }

    public static string? NormalizeTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        var compact = WhitespacePattern().Replace(title.Trim(), " ");
        return compact.Length <= 512 ? compact : compact[..512];
    }

    [GeneratedRegex("\\s+")]
    private static partial Regex WhitespacePattern();
}
