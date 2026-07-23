using CloudPlatform.Vms;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

namespace CloudPlatform.Vms;

/// <summary>
///     Strongly-typed route names for VM action endpoints. File-scoped so a
///     rename is one place and the compiler verifies both
///     <c>[HttpPost(..., Name = ...)]</c> and <c>CreatedAtAction(...)</c>
///     call sites match.
/// </summary>
file static class VmActionRouteNames
{
    /// <summary>POST <c>/api/v1/vms/{vmId}/actions</c>.</summary>
    public const string Post = "vms-post-action";
}

/// <summary>
///     Maps the HTTP endpoints for the VM action API.
/// </summary>
public static class VmActionEndpoint
{
    /// <summary>Registers the routes on the supplied endpoint builder.</summary>
    /// <param name="routes">Endpoint route builder from <c>WebApplication</c>.</param>
    public static IEndpointRouteBuilder MapVmActions(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/vms").WithTags("VMs");

        group.MapPost("/{vmId:guid}/actions", HandleAsync)
             .WithName(VmActionRouteNames.Post)
             .Produces<AcceptedVmActionResponse>(StatusCodes.Status202Accepted)
             .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
             .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
             .Produces<ProblemDetails>(StatusCodes.Status409Conflict);

        return routes;
    }

    /// <summary>Endpoint handler that dispatches a VM action through the application layer.</summary>
    private static async Task<IResult> HandleAsync(
        Guid vmId,
        [FromBody] VmActionRequest request,
        [FromServices] VmActionHandler handler,
        [FromServices] ICurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (request.Action == VmActionKind.ForceTerminate && string.IsNullOrWhiteSpace(request.Reason))
        {
            return TypedResults.Problem(
                title: "Reason required",
                detail: "ForceTerminate requires a non-empty reason.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var command = new VmActionCommand(
            request.Action,
            new VmId(vmId),
            request.Reason,
            currentUser.UserId?.ToString() ?? "anonymous");

        try
        {
            return TypedResults.Accepted(
                $"/api/v1/vms/{vmId}",
                new AcceptedVmActionResponse(
                    vmId,
                    await handler.HandleAsync(command, cancellationToken)));
        }
        catch (VmNotFoundException ex)
        {
            return TypedResults.Problem(
                title: "VM not found",
                detail: ex.Message,
                statusCode: StatusCodes.Status404NotFound);
        }
        catch (InvalidVmTransitionException ex)
        {
            return TypedResults.Problem(
                title: "Invalid state transition",
                detail: ex.Message,
                statusCode: StatusCodes.Status409Conflict);
        }
    }
}

/// <summary>
///     Wire response body for accepted VM actions. Replaces the clean-agent's
///     anonymous record <c>new { vmId, state }</c> so the contract is
///     discoverable + testable.
/// </summary>
/// <param name="VmId">Raw GUID of the VM that was acted on.</param>
/// <param name="State">New state after the action was applied.</param>
public sealed record AcceptedVmActionResponse(Guid VmId, VmState State);
