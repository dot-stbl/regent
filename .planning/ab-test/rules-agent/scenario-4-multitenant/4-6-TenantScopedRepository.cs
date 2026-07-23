using Microsoft.EntityFrameworkCore;
using Saas.Tenants;

namespace Saas.Tenants;

/// <summary>Marker for entities that belong to a single tenant.</summary>
public interface ITenantScoped
{
    /// <summary>Tenant that owns the entity.</summary>
    public TenantId TenantId { get; }
}

/// <summary>Thrown when a query or write crosses a tenant boundary.</summary>
public sealed class CrossTenantAccessException : Exception
{
    /// <summary>Stable machine-readable identifier for this failure class.</summary>
    public const string Code = "tenant.cross_tenant_access";

    /// <summary>Tenant of the calling request.</summary>
    public TenantId RequestTenant { get; }

    /// <summary>Tenant the entity actually belongs to.</summary>
    public TenantId EntityTenant { get; }

    public CrossTenantAccessException(TenantId requestTenant, TenantId entityTenant)
        : base($"Cross-tenant access: request tenant '{requestTenant}', entity tenant '{entityTenant}'.")
    {
        RequestTenant = requestTenant;
        EntityTenant = entityTenant;
    }
}

/// <summary>
///     Thrown when the current request has no tenant resolved (middleware
///     didn't run, or anonymous endpoint tried a tenant-scoped query).
/// </summary>
public sealed class NoTenantResolvedException : Exception
{
    /// <summary>Stable machine-readable identifier for this failure class.</summary>
    public const string Code = "tenant.no_tenant_resolved";

    public NoTenantResolvedException()
        : base("No tenant resolved for the current request.")
    {
    }
}

/// <summary>
///     Resolves the tenant id for the current request. Populated by
///     <c>TenantResolverMiddleware</c>.
/// </summary>
public interface ITenantContext
{
    /// <summary>Current tenant id, or <see langword="null" /> when no tenant is resolved.</summary>
    public TenantId? TenantId { get; }
}

/// <summary>
///     Generic base class for tenant-scoped repositories. Every query is
///     filtered by the tenant id from <see cref="ITenantContext" />; any read
///     or write that would touch another tenant throws
///     <see cref="CrossTenantAccessException" />.
/// </summary>
/// <typeparam name="T">Entity type, must implement <see cref="ITenantScoped" />.</typeparam>
/// <param name="dbContext">EF Core context for the tenant schema.</param>
/// <param name="tenantContext">Per-request tenant resolution.</param>
public abstract class TenantScopedRepository<T>(
    DbContext dbContext,
    ITenantContext tenantContext)
    where T : class, ITenantScoped
{
    /// <summary>Returns the tenant used to filter queries, throwing if none is resolved.</summary>
    protected TenantId CurrentTenantId
        => tenantContext.TenantId ?? throw new NoTenantResolvedException();

    /// <summary>Returns an untracked queryable filtered to the current tenant.</summary>
    protected IQueryable<T> Query()
        => dbContext.Set<T>().AsNoTracking().Where(e => e.TenantId == CurrentTenantId);

    /// <summary>Reads a single entity by id, scoped to the current tenant.</summary>
    /// <param name="id">Primary key of the entity.</param>
    /// <param name="cancellationToken">Forwarded to the underlying query.</param>
    /// <returns>The entity, or <see langword="null" /> if absent.</returns>
    /// <exception cref="CrossTenantAccessException">Thrown when the resolved entity belongs to a different tenant.</exception>
    public async Task<T?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var entity = await dbContext.Set<T>().FindAsync(new object?[] { id }, cancellationToken);
        if (entity is null)
        {
            return null;
        }

        TenantGuard.EnsureSameTenant(entity, CurrentTenantId);
        return entity;
    }

    /// <summary>Lists entities belonging to the current tenant.</summary>
    /// <param name="cancellationToken">Forwarded to the underlying query.</param>
    public async Task<IReadOnlyCollection<T>> ListAsync(CancellationToken cancellationToken = default)
        => await Query().ToListAsync(cancellationToken);

    /// <summary>Persists a new entity after verifying the tenant boundary.</summary>
    /// <param name="entity">Aggregate to persist.</param>
    /// <param name="cancellationToken">Forwarded to the underlying command.</param>
    /// <exception cref="CrossTenantAccessException">Thrown when the entity belongs to a different tenant.</exception>
    public async Task AddAsync(T entity, CancellationToken cancellationToken = default)
    {
        EnsureSameTenant(entity);
        await dbContext.Set<T>().AddAsync(entity, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Removes an entity after verifying the tenant boundary.</summary>
    /// <param name="entity">Aggregate to remove.</param>
    /// <param name="cancellationToken">Forwarded to the underlying command.</param>
    /// <exception cref="CrossTenantAccessException">Thrown when the entity belongs to a different tenant.</exception>
    public async Task RemoveAsync(T entity, CancellationToken cancellationToken = default)
    {
        EnsureSameTenant(entity);
        dbContext.Set<T>().Remove(entity);
        await dbContext.SaveChangesAsync(cancellationToken);
    }
}

/// <summary>
///     Tenant-scope validation helpers — file-static so production classes
///     don't carry a private method (per <c>code-shape.md</c> §1a).
/// </summary>
file static class TenantGuard
{
    /// <summary>
    ///     Throws <see cref="CrossTenantAccessException" /> when the
    ///     <paramref name="entity" /> belongs to a different tenant than the
    ///     <paramref name="current" /> request context.
    /// </summary>
    /// <param name="entity">Entity being read or written.</param>
    /// <param name="current">Tenant the request is operating in.</param>
    public static void EnsureSameTenant(ITenantScoped entity, TenantId current)
    {
        if (entity.TenantId != current)
        {
            throw new CrossTenantAccessException(current, entity.TenantId);
        }
    }
}
