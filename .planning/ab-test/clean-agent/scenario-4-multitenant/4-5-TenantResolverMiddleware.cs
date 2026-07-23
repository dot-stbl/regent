using Microsoft.AspNetCore.Http;
using Saas.Tenants;

namespace Saas.Tenants;

/// <summary>
/// Per-request context holding the resolved tenant id.
/// </summary>
public interface ITenantContext
{
    /// <summary>Tenant the current request belongs to.</summary>
    TenantId? TenantId { get; }

    /// <summary>True when a tenant has been resolved for this request.</summary>
    bool IsResolved { get; }
}

/// <summary>Default scoped implementation of <see cref="ITenantContext"/>.</summary>
public sealed class TenantContext : ITenantContext
{
    /// <inheritdoc />
    public TenantId? TenantId { get; set; }

    /// <inheritdoc />
    public bool IsResolved => TenantId is not null;
}

/// <summary>
/// ASP.NET Core middleware that resolves the tenant for the current request from
/// the <c>X-Tenant-Id</c> header.
/// </summary>
public sealed class TenantResolverMiddleware : IMiddleware
{
    /// <summary>Name of the header carrying the tenant identifier.</summary>
    public const string HeaderName = "X-Tenant-Id";

    private readonly ILogger<TenantResolverMiddleware> logger;

    /// <summary>Constructs the middleware.</summary>
    public TenantResolverMiddleware(ILogger<TenantResolverMiddleware> logger)
    {
        this.logger = logger;
    }

    /// <inheritdoc />
    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);

        var tenantContext = context.RequestServices.GetService(typeof(ITenantContext)) as ITenantContext;
        if (tenantContext is null)
        {
            // No tenant context registered — let the request continue but warn.
            logger.LogWarning("No ITenantContext is registered; tenant resolution skipped.");
            await next(context).ConfigureAwait(false);
            return;
        }

        if (context.Request.Headers.TryGetValue(HeaderName, out var values))
        {
            var raw = values.ToString();
            if (!string.IsNullOrWhiteSpace(raw) && Guid.TryParse(raw, out var parsed))
            {
                ((TenantContext)tenantContext).TenantId = new TenantId(parsed);
            }
            else
            {
                logger.LogDebug("X-Tenant-Id header was present but not a valid GUID: {Value}", raw);
            }
        }

        await next(context).ConfigureAwait(false);
    }
}
