using System.Text.Json;
using System.Threading.Channels;
using Confluent.Kafka;
using Microsoft.Extensions.Hosting;
using Stats.Storage;

namespace Stats.Ingestion;

/// <summary>Kafka consumer settings for the stats pipeline.</summary>
public sealed class KafkaStatsOptions
{
    /// <summary>Bootstrap servers (host:port,host:port).</summary>
    public string BootstrapServers { get; set; } = string.Empty;

    /// <summary>Topic to consume.</summary>
    public string Topic { get; set; } = "metrics.raw";

    /// <summary>Consumer group id.</summary>
    public string GroupId { get; set; } = "stats-pipeline";

    /// <summary>Maximum number of points to buffer before a flush.</summary>
    public int BatchSize { get; set; } = 500;

    /// <summary>Maximum time to wait before flushing a partial batch.</summary>
    public TimeSpan FlushInterval { get; set; } = TimeSpan.FromSeconds(2);
}

/// <summary>
/// Background service that consumes raw metric points from Kafka and batches
/// them into the <see cref="TimeSeriesStore"/>.
/// </summary>
public sealed class KafkaStatsConsumer : BackgroundService
{
    private readonly KafkaStatsOptions options;
    private readonly TimeSeriesStore store;
    private readonly ILogger<KafkaStatsConsumer> logger;

    /// <summary>Constructs the consumer.</summary>
    public KafkaStatsConsumer(
        KafkaStatsOptions options,
        TimeSeriesStore store,
        ILogger<KafkaStatsConsumer> logger)
    {
        this.options = options;
        this.store = store;
        this.logger = logger;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var config = new ConsumerConfig
        {
            BootstrapServers = options.BootstrapServers,
            GroupId = options.GroupId,
            AutoOffsetReset = AutoOffsetReset.Earliest,
            EnableAutoCommit = false,
        };

        using var consumer = new ConsumerBuilder<string, string>(config)
            .SetErrorHandler((_, error) => logger.LogError("Kafka error: {Reason}", error.Reason))
            .Build();
        consumer.Subscribe(options.Topic);

        var batch = new List<Point>(options.BatchSize);
        var lastFlush = DateTimeOffset.UtcNow;

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                ConsumeResult<string, string>? result = null;
                try
                {
                    result = consumer.Consume(stoppingToken);
                }
                catch (ConsumeException ex)
                {
                    logger.LogWarning(ex, "Consume failure: {Reason}", ex.Error.Reason);
                    continue;
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }

                if (result is null)
                {
                    await MaybeFlushAsync(batch, lastFlush, stoppingToken).ConfigureAwait(false);
                    continue;
                }

                if (TryParse(result.Message.Value, out var point))
                {
                    batch.Add(point);
                }

                if (batch.Count >= options.BatchSize ||
                    DateTimeOffset.UtcNow - lastFlush >= options.FlushInterval)
                {
                    await FlushAsync(batch, stoppingToken).ConfigureAwait(false);
                    consumer.Commit(result);
                    lastFlush = DateTimeOffset.UtcNow;
                }
            }
        }
        finally
        {
            await FlushAsync(batch, CancellationToken.None).ConfigureAwait(false);
            consumer.Close();
        }
    }

    private static bool TryParse(string? raw, out Point point)
    {
        point = default!;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        try
        {
            var dto = JsonSerializer.Deserialize<MetricDto>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            if (dto is null)
            {
                return false;
            }

            point = new Point(
                dto.Timestamp,
                dto.Metric,
                dto.Value,
                dto.Tags is null
                    ? null
                    : dto.Tags.ToDictionary(kvp => kvp.Key, kvp => kvp.Value));
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private async Task FlushAsync(List<Point> batch, CancellationToken ct)
    {
        if (batch.Count == 0)
        {
            return;
        }

        try
        {
            await store.AppendBatchAsync(batch, ct).ConfigureAwait(false);
            logger.LogDebug("Flushed {Count} points to time-series store", batch.Count);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to flush {Count} points", batch.Count);
        }
        finally
        {
            batch.Clear();
        }
    }

    private async Task MaybeFlushAsync(List<Point> batch, DateTimeOffset lastFlush, CancellationToken ct)
    {
        if (batch.Count == 0)
        {
            return;
        }

        if (DateTimeOffset.UtcNow - lastFlush >= options.FlushInterval)
        {
            await FlushAsync(batch, ct).ConfigureAwait(false);
        }
    }

    private sealed class MetricDto
    {
        public DateTimeOffset Timestamp { get; set; }
        public string Metric { get; set; } = string.Empty;
        public double Value { get; set; }
        public Dictionary<string, string>? Tags { get; set; }
    }
}
