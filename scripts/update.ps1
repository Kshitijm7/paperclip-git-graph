#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$TargetDir = (Split-Path -Parent $PSScriptRoot),
  [string]$ApiBase,
  [string]$DataDir
)

$ErrorActionPreference = "Stop"

function Invoke-Paperclip {
  param([string[]]$Args, [switch]$AllowFailure)
  $extra = @()
  if ($ApiBase) { $extra += @("--api-base", $ApiBase) }
  if ($DataDir) { $extra += @("--data-dir", $DataDir) }
  $cli = Get-Command paperclipai -ErrorAction SilentlyContinue
  if ($cli) { & $cli.Source @Args @extra } else { & npx --yes paperclipai @Args @extra }
  if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) { throw "paperclipai $($Args -join ' ') failed with exit code $LASTEXITCODE" }
  return $LASTEXITCODE
}

Push-Location $TargetDir
try {
  & git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw "git pull --ff-only failed; resolve the divergence first" }
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

  # upgrade is the in-place path; older hosts only know install, so fall back to it
  $code = Invoke-Paperclip @("plugin", "upgrade", "paperclip-git-graph") -AllowFailure
  if ($code -ne 0) { Invoke-Paperclip @("plugin", "install", $TargetDir) }
} finally {
  Pop-Location
}

Write-Host "Updated paperclip-git-graph at $TargetDir."
