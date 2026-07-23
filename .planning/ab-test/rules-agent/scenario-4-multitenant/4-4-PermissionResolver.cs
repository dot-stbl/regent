using Saas.Tenants;

namespace Saas.Permissions;

/// <summary>Kind of resource a permission applies to.</summary>
public enum ResourceType
{
    /// <summary>CRM account.</summary>
    Account = 0,
    /// <summary>Invoice / billing record.</summary>
    Invoice = 1,
    /// <summary>User record.</summary>
    User = 2,
    /// <summary>Report artefact.</summary>
    Report = 3,
    /// <summary>Tenant settings.</summary>
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
    /// <param name="userId">Target user.</param>
    /// <param name="cancellationToken">Forwarded to the underlying query.</param>
    public Task<IReadOnlyCollection<TeamId>> ListTeamsAsync(UserId userId, CancellationToken cancellationToken = default);
}

/// <summary>Source of org-to-tenant mappings.</summary>
public interface IOrgHierarchySource
{
    /// <summary>Returns the tenant that owns the org.</summary>
    /// <param name="orgId">Target org.</param>
    /// <param name="cancellationToken">Forwarded to the underlying query.</param>
    public Task<TenantId?> GetOrgTenantAsync(OrgId orgId, CancellationToken cancellationToken = default);
}

/// <summary>Source of permissions attached to a scope (team / org / tenant).</summary>
public interface IPermissionSource
{
    /// <summary>Returns the permissions granted at the given scope.</summary>
    /// <param name="scope">Target scope.</param>
    /// <param name="cancellationToken">Forwarded to the underlying query.</param>
    public Task<IReadOnlyCollection<Permission>> GetPermissionsAsync(Scope scope, CancellationToken cancellationToken = default);
}

/// <summary>
///     Hierarchical scope. Team-level scopes grant permissions to team members
///     only; Org-level grants extend to every team in the org; Tenant-level
///     grants extend to every org in the tenant.
/// </summary>
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
///     Resolves the effective permissions of a user by walking
///     Team → Org → Tenant and merging the permission grants at each scope.
/// </summary>
/// <param name="teamMemberships">Source of team memberships per user.</param>
/// <param name="orgHierarchy">Source of org-to-tenant mappings.</param>
/// <param name="permissionSource">Source of permissions per scope.</param>
public sealed class PermissionResolver(
    ITeamMembershipSource teamMemberships,
    IOrgHierarchySource orgHierarchy,
    IPermissionSource permissionSource)
{
    /// <summary>
    ///     Returns the merged set of permissions for <paramref name="userId" />.
    ///     Walks the scope hierarchy breadth-first, deduplicates scopes that are
    ///     reached via multiple paths.
    /// </summary>
    /// <param name="userId">Target user.</param>
    /// <param name="cancellationToken">Forwarded to the underlying sources.</param>
    public async Task<IReadOnlyCollection<Permission>> ResolveAsync(
        UserId userId,
        CancellationToken cancellationToken = default)
    {
        var seen = new HashSet<Scope>();
        var queue = new Queue<Scope>();
        var merged = new Dictionary<(ResourceType Resource, string Action), Permission>();

        foreach (var team in await teamMemberships.ListTeamsAsync(userId, cancellationToken))
        {
            Bfs.Enqueue(new Scope.TeamScope(team), seen, queue);
        }

        while (queue.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var current = queue.Dequeue();

            if (current is Scope.OrgScope orgScope
                && await orgHierarchy.GetOrgTenantAsync(orgScope.Id, cancellationToken) is { } tenantId)
            {
                Bfs.Enqueue(new Scope.TenantScope(tenantId), seen, queue);
            }

            foreach (var perm in await permissionSource.GetPermissionsAsync(current, cancellationToken))
            {
                merged[(perm.Resource, perm.Action)] = perm;
            }
        }

        return merged.Values;
    }
}

/// <summary>
///     BFS state holder helpers — file-static so production classes
///     don't carry a private method (per <c>code-shape.md</c> §1a).
/// </summary>
file static class Bfs
{
    /// <summary>
    ///     Enqueues <paramref name="scope" /> only if it has not been seen
    ///     before. Adds to <paramref name="seen" /> on first encounter.
    /// </summary>
    public static void Enqueue(Scope scope, HashSet<Scope> seen, Queue<Scope> queue)
    {
        if (seen.Add(scope))
        {
            queue.Enqueue(scope);
        }
    }
}
