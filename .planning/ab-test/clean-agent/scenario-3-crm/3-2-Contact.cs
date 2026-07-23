namespace Crm.Domain;

/// <summary>
/// Base class for all contacts belonging to an account.
/// </summary>
public abstract class Contact : IEquatable<Contact>
{
    /// <summary>Primary identifier.</summary>
    public ContactId Id { get; protected set; }

    /// <summary>Owning account.</summary>
    public AccountId AccountId { get; protected set; }

    /// <summary>Display name shown in lists.</summary>
    public string DisplayName { get; protected set; } = string.Empty;

    /// <summary>Protected parameterless constructor for EF Core.</summary>
    protected Contact()
    {
    }

    /// <summary>Constructs a new contact belonging to <paramref name="accountId"/>.</summary>
    protected Contact(ContactId id, AccountId accountId, string displayName)
    {
        if (string.IsNullOrWhiteSpace(displayName))
        {
            throw new ArgumentException("Display name must be provided.", nameof(displayName));
        }

        Id = id;
        AccountId = accountId;
        DisplayName = displayName.Trim();
    }

    /// <inheritdoc />
    public bool Equals(Contact? other)
    {
        if (other is null)
        {
            return false;
        }

        if (ReferenceEquals(this, other))
        {
            return true;
        }

        return Id == other.Id
            && AccountId == other.AccountId
            && string.Equals(DisplayName, other.DisplayName, StringComparison.Ordinal)
            && GetType() == other.GetType();
    }

    /// <inheritdoc />
    public override bool Equals(object? obj) => Equals(obj as Contact);

    /// <inheritdoc />
    public override int GetHashCode() => HashCode.Combine(Id, AccountId, DisplayName);
}
