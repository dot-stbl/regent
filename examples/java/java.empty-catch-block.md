# java.empty-catch-block

Empty `catch` blocks silently swallow exceptions.

## Why

A swallowed exception is invisible to operators. The symptom shows
up as a "stuck" downstream call without any diagnostic signal — no
log, no metric, no alert. The original cause is unrecoverable from
the symptoms alone.

## Pattern

```regex
\bcatch\s*\([^)]+\)\s*\{\s*\}
```

## Authoring

At minimum, log:

```java
try {
    charge(payment);
} catch (PaymentFailedException e) {
    LOG.warn("charge failed for payment {}", payment.id(), e);
    throw e;
}
```

If the error is genuinely expected (e.g. key-not-found), make it
explicit:

```java
try {
    return cache.get(id);
} catch (KeyNotFoundException e) {
    return Optional.empty();    // explicitly handled
}
```

If you genuinely need to swallow, add a `// FIXME` comment with the
ticket and accept the warning as a signal to revisit.