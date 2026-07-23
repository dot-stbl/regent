using Stats.Storage;

namespace Stats.Aggregation;

/// <summary>Type of aggregation to compute.</summary>
public enum AggregationKind
{
    Sum = 0,
    Avg = 1,
    P50 = 2,
    P95 = 3,
    P99 = 4,
}

/// <summary>A single aggregated bucket.</summary>
public sealed record AggregatedPoint(
    DateTimeOffset WindowStart,
    DateTimeOffset WindowEnd,
    AggregationKind Kind,
    double Value,
    int SampleCount);

/// <summary>Window specification.</summary>
public sealed record Window(TimeSpan Size, AggregationKind Kind)
{
    /// <summary>True if the window represents a tumbling (non-overlapping) aggregation.</summary>
    public bool IsTumbling => true;
}

/// <summary>
/// Pure-function aggregator that buckets a series of <see cref="Point"/>s into
/// fixed-size time windows and applies the requested aggregation kind.
/// </summary>
public static class WindowAggregator
{
    /// <summary>Aggregates <paramref name="points"/> using <paramref name="window"/>.</summary>
    public static IReadOnlyList<AggregatedPoint> Aggregate(
        IReadOnlyList<Point> points,
        Window window)
    {
        ArgumentNullException.ThrowIfNull(points);
        ArgumentNullException.ThrowIfNull(window);

        if (points.Count == 0 || window.Size <= TimeSpan.Zero)
        {
            return Array.Empty<AggregatedPoint>();
        }

        var ordered = points.OrderBy(p => p.Timestamp).ToList();
        var result = new List<AggregatedPoint>();

        var index = 0;
        while (index < ordered.Count)
        {
            var anchor = ordered[index].Timestamp;
            var windowStart = FloorToWindow(anchor, window.Size);
            var windowEnd = windowStart + window.Size;

            var bucket = new List<double>(capacity: 16);
            while (index < ordered.Count && ordered[index].Timestamp < windowEnd)
            {
                bucket.Add(ordered[index].Value);
                index++;
            }

            if (bucket.Count == 0)
            {
                continue;
            }

            var value = Compute(window.Kind, bucket);
            result.Add(new AggregatedPoint(windowStart, windowEnd, window.Kind, value, bucket.Count));
        }

        return result;
    }

    private static DateTimeOffset FloorToWindow(DateTimeOffset ts, TimeSpan size)
    {
        var ticks = ts.UtcTicks - (ts.UtcTicks % size.Ticks);
        return new DateTimeOffset(ticks, TimeSpan.Zero);
    }

    private static double Compute(AggregationKind kind, List<double> values)
    {
        return kind switch
        {
            AggregationKind.Sum => values.Sum(),
            AggregationKind.Avg => values.Average(),
            AggregationKind.P50 => Percentile(values, 0.50),
            AggregationKind.P95 => Percentile(values, 0.95),
            AggregationKind.P99 => Percentile(values, 0.99),
            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unsupported aggregation kind."),
        };
    }

    private static double Percentile(List<double> values, double p)
    {
        if (values.Count == 0)
        {
            return 0;
        }

        values.Sort();
        if (values.Count == 1)
        {
            return values[0];
        }

        var rank = p * (values.Count - 1);
        var lower = (int)Math.Floor(rank);
        var upper = (int)Math.Ceiling(rank);
        if (lower == upper)
        {
            return values[lower];
        }

        var weight = rank - lower;
        return values[lower] * (1 - weight) + values[upper] * weight;
    }
}
