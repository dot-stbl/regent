param(
  [string]$Title,
  [string]$BodyFile,
  [string]$Milestone,
  [string]$Labels
)

$ErrorActionPreference = "Stop"
$GH = "C:\Program Files\GitHub CLI\gh.exe"
$REPO = "dot-stbl/regent"

# Check if title already exists in the milestone (idempotency).
$milestoneNumber = if ($Milestone -eq "v0.2.1") { 1 } else { 2 }
$existing = & $GH api "repos/$REPO/issues?milestone=$milestoneNumber&state=all&per_page=100" --jq '.[].title' 2>$null

if ($existing -and ($existing -split "`n") -contains $Title) {
  Write-Output "SKIP: $Title"
  exit 0
}

# Use --body-file so the body is read from disk (avoids space-quoting issues
# in the inline body).
$labelArgs = @()
foreach ($label in ($Labels -split ",")) {
  $labelArgs += @("--label", $label)
}

# Print to terminal what we're doing (so the user can see progress).
Write-Output "Creating: $Title"

# Invoke gh with --body-file to avoid quoting issues with multiline bodies.
& $GH issue create --repo $REPO `
  --title $Title `
  --body-file $BodyFile `
  --milestone $Milestone `
  @labelArgs 2>&1 | Select-Object -Last 1
