using System.Text.Json.Serialization;

namespace CloudPlatform.Vms;

/// <summary>
/// Strongly-typed identifier for a virtual machine.
/// </summary>
public readonly record struct VmId(Guid Value)
{
    /// <summary>Creates a new <see cref="VmId"/> with a freshly generated GUID.</summary>
    public static VmId New() => new(Guid.NewGuid());

    /// <summary>Returns the string form of the underlying GUID.</summary>
    public override string ToString() => Value.ToString();
}

/// <summary>
/// Strongly-typed identifier for a tenant (organisation) that owns VMs.
/// </summary>
public readonly record struct TenantId(Guid Value)
{
    /// <summary>Creates a new <see cref="TenantId"/> with a freshly generated GUID.</summary>
    public static TenantId New() => new(Guid.NewGuid());

    /// <summary>Returns the string form of the underlying GUID.</summary>
    public override string ToString() => Value.ToString();
}

/// <summary>
/// The lifecycle state of a VM as persisted by the control-plane.
/// </summary>
public enum VmState
{
    Provisioning = 0,
    Running = 1,
    Stopped = 2,
    Terminated = 3,
    Failed = 4
}

/// <summary>
/// The set of actions a user can request against a VM.
/// </summary>
public enum VmActionKind
{
    Start = 0,
    Stop = 1,
    Restart = 2,
    Terminate = 3,
    ForceTerminate = 4
}

/// <summary>
/// Command sent to the application layer that requests a state-changing action on a VM.
/// </summary>
/// <param name="Action">The kind of action to perform.</param>
/// <param name="VmId">The target VM.</param>
/// <param name="Reason">Optional human-readable reason (required for ForceTerminate).</param>
/// <param name="RequestedBy">User or system principal that initiated the action.</param>
public sealed record VmActionCommand(
    VmActionKind Action,
    VmId VmId,
    string? Reason,
    string RequestedBy)
{
    /// <summary>JSON-friendly constructor used by the minimal-API binding layer.</summary>
    [JsonConstructor]
    public VmActionCommand(VmActionKind Action, Guid VmId, string? Reason, string RequestedBy)
        : this(Action, new VmId(VmId), Reason, RequestedBy)
    {
    }
}

/// <summary>
/// HTTP request body for the VM action endpoint.
/// </summary>
public sealed record VmActionRequest(VmActionKind Action, string? Reason);
