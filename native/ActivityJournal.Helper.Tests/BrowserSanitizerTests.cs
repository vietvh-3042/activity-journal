using ActivityJournal.Helper;

namespace ActivityJournal.Helper.Tests;

public sealed class BrowserSanitizerTests
{
    [Theory]
    [InlineData("Example.COM", "example.com")]
    [InlineData("sub.example.com.", "sub.example.com")]
    [InlineData("bad host/path", null)]
    [InlineData("", null)]
    public void NormalizesOnlyHostnames(string input, string? expected) =>
        Assert.Equal(expected, BrowserSanitizer.NormalizeHostname(input));

    [Fact]
    public void CompactsAndLimitsTitle()
    {
        var result = BrowserSanitizer.NormalizeTitle("  Account\n   overview  ");
        Assert.Equal("Account overview", result);
        Assert.Equal(512, BrowserSanitizer.NormalizeTitle(new string('a', 900))!.Length);
    }
}
