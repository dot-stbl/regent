using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Saas.Permissions;
using Saas.Tenants;

namespace Saas.Api;

/// <summary>Summary projection of an account in the tenant-scoped list endpoint.</summary>
public sealed record AccountSummary(Guid Id, string Name, TenantPlan Plan);

/// <summary>Abstraction over the multi-tenant account query service.</summary>
public interface IMultiTenantAccountService
{
    /// <summary>Lists accounts in the current tenant.</summary>
    Task<IReadOnlyList<AccountSummary>> ListAsync(CancellationToken ct);
}

/// <summary>
/// Example controller that requires an authenticated user, resolves the tenant
/// from <see cref="ITenantContext"/>, and returns tenant-scoped data.
/// </summary>
[ApiController]
[Route("api/v1/accounts")]
[Authorize]
public sealed class MultiTenantController : ControllerBase
{
    private readonly IMultiTenantAccountService service;
    private readonly ITenantContext tenantContext;

    /// <summary>Constructs the controller with its dependencies.</summary>
    public MultiTenantController(IMultiTenantAccountService service, ITenantContext tenantContext)
    {
        this.service = service;
        this.tenantContext = tenantContext;
    }

    /// <summary>Returns the accounts in the current tenant.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<AccountSummary>), StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<IReadOnlyList<AccountSummary>>> ListAsync(CancellationToken ct)
    {
        if (!tenantContext.IsResolved)
        {
            return Problem(
                title: "Tenant not resolved",
                detail: "Request is missing the X-Tenant-Id header.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var accounts = await service.ListAsync(ct).ConfigureAwait(false);
        return Ok(accounts);
    }
}
