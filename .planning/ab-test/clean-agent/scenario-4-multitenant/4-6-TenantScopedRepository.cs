using Microsoft.EntityFrameworkCore;
using Saas.Tenants;

namespace Saas.Tenants;

/// <summary>Marker for entities that belong to a single tenant.</summary>
public interface ITenantScoped
{
    /// <summary>Tenant that owns the entity.</summary>
    TenantId TenantId { get; }
}

/// <summary>Thrown when a query or write crosses a tenant boundary.</summary>
public sealed class CrossTenantAccessException : Exception
{
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
/// Generic base class for tenant-scoped repositories. Every query is filtered by the
/// tenant id from <see cref="ITenantContext"/>; any read or write that would
/// touch another tenant throws <see cref="CrossTenantAccessException"/>.
/// </summary>
/// <typeparam name="T">Entity type, must be <see cref="ITenantScoped"/>.</typeparam>
public class TenantScopedRepository<T> where T : class, ITenantScoped
{
    private readonly DbContext dbContext;
    private readonly ITenantContext tenantContext;

    /// <summary>Constructs the repository.</summary>
    public TenantScopedRepository(DbContext dbContext, ITenantContext tenantContext)
    {
        this.dbContext = dbContext;
        this.tenantContext = tenantContext;
    }

    /// <summary>Returns the tenant used to filter queries, throwing if none is resolved.</summary>
    protected TenantId CurrentTenantId
    {
        get
        {
            if (tenantContext.TenantId is not { } id)
            {
                throw new InvalidOperationException("No tenant resolved for the current request.");
            }
            return id;
        }
    }

    /// <summary>Returns a queryable filtered to the current tenant.</summary>
    protected IQueryable<T> Query()
    {
        var id = CurrentTenantId;
        return dbContext.Set<T>().AsNoTracking().Where(e => e.TenantId == id);
    }

    /// <summary>Reads a single entity by id, scoped to the current tenant.</summary>
    public async Task<T?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        var entity = await dbContext.Set<T>().FindAsync(new object?[] { id }, ct).ConfigureAwait(false);
        if (entity is null)
        {
            return null;
        }

        EnsureSameTenant(entity);
        return entity;
    }

    /// <summary>Lists entities belonging to the current tenant.</summary>
    public Task<List<T>> ListAsync(CancellationToken ct)
        => Query().ToListAsync(ct);

    /// <summary>Persists a new entity after verifying the tenant boundary.</summary>
    public async Task AddAsync(T entity, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(entity);
        EnsureSameTenant(entity);
        await dbContext.Set<T>().AddAsync(entity, ct).ConfigureAwait(false);
        await dbContext.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    /// <summary>Removes an entity after verifying the tenant boundary.</summary>
    public async Task RemoveAsync(T entity, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(entity);
        EnsureSameTenant(entity);
        dbContext.Set<T>().Remove(entity);
        await dbContext.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    private void EnsureSameTenant(T entity)
    {
        var current = CurrentTenantId;
        if (entity.TenantId != current)
        {
            throw new CrossTenantAccessException(current, entity.TenantId);
        }
    }
}
