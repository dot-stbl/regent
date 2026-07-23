using CloudPlatform.Vms;

namespace CloudPlatform.Vms;

/// <summary>
///     Domain entity that represents a virtual machine tracked by the
///     control-plane. State transitions are validated by
///     <see cref="VmStateMachine" />.
/// </summary>
/// <remarks>
///     <para>
///         EF Core requires a parameterless constructor for materialised
///         entities. The constructor is <c>internal</c> so EF Core can use
///         it but external code cannot bypass the state-machine validation
///         by calling it directly.
///     </para>
/// </remarks>
public sealed class Vm
{
    /// <summary>Primary identifier.</summary>
    public VmId Id { get; private set; } = null!;

    /// <summary>Tenant that owns the VM.</summary>
    public TenantId TenantId { get; private set; } = null!;

    /// <summary>Current lifecycle state.</summary>
    public VmState State { get; private set; }

    /// <summary>Wall-clock instant when the VM entered <see cref="VmState.Provisioning" />.</summary>
    public DateTimeOffset? ProvisioningStartedAt { get; private set; }

    /// <summary>Last state transition timestamp.</summary>
    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>EF Core parameterless constructor — internal, not part of the public API.</summary>
    internal Vm()
    {
    }

    /// <summary>Constructs a new VM in the <see cref="VmState.Provisioning" /> state.</summary>
    /// <param name="id">Primary identifier.</param>
    /// <param name="tenantId">Tenant that owns the VM.</param>
    /// <param name="now">Wall-clock instant for the state transition (from injected <see cref="TimeProvider" />).</param>
    public Vm(VmId id, TenantId tenantId, DateTimeOffset now)
    {
        Id = id;
        TenantId = tenantId;
        State = VmState.Provisioning;
        ProvisioningStartedAt = now;
        UpdatedAt = now;
    }

    /// <summary>Applies a state transition if the state machine permits it.</summary>
    /// <param name="action">Requested action.</param>
    /// <param name="now">Wall-clock instant for the transition.</param>
    /// <param name="previousState">Output: the state before the transition (or <c>null</c> if unchanged).</param>
    /// <returns><see langword="true" /> if the transition was applied.</returns>
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
///     Exception raised when a VM action is requested against an unknown VM.
///     Stable <see cref="Code" /> for the global exception handler.
/// </summary>
public sealed class VmNotFoundException : Exception
{
    /// <summary>Stable machine-readable identifier for this failure class.</summary>
    public const string Code = "vm.not_found";

    /// <summary>Identifier of the VM that could not be found.</summary>
    public VmId VmId { get; }

    public VmNotFoundException(VmId vmId)
        : base($"VM '{vmId}' was not found.")
    {
        VmId = vmId;
    }
}

/// <summary>
///     Exception raised when a VM action would violate the state machine.
///     Stable <see cref="Code" /> for the global exception handler.
/// </summary>
public sealed class InvalidVmTransitionException : Exception
{
    /// <summary>Stable machine-readable identifier for this failure class.</summary>
    public const string Code = "vm.invalid_transition";

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
///     Repository contract for persisting VMs. All methods thread
///     <see cref="CancellationToken" /> as the last parameter.
/// </summary>
public interface IVmRepository
{
    /// <summary>Retrieves a VM by its identifier, or <see langword="null" /> if absent.</summary>
    /// <param name="vmId">Target VM identifier.</param>
    /// <param name="cancellationToken">Forwarded to the underlying query.</param>
    public Task<Vm?> GetByIdAsync(VmId vmId, CancellationToken cancellationToken = default);

    /// <summary>Lists VMs owned by the tenant, paginated.</summary>
    /// <param name="tenantId">Tenant scope.</param>
    /// <param name="pageNumber">1-based page number.</param>
    /// <param name="pageSize">Page size (capped by repository).</param>
    /// <param name="cancellationToken">Forwarded to the underlying query.</param>
    public Task<IReadOnlyCollection<Vm>> ListByTenantAsync(
        TenantId tenantId,
        int pageNumber,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>Persists the supplied VM.</summary>
    /// <param name="vm">Aggregate to persist.</param>
    /// <param name="cancellationToken">Forwarded to the underlying command.</param>
    public Task SaveAsync(Vm vm, CancellationToken cancellationToken = default);
}

/// <summary>
///     Application-level handler that processes a <see cref="VmActionCommand" />.
///     Uses primary constructor for DI; <see cref="TimeProvider" /> for
///     deterministic "now".
/// </summary>
/// <param name="repository">VM persistence contract.</param>
/// <param name="clock">Wall-clock source; injected for testability.</param>
/// <param name="logger">Structured logger.</param>
public sealed class VmActionHandler(
    IVmRepository repository,
    TimeProvider clock,
    ILogger<VmActionHandler> logger)
{
    /// <summary>
    ///     Processes the command and returns the resulting VM state.
    ///     Throws <see cref="VmNotFoundException" /> when the VM is absent;
    ///     throws <see cref="InvalidVmTransitionException" /> when the
    ///     state machine forbids the action.
    /// </summary>
    /// <param name="command">Action to apply.</param>
    /// <param name="cancellationToken">Forwarded to the repository.</param>
    public async Task<VmState> HandleAsync(VmActionCommand command, CancellationToken cancellationToken = default)
    {
        var vm = await repository.GetByIdAsync(command.VmId, cancellationToken)
            ?? throw new VmNotFoundException(command.VmId);

        if (!vm.TryTransit(command.Action, clock.GetUtcNow(), out _))
        {
            throw new InvalidVmTransitionException(command.VmId, vm.State, command.Action);
        }

        await repository.SaveAsync(vm, cancellationToken);

        logger.LogInformation(
            "Applied {Action} to VM {VmId}; new state is {State}",
            command.Action, vm.Id, vm.State);

        return vm.State;
    }
}
