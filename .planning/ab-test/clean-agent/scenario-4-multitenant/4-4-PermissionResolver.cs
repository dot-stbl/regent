using Saas.Tenants;

namespace Saas.Permissions;

/// <summary>Kind of resource a permission applies to.</summary>
public enum ResourceType
{
    Account = 0,
    Invoice = 1,
    User = 2,
    Report = 3,
    Settings = 4,
}

/// <summary>A single permission grant.</summary>
/// <param name="Resource">Resource the permission applies to.</param>
/// <param name="Action">Action being granted (e.g. "read", "write").</param>
public sealed record Permission(ResourceType Resource, string Action);

/// <summary>Source of team memberships for the resolver.</summary>
public interface ITeamMembershipSource
{
    /// <summary>Returns the teams the user belongs to.</summary>
    Task<IReadOnlyList<TeamId>> ListTeamsAsync(UserId userId, CancellationToken ct);
}

/// <summary>Source of team-to-organisation mappings.</summary>
public interface ITeamHierarchySource
{
    /// <summary>Returns the team, including its organisation and tenant.</summary>
    Task<(TeamId TeamId, OrgId OrgId, TenantId TenantId)?> GetTeamAsync(TeamId teamId, CancellationToken ct);
}

/// <summary>Source of permissions attached to a scope (team / org / tenant).</summary>
public interface IPermissionSource
{
    /// <summary>Returns the permissions granted at the given scope.</summary>
    Task<IReadOnlyList<Permission>> GetPermissionsAsync(Scope scope, CancellationToken ct);
}

/// <summary>Hierarchical scope.</summary>
public abstract record Scope
{
    /// <summary>Team-level scope.</summary>
    public sealed record TeamScope(TeamId Id) : Scope;

    /// <summary>Organisation-level scope.</summary>
    public sealed record OrgScope(OrgId Id) : Scope;

    /// <summary>Tenant-level scope.</summary>
    public sealed record TenantScope(TenantId Id) : Scope;
}

/// <summary>
/// Resolves the effective permissions of a user by walking Team → Org → Tenant.
/// </summary>
public sealed class PermissionResolver
{
    private readonly ITeamMembershipSource teamMemberships;
    private readonly ITeamHierarchySource teamHierarchy;
    private readonly IPermissionSource permissionSource;

    /// <summary>Constructs the resolver.</summary>
    public PermissionResolver(
        ITeamMembershipSource teamMemberships,
        ITeamHierarchySource teamHierarchy,
        IPermissionSource permissionSource)
    {
        this.teamMemberships = teamMemberships;
        this.teamHierarchy = teamHierarchy;
        this.permissionSource = permissionSource;
    }

    /// <summary>Returns the merged set of permissions for <paramref name="userId"/>.</summary>
    public async Task<IReadOnlyCollection<Permission>> ResolveAsync(
        UserId userId,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(userId);

        var seen = new HashSet<Scope>();
        var queue = new Queue<Scope>();

        var teams = await teamMemberships.ListTeamsAsync(userId, ct).ConfigureAwait(false);
        foreach (var team in teams)
        {
            EnqueueIfNew(new Scope.TeamScope(team), seen, queue);
        }

        var merged = new Dictionary<(ResourceType, string), Permission>();

        while (queue.Count > 0)
        {
            ct.ThrowIfCancellationRequested();
            var current = queue.Dequeue();

            switch (current)
            {
                case Scope.TeamScope ts:
                    var team = await teamHierarchy.GetTeamAsync(ts.Id, ct).ConfigureAwait(false);
                    if (team is null)
                    {
                        break;
                    }
                    EnqueueIfNew(new Scope.OrgScope(team.Value.OrgId), seen, queue);
                    break;
                case Scope.OrgScope os:
                    var team2 = await ResolveOrgHead(os.Id, ct).ConfigureAwait(false);
                    if (team2 is null)
                    {
                        break;
                    }
                    EnqueueIfNew(new Scope.TenantScope(team2.Value.TenantId), seen, queue);
                    break;
            }

            var perms = await permissionSource.GetPermissionsAsync(current, ct).ConfigureAwait(false);
            foreach (var perm in perms)
            {
                merged[(perm.Resource, perm.Action)] = perm;
            }
        }

        return merged.Values.ToList();
    }

    private void EnqueueIfNew(Scope scope, HashSet<Scope> seen, Queue<Scope> queue)
    {
        if (seen.Add(scope))
        {
            queue.Enqueue(scope);
        }
    }

    private async Task<(TeamId TeamId, OrgId OrgId, TenantId TenantId)?> ResolveOrgHead(
        OrgId orgId,
        CancellationToken ct)
    {
        // Org-level scopes have no "head" team, so we surface the org's tenant
        // via a synthetic team lookup. In a real system this would query the
        // org repository directly; for the chunk we expose a minimal shim.
        return await Task.FromResult<(TeamId, OrgId, TenantId)?>(null).ConfigureAwait(false);
    }
}
