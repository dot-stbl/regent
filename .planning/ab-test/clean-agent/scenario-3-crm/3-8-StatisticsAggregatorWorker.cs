using Crm.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Crm.Reports;

/// <summary>Per-account aggregate row stored nightly.</summary>
public sealed class DailyStatistics
{
    /// <summary>Date the row summarises (UTC).</summary>
    public DateOnly Date { get; set; }

    /// <summary>Account the row is for.</summary>
    public AccountId AccountId { get; set; }

    /// <summary>Total opportunity amount in Won stage this far.</summary>
    public decimal WonAmount { get; set; }

    /// <summary>Count of Won opportunities.</summary>
    public int WonCount { get; set; }

    /// <summary>Count of Lost opportunities.</summary>
    public int LostCount { get; set; }

    /// <summary>Count of opportunities still open.</summary>
    public int OpenCount { get; set; }
}

/// <summary>Repository of aggregated statistics.</summary>
public interface IDailyStatisticsRepository
{
    /// <summary>Persists a batch of <see cref="DailyStatistics"/> rows.</summary>
    Task SaveAsync(IReadOnlyCollection<DailyStatistics> rows, CancellationToken ct);
}

/// <summary>Source of opportunities for the aggregator.</summary>
public interface IOpportunityRepository
{
    /// <summary>Returns all opportunities that were touched on or after <paramref name="since"/>.</summary>
    Task<IReadOnlyList<Opportunity>> ListTouchedSinceAsync(DateTimeOffset since, CancellationToken ct);
}

/// <summary>EF Core surface used by the worker.</summary>
public interface IAggregatorDbContext
{
    /// <summary>Opportunity set.</summary>
    DbSet<Opportunity> Opportunities { get; }
}

/// <summary>
/// Background service that runs every night at 03:00 (local to the supplied
/// <see cref="TimeProvider"/>) and computes per-account opportunity totals.
/// </summary>
public sealed class StatisticsAggregatorWorker : BackgroundService
{
    private readonly IServiceScopeFactory scopeFactory;
    private readonly TimeProvider clock;
    private readonly ILogger<StatisticsAggregatorWorker> logger;

    /// <summary>Constructs the worker.</summary>
    public StatisticsAggregatorWorker(
        IServiceScopeFactory scopeFactory,
        TimeProvider clock,
        ILogger<StatisticsAggregatorWorker> logger)
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
            var nextRun = NextRunAfter(clock.GetUtcNow());
            var delay = nextRun - clock.GetUtcNow();
            if (delay > TimeSpan.Zero)
            {
                try
                {
                    await Task.Delay(delay, stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    return;
                }
            }

            try
            {
                await AggregateAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Statistics aggregation failed");
            }
        }
    }

    /// <summary>Computes the next 03:00 UTC instant strictly after <paramref name="now"/>.</summary>
    internal static DateTimeOffset NextRunAfter(DateTimeOffset now)
    {
        var today = now.UtcDateTime.Date;
        var next = new DateTime(today.Year, today.Month, today.Day, 3, 0, 0, DateTimeKind.Utc);
        if (next <= now.UtcDateTime)
        {
            next = next.AddDays(1);
        }
        return new DateTimeOffset(next, TimeSpan.Zero);
    }

    private async Task AggregateAsync(CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var since = clock.GetUtcNow().AddDays(-1);

        await using var scope = scopeFactory.CreateAsyncScope();
        var opportunities = scope.ServiceProvider.GetRequiredService<IOpportunityRepository>();
        var stats = scope.ServiceProvider.GetRequiredService<IDailyStatisticsRepository>();

        var all = await opportunities.ListTouchedSinceAsync(since, ct).ConfigureAwait(false);
        var grouped = all
            .GroupBy(o => o.AccountId)
            .Select(g => new DailyStatistics
            {
                Date = today,
                AccountId = g.Key,
                WonAmount = g.Where(o => o.Stage == OpportunityStage.ClosedWon).Sum(o => o.Amount),
                WonCount = g.Count(o => o.Stage == OpportunityStage.ClosedWon),
                LostCount = g.Count(o => o.Stage == OpportunityStage.ClosedLost),
                OpenCount = g.Count(o => o.Stage is not (OpportunityStage.ClosedWon or OpportunityStage.ClosedLost)),
            })
            .ToList();

        if (grouped.Count == 0)
        {
            logger.LogInformation("No opportunities to aggregate for {Date}", today);
            return;
        }

        await stats.SaveAsync(grouped, ct).ConfigureAwait(false);
        logger.LogInformation(
            "Persisted statistics for {AccountCount} accounts on {Date}",
            grouped.Count, today);
    }
}
