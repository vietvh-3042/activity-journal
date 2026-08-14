namespace ActivityJournal.Helper;

public sealed class PrivacyFilter
{
    private IReadOnlyList<ExclusionRule> rules;

    public PrivacyFilter(IReadOnlyList<ExclusionRule> rules) => this.rules = rules;

    public void ReplaceRules(IReadOnlyList<ExclusionRule> nextRules) => rules = nextRules;

    public ActivityInput Apply(ActivityInput input)
    {
        if (input.Kind is ActivityKind.Idle or ActivityKind.Locked or ActivityKind.Suspended or ActivityKind.Paused)
            return input with { App = null, Title = null, Domain = null, Path = null };

        var excluded = rules.Any(rule => Matches(rule, input));
        return excluded
            ? new ActivityInput(input.AtUtc, ActivityKind.Excluded, null, null, null, null, "privacy_filter", Confidence.High)
            : input;
    }

    private static bool Matches(ExclusionRule rule, ActivityInput input)
    {
        var pattern = rule.Pattern.Trim();
        if (pattern.Length == 0) return false;
        return rule.Type.ToLowerInvariant() switch
        {
            "app" => Contains(input.App, pattern),
            "domain" => DomainMatches(input.Domain, pattern),
            "title" => Contains(input.Title, pattern),
            "path" => input.Path?.StartsWith(pattern, StringComparison.OrdinalIgnoreCase) == true,
            _ => false
        };
    }

    private static bool Contains(string? value, string pattern) =>
        value?.Contains(pattern, StringComparison.OrdinalIgnoreCase) == true;

    private static bool DomainMatches(string? value, string pattern)
    {
        if (value is null) return false;
        var normalized = pattern.Trim().Trim('.');
        return value.Equals(normalized, StringComparison.OrdinalIgnoreCase)
            || value.EndsWith($".{normalized}", StringComparison.OrdinalIgnoreCase);
    }
}
