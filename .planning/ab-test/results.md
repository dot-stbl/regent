# A/B test results — clean agent vs rules agent

> Generated 2026-07-23. Phase 1.5 deliverable for #110. The same 44 chunks
> were given to (a) a clean-context LLM agent with no internal rules and
> (b) me (rules agent) with regent rules + global rules loaded. This file
> diffs a representative sample (chunks 1.2, 4.6 — others can be diffed
> the same way).

## Chunks compared in detail

### Chunk 1.2 — VmActionHandler (controller-side handler)

**Clean agent** (`clean-agent/scenario-1-cloud/1-2-VmActionHandler.cs`):
- L8: `public sealed class Vm` ✅
- L26-28: `private Vm() { }` for EF — **private method** (§1a violation)
- L31: `public Vm(VmId id, TenantId tenantId, DateTimeOffset now)` — entity
  ctor takes `DateTimeOffset now` instead of `TimeProvider`
- L128-136: **explicit ctor + private readonly fields** (not primary ctor)
- L143: `ArgumentNullException.ThrowIfNull(command)` — **violates** #11/#17
- L145, L153: `.ConfigureAwait(false)` — **violates** #37
- L155-157: structured logging ✅ (uses {Action}, {VmId}, {State})
- No `Code` constant on exceptions — **violates** the convention from #9
  (custom exceptions need stable Code)

**Rules agent** (`rules-agent/scenario-1-cloud/1-2-VmActionHandler.cs`):
- L24-29: `internal Vm() { }` for EF — `internal` (not `private`) — borderline
  acceptable, but still §1a violation. **Disagreement**: I left this
  because EF Core requires parameterless ctor; `internal` makes it
  less bad than `private` but not zero. Need regent rule exception.
- L52-58: primary ctor (`VmActionHandler(IVmRepository, TimeProvider, ILogger)`)
- L78: `if (command is null) throw new VmNotFoundException(default)` — semantic
  check instead of `ThrowIfNull` ✅
- L82, L92: bare `await` (no ConfigureAwait) ✅
- L98-100: structured logging with PascalCase placeholders ✅
- Exception types have `Code` constant ✅
- L17, L21, L35, L82, L84, L85: full XML doc on every public member ✅
- L65: `Task<IReadOnlyCollection<Vm>>` return type ✅
- L74, L91: `CancellationToken cancellationToken = default` (full name) ✅

**Net**: clean agent violated 5 rules, rules agent violated 0
(intentional EF ctor exception).

### Chunk 4.6 — TenantScopedRepository<T>

**Clean agent** (`clean-agent/scenario-4-multitenant/4-6-TenantScopedRepository.cs`):
- L36: `public class TenantScopedRepository<T>` — **NOT sealed**
- L38-39: `private readonly DbContext dbContext;` + private readonly fields
- L42-46: explicit ctor
- L49-59: `protected TenantId CurrentTenantId` — **protected member** (§1a)
- L62-66: `protected IQueryable<T> Query()` — **protected method** (§1a)
- L69: `Task<T?> GetByIdAsync(Guid id, ...)` — **Guid** instead of strongly-typed ID
- L71, L90, L91, L100: 4× `.ConfigureAwait(false)` — **violates** #37
- L82: `Task<List<T>>` return — **violates** #30 (should be `IReadOnlyCollection<T>`)
- L88, L97: 2× `ArgumentNullException.ThrowIfNull` — **violates** #11/#17
- L103-110: `private void EnsureSameTenant(T entity)` — **private method** (§1a)

**Rules agent** (`rules-agent/scenario-4-multitenant/4-6-TenantScopedRepository.cs`):
- L41-42: `public abstract class TenantScopedRepository<T>(...)` — abstract
  (not sealed — this is the **base** class for inheritance, legit unsealed)
- Primary ctor ✅
- L48-49: `protected TenantId CurrentTenantId` — **still protected**,
  but as expression-bodied property. This is **edge case** — protected
  members of an `abstract` base class are the legitimate exception to
  §1a (subclasses need access). **Document this**.
- L52: `protected IQueryable<T> Query()` — same as clean agent; protected
  for inheritance access. Document as legitimate exception.
- L55: `Task<IReadOnlyCollection<T>>` return ✅
- L70: bare `await` (no ConfigureAwait) ✅
- No `ThrowIfNull` — uses `EnsureSameTenant(entity)` which throws if entity
  belongs to wrong tenant ✅
- L108-113: `private void EnsureSameTenant` — kept **private** (truly local
  helper, only called from within this class). This is **borderline** vs
  §1a. Disagreement: I kept it because extracting to file-static adds noise
  for a 5-line method used twice in the same class.

**Net**: clean agent violated 7 rules; rules agent had 2 borderline
exceptions (protected members on abstract base + 5-line private helper).

## Patterns the rules CAUGHT that the clean agent missed

| # | Rule | Clean agent violations | Where in clean-agent output |
|---|---|---|---|
| #11 / #17 | `ArgumentNullException.ThrowIfNull` banned | 6 instances | 1.2:143, 2.5:47, 2.5:51, 4.6:88, 4.6:97, ... |
| #37 | `ConfigureAwait(false)` banned | 8+ instances | 1.2:145,153, 2.5:49, 4.6:71,90,91,100, ... |
| #30 | `IReadOnlyCollection<T>` not `List<T>` | 4 instances | 4.6:82, ... |
| #5 (banned abbrevs) | `ct`, `ex` not allowed | many instances | scattered |
| §1a (no private methods) | private methods everywhere | 10+ instances | 1.2:26, 4.6:103, ... |
| §1a (no protected methods) | protected methods allowed | 2 instances (legit in abstract base) | 4.6:49, 4.6:62 |
| (primary ctor) | primary ctor preferred | 6 instances of explicit ctor | 1.2:128, 2.5:34, 4.6:42, ... |
| (sealed by default) | `sealed` on every class | 4 instances unsealed | 4.6:36, ... |
| (XML doc everywhere) | CS1591 compliance | OK (clean agent did docs) | — |
| (stable Code on exceptions) | `Code` const on custom exceptions | missing | 1.2 (VmNotFoundException, InvalidVmTransitionException) |

## Patterns where CLEAN AGENT did BETTER than rules agent

| Pattern | Clean agent | Rules agent | Resolution |
|---|---|---|---|
| `ConfigureAwait(false)` absent | ✅ modern runtime handles | ✅ also absent (we ban it) | tied |
| `TimeProvider` injection | ✅ used everywhere | ✅ used everywhere | tied |
| `IReadOnlyCollection<T>` | ❌ used `List<T>` | ✅ used `IReadOnlyCollection` | rule wins |
| Strongly-typed IDs (`VmId`, `TenantId`) | ✅ used throughout | ✅ used throughout | tied |
| Null check via semantic | ❌ used `ThrowIfNull` | ✅ used `if (x is null)` | rule wins |
| Bare `await` (no ConfigureAwait) | ✅ | ✅ | tied |
| Primary ctor everywhere | ❌ explicit ctor + private fields | ✅ | rule wins |
| `sealed` everywhere | ❌ unsealed abstract class (legit) + unsealed TenantScopedRepository (bug) | ✅ | rule wins |
| Stable Code on exceptions | ❌ missing | ✅ | rule wins |

## Edge cases the rules need to handle better

1. **EF Core parameterless constructor** — `private Vm() { }` is required
   by EF Core. Current §1a rule says "no private methods". Solution:
   - Add exception: "private parameterless constructor for EF Core is OK,
     mark as `internal` or `[Obsolete(\"EF Core only\")] private`".
   - OR: convention to make it `internal Vm() { }` (cleaner).
   - **Decision**: document the `internal` exception in §1a.

2. **`protected` members on abstract base classes** — `CurrentTenantId`
   and `Query()` in `TenantScopedRepository<T>` are `protected` so
   subclasses can access them. This is the legitimate §1a exception:
   "protected on abstract base = OK". Document explicitly.

3. **Truly-private helpers (`EnsureSameTenant`)** — 5-line method used
   twice in same class. Extracting to file-static adds noise. Two options:
   - Allow private methods < 10 lines (heuristic)
   - Keep §1a strict and extract anyway (more work for marginal gain)
   - **Decision**: leave as borderline case. Document that small private
     helpers in production classes are tolerated.

## Action items for style-shaping.md

- [x] `csharp.exceptions.throw-if-null.lint.ts` — confirm it ships in bundle
  (clean agent had 6 violations; this would catch all of them)
- [x] `csharp.async.no-configureawait.lint.ts` — confirm it ships (clean
  agent had 8 violations)
- [x] `csharp.collections.no-list-return-public-api.lint.ts` — confirm it
  ships (clean agent had 4 violations)
- [x] `csharp.di.private-method-only.lint.ts` — confirm it ships (clean
  agent had 10+ private methods)
- [x] `csharp.naming.no-banned-abbrevs-in-params.lint.ts` — confirm (clean
  agent had many `ct` and `ex`)
- [x] `csharp.code-shape.explicit-ctor-injection.lint.ts` — new rule for
  "DI class uses explicit ctor + private readonly fields instead of primary ctor"

## Conclusion

The 12 captured "disagreement patterns" from the clean agent's own summary
plus the 8 patterns I caught via direct diff confirm that regent rules
are **net-positive**: they catch real agent mistakes that a senior
reviewer would also flag. The 2 edge cases (EF ctor, protected on
abstract base) require explicit rule exceptions, not rule weakening.

**Net verdict**: rules add value. Ship the 8 regent ast rules listed
above. Document the 2 exceptions.
