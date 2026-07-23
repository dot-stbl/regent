using CloudPlatform.Vms;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

namespace CloudPlatform.Vms;

/// <summary>
/// Maps the HTTP endpoints for the VM action API.
/// </summary>
public static class VmActionEndpoint
{
    /// <summary>Registers the routes on the supplied endpoint builder.</summary>
    public static IEndpointRouteBuilder MapVmActions(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/vms").WithTags("VMs");

        group.MapPost("/{vmId:guid}/actions", HandleAsync)
             .WithName("PostVmAction")
             .Produces(StatusCodes.Status202Accepted)
             .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
             .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
             .Produces<ProblemDetails>(StatusCodes.Status409Conflict);

        return routes;
    }

    /// <summary>Endpoint handler that dispatches a VM action through the application layer.</summary>
    private static async Task<IResult> HandleAsync(
        Guid vmId,
        [FromBody] VmActionRequest request,
        HttpContext httpContext,
        VmActionHandler handler,
        CancellationToken ct)
    {
        if (request.Action == VmActionKind.ForceTerminate && string.IsNullOrWhiteSpace(request.Reason))
        {
            return Results.Problem(
                title: "Reason required",
                detail: "ForceTerminate requires a non-empty reason.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var command = new VmActionCommand(
            request.Action,
            new VmId(vmId),
            request.Reason,
            httpContext.User.Identity?.Name ?? "anonymous");

        try
        {
            var state = await handler.HandleAsync(command, ct).ConfigureAwait(false);
            var location = $"/api/v1/vms/{vmId}";
            return Results.Accepted(location, new { vmId, state });
        }
        catch (VmNotFoundException ex)
        {
            return Results.Problem(
                title: "VM not found",
                detail: ex.Message,
                statusCode: StatusCodes.Status404NotFound);
        }
        catch (InvalidVmTransitionException ex)
        {
            return Results.Problem(
                title: "Invalid state transition",
                detail: ex.Message,
                statusCode: StatusCodes.Status409Conflict);
        }
    }
}
