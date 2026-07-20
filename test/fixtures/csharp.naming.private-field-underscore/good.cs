using System;

namespace Tessera.Modules.Traces.Endpoints;

/// <summary>
/// Stale cached span aggregator. Private fields drop the underscore prefix;
/// primary constructor exposes the parameter name as the implicit backing
/// field when needed.
/// </summary>
public sealed class StaleAggregator
{
    public StaleAggregator(TimeSpan padding, int cacheCeiling)
    {
        Padding = padding;
        CacheCeiling = cacheCeiling;
    }

    public TimeSpan Padding { get; }
    public int CacheCeiling { get; }

    public bool ShouldAggregate(TimeSpan span) =>
        span > Padding && span.TotalMilliseconds < CacheCeiling;
}
