using CloudPlatform.Vms;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

namespace CloudPlatform.Vms;

/// <summary>
/// Per-VM report posted by a NodeAgent describing the state it observes locally.
/// </summary>
public sealed record NodeAgentReport(VmId VmId, VmState ObservedState, DateTimeOffset ReportedAt);

/// <summary>
/// Contract for receiving NodeAgent reports (a Kafka topic, a queue, etc.).
/// </summary>
public interface INodeAgentReportSource
{
    /// <summary>Streams reports as they arrive.</summary>
    IAsyncEnumerable<NodeAgentReport> ReadReportsAsync(CancellationToken ct);
}

/// <summary>
/// Persistence surface used by the drift detector.
/// </summary>
public interface IDriftDbContext
{
    /// <summary>Set of VMs tracked by the control-plane.</summary>
    DbSet<Vm> Vms { get; }

    /// <summary>Set of drift events recorded by the detector.</summary>
    DbSet<DriftEvent> DriftEvents { get; }
}

/// <summary>
/// Record of a state mismatch between the control-plane view and a NodeAgent report.
/// </summary>
public sealed class DriftEvent
{
    /// <summary>Id of the VM that drifted.</summary>
    public VmId VmId { get; set; }

    /// <summary>State the control-plane believes the VM is in.</summary>
    public VmState ExpectedState { get; set; }

    /// <summary>State the NodeAgent reported.</summary>
    public VmState ObservedState { get; set; }

    /// <summary>When the drift was detected.</summary>
    public DateTimeOffset DetectedAt { get; set; }
}

/// <summary>
/// Long-running background service that compares NodeAgent reports to the persisted
/// state of each VM and persists <see cref="DriftEvent"/>s whenever they disagree.
/// </summary>
public sealed class VmDriftDetectorWorker : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(60);

    private readonly IServiceScopeFactory scopeFactory;
    private readonly TimeProvider clock;
    private readonly ILogger<VmDriftDetectorWorker> logger;

    /// <summary>Constructs the worker from its dependencies.</summary>
    public VmDriftDetectorWorker(
        IServiceScopeFactory scopeFactory,
        TimeProvider clock,
        ILogger<VmDriftDetectorWorker> logger)
    {
        this.scopeFactory = scopeFactory;
        this.clock = clock;
        this.logger = logger;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await DetectOnceAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Drift detection pass failed");
            }

            try
            {
                await Task.Delay(PollInterval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    /// <summary>Runs a single drift detection pass.</summary>
    private async Task DetectOnceAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IDriftDbContext>();
        var reports = scope.ServiceProvider.GetRequiredService<INodeAgentReportSource>();

        var vms = await db.Vms
            .AsNoTracking()
            .ToDictionaryAsync(v => v.Id, ct)
            .ConfigureAwait(false);

        var driftDetected = new List<DriftEvent>();
        await foreach (var report in reports.ReadReportsAsync(ct).ConfigureAwait(false))
        {
            if (!vms.TryGetValue(report.VmId, out var vm))
            {
                continue;
            }

            if (vm.State != report.ObservedState)
            {
                driftDetected.Add(new DriftEvent
                {
                    VmId = report.VmId,
                    ExpectedState = vm.State,
                    ObservedState = report.ObservedState,
                    DetectedAt = clock.GetUtcNow(),
                });
            }
        }

        if (driftDetected.Count == 0)
        {
            return;
        }

        await db.DriftEvents.AddRangeAsync(driftDetected, ct).ConfigureAwait(false);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);

        foreach (var drift in driftDetected)
        {
            logger.LogWarning(
                "Drift on {VmId}: control-plane={Expected}, node={Observed}",
                drift.VmId, drift.ExpectedState, drift.ObservedState);
        }
    }
}
