#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CompanyId,
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$ApiBase,
  [string]$DataDir
)

$ErrorActionPreference = "Stop"

$full = [System.IO.Path]::GetFullPath($Path)
if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "Not a directory: $full" }
if (-not (Test-Path -LiteralPath (Join-Path $full ".git"))) { throw "No .git directory under $full" }

# the CLI parses --payload-json, so the path has to survive as a JSON string literal
$payload = @{ path = $full } | ConvertTo-Json -Compress

$pcArgs = @("plugin", "local-folder:set", "paperclip-git-graph", "repo", "-C", $CompanyId, "--payload-json", $payload)
if ($ApiBase) { $pcArgs += @("--api-base", $ApiBase) }
if ($DataDir) { $pcArgs += @("--data-dir", $DataDir) }

$cli = Get-Command paperclipai -ErrorAction SilentlyContinue
if ($cli) { & $cli.Source @pcArgs } else { & npx --yes paperclipai @pcArgs }
if ($LASTEXITCODE -ne 0) { throw "paperclipai local-folder:set failed with exit code $LASTEXITCODE" }

Write-Host "Bound repo folder for company $CompanyId to $full."
