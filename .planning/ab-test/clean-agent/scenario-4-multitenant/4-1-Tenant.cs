namespace Saas.Tenants;

/// <summary>Strongly-typed identifier for a tenant.</summary>
public readonly record struct TenantId(Guid Value)
{
    /// <summary>Creates a new <see cref="TenantId"/>.</summary>
    public static TenantId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>Subscription plan a tenant is on.</summary>
public enum TenantPlan
{
    Free = 0,
    Pro = 1,
    Enterprise = 2,
}

/// <summary>
/// Aggregate root for a tenant (top of the multi-tenant hierarchy).
/// </summary>
public sealed class Tenant
{
    /// <summary>Primary identifier.</summary>
    public TenantId Id { get; private set; }

    /// <summary>Display name of the tenant.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Current subscription plan.</summary>
    public TenantPlan Plan { get; private set; }

    /// <summary>Wall-clock instant the tenant was created.</summary>
    public DateTimeOffset CreatedAt { get; private set; }

    private Tenant()
    {
    }

    /// <summary>Constructs a new tenant in the <see cref="TenantPlan.Free"/> plan.</summary>
    public Tenant(TenantId id, string name, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Name must be provided.", nameof(name));
        }

        Id = id;
        Name = name.Trim();
        Plan = TenantPlan.Free;
        CreatedAt = now;
    }

    /// <summary>Upgrades the tenant to a new plan.</summary>
    public void ChangePlan(TenantPlan plan) => Plan = plan;
}
