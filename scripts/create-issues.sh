#!/usr/bin/env bash
# Create 22 GitHub issues for regent v0.2.1 + v0.3.0 plan.
# Issues #4-9 (fix pipeline sub-tasks) are sub-issues of #7 (already
# exists, assigned to v0.2.1).
#
# Idempotency: skip if an issue with the same title already exists in
# the milestone (avoids duplicates on re-run).

set -euo pipefail
REPO="dot-stbl/regent"
M2_1="v0.2.1"
M3_0="v0.3.0"
GH="${GH:-C:\Program Files\GitHub CLI\gh.exe}"

# Use the full path to gh (Windows path with spaces — quote it).
gh() { "$GH" "$@"; }

# Fetch existing issue titles per milestone (idempotency).
existing_v2_1=$("$GH" api "repos/${REPO}/issues?milestone=1&state=all&per_page=100" --jq '.[].title' 2>/dev/null || true)
existing_v3_0=$("$GH" api "repos/${REPO}/issues?milestone=2&state=all&per_page=100" --jq '.[].title' 2>/dev/null || true)

# Helper: create issue if title not already present.
create_if_new() {
  local title="$1"
  local body_file="$2"
  local milestone="$3"
  local labels="$4"
  local existing
  if [ "$milestone" = "$M2_1" ]; then existing="$existing_v2_1"; else existing="$existing_v3_0"; fi
  if grep -qxF "$title" <<< "$existing"; then
    echo "SKIP (exists): $title"
    return 0
  fi
  gh issue create --repo "$REPO" \
    --title "$title" \
    --body-file "$body_file" \
    --milestone "$milestone" \
    --label "$labels" 2>&1 | tail -1
}

# === v0.2.1 issues (10 new — #4-9 are inside #7) ===

create_if_new "YAML config support (.regentrc.yaml)" \
  "$(dirname "$0")/issues/01-yaml-config.md" \
  "$M2_1" "config"

create_if_new "JSON Schema output for \`regent llm schema --json\`" \
  "$(dirname "$0")/issues/02-json-schema-llm.md" \
  "$M2_1" "config,agent-contract"

create_if_new "Config diff (\`regent config show\` / \`regent config diff\`)" \
  "$(dirname "$0")/issues/03-config-diff.md" \
  "$M2_1" "config"

create_if_new "\`--format json\` output for agent consumption" \
  "$(dirname "$0")/issues/10-format-json.md" \
  "$M2_1" "cli,agent-contract"

create_if_new "\`--concurrency N\` flag" \
  "$(dirname "$0")/issues/11-concurrency-flag.md" \
  "$M2_1" "cli,performance"

create_if_new "Cache TTL" \
  "$(dirname "$0")/issues/12-cache-ttl.md" \
  "$M2_1" "cache"

create_if_new "Cache invalidation by rule" \
  "$(dirname "$0")/issues/13-cache-invalidate-rule.md" \
  "$M2_1" "cache"

create_if_new "\`STBL_REGENT_OUTPUT_CONTEXT_BUFFER\` is parsed but ignored by the runner" \
  "$(dirname "$0")/issues/15-context-buffer-env.md" \
  "$M2_1" "config,cli"

create_if_new "CI benchmark job in PRs" \
  "$(dirname "$0")/issues/16-ci-benchmark-prs.md" \
  "$M2_1" "ci"

create_if_new "Shipped example \`regent example copy\` produces a broken file" \
  "$(dirname "$0")/issues/01-example-copy-broken.md" \
  "$M2_1" "examples,bug"

# === v0.3.0 issues (10) ===

create_if_new "Plugin resolution (\`extends: '@scope/regent-rules-x'\`)" \
  "$(dirname "$0")/issues/17-plugin-resolution.md" \
  "$M3_0" "plugin,config"

create_if_new "Transform rule kind (.transform.ts)" \
  "$(dirname "$0")/issues/18-transform-kind.md" \
  "$M3_0" "kind,transform"

create_if_new "Whole-file programmatic rewrite" \
  "$(dirname "$0")/issues/19-whole-file-rewrite.md" \
  "$M3_0" "kind,transform"

create_if_new "Watch mode (\`regent check --watch\`)" \
  "$(dirname "$0")/issues/20-watch-mode.md" \
  "$M3_0" "cli,watch"

create_if_new "AST-aware rules (tree-sitter integration)" \
  "$(dirname "$0")/issues/21-ast-tree-sitter.md" \
  "$M3_0" "ast,future"

create_if_new "Rust pattern helpers" \
  "$(dirname "$0")/issues/22-rust-helpers.md" \
  "$M3_0" "examples,patterns"

create_if_new "Java pattern helpers" \
  "$(dirname "$0")/issues/23-java-helpers.md" \
  "$M3_0" "examples,patterns"

create_if_new "Go pattern helpers" \
  "$(dirname "$0")/issues/24-go-helpers.md" \
  "$M3_0" "examples,patterns"

create_if_new "Inline /** docs */ in core modules" \
  "$(dirname "$0")/issues/25-inline-docs.md" \
  "$M3_0" "docs"

create_if_new "Migration guide from eslint/biome/prettier" \
  "$(dirname "$0")/issues/26-migration-guides.md" \
  "$M3_0" "docs,migration"

echo ""
echo "=== Summary ==="
gh issue list --repo "$REPO" --milestone "$M2_1" --state all --json number,title --jq '.[] | "  v0.2.1 #\(.number): \(.title)"'
echo ""
gh issue list --repo "$REPO" --milestone "$M3_0" --state all --json number,title --jq '.[] | "  v0.3.0 #\(.number): \(.title)"'
