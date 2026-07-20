# Create 22 GitHub issues for regent v0.2.1 + v0.3.0 plan.

$ErrorActionPreference = "Continue"
$script = Join-Path $PSScriptRoot "create-issue.ps1"

# Helper: build a single-line invocation
function Run-Issue {
  param([string]$Title, [string]$BodyFile, [string]$Milestone, [string]$Labels)
  & $script -Title $Title -BodyFile $BodyFile -Milestone $Milestone -Labels $Labels
}

# === v0.2.1 (10 new — #4-9 are sub-issues of #7 which already exists) ===
Run-Issue "YAML config support (.regentrc.yaml)" (Join-Path $PSScriptRoot "issues/01-yaml-config.md") "v0.2.1" "config"
Run-Issue "JSON Schema output for ``regent llm schema --json``" (Join-Path $PSScriptRoot "issues/02-json-schema-llm.md") "v0.2.1" "config,agent-contract"
Run-Issue "Config diff (``regent config show`` / ``regent config diff``)" (Join-Path $PSScriptRoot "issues/03-config-diff.md") "v0.2.1" "config"
Run-Issue "Shipped example ``regent example copy`` produces a broken file" (Join-Path $PSScriptRoot "issues/01-example-copy-broken.md") "v0.2.1" "examples,bug"
Run-Issue "``--format json`` output for agent consumption" (Join-Path $PSScriptRoot "issues/10-format-json.md") "v0.2.1" "cli,agent-contract"
Run-Issue "``--concurrency N`` flag" (Join-Path $PSScriptRoot "issues/11-concurrency-flag.md") "v0.2.1" "cli,performance"
Run-Issue "Cache TTL" (Join-Path $PSScriptRoot "issues/12-cache-ttl.md") "v0.2.1" "cache"
Run-Issue "Cache invalidation by rule" (Join-Path $PSScriptRoot "issues/13-cache-invalidate-rule.md") "v0.2.1" "cache"
Run-Issue "``STBL_REGENT_OUTPUT_CONTEXT_BUFFER`` is parsed but ignored by the runner" (Join-Path $PSScriptRoot "issues/15-context-buffer-env.md") "v0.2.1" "config,cli"
Run-Issue "CI benchmark job in PRs" (Join-Path $PSScriptRoot "issues/16-ci-benchmark-prs.md") "v0.2.1" "ci"

# === v0.3.0 (10) ===
Run-Issue "Plugin resolution (``extends: '@scope/regent-rules-x'``)" (Join-Path $PSScriptRoot "issues/17-plugin-resolution.md") "v0.3.0" "plugin,config"
Run-Issue "Transform rule kind (.transform.ts)" (Join-Path $PSScriptRoot "issues/18-transform-kind.md") "v0.3.0" "kind,transform"
Run-Issue "Whole-file programmatic rewrite" (Join-Path $PSScriptRoot "issues/19-whole-file-rewrite.md") "v0.3.0" "kind,transform"
Run-Issue "Watch mode (``regent check --watch``)" (Join-Path $PSScriptRoot "issues/20-watch-mode.md") "v0.3.0" "cli,watch"
Run-Issue "AST-aware rules (tree-sitter integration)" (Join-Path $PSScriptRoot "issues/21-ast-tree-sitter.md") "v0.3.0" "ast,future"
Run-Issue "Rust pattern helpers" (Join-Path $PSScriptRoot "issues/22-rust-helpers.md") "v0.3.0" "examples,patterns"
Run-Issue "Java pattern helpers" (Join-Path $PSScriptRoot "issues/23-java-helpers.md") "v0.3.0" "examples,patterns"
Run-Issue "Go pattern helpers" (Join-Path $PSScriptRoot "issues/24-go-helpers.md") "v0.3.0" "examples,patterns"
Run-Issue "Inline ``/** docs */`` in core modules" (Join-Path $PSScriptRoot "issues/25-inline-docs.md") "v0.3.0" "docs"
Run-Issue "Migration guide from eslint/biome/prettier" (Join-Path $PSScriptRoot "issues/26-migration-guides.md") "v0.3.0" "docs,migration"
