using System.Text.Json;
using System.Text.Json.Serialization;
using Confluent.Kafka;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Stats.Storage;

namespace Stats.Ingestion;

/// <summary>
///     Kafka consumer settings for the stats pipeline. Bound from
///     <c>appsettings.json</c> section <c>Kafka:Stats</c>.
/// </summary>
public sealed class KafkaStatsOptions
{
    public const string SectionName = "Kafka:Stats";

    /// <summary>Bootstrap servers (host:port,host:port).</summary>
    public string BootstrapServers { get; init; } = string.Empty;

    /// <summary>Topic to consume.</summary>
    public string Topic { get; init; } = "metrics.raw";

    /// <summary>Consumer group id.</summary>
    public string GroupId { get; init; } = "stats-pipeline";

    /// <summary>Maximum number of points to buffer before a flush.</summary>
    public int BatchSize { get; init; } = 500;

    /// <summary>Maximum time to wait before flushing a partial batch.</summary>
    public TimeSpan FlushInterval { get; init; } = TimeSpan.FromSeconds(2);
}

/// <summary>
///     Wire shape of a single metric event on the <c>metrics.raw</c> topic.
/// </summary>
/// <param name="Timestamp">Wall-clock instant the metric was sampled.</param>
/// <param name="Metric">Metric name (e.g. <c>"http.request.duration"</c>).</param>
/// <param name="Value">Sampled value.</param>
/// <param name="Tags">Optional key/value tags (e.g. <c>"region": "eu-central-1"</c>).</param>
public sealed record MetricDto(
    [property: JsonPropertyName("ts")] DateTimeOffset Timestamp,
    [property: JsonPropertyName("metric")] string Metric,
    [property: JsonPropertyName("value")] double Value,
    [property: JsonPropertyName("tags")] IReadOnlyDictionary<string, string>? Tags);

/// <summary>
///     Background service that consumes raw metric points from Kafka and
///     batches them into the <see cref="TimeSeriesStore" />. Uses
///     <see cref="TimeProvider" /> for deterministic "now".
/// </summary>
/// <param name="options">Kafka settings.</param>
/// <param name="store">Target storage.</param>
/// <param name="clock">Wall-clock source for flush timestamps.</param>
/// <param name="logger">Structured logger.</param>
public sealed class KafkaStatsConsumer(
    IOptions<KafkaStatsOptions> options,
    TimeSeriesStore store,
    TimeProvider clock,
    ILogger<KafkaStatsConsumer> logger) : BackgroundService
{
    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var config = new ConsumerConfig
        {
            BootstrapServers = options.Value.BootstrapServers,
            GroupId = options.Value.GroupId,
            AutoOffsetReset = AutoOffsetReset.Earliest,
            EnableAutoCommit = false,
        };

        using var consumer = new ConsumerBuilder<string, string>(config)
            .SetErrorHandler((_, error) => logger.LogError("Kafka error: {Reason}", error.Reason))
            .Build();
        consumer.Subscribe(options.Value.Topic);

        var batch = new List<Point>(options.Value.BatchSize);
        var lastFlush = clock.GetUtcNow();

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
                    await KafkaBatch.MaybeFlushAsync(
                        batch, lastFlush, options.Value.FlushInterval, store, clock, logger, stoppingToken);
                    continue;
                }

                if (KafkaBatch.TryParse(result.Message.Value) is { } point)
                {
                    batch.Add(point);
                }

                if (batch.Count >= options.Value.BatchSize ||
                    clock.GetUtcNow() - lastFlush >= options.Value.FlushInterval)
                {
                    await FlushAsync(batch, stoppingToken);
                    consumer.Commit(result);
                    lastFlush = clock.GetUtcNow();
                }
            }
        }
        finally
        {
            await KafkaBatch.FlushAsync(batch, store, logger, CancellationToken.None);
            consumer.Close();
        }
    }
}

/// <summary>
///     Batch-flush helpers for the Kafka stats pipeline. File-static so
///     production classes don't carry private methods (per
///     <c>code-shape.md</c> §1a).
/// </summary>
file static class KafkaBatch
{
    /// <summary>Tries to parse a single Kafka message value as a <see cref="Point" />.</summary>
    /// <param name="raw">Raw message value (UTF-8 JSON).</param>
    /// <returns>The parsed point, or <see langword="null" /> on parse failure.</returns>
    public static Point? TryParse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            var dto = JsonSerializer.Deserialize<MetricDto>(raw, KafkaStatsJsonOptions.Instance);
            if (dto is null)
            {
                return null;
            }

            return new Point(dto.Timestamp, dto.Metric, dto.Value, dto.Tags);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    ///     Flushes a batch to the store. Swallows I/O errors so a transient
    ///     store failure doesn't crash the consumer.
    /// </summary>
    /// <param name="batch">Batch to persist; cleared on success or failure.</param>
    /// <param name="store">Target storage.</param>
    /// <param name="logger">Structured logger.</param>
    /// <param name="cancellationToken">Forwarded to the store.</param>
    public static async Task FlushAsync(
        List<Point> batch,
        TimeSeriesStore store,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        if (batch.Count == 0)
        {
            return;
        }

        try
        {
            await store.AppendBatchAsync(batch, cancellationToken);
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

    /// <summary>Flushes the batch only if the flush interval has elapsed.</summary>
    /// <param name="batch">Batch to persist; cleared on flush.</param>
    /// <param name="lastFlush">Wall-clock instant of the last flush.</param>
    /// <param name="flushInterval">Configured flush interval.</param>
    /// <param name="store">Target storage.</param>
    /// <param name="clock">Wall-clock source.</param>
    /// <param name="logger">Structured logger.</param>
    /// <param name="cancellationToken">Forwarded to the store.</param>
    public static async Task MaybeFlushAsync(
        List<Point> batch,
        DateTimeOffset lastFlush,
        TimeSpan flushInterval,
        TimeSeriesStore store,
        TimeProvider clock,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        if (batch.Count == 0)
        {
            return;
        }

        if (clock.GetUtcNow() - lastFlush >= flushInterval)
        {
            await FlushAsync(batch, store, logger, cancellationToken);
        }
    }
}

/// <summary>
///     Shared <see cref="JsonSerializerOptions" /> for the Kafka stats pipeline.
///     Snake-case wire field names match the producer's contract.
/// </summary>
file static class KafkaStatsJsonOptions
{
    public static JsonSerializerOptions Instance { get; } = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Converters = { new JsonStringEnumConverter() },
    };
}
