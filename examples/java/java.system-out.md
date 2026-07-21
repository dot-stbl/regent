# java.system-out

`System.out.println` / `System.err.println` in production code.

## Why

Stdout writes bypass the logger pipeline. Operators see unstructured
text while structured logs land in the aggregator. There's no level,
no sink configuration, no correlation id — incident triage starts
with "what does this string mean?".

## Pattern

```regex
\bSystem\.(out|err)\.print(ln)?\s*\(
```

Excludes paths: `**/test/**`, `**/tests/**`.

## Authoring

Replace with SLF4J (or JUL / Log4j):

```java
private static final Logger LOG = LoggerFactory.getLogger(OrderService.class);

LOG.info("shipping order id={}", order.id());
```

If you genuinely need a one-shot debug line in production, leave a
// FIXME with the issue ticket and accept the rule warning as a
signal to revisit.