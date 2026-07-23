using CloudPlatform.Vms;
using Microsoft.EntityFrameworkCore;

namespace CloudPlatform.Vms;

/// <summary>
/// Re-export of the <see cref="DbContext"/> for this scenario so the repository can stand alone.
/// </summary>
public interface IVmDbContext
{
    /// <summary>Set of VMs tracked by the context.</summary>
    DbSet<Vm> Vms { get; }
}

/// <summary>
/// EF Core-backed implementation of <see cref="IVmRepository"/>.
/// </summary>
public sealed class VmRepository : IVmRepository
{
    private readonly IVmDbContext dbContext;

    /// <summary>Constructs the repository from a DbContext.</summary>
    public VmRepository(IVmDbContext dbContext)
    {
        this.dbContext = dbContext;
    }

    /// <inheritdoc />
    public async Task<Vm?> GetByIdAsync(VmId vmId, CancellationToken ct)
    {
        return await dbContext.Vms
            .AsNoTracking()
            .FirstOrDefaultAsync(v => v.Id == vmId, ct)
            .ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyCollection<Vm>> ListByTenantAsync(
        TenantId tenantId,
        int pageNumber,
        int pageSize,
        CancellationToken ct)
    {
        if (pageNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(pageNumber), "Page number must be >= 1.");
        }

        if (pageSize < 1 || pageSize > 200)
        {
            throw new ArgumentOutOfRangeException(nameof(pageSize), "Page size must be between 1 and 200.");
        }

        return await dbContext.Vms
            .AsNoTracking()
            .Where(v => v.TenantId == tenantId)
            .OrderBy(v => v.Id.Value)
            .Skip((pageNumber - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct)
            .ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task SaveAsync(Vm vm, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(vm);

        var existing = await dbContext.Vms.FirstOrDefaultAsync(v => v.Id == vm.Id, ct).ConfigureAwait(false);
        if (existing is null)
        {
            await dbContext.Vms.AddAsync(vm, ct).ConfigureAwait(false);
        }
        else
        {
            dbContext.Vms.Update(vm);
        }

        await dbContext.SaveChangesAsync(ct).ConfigureAwait(false);
    }
}
