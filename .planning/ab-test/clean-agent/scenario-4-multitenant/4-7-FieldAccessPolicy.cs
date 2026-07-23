using Saas.Tenants;

namespace Saas.Permissions;

/// <summary>
/// Repository of per-user field-level access rules.
/// </summary>
public interface IFieldAccessRuleRepository
{
    /// <summary>Returns all rules applicable to <paramref name="userId"/>.</summary>
    Task<IReadOnlyList<FieldAccessRule>> GetRulesAsync(UserId userId, CancellationToken ct);
}

/// <summary>A single field-level access rule.</summary>
public sealed record FieldAccessRule(
    string ResourceType,
    string FieldPath,
    FieldAccessDecision Decision);

/// <summary>Decision for a field access check.</summary>
public enum FieldAccessDecision
{
    Allow = 0,
    Deny = 1,
}

/// <summary>
/// Decides whether a given user is allowed to read a particular field on a resource.
/// </summary>
public sealed class FieldAccessPolicy
{
    private readonly IFieldAccessRuleRepository repository;

    /// <summary>Constructs the policy.</summary>
    public FieldAccessPolicy(IFieldAccessRuleRepository repository)
    {
        this.repository = repository;
    }

    /// <summary>Returns <see langword="true"/> when the user can read the field.</summary>
    public async Task<bool> CanReadAsync(
        UserId userId,
        string resourceType,
        string fieldPath,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(resourceType))
        {
            throw new ArgumentException("Resource type must be provided.", nameof(resourceType));
        }

        if (string.IsNullOrWhiteSpace(fieldPath))
        {
            throw new ArgumentException("Field path must be provided.", nameof(fieldPath));
        }

        var rules = await repository.GetRulesAsync(userId, ct).ConfigureAwait(false);
        var matching = rules
            .Where(r => string.Equals(r.ResourceType, resourceType, StringComparison.OrdinalIgnoreCase))
            .Where(r => MatchesPath(r.FieldPath, fieldPath))
            .ToList();

        if (matching.Count == 0)
        {
            return true;
        }

        return !matching.Any(r => r.Decision == FieldAccessDecision.Deny);
    }

    private static bool MatchesPath(string rulePath, string queryPath)
    {
        if (string.Equals(rulePath, queryPath, StringComparison.Ordinal))
        {
            return true;
        }

        if (rulePath.EndsWith(".*", StringComparison.Ordinal))
        {
            var prefix = rulePath[..^2];
            return queryPath.StartsWith(prefix + ".", StringComparison.Ordinal)
                   || string.Equals(queryPath, prefix, StringComparison.Ordinal);
        }

        return false;
    }
}
