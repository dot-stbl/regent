# C# examples

| Rule | Kind | Description |
|------|------|-------------|
| [no-region-directive](./no-region-directive.md) | detect | ban `#region`/`#endregion` |
| [no-todo-without-owner](./no-todo-without-owner.md) | detect (review) | require ticket ref on TODO/FIXME |
| [async.configure-await](./async.configure-await.md) | detect + fix (`safe`, `replace`) | ban `.ConfigureAwait(false)` in app code; auto-delete the call |
| [exceptions.brace-style](./exceptions.brace-style.md) | detect + fix (`safe`, `function`) | move trailing `}` to its own line; function-form `--unsafe` only |
