namespace Saas.Tenants;

/// <summary>Strongly-typed identifier for a team.</summary>
public readonly record struct TeamId(Guid Value)
{
    /// <summary>Creates a new <see cref="TeamId"/>.</summary>
    public static TeamId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>Strongly-typed identifier for a user.</summary>
public readonly record struct UserId(Guid Value)
{
    /// <summary>Creates a new <see cref="UserId"/>.</summary>
    public static UserId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>
/// Aggregate root for a team within an organisation.
/// </summary>
public sealed class Team
{
    private readonly HashSet<UserId> memberIds = new();

    /// <summary>Primary identifier.</summary>
    public TeamId Id { get; private set; }

    /// <summary>Owning organisation.</summary>
    public OrgId OrgId { get; private set; }

    /// <summary>Display name of the team.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Members of the team.</summary>
    public IReadOnlyCollection<UserId> MemberIds => memberIds;

    private Team()
    {
    }

    /// <summary>Constructs a new team.</summary>
    public Team(TeamId id, OrgId orgId, string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Name must be provided.", nameof(name));
        }

        Id = id;
        OrgId = orgId;
        Name = name.Trim();
    }

    /// <summary>Adds a user to the team.</summary>
    public bool AddMember(UserId userId) => memberIds.Add(userId);

    /// <summary>Removes a user from the team.</summary>
    public bool RemoveMember(UserId userId) => memberIds.Remove(userId);
}
