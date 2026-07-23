using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Stats.Aggregation;
using Stats.Anomalies;
using Stats.Storage;

namespace Stats.Api;

/// <summary>Response envelope containing aggregated points and anomaly markers.</summary>
public sealed record StatsResponse(
    string Metric,
    DateTimeOffset From,
    DateTimeOffset To,
    Window Window,
    IReadOnlyList<AggregatedPoint> Points,
    IReadOnlyList<Anomaly> Anomalies);

/// <summary>Maps the stats HTTP endpoints.</summary>
public static class StatsEndpoint
{
    /// <summary>Registers the routes.</summary>
    public static IEndpointRouteBuilder MapStats(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/stats").WithTags("Stats");

        group.MapGet("/{metric}", HandleAsync)
             .WithName("GetStats")
             .Produces<StatsResponse>(StatusCodes.Status200OK)
             .Produces<ProblemDetails>(StatusCodes.Status400BadRequest);

        return routes;
    }

    /// <summary>Endpoint handler.</summary>
    public static async Task<IResult> HandleAsync(
        string metric,
        [FromQuery] DateTimeOffset from,
        [FromQuery] DateTimeOffset to,
        [FromQuery] string window,
        [FromQuery] string kind,
        TimeSeriesStore store,
        AnomalyDetector detector,
        CancellationToken ct)
    {
        if (to <= from)
        {
            return Results.Problem(
                title: "Invalid time range",
                detail: "'to' must be greater than 'from'.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var windowSize = ParseWindow(window);
        if (windowSize is null)
        {
            return Results.Problem(
                title: "Invalid window",
                detail: "Window must be a positive duration (e.g. '1m', '5m', '1h').",
                statusCode: StatusCodes.Status400BadRequest);
        }

        if (!TryParseKind(kind, out var aggregation))
        {
            return Results.Problem(
                title: "Invalid aggregation",
                detail: "Kind must be one of: sum, avg, p50, p95, p99.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var points = new List<Point>();
        await foreach (var point in store.RangeAsync(metric, from, to, ct: ct).ConfigureAwait(false))
        {
            points.Add(point);
        }

        var windowSpec = new Window(windowSize.Value, aggregation);
        var aggregated = WindowAggregator.Aggregate(points, windowSpec);
        var anomalies = await detector.DetectAsync(metric, points, ct).ConfigureAwait(false);

        return Results.Ok(new StatsResponse(metric, from, to, windowSpec, aggregated, anomalies));
    }

    private static TimeSpan? ParseWindow(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return TimeSpan.FromMinutes(1);
        }

        if (input.Length < 2)
        {
            return null;
        }

        var unit = input[^1];
        if (!double.TryParse(input[..^1], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var value))
        {
            return null;
        }

        return unit switch
        {
            's' => TimeSpan.FromSeconds(value),
            'm' => TimeSpan.FromMinutes(value),
            'h' => TimeSpan.FromHours(value),
            'd' => TimeSpan.FromDays(value),
            _ => null,
        };
    }

    private static bool TryParseKind(string? input, out AggregationKind kind)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            kind = AggregationKind.Avg;
            return true;
        }

        switch (input.ToLowerInvariant())
        {
            case "sum": kind = AggregationKind.Sum; return true;
            case "avg":
            case "mean": kind = AggregationKind.Avg; return true;
            case "p50": kind = AggregationKind.P50; return true;
            case "p95": kind = AggregationKind.P95; return true;
            case "p99": kind = AggregationKind.P99; return true;
            default: kind = default; return false;
        }
    }
}
