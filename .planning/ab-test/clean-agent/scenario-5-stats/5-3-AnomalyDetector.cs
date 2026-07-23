using Stats.Storage;

namespace Stats.Anomalies;

/// <summary>A detected anomaly.</summary>
/// <param name="Timestamp">Timestamp of the anomalous point.</param>
/// <param name="Metric">Metric name.</param>
/// <param name="Value">Observed value.</param>
/// <param name="ExpectedMean">Baseline mean.</param>
/// <param name="StandardDeviations">Number of standard deviations away from the mean.</param>
public sealed record Anomaly(
    DateTimeOffset Timestamp,
    string Metric,
    double Value,
    double ExpectedMean,
    double StandardDeviations);

/// <summary>Baseline statistics for a metric.</summary>
public sealed record Baseline(double Mean, double StdDev, int SampleCount);

/// <summary>Source of historical baselines for metrics.</summary>
public interface IBaselineSource
{
    /// <summary>Returns the baseline for <paramref name="metric"/>.</summary>
    Task<Baseline?> GetBaselineAsync(string metric, CancellationToken ct);
}

/// <summary>
/// Detects points that deviate from the historical baseline by more than N standard deviations.
/// </summary>
public sealed class AnomalyDetector
{
    /// <summary>Default sigma threshold.</summary>
    public const double DefaultSigma = 3.0;

    private readonly IBaselineSource baselines;
    private readonly double sigmaThreshold;

    /// <summary>Constructs the detector.</summary>
    public AnomalyDetector(IBaselineSource baselines, double sigmaThreshold = DefaultSigma)
    {
        this.baselines = baselines;
        this.sigmaThreshold = sigmaThreshold;
    }

    /// <summary>Returns all anomalies in the supplied series.</summary>
    public async Task<IReadOnlyCollection<Anomaly>> DetectAsync(
        string metric,
        IReadOnlyList<Point> series,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(series);
        if (string.IsNullOrWhiteSpace(metric))
        {
            throw new ArgumentException("Metric must be provided.", nameof(metric));
        }

        var baseline = await baselines.GetBaselineAsync(metric, ct).ConfigureAwait(false);
        if (baseline is null || baseline.StdDev <= 0 || baseline.SampleCount < 2)
        {
            return Array.Empty<Anomaly>();
        }

        var result = new List<Anomaly>();
        foreach (var point in series)
        {
            var z = (point.Value - baseline.Mean) / baseline.StdDev;
            if (Math.Abs(z) > sigmaThreshold)
            {
                result.Add(new Anomaly(
                    point.Timestamp,
                    metric,
                    point.Value,
                    baseline.Mean,
                    z));
            }
        }

        return result;
    }
}
