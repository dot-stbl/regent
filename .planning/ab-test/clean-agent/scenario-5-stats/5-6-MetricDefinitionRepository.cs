using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace Stats.Meta;

/// <summary>Metadata describing a metric.</summary>
public sealed record MetricDefinition(
    string Name,
    string Label,
    string Unit,
    TimeSpan Retention);

/// <summary>Persistence surface for metric metadata.</summary>
public interface IMetricDefinitionRepository
{
    /// <summary>Returns the metadata for a metric, or <see langword="null"/> when unknown.</summary>
    Task<MetricDefinition?> GetAsync(string name, CancellationToken ct);

    /// <summary>Persists metadata for a metric.</summary>
    Task UpsertAsync(MetricDefinition definition, CancellationToken ct);
}

/// <summary>EF Core DbContext exposing the metrics metadata table.</summary>
public interface IMetricDefinitionDbContext
{
    /// <summary>Set of <see cref="MetricDefinitionRow"/>.</summary>
    DbSet<MetricDefinitionRow> MetricDefinitions { get; }
}

/// <summary>EF Core row stored in the database.</summary>
public sealed class MetricDefinitionRow
{
    /// <summary>Primary key (metric name).</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Human label.</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>Unit of measurement.</summary>
    public string Unit { get; set; } = string.Empty;

    /// <summary>Retention in days (we store the days count for simplicity).</summary>
    public int RetentionDays { get; set; }
}

/// <summary>EF Core implementation of <see cref="IMetricDefinitionRepository"/>.</summary>
public sealed class MetricDefinitionRepository : IMetricDefinitionRepository
{
    private readonly IMetricDefinitionDbContext dbContext;

    /// <summary>Constructs the repository.</summary>
    public MetricDefinitionRepository(IMetricDefinitionDbContext dbContext)
    {
        this.dbContext = dbContext;
    }

    /// <inheritdoc />
    public async Task<MetricDefinition?> GetAsync(string name, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Name must be provided.", nameof(name));
        }

        var row = await dbContext.MetricDefinitions
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.Name == name, ct)
            .ConfigureAwait(false);

        return row is null
            ? null
            : new MetricDefinition(row.Name, row.Label, row.Unit, TimeSpan.FromDays(row.RetentionDays));
    }

    /// <inheritdoc />
    public async Task UpsertAsync(MetricDefinition definition, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(definition);

        var existing = await dbContext.MetricDefinitions
            .FirstOrDefaultAsync(m => m.Name == definition.Name, ct)
            .ConfigureAwait(false);

        if (existing is null)
        {
            await dbContext.MetricDefinitions.AddAsync(Map(definition), ct).ConfigureAwait(false);
        }
        else
        {
            existing.Label = definition.Label;
            existing.Unit = definition.Unit;
            existing.RetentionDays = (int)Math.Round(definition.Retention.TotalDays);
        }

        await dbContext.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    private static MetricDefinitionRow Map(MetricDefinition definition) => new()
    {
        Name = definition.Name,
        Label = definition.Label,
        Unit = definition.Unit,
        RetentionDays = (int)Math.Round(definition.Retention.TotalDays),
    };
}
