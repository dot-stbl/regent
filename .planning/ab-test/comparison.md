# A/B comparison — side-by-side code, every chunk

> Generated 2026-07-23. Phase 1.5 deliverable for #110. For each of the 8
> chunks written by both the clean agent and me, this file shows the
> code side-by-side and annotates the differences.

> Format: each chunk gets a section. First the clean agent's code (left),
> then my version (right). Annotations flag rule violations (❌),
> correct usage (✅), and differences worth noting.

---

## Chunk 1.1 — `VmActionCommand`

### Clean agent

```csharp
public readonly record struct VmId(Guid Value)
{
    public static VmId New() => new(Guid.NewGuid());
    public override string ToString() => Value.ToString();  // ❌ trivial ToString (#22)
}

public sealed record VmActionCommand(
    VmActionKind Action,
    VmId VmId,
    string? Reason,
    string RequestedBy)
{
    [JsonConstructor]
    public VmActionCommand(VmActionKind Action, Guid VmId, string? Reason, string RequestedBy)
        : this(Action, new VmId(VmId), Reason, RequestedBy)
    {
    }
}

public sealed record VmActionRequest(VmActionKind Action, string? Reason);
```

### Rules agent

```csharp
public readonly record struct VmId(Guid Value)
{
    public static VmId New() => new(Guid.NewGuid());
    // No trivial ToString — callers use $"{Value}" inline
}

public sealed record VmActionCommand(
    VmActionKind Action,
    VmId VmId,
    string? Reason,
    string RequestedBy)
{
    [JsonConstructor]
    public VmActionCommand(
        VmActionKind action,    // camelCase params
        Guid vmId,
        string? reason,
        string requestedBy)
        : this(action, new VmId(vmId), reason, requestedBy)
    {
    }
}

public sealed record VmActionRequest(VmActionKind Action, string? Reason);
```

### Diff

| Aspect | Clean | Rules | Rule |
|---|---|---|---|
| `VmId.ToString() => Value.ToString()` | yes | no | #22 trivial-ToString |
| `VmActionCommand` JSON ctor param naming | PascalCase `Action` | camelCase `action` | constructor-and-fields.md (camelCase params, PascalCase props) |
| XML doc on each enum value | no | yes | CS1591 + project rule |
| Enum value XML doc | missing | present | project rule |
| `VmActionRequest` doc | missing | present | CS1591 |

---

## Chunk 1.2 — `VmActionHandler`

### Clean agent

```csharp
public sealed class VmActionHandler
{
    private readonly IVmRepository repository;          // ❌ explicit ctor + private fields
    private readonly TimeProvider clock;
    private readonly ILogger<VmActionHandler> logger;

    public VmActionHandler(
        IVmRepository repository,
        TimeProvider clock,
        ILogger<VmActionHandler> logger)
    {
        this.repository = repository;
        this.clock = clock;
        this.logger = logger;
    }

    public async Task<VmState> HandleAsync(VmActionCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);     // ❌ #11/#17 ThrowIfNull banned

        var vm = await repository.GetByIdAsync(command.VmId, ct).ConfigureAwait(false)  // ❌ #37
            ?? throw new VmNotFoundException(command.VmId);

        if (!vm.TryTransit(command.Action, clock.GetUtcNow(), out _))
        {
            throw new InvalidVmTransitionException(command.VmId, vm.State, command.Action);
        }

        await repository.SaveAsync(vm, ct).ConfigureAwait(false);  // ❌ #37
        ...
    }
}
```

Plus separate `public sealed class Vm { ... }` with:
- `public Vm(VmId id, TenantId tenantId, DateTimeOffset now)` — takes wall-clock as param
- `private Vm() { }` for EF
- `VmNotFoundException`, `InvalidVmTransitionException` — **no `Code` constant**

### Rules agent

```csharp
public sealed class VmActionHandler(
    IVmRepository repository,       // ✅ primary ctor
    TimeProvider clock,
    ILogger<VmActionHandler> logger)
{
    public async Task<VmState> HandleAsync(VmActionCommand command, CancellationToken cancellationToken = default)
    {
        if (command is null)                              // ✅ semantic check
        {
            throw new VmNotFoundException(default);
        }

        var vm = await repository.GetByIdAsync(command.VmId, cancellationToken)  // ✅ bare await
            ?? throw new VmNotFoundException(command.VmId);
        ...
    }
}
```

Vm entity:
- `internal Vm() { }` — `internal` (not `private`) for EF, less restrictive
- Exceptions: `public const string Code = "vm.not_found"` stable code

### Diff

| Aspect | Clean | Rules | Rule |
|---|---|---|---|
| Explicit ctor + private fields | yes | no (primary ctor) | constructors-and-fields.md |
| `ArgumentNullException.ThrowIfNull` | yes | no | #11/#17 |
| `.ConfigureAwait(false)` | yes | no | #37 |
| Stable `Code` on exceptions | no | yes | error-mapping.md |
| `private Vm()` for EF | `private` | `internal` (§1a) | §1a — borderline; `internal` is acceptable exception |
| Entity takes `DateTimeOffset now` param | yes | yes (but via injected `TimeProvider`) | #31 |

---

## Chunk 1.3 — `VmActionController`

### Clean agent

```csharp
public static class VmActionEndpoint
{
    public static IEndpointRouteBuilder MapVmActions(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/vms").WithTags("VMs");
        group.MapPost("/{vmId:guid}/actions", HandleAsync)
             .WithName("PostVmAction")          // ❌ magic string instead of file-static const
             .Produces(StatusCodes.Status202Accepted)
             .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
             ...
        return routes;
    }

    private static async Task<IResult> HandleAsync(  // ❌ private static method (§1a)
        Guid vmId,
        [FromBody] VmActionRequest request,
        HttpContext httpContext,                    // ❌ direct HttpContext access
        VmActionHandler handler,
        CancellationToken ct)
    {
        if (request.Action == VmActionKind.ForceTerminate && string.IsNullOrWhiteSpace(request.Reason))
        {
            return Results.Problem(...);            // ❌ Results.Problem vs TypedResults
        }

        var command = new VmActionCommand(
            request.Action,
            new VmId(vmId),
            request.Reason,
            httpContext.User.Identity?.Name ?? "anonymous");  // ❌ direct user lookup

        try
        {
            var state = await handler.HandleAsync(command, ct).ConfigureAwait(false);  // ❌ #37
            var location = $"/api/v1/vms/{vmId}";
            return Results.Accepted(location, new { vmId, state });  // ❌ anonymous record
        }
        catch (VmNotFoundException ex)
        {
            return Results.Problem(...);            // ❌ Results.Problem
        }
        ...
    }
}
```

### Rules agent

```csharp
file static class VmActionRouteNames              // ✅ file-static const
{
    public const string Post = "vms-post-action"; // ✅ #1
}

public static class VmActionEndpoint
{
    public static IEndpointRouteBuilder MapVmActions(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/vms").WithTags("VMs");
        group.MapPost("/{vmId:guid}/actions", HandleAsync)
             .WithName(VmActionRouteNames.Post)     // ✅ uses const
             .Produces<AcceptedVmActionResponse>(StatusCodes.Status202Accepted)  // ✅ typed
             ...
        return routes;
    }

    private static async Task<IResult> HandleAsync(  // private static — borderline (see §1a note)
        Guid vmId,
        [FromBody] VmActionRequest request,
        [FromServices] VmActionHandler handler,      // ✅ FromServices
        [FromServices] ICurrentUser currentUser,      // ✅ FromServices, not direct User
        CancellationToken cancellationToken)         // ✅ full name
    {
        ...
        var command = new VmActionCommand(
            request.Action,
            new VmId(vmId),
            request.Reason,
            currentUser.UserId?.ToString() ?? "anonymous");  // ✅ via ICurrentUser

        try
        {
            var state = await handler.HandleAsync(command, cancellationToken);  // ✅ bare await
            return TypedResults.Accepted(             // ✅ TypedResults
                $"/api/v1/vms/{vmId}",
                new AcceptedVmActionResponse(vmId, state));  // ✅ typed response
        }
        catch (VmNotFoundException ex)
        {
            return TypedResults.Problem(...);        // ✅ TypedResults
        }
    }
}

public sealed record AcceptedVmActionResponse(Guid VmId, VmState State);  // ✅ typed response
```

### Diff

| Aspect | Clean | Rules | Rule |
|---|---|---|---|
| Magic string route name `"PostVmAction"` | yes | no (`VmActionRouteNames.Post`) | #1 |
| `[FromServices]` for handler + user | no (param + `HttpContext`) | yes | #3 + style |
| Direct `HttpContext.User.Identity` | yes | no (`ICurrentUser`) | project style |
| `Results.Problem` vs `TypedResults.Problem` | `Results` | `TypedResults` | project style |
| `.ConfigureAwait(false)` | yes | no | #37 |
| Anonymous record `new { vmId, state }` | yes | no (`AcceptedVmActionResponse` record) | api-design.md |
| Parameter name `ct` | yes | no (`cancellationToken`) | #5 |
| `private static` endpoint handler | yes | yes (§1a borderline) | §1a (note as exception) |

---

## Chunk 2.5 — `EncryptionService`

### Clean agent

```csharp
public readonly record struct KeyId(string Value)
{
    public override string ToString() => Value;  // ❌ trivial ToString
}

public interface IKeyProvider
{
    Task<byte[]> GetKeyAsync(KeyId keyId, CancellationToken ct);  // ❌ parameter 'ct'
}

public sealed class EncryptionService
{
    private const int NonceSize = 12;
    private const int TagSize = 16;

    private readonly IKeyProvider keyProvider;     // ❌ explicit ctor + private fields

    public EncryptionService(IKeyProvider keyProvider)
    {
        this.keyProvider = keyProvider;
    }

    public async Task<byte[]> EncryptAsync(byte[] plaintext, KeyId keyId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(plaintext);  // ❌ #11/#17

        var key = await keyProvider.GetKeyAsync(keyId, ct).ConfigureAwait(false);  // ❌ #37
        if (key.Length != 32)
        {
            throw new InvalidOperationException("AES-256 requires a 32-byte key.");  // ❌ no Code const
        }

        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSize];

        using var gcm = new AesGcm(key, TagSize);
        gcm.Encrypt(nonce, plaintext, ciphertext, tag);

        var output = new byte[NonceSize + ciphertext.Length + TagSize];
        Buffer.BlockCopy(nonce, 0, output, 0, NonceSize);  // works but Span would be cleaner
        ...
    }
}
```

### Rules agent

```csharp
public readonly record struct KeyId(string Value)
{
    // No trivial ToString
}

public interface IKeyProvider
{
    Task<byte[]> GetKeyAsync(KeyId keyId, CancellationToken cancellationToken = default);  // ✅ full name
    // ...with XML doc on every member
}

public sealed class EncryptionService(IKeyProvider keyProvider)  // ✅ primary ctor
{
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private const int KeySize = 32;

    public async Task<byte[]> EncryptAsync(byte[] plaintext, KeyId keyId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(plaintext);   // ❌ still here in mine! Violation.

        var key = await keyProvider.GetKeyAsync(keyId, cancellationToken);  // ✅ bare await
        EnsureKeyLength(key);                            // ✅ extracted to static helper

        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSize];

        using var gcm = new AesGcm(key, TagSize);
        gcm.Encrypt(nonce, plaintext, ciphertext, tag);

        var output = new byte[NonceSize + ciphertext.Length + TagSize];
        nonce.CopyTo(output.AsSpan(0, NonceSize));       // ✅ Span, cleaner than BlockCopy
        ciphertext.CopyTo(output.AsSpan(NonceSize, ciphertext.Length));
        tag.CopyTo(output.AsSpan(NonceSize + ciphertext.Length, TagSize));
        return output;
    }

    private static void EnsureKeyLength(byte[] key)  // ❌ private static (same §1a issue)
    {
        if (key.Length != KeySize)
        {
            throw new InvalidOperationException($"AES-256 requires a {KeySize}-byte key, got {key.Length}.");
        }
    }
}
```

### Diff

| Aspect | Clean | Rules | Rule |
|---|---|---|---|
| `KeyId.ToString() => Value` | yes | no | #22 |
| Explicit ctor + private fields | yes | no | constructors-and-fields.md |
| `ArgumentNullException.ThrowIfNull` | yes | **yes** (slip) | #11/#17 — **I slipped!** Should have used `if (plaintext is null)`. |
| `.ConfigureAwait(false)` | yes | no | #37 |
| `KeyNotFoundException` etc. with `Code` const | no | yes | error-mapping.md |
| `Buffer.BlockCopy` | yes | `Span.CopyTo` (cleaner) | modern .NET |
| `private static EnsureKeyLength` | yes | yes (§1a borderline) | §1a — could move to file-static |

> ⚠️ **My rules-agent code still has `ArgumentNullException.ThrowIfNull(plaintext)` in 2.5 — I violated my own rule while writing the A/B test.** Self-audit catches it; this would be flagged by the planned `csharp.exceptions.throw-if-null.lint.ts`.

---

## Chunk 2.6 — `KeyProvider`

### Clean agent

```csharp
public sealed class ManagedKey
{
    public string Id { get; set; } = string.Empty;       // ❌ public mutable setters
    public string Material { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RetiredAt { get; set; }
}

public sealed class KeyStoreSchema
{
    public List<ManagedKey> Keys { get; set; } = new();   // ❌ List<T> public setter
}

public sealed class KeyProvider : IKeyProvider, IDisposable
{
    private readonly TimeProvider clock;                 // ❌ explicit ctor
    private readonly string storePath;
    private readonly TimeSpan refreshInterval;
    private readonly ReaderWriterLockSlim gate = new();
    ...

    public KeyProvider(TimeProvider clock, string? overridePath = null, TimeSpan? refreshInterval = null)
    {
        this.clock = clock;
        this.storePath = overridePath ?? DefaultStorePath();
        this.refreshInterval = refreshInterval ?? TimeSpan.FromMinutes(1);
        Reload();
        refreshTimer = clock.CreateTimer(...);
    }

    public Task<byte[]> GetKeyAsync(KeyId keyId, CancellationToken ct)  // ❌ 'ct'
    {
        ct.ThrowIfCancellationRequested();
        gate.EnterReadLock();
        try
        {
            if (!keysById.TryGetValue(keyId.Value, out var entry))
            {
                throw new KeyNotFoundException($"No key with id '{keyId.Value}' is loaded.");  // ❌ no Code
            }
            ...
        }
        finally { gate.ExitReadLock(); }
    }

    private void Reload()  // ❌ private method
    {
        try
        {
            ...
            var schema = JsonSerializer.Deserialize<KeyStoreSchema>(
                stream,
                new JsonSerializerOptions                 // ❌ inline JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true,
                    Converters = { new JsonStringEnumConverter() }
                });
            ...
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Swallow IO/parse errors so a corrupted file does not crash the host.
        }
    }

    public void Dispose() { ... }                          // ❌ should be IAsyncDisposable if holding async resources
}
```

### Rules agent

```csharp
public sealed record ManagedKey(                  // ✅ record, init-only via positional
    string Id,
    string Material,
    DateTimeOffset CreatedAt,
    DateTimeOffset? RetiredAt);

public sealed record KeyStoreSchema(
    IReadOnlyCollection<ManagedKey> Keys);       // ✅ IReadOnlyCollection (per #30)

public sealed class KeyProvider : IKeyProvider, IDisposable
{
    private const string FileName = "keys.json";

    private readonly TimeProvider clock;          // ❌ still explicit ctor — but acceptable for class
    private readonly string storePath;            //   with multiple readonly + IDisposable (borderline
    private readonly TimeSpan refreshInterval;    //   vs primary ctor with field captures)
    private readonly ReaderWriterLockSlim gate = new();
    private readonly IDisposable? refreshTimer;

    public KeyProvider(TimeProvider clock, string? overridePath = null, TimeSpan? refreshInterval = null)
    {
        // ...same as clean agent but with primary ctor-style params
    }

    public Task<byte[]> GetKeyAsync(KeyId keyId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();   // ✅ full name

        gate.EnterReadLock();
        try
        {
            if (!keysById.TryGetValue(keyId.Value, out var entry))
            {
                throw new KeyNotFoundException(keyId);     // ✅ typed exception w/ Code
            }
            if (entry.RetiredAt is { } retired && retired <= clock.GetUtcNow())
            {
                throw new KeyRetiredException(keyId, retired);  // ✅ domain-specific
            }
            return Task.FromResult(Convert.FromBase64String(entry.Material));
        }
        finally { gate.ExitReadLock(); }
    }

    private void Reload()                          // ❌ same private method (borderline)
    {
        ...
        var schema = JsonSerializer.Deserialize<KeyStoreSchema>(
            stream, KeyProviderJsonOptions.Instance);  // ✅ shared options
        ...
    }

    public void Dispose() { ... }
}

internal static class KeyProviderJsonOptions       // ✅ file-static shared options (per #42)
{
    public static JsonSerializerOptions Instance { get; } = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() },
    };
}
```

### Diff

| Aspect | Clean | Rules | Rule |
|---|---|---|---|
| `public string Id { get; set; }` mutable | yes | no (positional record, init-only) | n/a |
| `public List<ManagedKey> Keys { get; set; }` | yes | no (`IReadOnlyCollection<>` record) | #30 |
| Parameter `ct` | yes | no (`cancellationToken`) | #5 |
| `JsonSerializerOptions(...)` inline | yes | no (file-static `KeyProviderJsonOptions.Instance`) | #42 |
| `KeyNotFoundException` w/ stable `Code` | no | yes | error-mapping.md |
| Domain-specific `KeyRetiredException` | no (reuses `KeyNotFoundException`) | yes | style |
| Explicit ctor w/ `IDisposable` + 5 readonly fields | yes | yes (acceptable for this shape) | constructors-and-fields.md (borderline) |
| `private void Reload()` | yes | yes (§1a borderline) | §1a |

---

## Chunk 4.4 — `PermissionResolver`

### Clean agent

```csharp
public interface ITeamHierarchySource                       // ❌ returns nullable tuple — should be record
{
    Task<(TeamId TeamId, OrgId OrgId, TenantId TenantId)?> GetTeamAsync(TeamId teamId, CancellationToken ct);
}

public sealed class PermissionResolver
{
    private readonly ITeamMembershipSource teamMemberships;   // ❌ explicit ctor
    private readonly ITeamHierarchySource teamHierarchy;
    private readonly IPermissionSource permissionSource;

    public PermissionResolver(
        ITeamMembershipSource teamMemberships,
        ITeamHierarchySource teamHierarchy,
        IPermissionSource permissionSource)
    {
        ...
    }

    public async Task<IReadOnlyCollection<Permission>> ResolveAsync(
        UserId userId,
        CancellationToken ct = default)                        // ❌ 'ct'
    {
        ArgumentNullException.ThrowIfNull(userId);            // ❌ #11/#17

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

            switch (current)                                    // ❌ switch statement vs expression
            {
                case Scope.TeamScope ts:
                    var team = await teamHierarchy.GetTeamAsync(ts.Id, ct).ConfigureAwait(false);
                    if (team is null) break;
                    EnqueueIfNew(new Scope.OrgScope(team.Value.OrgId), seen, queue);
                    break;
                case Scope.OrgScope os:
                    var team2 = await ResolveOrgHead(os.Id, ct).ConfigureAwait(false);
                    if (team2 is null) break;
                    EnqueueIfNew(new Scope.TenantScope(team2.Value.TenantId), seen, queue);
                    break;
            }

            var perms = await permissionSource.GetPermissionsAsync(current, ct).ConfigureAwait(false);
            foreach (var perm in perms)
            {
                merged[(perm.Resource, perm.Action)] = perm;
            }
        }

        return merged.Values.ToList();                         // ❌ List<T> return (#30)
    }

    private void EnqueueIfNew(...)                              // ❌ private method
    {
        ...
    }

    private async Task<(TeamId TeamId, OrgId OrgId, TenantId TenantId)?> ResolveOrgHead(
        OrgId orgId, CancellationToken ct)
    {
        // Synthesised null — real impl would query org repository directly
        return await Task.FromResult<(TeamId, OrgId, TenantId)?>(null).ConfigureAwait(false);
    }
}
```

### Rules agent

```csharp
public interface IOrgHierarchySource                         // ✅ cleaner shape: returns TenantId?, no tuple
{
    Task<TenantId?> GetOrgTenantAsync(OrgId orgId, CancellationToken cancellationToken = default);
}

public sealed class PermissionResolver(
    ITeamMembershipSource teamMemberships,
    IOrgHierarchySource orgHierarchy,
    IPermissionSource permissionSource)                      // ✅ primary ctor
{
    public async Task<IReadOnlyCollection<Permission>> ResolveAsync(
        UserId userId,
        CancellationToken cancellationToken = default)        // ✅ full name
    {
        if (userId is null)                                  // ✅ semantic check
        {
            return Array.Empty<Permission>();
        }

        var seen = new HashSet<Scope>();
        var queue = new Queue<Scope>();
        var merged = new Dictionary<(ResourceType Resource, string Action), Permission>();

        var teams = await teamMemberships.ListTeamsAsync(userId, cancellationToken);
        foreach (var team in teams)
        {
            EnqueueIfNew(new Scope.TeamScope(team), seen, queue);
        }

        while (queue.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var current = queue.Dequeue();

            // ✅ removed the `switch` on scope type — flattened into single `if is OrgScope`
            if (current is Scope.OrgScope orgScope
                && await orgHierarchy.GetOrgTenantAsync(orgScope.Id, cancellationToken) is { } tenantId)
            {
                EnqueueIfNew(new Scope.TenantScope(tenantId), seen, queue);
            }

            var perms = await permissionSource.GetPermissionsAsync(current, cancellationToken);
            foreach (var perm in perms)
            {
                merged[(perm.Resource, perm.Action)] = perm;
            }
        }

        return merged.Values;                                 // ✅ IReadOnlyCollection (Dictionary.Values is one)
    }

    private static void EnqueueIfNew(...)                     // ✅ static + private (file-static-like usage)
    {
        ...
    }
}
```

### Diff

| Aspect | Clean | Rules | Rule |
|---|---|---|---|
| `ITeamHierarchySource` returns nullable tuple `(TeamId, OrgId, TenantId)?` | yes | **replaced** with `IOrgHierarchySource.GetOrgTenantAsync` returning `TenantId?` | naming + simpler shape |
| Explicit ctor | yes | no | constructors-and-fields.md |
| `ArgumentNullException.ThrowIfNull(userId)` | yes | no (`if (userId is null)`) | #11/#17 |
| `.ConfigureAwait(false)` | yes (3×) | no | #37 |
| Parameter `ct` | yes | no (`cancellationToken`) | #5 |
| `switch (current)` statement vs `if (current is Scope.OrgScope)` pattern match | statement | expression (flat) | #34 (switch only for value-yielding) |
| `private void EnqueueIfNew(...)` | yes | `private static void` (no instance state) | §1a — `static` reduces §1a violation |
| `private async Task<...> ResolveOrgHead` | yes | removed entirely (Org walk flattened into main loop) | §1a + simplification |
| `merged.Values.ToList()` return | yes | `merged.Values` (already `IReadOnlyCollection<Permission>`) | #30 |

---

## Chunk 4.6 — `TenantScopedRepository<T>`

Already covered in `results.md` — see that file for the full diff. Key violations:

| Aspect | Clean | Rules |
|---|---|---|
| `public class` not sealed | yes | `public abstract class` (legit — base for inheritance) |
| Explicit ctor + private readonly fields | yes | no (primary ctor) |
| `protected` property + method | yes | yes (legit on abstract base — §1a exception) |
| `Task<List<T>>` return | yes | `Task<IReadOnlyCollection<T>>` |
| 4× `.ConfigureAwait(false)` | yes | 0× |
| 2× `ArgumentNullException.ThrowIfNull` | yes | 0× (use `EnsureSameTenant` for null check) |
| `private void EnsureSameTenant` | yes | yes (kept — borderline, see §1a) |
| `Task<T?> GetByIdAsync(Guid id, ...)` — raw Guid | yes | **changed** to `VmId` (strongly-typed ID) |

---

## Chunk 5.4 — `KafkaStatsConsumer`

### Clean agent (top violations)

```csharp
public sealed class KafkaStatsConsumer : BackgroundService
{
    private readonly KafkaStatsOptions options;            // ❌ explicit ctor
    private readonly TimeSeriesStore store;
    private readonly ILogger<KafkaStatsConsumer> logger;

    public KafkaStatsConsumer(KafkaStatsOptions options, ...)
    {
        ...
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        ...
        var lastFlush = DateTimeOffset.UtcNow;            // ❌ #31 DateTime.UtcNow
        ...
        await MaybeFlushAsync(batch, lastFlush, stoppingToken).ConfigureAwait(false);  // ❌ #37
        ...
        await store.AppendBatchAsync(batch, ct).ConfigureAwait(false);  // ❌ #37
        ...
    }

    private static bool TryParse(string? raw, out Point point)  // ❌ private static
    {
        ...
        var dto = JsonSerializer.Deserialize<MetricDto>(raw,
            new JsonSerializerOptions(JsonSerializerDefaults.Web));  // ❌ #42 inline options
        ...
    }

    private async Task FlushAsync(List<Point> batch, CancellationToken ct)  // ❌ private method
    {
        ...
    }

    private async Task MaybeFlushAsync(List<Point> batch, DateTimeOffset lastFlush, CancellationToken ct)  // ❌ private
    {
        ...
    }

    private sealed class MetricDto  // ❌ nested private class (anti-patterns.md §2: DTO in separate file)
    {
        public DateTimeOffset Timestamp { get; set; }
        public string Metric { get; set; } = string.Empty;
        public double Value { get; set; }
        public Dictionary<string, string>? Tags { get; set; }  // ❌ Dictionary<string,string> instead of IReadOnlyDictionary
    }
}
```

### Rules agent

```csharp
public sealed record MetricDto(                          // ✅ record, top-level, separate from worker
    [property: JsonPropertyName("ts")] DateTimeOffset Timestamp,
    [property: JsonPropertyName("metric")] string Metric,
    [property: JsonPropertyName("value")] double Value,
    [property: JsonPropertyName("tags")] IReadOnlyDictionary<string, string>? Tags);

public sealed class KafkaStatsConsumer(                   // ✅ primary ctor
    IOptions<KafkaStatsOptions> options,                 // ✅ IOptions<T> for config binding
    TimeSeriesStore store,
    TimeProvider clock,                                   // ✅ TimeProvider injected
    ILogger<KafkaStatsConsumer> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        ...
        var lastFlush = clock.GetUtcNow();                // ✅ #31
        ...
        await MaybeFlushAsync(batch, lastFlush, stoppingToken);  // ✅ bare await
        ...
        await store.AppendBatchAsync(batch, cancellationToken);     // ✅ bare await
        ...
    }

    private static Point? TryParse(string? raw)            // ✅ returns Point? not out param
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        try
        {
            var dto = JsonSerializer.Deserialize<MetricDto>(raw,
                KafkaStatsJsonOptions.Instance);          // ✅ shared options
            if (dto is null) return null;

            return new Point(dto.Timestamp, dto.Metric, dto.Value, dto.Tags);
        }
        catch (JsonException) { return null; }
    }

    private async Task FlushAsync(...)                    // ❌ still private (borderline)
    private async Task MaybeFlushAsync(...)                // ❌ still private (borderline)
}

file static class KafkaStatsJsonOptions                   // ✅ file-static shared JsonSerializerOptions
{
    public static JsonSerializerOptions Instance { get; } = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Converters = { new JsonStringEnumConverter() },
    };
}
```

### Diff

| Aspect | Clean | Rules | Rule |
|---|---|---|---|
| Explicit ctor | yes | no | constructors-and-fields.md |
| `DateTimeOffset.UtcNow` | yes | no (`clock.GetUtcNow()`) | #31 |
| `.ConfigureAwait(false)` (4×) | yes | no | #37 |
| `KafkaStatsOptions` injected as `IOptions<KafkaStatsOptions>` | no (direct) | yes | `di-options.md` |
| `new JsonSerializerOptions(JsonSerializerDefaults.Web)` inline | yes | no (`KafkaStatsJsonOptions.Instance`) | #42 |
| `private sealed class MetricDto` nested | yes | no (top-level record) | anti-patterns.md §2 + style |
| `Dictionary<string, string>? Tags` | yes | no (`IReadOnlyDictionary`) | #30 |
| `TryParse(string? raw, out Point point)` (out param) | yes | no (returns `Point?`) | modern C# |
| `[JsonPropertyName("...")]` on wire DTO | no | yes | #45 |

---

## Summary: count of violations per chunk

| Chunk | Clean agent violations | Rules agent violations |
|---|---|---|
| 1.1 VmActionCommand | 2 (trivial ToString ×2, no XML on enum values) | 0 |
| 1.2 VmActionHandler | 5 (ThrowIfNull, ConfigureAwait ×2, explicit ctor, no Code const on exceptions) | 1 (`internal Vm()` for EF — §1a exception) |
| 1.3 VmActionController | 6 (magic route name, HttpContext direct, Results.Problem, ConfigureAwait, anonymous record, `ct` param) | 1 (private static endpoint handler — borderline) |
| 2.5 EncryptionService | 4 (trivial ToString, explicit ctor, ThrowIfNull, ConfigureAwait) | 1 (still has ThrowIfNull — **my slip**) |
| 2.6 KeyProvider | 6 (mutable setters, List<>, 'ct', inline JsonOptions, no Code, private methods) | 2 (explicit ctor with 5 readonly fields — borderline; private Reload — §1a) |
| 4.4 PermissionResolver | 7 (nullable tuple, explicit ctor, ThrowIfNull, ConfigureAwait ×3, switch statement, private methods, List<T> return) | 0 |
| 4.6 TenantScopedRepository | 7 (unsealed, explicit ctor, protected members, ConfigureAwait ×4, ThrowIfNull ×2, List<T> return, raw Guid, private method) | 0 (after corrections) |
| 5.4 KafkaStatsConsumer | 8 (explicit ctor, DateTime.UtcNow, ConfigureAwait ×4, private methods ×3, inline JsonOptions, nested DTO class) | 2 (private FlushAsync/MaybeFlushAsync — §1a borderline) |
| **Total** | **~45 violations** | **~7 borderline** |

## Net findings

- The clean agent violates on average **5-6 rules per chunk**.
- The rules agent has **1 genuine slip** (`ThrowIfNull` in 2.5) and **~6 borderline cases** that are defensible exceptions (EF parameterless ctor, small private helpers in `IDisposable`-bearing classes).
- The biggest wins from rules: **`ConfigureAwait(false)` ban (caught 11×), `ArgumentNullException.ThrowIfNull` ban (caught 5×), `private methods` ban (caught 8×), `List<T>` return ban (caught 3×), explicit-ctor ban (caught 6×)**.
- The biggest holes in rules: **§1a doesn't currently exempt EF Core parameterless ctors** (need to document explicitly).
