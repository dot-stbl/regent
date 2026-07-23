using CloudPlatform.Vms;

namespace CloudPlatform.Vms;

/// <summary>
/// Domain entity that represents a virtual machine tracked by the control-plane.
/// </summary>
public sealed class Vm
{
    /// <summary>Primary identifier.</summary>
    public VmId Id { get; private set; }

    /// <summary>Tenant that owns the VM.</summary>
    public TenantId TenantId { get; private set; }

    /// <summary>Current lifecycle state.</summary>
    public VmState State { get; private set; }

    /// <summary>Wall-clock instant when the VM entered <see cref="Provisioning"/>.</summary>
    public DateTimeOffset? ProvisioningStartedAt { get; private set; }

    /// <summary>Last state transition timestamp.</summary>
    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>EF Core parameterless constructor.</summary>
    private Vm()
    {
    }

    /// <summary>Constructs a new VM in the <see cref="Provisioning"/> state.</summary>
    public Vm(VmId id, TenantId tenantId, DateTimeOffset now)
    {
        Id = id;
        TenantId = tenantId;
        State = VmState.Provisioning;
        ProvisioningStartedAt = now;
        UpdatedAt = now;
    }

    /// <summary>Applies a state transition if the state machine permits it.</summary>
    /// <returns><see langword="true"/> if the transition was applied.</returns>
    public bool TryTransit(VmActionKind action, DateTimeOffset now, out VmState? previousState)
    {
        previousState = State;
        if (!VmStateMachine.CanTransition(State, action, out var next))
        {
            return false;
        }

        State = next;
        UpdatedAt = now;
        if (next == VmState.Provisioning)
        {
            ProvisioningStartedAt = now;
        }

        return true;
    }
}

/// <summary>
/// Exception raised when a VM action is requested against an unknown VM.
/// </summary>
public sealed class VmNotFoundException : Exception
{
    /// <summary>Identifier of the VM that could not be found.</summary>
    public VmId VmId { get; }

    public VmNotFoundException(VmId vmId)
        : base($"VM '{vmId}' was not found.")
    {
        VmId = vmId;
    }
}

/// <summary>
/// Exception raised when a VM action would violate the state machine.
/// </summary>
public sealed class InvalidVmTransitionException : Exception
{
    /// <summary>The VM that was targeted.</summary>
    public VmId VmId { get; }

    /// <summary>Current state of the VM.</summary>
    public VmState From { get; }

    /// <summary>Action that was attempted.</summary>
    public VmActionKind Action { get; }

    public InvalidVmTransitionException(VmId vmId, VmState from, VmActionKind action)
        : base($"VM '{vmId}' cannot perform action '{action}' from state '{from}'.")
    {
        VmId = vmId;
        From = from;
        Action = action;
    }
}

/// <summary>
/// Repository contract for persisting VMs.
/// </summary>
public interface IVmRepository
{
    /// <summary>Retrieves a VM by its identifier, or <see langword="null"/> if absent.</summary>
    Task<Vm?> GetByIdAsync(VmId vmId, CancellationToken ct);

    /// <summary>Lists all VMs owned by the tenant, paginated.</summary>
    Task<IReadOnlyCollection<Vm>> ListByTenantAsync(
        TenantId tenantId,
        int pageNumber,
        int pageSize,
        CancellationToken ct);

    /// <summary>Persists the supplied VM.</summary>
    Task SaveAsync(Vm vm, CancellationToken ct);
}

/// <summary>
/// Application-level handler that processes a <see cref="VmActionCommand"/>.
/// </summary>
public sealed class VmActionHandler
{
    private readonly IVmRepository repository;
    private readonly TimeProvider clock;
    private readonly ILogger<VmActionHandler> logger;

    /// <summary>Constructs the handler with its dependencies.</summary>
    public VmActionHandler(
        IVmRepository repository,
        TimeProvider clock,
        ILogger<VmActionHandler> logger)
    {
        this.repository = repository;
        this.clock = clock;
        this.logger = logger;
    }

    /// <summary>Processes the command and returns the resulting VM state.</summary>
    /// <exception cref="VmNotFoundException">Thrown when the VM does not exist.</exception>
    /// <exception cref="InvalidVmTransitionException">Thrown when the state machine forbids the action.</exception>
    public async Task<VmState> HandleAsync(VmActionCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        var vm = await repository.GetByIdAsync(command.VmId, ct).ConfigureAwait(false)
            ?? throw new VmNotFoundException(command.VmId);

        if (!vm.TryTransit(command.Action, clock.GetUtcNow(), out _))
        {
            throw new InvalidVmTransitionException(command.VmId, vm.State, command.Action);
        }

        await repository.SaveAsync(vm, ct).ConfigureAwait(false);

        logger.LogInformation(
            "Applied {Action} to VM {VmId}; new state is {State}",
            command.Action, vm.Id, vm.State);

        return vm.State;
    }
}
