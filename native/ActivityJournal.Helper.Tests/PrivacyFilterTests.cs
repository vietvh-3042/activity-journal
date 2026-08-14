using ActivityJournal.Helper;

namespace ActivityJournal.Helper.Tests;

public sealed class PrivacyFilterTests
{
    [Fact]
    public void RedactsAllMetadataBeforePersistence()
    {
        var filter = new PrivacyFilter([new ExclusionRule(null, "domain", "bank.example")]);
        var input = new ActivityInput(DateTimeOffset.UtcNow, ActivityKind.Browser, "Google Chrome", "My account", "secure.bank.example", @"C:\secret.txt", "browser_extension", Confidence.High);

        var result = filter.Apply(input);

        Assert.Equal(ActivityKind.Excluded, result.Kind);
        Assert.Null(result.App);
        Assert.Null(result.Title);
        Assert.Null(result.Domain);
        Assert.Null(result.Path);
    }

    [Fact]
    public void PathRulesArePrefixBasedAndCaseInsensitive()
    {
        var filter = new PrivacyFilter([new ExclusionRule(null, "path", @"C:\Private")]);
        var result = filter.Apply(new ActivityInput(DateTimeOffset.UtcNow, ActivityKind.Active, "Editor", "Note", null, @"c:\private\note.txt", "test", Confidence.High));
        Assert.Equal(ActivityKind.Excluded, result.Kind);
    }
}
