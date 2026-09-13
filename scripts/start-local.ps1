param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot ".local-runtime"
$secretPath = Join-Path $runtimeRoot "task-secret.txt"
$serverLog = Join-Path $runtimeRoot "server-$PID.log"
$devVarsPath = Join-Path $projectRoot ".dev.vars"
$healthUrl = "http://127.0.0.1:$Port/"

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

if (-not (Test-Path -LiteralPath $secretPath)) {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  $secret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  Set-Content -LiteralPath $secretPath -Value $secret -Encoding ascii -NoNewline
}

$taskSecret = (Get-Content -Raw -LiteralPath $secretPath).Trim()
if ($taskSecret.Length -lt 32) { throw "Local task secret is invalid." }
$devVars = @()
if (Test-Path -LiteralPath $devVarsPath) {
  foreach ($line in Get-Content -LiteralPath $devVarsPath) {
    $cleanLine = ($line -replace 'TASK_SECRET=.*$', '').Trim()
    if ($cleanLine) { $devVars += $cleanLine }
  }
}
$devVars += "TASK_SECRET=$taskSecret"
[System.IO.File]::WriteAllLines($devVarsPath, $devVars, (New-Object System.Text.UTF8Encoding($false)))

try {
  $health = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
  if ($health.StatusCode -eq 200) { exit 0 }
} catch {
  # The local server is not running yet.
}

$env:TASK_SECRET = $taskSecret
$env:WRANGLER_LOG_PATH = Join-Path $runtimeRoot "wrangler.log"
Set-Location -LiteralPath $projectRoot

"[$(Get-Date -Format o)] starting local server on port $Port" | Add-Content -LiteralPath $serverLog -Encoding utf8
& npx.cmd vinext dev --port $Port *>> $serverLog
