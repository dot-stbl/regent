namespace Saas.Tenants;

/// <summary>Strongly-typed identifier for an organisation.</summary>
public readonly record struct OrgId(Guid Value)
{
    /// <summary>Creates a new <see cref="OrgId"/>.</summary>
    public static OrgId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>
/// Free-form settings for an organisation.
/// </summary>
public sealed class OrgSettings
{
    /// <summary>Whether two-factor authentication is required for all users.</summary>
    public bool RequireMfa { get; set; }

    /// <summary>Time zone identifier (IANA) used to display times in the UI.</summary>
    public string TimeZone { get; set; } = "UTC";

    /// <summary>Branding accent color (hex).</summary>
    public string AccentColor { get; set; } = "#3B82F6";
}

/// <summary>
/// Aggregate root for an organisation that belongs to a tenant.
/// </summary>
public sealed class Org
{
    /// <summary>Primary identifier.</summary>
    public OrgId Id { get; private set; }

    /// <summary>Owning tenant.</summary>
    public TenantId TenantId { get; private set; }

    /// <summary>Display name of the organisation.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Per-organisation settings.</summary>
    public OrgSettings Settings { get; private set; } = new();

    private Org()
    {
    }

    /// <summary>Constructs a new organisation.</summary>
    public Org(OrgId id, TenantId tenantId, string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Name must be provided.", nameof(name));
        }

        Id = id;
        TenantId = tenantId;
        Name = name.Trim();
    }

    /// <summary>Renames the organisation.</summary>
    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Name must be provided.", nameof(name));
        }

        Name = name.Trim();
    }

    /// <summary>Replaces the current settings with the supplied instance.</summary>
    public void UpdateSettings(OrgSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        Settings = settings;
    }
}
