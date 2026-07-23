using Dlp.Scanning;

namespace Dlp.Scanning;

/// <summary>
/// Pure-function evaluator that walks a <see cref="PolicyNode"/> tree against the
/// metadata of a single file.
/// </summary>
public static class PolicyEvaluator
{
    /// <summary>Evaluates a policy against file metadata.</summary>
    public static PolicyEvaluationResult Evaluate(Policy policy, FileMetadata meta)
    {
        ArgumentNullException.ThrowIfNull(policy);
        ArgumentNullException.ThrowIfNull(meta);

        var matched = EvaluateNode(policy.Predicate, meta);
        return new PolicyEvaluationResult(matched, policy.Sensitivity, matched ? policy.Label : null);
    }

    /// <summary>Evaluates a predicate tree.</summary>
    public static bool EvaluateNode(PolicyNode node, FileMetadata meta)
    {
        ArgumentNullException.ThrowIfNull(node);
        ArgumentNullException.ThrowIfNull(meta);

        return node switch
        {
            AndNode and => EvaluateNode(and.Left, meta) && EvaluateNode(and.Right, meta),
            OrNode or => EvaluateNode(or.Left, meta) || EvaluateNode(or.Right, meta),
            NotNode not => !EvaluateNode(not.Inner, meta),
            LeafNode leaf => EvaluateLeaf(leaf, meta),
            _ => throw new InvalidOperationException($"Unknown policy node type '{node.GetType().Name}'."),
        };
    }

    private static bool EvaluateLeaf(LeafNode leaf, FileMetadata meta)
    {
        var left = ResolveField(leaf.Field, meta);
        if (left is null)
        {
            return false;
        }

        return leaf.Op.ToUpperInvariant() switch
        {
            "EQUALS" or "EQ" or "==" => string.Equals(left, leaf.Value, StringComparison.OrdinalIgnoreCase),
            "NOTEQUALS" or "NE" or "!=" => !string.Equals(left, leaf.Value, StringComparison.OrdinalIgnoreCase),
            "CONTAINS" => left.Contains(leaf.Value, StringComparison.OrdinalIgnoreCase),
            "STARTSWITH" => left.StartsWith(leaf.Value, StringComparison.OrdinalIgnoreCase),
            "ENDSWITH" => left.EndsWith(leaf.Value, StringComparison.OrdinalIgnoreCase),
            "MATCHES" or "REGEX" => System.Text.RegularExpressions.Regex.IsMatch(
                left, leaf.Value, System.Text.RegularExpressions.RegexOptions.IgnoreCase),
            _ => throw new InvalidOperationException($"Unsupported operator '{leaf.Op}'."),
        };
    }

    private static string? ResolveField(string field, FileMetadata meta)
    {
        if (string.Equals(field, "path", StringComparison.OrdinalIgnoreCase))
        {
            return meta.Path;
        }

        if (string.Equals(field, "mime", StringComparison.OrdinalIgnoreCase))
        {
            return meta.MimeType;
        }

        if (string.Equals(field, "sha256", StringComparison.OrdinalIgnoreCase))
        {
            return meta.Sha256;
        }

        if (string.Equals(field, "size", StringComparison.OrdinalIgnoreCase))
        {
            return meta.SizeBytes.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        return meta.Attributes.TryGetValue(field, out var v) ? v : null;
    }
}
