using System;

namespace Tessera.Modules.Traces.Endpoints;

/// <summary>
/// Stale cached span aggregator. Private fields with underscore prefix
/// are banned — primary-constructor parameter names already serve as
/// backing fields.
/// </summary>
public sealed class StaleAggregator
{
    private readonly TimeSpan _padding;
    private readonly int _cacheCeiling;

    public StaleAggregator(TimeSpan padding, int cacheCeiling)
    {
        _padding = padding;
        _cacheCeiling = cacheCeiling;
    }

    public bool ShouldAggregate(TimeSpan span) =>
        span > _padding && span.TotalMilliseconds < _cacheCeiling;
}
