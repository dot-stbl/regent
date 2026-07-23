using Dlp.Scanning;

namespace Dlp.Scanning;

/// <summary>
/// Sensitivity classification of a file.
/// </summary>
public enum Sensitivity
{
    Unknown = 0,
    Public = 1,
    Internal = 2,
    Sensitive = 3,
    Restricted = 4,
}

/// <summary>
/// A policy that classifies content based on metadata predicates.
/// </summary>
/// <param name="Id">Stable identifier of the policy.</param>
/// <param name="Label">Human-readable label.</param>
/// <param name="Sensitivity">The classification the policy asserts.</param>
/// <param name="Predicate">Boolean expression over file metadata.</param>
public sealed record Policy(
    Guid Id,
    string Label,
    Sensitivity Sensitivity,
    PolicyNode Predicate);

/// <summary>
/// A composable boolean predicate tree.
/// </summary>
public abstract record PolicyNode
{
    /// <summary>Logical AND of two predicates.</summary>
    public static PolicyNode And(PolicyNode left, PolicyNode right) => new AndNode(left, right);

    /// <summary>Logical OR of two predicates.</summary>
    public static PolicyNode Or(PolicyNode left, PolicyNode right) => new OrNode(left, right);

    /// <summary>Logical negation of a predicate.</summary>
    public static PolicyNode Not(PolicyNode inner) => new NotNode(inner);

    /// <summary>A leaf predicate that tests a single metadata field.</summary>
    public static PolicyNode Leaf(string field, string op, string value) => new LeafNode(field, op, value);
}

/// <summary>AND combination.</summary>
public sealed record AndNode(PolicyNode Left, PolicyNode Right) : PolicyNode;

/// <summary>OR combination.</summary>
public sealed record OrNode(PolicyNode Left, PolicyNode Right) : PolicyNode;

/// <summary>NOT wrapper.</summary>
public sealed record NotNode(PolicyNode Inner) : PolicyNode;

/// <summary>A single comparison like <c>path CONTAINS "secret"</c>.</summary>
public sealed record LeafNode(string Field, string Op, string Value) : PolicyNode;

/// <summary>Metadata about a file, used as input to the policy evaluator.</summary>
public sealed record FileMetadata(string Path, long SizeBytes, string Sha256, string MimeType, IDictionary<string, string> Attributes);

/// <summary>Result of running a policy against a file's metadata.</summary>
/// <param name="Matched"><see langword="true"/> if the policy matches.</param>
/// <param name="Sensitivity">Sensitivity asserted by the policy when matched.</param>
/// <param name="Label">Label of the matched policy (or <see langword="null"/> when no match).</param>
public sealed record PolicyEvaluationResult(bool Matched, Sensitivity Sensitivity, string? Label);

/// <summary>
/// File-hash index abstraction used by the classifier to look up prior decisions.
/// </summary>
public interface IFileHashIndex
{
    /// <summary>Looks up the previously stored classification for <paramref name="sha256"/>.</summary>
    Task<Sensitivity?> LookupAsync(string sha256, CancellationToken ct);

    /// <summary>Persists a classification decision for the given hash.</summary>
    Task StoreAsync(string sha256, Sensitivity sensitivity, CancellationToken ct);
}

/// <summary>Repository of all known policies.</summary>
public interface IPolicyRepository
{
    /// <summary>Enumerates the active policies.</summary>
    Task<IReadOnlyList<Policy>> ListAsync(CancellationToken ct);
}

/// <summary>
/// Classifies a file by inspecting the hash index and the policy repository.
/// </summary>
public sealed class FileClassifier
{
    private readonly IPolicyRepository policyRepository;
    private readonly IFileHashIndex hashIndex;

    /// <summary>Constructs the classifier with its collaborators.</summary>
    public FileClassifier(IPolicyRepository policyRepository, IFileHashIndex hashIndex)
    {
        this.policyRepository = policyRepository;
        this.hashIndex = hashIndex;
    }

    /// <summary>Returns the classification for a file given its hash and metadata.</summary>
    public async Task<(Sensitivity Sensitivity, Policy? MatchedPolicy)> ClassifyAsync(
        FileMetadata meta,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(meta);

        var cached = await hashIndex.LookupAsync(meta.Sha256, ct).ConfigureAwait(false);
        if (cached is not null)
        {
            return (cached.Value, null);
        }

        var policies = await policyRepository.ListAsync(ct).ConfigureAwait(false);
        Sensitivity best = Sensitivity.Unknown;
        Policy? matched = null;

        foreach (var policy in policies)
        {
            var result = PolicyEvaluator.Evaluate(policy.Predicate, meta);
            if (!result.Matched)
            {
                continue;
            }

            if ((int)policy.Sensitivity > (int)best)
            {
                best = policy.Sensitivity;
                matched = policy;
            }
        }

        if (matched is not null)
        {
            await hashIndex.StoreAsync(meta.Sha256, best, ct).ConfigureAwait(false);
        }

        return (best, matched);
    }
}
