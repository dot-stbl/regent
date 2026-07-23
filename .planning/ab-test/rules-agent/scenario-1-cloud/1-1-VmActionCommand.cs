using System.Text.Json.Serialization;

namespace CloudPlatform.Vms;

/// <summary>
///     Strongly-typed identifier for a virtual machine. Wraps a <see cref="Guid" />
///     to prevent accidental mixing with other GUID-typed identifiers (TenantId,
///     ClusterId, …) at API boundaries.
/// </summary>
/// <param name="Value">Underlying GUID value.</param>
public readonly record struct VmId(Guid Value)
{
    /// <summary>Creates a new <see cref="VmId" /> with a freshly generated GUID.</summary>
    public static VmId New() => new(Guid.NewGuid());
}

/// <summary>
///     Strongly-typed identifier for a tenant (organisation) that owns VMs.
/// </summary>
/// <param name="Value">Underlying GUID value.</param>
public readonly record struct TenantId(Guid Value)
{
    /// <summary>Creates a new <see cref="TenantId" /> with a freshly generated GUID.</summary>
    public static TenantId New() => new(Guid.NewGuid());
}

/// <summary>
///     The lifecycle state of a VM as persisted by the control-plane.
/// </summary>
public enum VmState
{
    /// <summary>VM is being provisioned on a node.</summary>
    Provisioning = 0,
    /// <summary>VM is running on a node.</summary>
    Running = 1,
    /// <summary>VM is gracefully shut down.</summary>
    Stopped = 2,
    /// <summary>VM is permanently removed.</summary>
    Terminated = 3,
    /// <summary>VM is in a non-recoverable error state.</summary>
    Failed = 4
}

/// <summary>
///     The set of actions a user can request against a VM.
/// </summary>
public enum VmActionKind
{
    /// <summary>Transition a Stopped VM to Provisioning.</summary>
    Start = 0,
    /// <summary>Transition a Running VM to Stopped (graceful).</summary>
    Stop = 1,
    /// <summary>Transition a Running/Stopped VM to Provisioning (reboot).</summary>
    Restart = 2,
    /// <summary>Transition any VM to Terminated.</summary>
    Terminate = 3,
    /// <summary>Skip the <c>AllowedFrom</c> guard; used by admin recovery flows.</summary>
    ForceTerminate = 4
}

/// <summary>
///     Command sent to the application layer that requests a state-changing
///     action on a VM. Carries <see cref="RequestedBy" /> for audit.
/// </summary>
/// <param name="Action">The kind of action to perform.</param>
/// <param name="VmId">The target VM.</param>
/// <param name="Reason">Optional human-readable reason (required for <see cref="VmActionKind.ForceTerminate" />).</param>
/// <param name="RequestedBy">User or system principal that initiated the action.</param>
public sealed record VmActionCommand(
    VmActionKind Action,
    VmId VmId,
    string? Reason,
    string RequestedBy)
{
    /// <summary>
    ///     JSON-friendly constructor used by the minimal-API binding layer
    ///     when the wire payload uses raw GUIDs. Delegates to the primary
    ///     constructor with a strongly-typed <see cref="VmId" />.
    /// </summary>
    /// <param name="action">The kind of action to perform.</param>
    /// <param name="vmId">Raw VM GUID from the wire payload.</param>
    /// <param name="reason">Optional human-readable reason.</param>
    /// <param name="requestedBy">User or system principal that initiated the action.</param>
    [JsonConstructor]
    public VmActionCommand(
        VmActionKind action,
        Guid vmId,
        string? reason,
        string requestedBy)
        : this(action, new VmId(vmId), reason, requestedBy)
    {
    }
}

/// <summary>
///     HTTP request body for the VM action endpoint. Wire shape — does NOT
///     carry <c>VmId</c> (it's in the route) or <c>RequestedBy</c> (populated
///     from <c>ICurrentUser</c> in the controller).
/// </summary>
/// <param name="Action">The kind of action to perform.</param>
/// <param name="Reason">Optional human-readable reason.</param>
public sealed record VmActionRequest(VmActionKind Action, string? Reason);
