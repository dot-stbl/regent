namespace Crm.Domain;

/// <summary>Strongly-typed identifier for an account.</summary>
public readonly record struct AccountId(Guid Value)
{
    /// <summary>Creates a new <see cref="AccountId"/> with a freshly generated GUID.</summary>
    public static AccountId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>Strongly-typed identifier for a contact.</summary>
public readonly record struct ContactId(Guid Value)
{
    /// <summary>Creates a new <see cref="ContactId"/> with a freshly generated GUID.</summary>
    public static ContactId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>Lifecycle status of an account.</summary>
public enum AccountStatus
{
    Prospect = 0,
    Active = 1,
    Churned = 2,
}

/// <summary>
/// Aggregate root for an account (customer) in the CRM.
/// </summary>
public sealed class Account
{
    private readonly List<Contact> contacts = new();

    /// <summary>Primary identifier.</summary>
    public AccountId Id { get; private set; }

    /// <summary>Owning organisation.</summary>
    public Guid OrgId { get; private set; }

    /// <summary>Display name of the account.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Current lifecycle status.</summary>
    public AccountStatus Status { get; private set; }

    /// <summary>All contacts belonging to the account.</summary>
    public IReadOnlyCollection<Contact> Contacts => contacts;

    /// <summary>EF Core parameterless constructor.</summary>
    private Account()
    {
    }

    /// <summary>Constructs a new account in the <see cref="AccountStatus.Prospect"/> state.</summary>
    public Account(AccountId id, Guid orgId, string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Account name must be provided.", nameof(name));
        }

        Id = id;
        OrgId = orgId;
        Name = name.Trim();
        Status = AccountStatus.Prospect;
    }

    /// <summary>Transitions the account to a new status.</summary>
    public void ChangeStatus(AccountStatus status)
    {
        if (Status == AccountStatus.Churned && status != AccountStatus.Churned)
        {
            throw new InvalidOperationException("Churned accounts cannot be reactivated.");
        }

        Status = status;
    }

    /// <summary>Attaches a new contact to the account.</summary>
    public void AddContact(Contact contact)
    {
        ArgumentNullException.ThrowIfNull(contact);
        if (contact.AccountId != Id)
        {
            throw new ArgumentException(
                $"Contact {contact.Id} belongs to account {contact.AccountId}, not {Id}.",
                nameof(contact));
        }

        if (contacts.Any(c => c.Id == contact.Id))
        {
            return;
        }

        contacts.Add(contact);
    }

    /// <summary>Removes a contact from the account.</summary>
    public bool RemoveContact(ContactId contactId)
        => contacts.RemoveAll(c => c.Id == contactId) > 0;
}
