param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)
$ErrorActionPreference = 'Stop'
# Skill layout: <repo>/skills/vision-bridge/scripts -> repo root is three levels up.
$scriptDir = $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $scriptDir))
$cli = Join-Path $repoRoot 'vision-bridge.js'
if (-not (Test-Path $cli)) {
    [Console]::Error.WriteLine('{"code":"NO_RUNTIME","nextSteps":"vision-bridge.js not found under the repo root; keep the skills/vision-bridge layout inside the repository, or run node vision-bridge.js directly with the full path."}')
    exit 78
}
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
    [Console]::Error.WriteLine('{"code":"NO_RUNTIME","nextSteps":"node.exe not found on PATH; install Node.js >= 20 from https://nodejs.org"}')
    exit 78
}
& node $cli @Rest
exit $LASTEXITCODE
