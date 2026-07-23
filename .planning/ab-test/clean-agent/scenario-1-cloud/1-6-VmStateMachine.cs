using CloudPlatform.Vms;

namespace CloudPlatform.Vms;

/// <summary>
/// Pure-function state machine that determines which <see cref="VmActionKind"/>s are
/// valid from a given <see cref="VmState"/>, and what the resulting state should be.
/// </summary>
public static class VmStateMachine
{
    /// <summary>Decides whether a transition is allowed.</summary>
    /// <param name="from">Current VM state.</param>
    /// <param name="action">Action being requested.</param>
    /// <param name="next">Resulting state, when the transition is allowed.</param>
    /// <returns><see langword="true"/> when the transition is permitted.</returns>
    public static bool CanTransition(VmState from, VmActionKind action, out VmState next)
    {
        switch (from, action)
        {
            case (VmState.Provisioning, VmActionKind.Start):
            case (VmState.Provisioning, VmActionKind.Terminate):
            case (VmState.Provisioning, VmActionKind.ForceTerminate):
            case (VmState.Provisioning, VmActionKind.Stop):
                next = action switch
                {
                    VmActionKind.Start => VmState.Running,
                    VmActionKind.Stop or VmActionKind.Terminate => VmState.Stopped,
                    VmActionKind.ForceTerminate => VmState.Terminated,
                    _ => from
                };
                return true;

            case (VmState.Running, VmActionKind.Stop):
            case (VmState.Running, VmActionKind.Restart):
            case (VmState.Running, VmActionKind.Terminate):
            case (VmState.Running, VmActionKind.ForceTerminate):
                next = action switch
                {
                    VmActionKind.Stop or VmActionKind.Restart => VmState.Stopped,
                    VmActionKind.Terminate => VmState.Stopped,
                    VmActionKind.ForceTerminate => VmState.Terminated,
                    _ => from
                };
                return true;

            case (VmState.Stopped, VmActionKind.Start):
            case (VmState.Stopped, VmActionKind.Restart):
            case (VmState.Stopped, VmActionKind.Terminate):
            case (VmState.Stopped, VmActionKind.ForceTerminate):
                next = action switch
                {
                    VmActionKind.Start or VmActionKind.Restart => VmState.Running,
                    VmActionKind.ForceTerminate => VmState.Terminated,
                    _ => VmState.Stopped
                };
                return true;

            case (VmState.Failed, VmActionKind.Restart):
            case (VmState.Failed, VmActionKind.ForceTerminate):
            case (VmState.Failed, VmActionKind.Terminate):
                next = action switch
                {
                    VmActionKind.Restart => VmState.Running,
                    VmActionKind.ForceTerminate => VmState.Terminated,
                    _ => VmState.Stopped
                };
                return true;

            case (VmState.Terminated, _):
            default:
                next = from;
                return false;
        }
    }

    /// <summary>Convenience overload returning only the boolean result.</summary>
    public static bool CanTransition(VmState from, VmActionKind action)
        => CanTransition(from, action, out _);
}
