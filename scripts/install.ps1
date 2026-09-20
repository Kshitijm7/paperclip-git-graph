#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$TargetDir = (Join-Path (Split-Path -Parent (Get-Location).Path) "paperclip-git-graph"),
  [string]$Repo = "https://github.com/Kshitijm7/paperclip-git-graph",
  [string]$ApiBase,
  [string]$DataDir
)

$ErrorActionPreference = "Stop"

function Invoke-Paperclip {
  param([string[]]$Args)
  $extra = @()
  if ($ApiBase) { $extra += @("--api-base", $ApiBase) }
  if ($DataDir) { $extra += @("--data-dir", $DataDir) }
  $cli = Get-Command paperclipai -ErrorAction SilentlyContinue
  if ($cli) { & $cli.Source @Args @extra } else { & npx --yes paperclipai @Args @extra }
  if ($LASTEXITCODE -ne 0) { throw "paperclipai $($Args -join ' ') failed with exit code $LASTEXITCODE" }
}

if (Test-Path (Join-Path $TargetDir ".git")) {
  Write-Host "Updating existing checkout at $TargetDir"
  & git -C $TargetDir pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw "git pull failed" }
} else {
  Write-Host "Cloning $Repo into $TargetDir"
  & git clone $Repo $TargetDir
  if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
}

Push-Location $TargetDir
try {
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
  Invoke-Paperclip @("plugin", "install", $TargetDir)
} finally {
  Pop-Location
}

Write-Host "Installed. Bind a repository with scripts/bind-repo.ps1 -CompanyId <id> -Path <abs path>."
