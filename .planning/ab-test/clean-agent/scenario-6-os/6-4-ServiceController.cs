using Microsoft.AspNetCore.Mvc;
using Refit;

namespace OsService.Services;

/// <summary>Possible states of a service on a node.</summary>
public enum ServiceState
{
    Unknown = 0,
    Stopped = 1,
    Starting = 2,
    Running = 3,
    Stopping = 4,
    Failed = 5,
}

/// <summary>Refit client contract for talking to a node agent.</summary>
public interface INodeAgentClient
{
    /// <summary>Starts the service on the agent.</summary>
    [Post("/api/v1/services/{name}/start")]
    Task<ServiceState> StartAsync(string name, CancellationToken ct);

    /// <summary>Stops the service on the agent.</summary>
    [Post("/api/v1/services/{name}/stop")]
    Task<ServiceState> StopAsync(string name, CancellationToken ct);

    /// <summary>Returns the current state of the service.</summary>
    [Get("/api/v1/services/{name}")]
    Task<ServiceState> GetStateAsync(string name, CancellationToken ct);
}

/// <summary>Routes service start/stop requests to a remote node agent.</summary>
[ApiController]
[Route("api/v1/services")]
public sealed class ServiceController : ControllerBase
{
    private readonly INodeAgentClient agentClient;
    private readonly ILogger<ServiceController> logger;

    /// <summary>Constructs the controller.</summary>
    public ServiceController(INodeAgentClient agentClient, ILogger<ServiceController> logger)
    {
        this.agentClient = agentClient;
        this.logger = logger;
    }

    /// <summary>Starts a service on the agent.</summary>
    [HttpPost("{name}/start")]
    [ProducesResponseType<ServiceState>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ServiceState>> StartAsync(string name, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return Problem("Service name is required.", statusCode: StatusCodes.Status400BadRequest);
        }

        try
        {
            var state = await agentClient.StartAsync(name, ct).ConfigureAwait(false);
            logger.LogInformation("Started service {Service}", name);
            return Ok(state);
        }
        catch (ApiException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return Problem($"Service '{name}' is not registered on the agent.", statusCode: StatusCodes.Status404NotFound);
        }
    }

    /// <summary>Stops a service on the agent.</summary>
    [HttpPost("{name}/stop")]
    [ProducesResponseType<ServiceState>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ServiceState>> StopAsync(string name, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return Problem("Service name is required.", statusCode: StatusCodes.Status400BadRequest);
        }

        try
        {
            var state = await agentClient.StopAsync(name, ct).ConfigureAwait(false);
            logger.LogInformation("Stopped service {Service}", name);
            return Ok(state);
        }
        catch (ApiException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return Problem($"Service '{name}' is not registered on the agent.", statusCode: StatusCodes.Status404NotFound);
        }
    }

    /// <summary>Returns the current state of a service.</summary>
    [HttpGet("{name}")]
    [ProducesResponseType<ServiceState>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ServiceState>> GetStateAsync(string name, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return Problem("Service name is required.", statusCode: StatusCodes.Status400BadRequest);
        }

        try
        {
            return Ok(await agentClient.GetStateAsync(name, ct).ConfigureAwait(false));
        }
        catch (ApiException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return Problem($"Service '{name}' is not registered on the agent.", statusCode: StatusCodes.Status404NotFound);
        }
    }
}
