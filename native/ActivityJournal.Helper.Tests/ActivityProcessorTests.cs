using ActivityJournal.Helper;

namespace ActivityJournal.Helper.Tests;

public sealed class ActivityProcessorTests
{
    [Fact]
    public void SegmentIdentityIncludesPrivacyRelevantMetadata()
    {
        var at = DateTimeOffset.UtcNow;
        var first = new ActivityInput(at, ActivityKind.Browser, "Google Chrome", "A", "example.com", null, "browser_extension", Confidence.High);
        var same = first with { AtUtc = at.AddSeconds(5) };
        var otherDomain = first with { Domain = "other.example" };

        Assert.True(ActivityProcessor.SameIdentity(first, same));
        Assert.False(ActivityProcessor.SameIdentity(first, otherDomain));
    }

    [Theory]
    [InlineData("visual studio", "\"visual\"* AND \"studio\"*")]
    [InlineData("example.com", "\"example.com\"*")]
    [InlineData("   ", null)]
    public void BuildsSafePrefixSearch(string query, string? expected) =>
        Assert.Equal(expected, EncryptedRepository.BuildFtsQuery(query));
}
