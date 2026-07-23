using Npgsql;
using NpgsqlTypes;

namespace Stats.Storage;

/// <summary>A single time-series data point.</summary>
public sealed record Point(DateTimeOffset Timestamp, string Metric, double Value, IReadOnlyDictionary<string, string>? Tags);

/// <summary>Append-only time-series store backed by TimescaleDB.</summary>
public sealed class TimeSeriesStore : IDisposable
{
    private readonly NpgsqlDataSource dataSource;
    private readonly ILogger<TimeSeriesStore> logger;
    private bool disposed;

    /// <summary>Constructs the store from a connection string.</summary>
    public TimeSeriesStore(string connectionString, ILogger<TimeSeriesStore> logger)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new ArgumentException("Connection string must be provided.", nameof(connectionString));
        }

        this.dataSource = new NpgsqlDataSourceBuilder(connectionString).Build();
        this.logger = logger;
    }

    /// <summary>Appends a batch of points in a single round-trip.</summary>
    public async Task AppendBatchAsync(IReadOnlyList<Point> points, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(points);
        if (points.Count == 0)
        {
            return;
        }

        const string sql = """
            INSERT INTO metrics.points (ts, metric, value, tags)
            VALUES (@ts, @metric, @value, @tags)
            """;

        await using var conn = await dataSource.OpenConnectionAsync(ct).ConfigureAwait(false);
        await using var tx = await conn.BeginTransactionAsync(ct).ConfigureAwait(false);

        foreach (var p in points)
        {
            await using var cmd = new NpgsqlCommand(sql, conn, tx);
            cmd.Parameters.Add(new NpgsqlParameter("@ts", NpgsqlDbType.TimestampTz) { Value = p.Timestamp });
            cmd.Parameters.Add(new NpgsqlParameter("@metric", NpgsqlDbType.Varchar) { Value = p.Metric });
            cmd.Parameters.Add(new NpgsqlParameter("@value", NpgsqlDbType.Double) { Value = p.Value });
            cmd.Parameters.Add(new NpgsqlParameter("@tags", NpgsqlDbType.Jsonb)
            {
                Value = p.Tags is null ? (object)DBNull.Value : System.Text.Json.JsonSerializer.Serialize(p.Tags),
            });
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        await tx.CommitAsync(ct).ConfigureAwait(false);
    }

    /// <summary>Returns all points for a metric in the half-open interval [from, to).</summary>
    public async IAsyncEnumerable<Point> RangeAsync(
        string metric,
        DateTimeOffset from,
        DateTimeOffset to,
        int maxPoints = 10_000,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(metric))
        {
            throw new ArgumentException("Metric must be provided.", nameof(metric));
        }

        if (to <= from)
        {
            yield break;
        }

        const string sql = """
            SELECT ts, metric, value, tags
            FROM metrics.points
            WHERE metric = @metric AND ts >= @from AND ts < @to
            ORDER BY ts ASC
            LIMIT @limit
            """;

        await using var conn = await dataSource.OpenConnectionAsync(ct).ConfigureAwait(false);
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.Add(new NpgsqlParameter("@metric", NpgsqlDbType.Varchar) { Value = metric });
        cmd.Parameters.Add(new NpgsqlParameter("@from", NpgsqlDbType.TimestampTz) { Value = from });
        cmd.Parameters.Add(new NpgsqlParameter("@to", NpgsqlDbType.TimestampTz) { Value = to });
        cmd.Parameters.Add(new NpgsqlParameter("@limit", NpgsqlDbType.Integer) { Value = maxPoints });

        await using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            var ts = reader.GetFieldValue<DateTime>(0);
            var name = reader.GetFieldValue<string>(1);
            var value = reader.GetFieldValue<double>(2);
            var tagsJson = reader.IsDBNull(3) ? null : reader.GetFieldValue<string>(3);
            IReadOnlyDictionary<string, string>? tags = null;
            if (!string.IsNullOrEmpty(tagsJson))
            {
                tags = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(tagsJson);
            }
            yield return new Point(new DateTimeOffset(ts, TimeSpan.Zero), name, value, tags);
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (disposed)
        {
            return;
        }
        disposed = true;
        dataSource.Dispose();
        GC.SuppressFinalize(this);
    }
}
