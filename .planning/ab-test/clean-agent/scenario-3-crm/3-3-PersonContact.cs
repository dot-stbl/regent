using System.Text.RegularExpressions;

namespace Crm.Domain;

/// <summary>
/// Contact representing an individual person.
/// </summary>
public sealed class PersonContact : Contact, IEquatable<PersonContact>
{
    private static readonly Regex EmailRegex = new(
        @"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>Given name.</summary>
    public string FirstName { get; private set; } = string.Empty;

    /// <summary>Family name.</summary>
    public string LastName { get; private set; } = string.Empty;

    /// <summary>Email address.</summary>
    public string? Email { get; private set; }

    private PersonContact()
    {
    }

    private PersonContact(
        ContactId id,
        AccountId accountId,
        string firstName,
        string lastName,
        string? email)
        : base(id, accountId, $"{firstName} {lastName}".Trim())
    {
        FirstName = firstName.Trim();
        LastName = lastName.Trim();
        Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
    }

    /// <summary>Factory that validates inputs and constructs a new <see cref="PersonContact"/>.</summary>
    /// <exception cref="ArgumentException">When required fields are missing or the email is invalid.</exception>
    public static PersonContact Create(
        AccountId accountId,
        string firstName,
        string lastName,
        string? email = null)
    {
        if (string.IsNullOrWhiteSpace(firstName))
        {
            throw new ArgumentException("First name must be provided.", nameof(firstName));
        }

        if (string.IsNullOrWhiteSpace(lastName))
        {
            throw new ArgumentException("Last name must be provided.", nameof(lastName));
        }

        if (!string.IsNullOrWhiteSpace(email) && !EmailRegex.IsMatch(email))
        {
            throw new ArgumentException($"'{email}' is not a valid email address.", nameof(email));
        }

        return new PersonContact(ContactId.New(), accountId, firstName, lastName, email);
    }

    /// <summary>Updates the contact's email address.</summary>
    public void SetEmail(string email)
    {
        if (!EmailRegex.IsMatch(email))
        {
            throw new ArgumentException($"'{email}' is not a valid email address.", nameof(email));
        }

        Email = email.Trim();
    }

    /// <inheritdoc />
    public bool Equals(PersonContact? other)
    {
        if (other is null)
        {
            return false;
        }
        if (ReferenceEquals(this, other))
        {
            return true;
        }

        return base.Equals(other)
            && string.Equals(FirstName, other.FirstName, StringComparison.Ordinal)
            && string.Equals(LastName, other.LastName, StringComparison.Ordinal)
            && string.Equals(Email, other.Email, StringComparison.OrdinalIgnoreCase);
    }

    /// <inheritdoc />
    public override bool Equals(object? obj) => Equals(obj as PersonContact);

    /// <inheritdoc />
    public override int GetHashCode() => HashCode.Combine(base.GetHashCode(), FirstName, LastName, Email);
}

/// <summary>
/// Contact representing a company.
/// </summary>
public sealed class CompanyContact : Contact, IEquatable<CompanyContact>
{
    /// <summary>Legal entity name.</summary>
    public string LegalName { get; private set; } = string.Empty;

    /// <summary>Tax identifier (VAT, EIN, etc.).</summary>
    public string TaxId { get; private set; } = string.Empty;

    private CompanyContact()
    {
    }

    private CompanyContact(ContactId id, AccountId accountId, string legalName, string taxId)
        : base(id, accountId, legalName)
    {
        LegalName = legalName.Trim();
        TaxId = taxId.Trim();
    }

    /// <summary>Factory that validates inputs and constructs a new <see cref="CompanyContact"/>.</summary>
    public static CompanyContact Create(AccountId accountId, string legalName, string taxId)
    {
        if (string.IsNullOrWhiteSpace(legalName))
        {
            throw new ArgumentException("Legal name must be provided.", nameof(legalName));
        }

        if (string.IsNullOrWhiteSpace(taxId))
        {
            throw new ArgumentException("Tax id must be provided.", nameof(taxId));
        }

        return new CompanyContact(ContactId.New(), accountId, legalName, taxId);
    }

    /// <inheritdoc />
    public bool Equals(CompanyContact? other)
    {
        if (other is null)
        {
            return false;
        }
        if (ReferenceEquals(this, other))
        {
            return true;
        }

        return base.Equals(other)
            && string.Equals(LegalName, other.LegalName, StringComparison.Ordinal)
            && string.Equals(TaxId, other.TaxId, StringComparison.Ordinal);
    }

    /// <inheritdoc />
    public override bool Equals(object? obj) => Equals(obj as CompanyContact);

    /// <inheritdoc />
    public override int GetHashCode() => HashCode.Combine(base.GetHashCode(), LegalName, TaxId);
}
