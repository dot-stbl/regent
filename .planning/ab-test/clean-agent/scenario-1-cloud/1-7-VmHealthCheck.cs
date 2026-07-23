using CloudPlatform.Vms;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace CloudPlatform.Vms;

/// <summary>
/// Re-export of the DbContext surface used by the health check (kept local so the file
/// is self-contained in the A/B test).
/// </summary>
public interface IVmHealthDbContext
{
    /// <summary>Set of VMs tracked by the context.</summary>
    DbSet<Vm> Vms { get; }
}

/// <summary>
/// Health check that flags the system as <see cref="HealthStatus.Unhealthy"/> if any
/// VM has been stuck in <see cref="VmState.Provisioning"/> for more than five minutes.
/// </summary>
public sealed class VmHealthCheck : IHealthCheck
{
    private static readonly TimeSpan ProvisioningTimeout = TimeSpan.FromMinutes(5);

    private readonly IVmHealthDbContext dbContext;
    private readonly TimeProvider clock;
    private readonly ILogger<VmHealthCheck> logger;

    /// <summary>Constructs the health check.</summary>
    public VmHealthCheck(
        IVmHealthDbContext dbContext,
        TimeProvider clock,
        ILogger<VmHealthCheck> logger)
    {
        this.dbContext = dbContext;
        this.clock = clock;
        this.logger = logger;
    }

    /// <inheritdoc />
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);

        var now = clock.GetUtcNow();
        var cutoff = now - ProvisioningTimeout;

        var stuck = await dbContext.Vms
            .AsNoTracking()
            .Where(v => v.State == VmState.Provisioning
                        && v.ProvisioningStartedAt != null
                        && v.ProvisioningStartedAt < cutoff)
            .Select(v => new { v.Id, v.ProvisioningStartedAt })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        if (stuck.Count == 0)
        {
            return HealthCheckResult.Healthy("No stuck provisioning VMs.");
        }

        var data = stuck.ToDictionary(
            entry => entry.Id.Value.ToString(),
            entry => (object)($"provisioning since {entry.ProvisioningStartedAt:O}"));

        logger.LogWarning("{Count} VM(s) are stuck in provisioning", stuck.Count);

        return HealthCheckResult.Unhealthy(
            description: $"{stuck.Count} VM(s) stuck in provisioning",
            data: data);
    }
}
