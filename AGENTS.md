# regent — agent operations

## Task tracking: GitHub Issues

All work items for `regent` live as **GitHub Issues** in
[`dot-stbl/regent`](https://github.com/dot-stbl/regent/issues), not in
this repository or in chat history.

**Authoritative source:** <https://github.com/dot-stbl/regent/issues>
— do NOT duplicate tasks in TODOs, plan files, or commit messages.

## Conventions

- **Open an issue before starting work.** Title is one line; the body
  follows the `## Context / ## Current behaviour / ## Expected
  behaviour / ## Acceptance criteria / ## References` template (see
  any recent issue for a worked example).
- **Assign the right milestone** at creation:
  - `v0.2.1` — incomplete work from v0.2 (blockers first)
  - `v0.3.0` — deferred features
- **Reference the issue in commit messages** —
  `Refs: #N` or `Fixes: #N`. The `Fixes:` form auto-closes on merge
  to `main` (when repository settings allow it).
- **Close the issue when the work lands.** `gh issue close N --comment
  "landed in <sha>"` is the canonical close — the comment preserves
  the audit trail. If the work spans multiple PRs, close via
  `gh issue comment N -b "shipped in <sha>"` from the last PR.
- **Reopen, don't supersede.** If a closed issue regresses or needs
  follow-up, reopen it with `gh issue reopen N` and link a new issue
  via `Depends on #N` / `Blocks #N` in the body. Do not silently
  re-create the same problem under a new number.

## Day-to-day commands

```sh
# What's open right now?
gh issue list --repo dot-stbl/regent --state open

# What's in v0.2.1 vs v0.3.0?
gh issue list --repo dot-stbl/regent --milestone "v0.2.1" --state all
gh issue list --repo dot-stbl/regent --milestone "v0.3.0" --state all

# Start a new one (use the body template from any existing issue)
gh issue create --repo dot-stbl/regent \
  --title "..." --body-file path/to/body.md \
  --milestone "v0.2.1" --label "config"

# Close with a comment
gh issue close 16 --repo dot-stbl/regent --comment "landed in abc1234"
```

## Why issues, not in-repo task files

This project has a single primary maintainer (lowern1ght) plus an
LLM agent in the loop. Both need a single, persistent, queryable
backlog that:

- outlives chat sessions and agent restarts,
- is searchable by milestone, label, and author,
- ties work to the git history via `Refs: #N` / `Fixes: #N`,
- surfaces open work on the GitHub repo page where the maintainer
  actually looks.

An in-repo `TODO.md` or `.planning/` directory duplicates the
source of truth and rots the moment the agent's working tree is
wiped.
