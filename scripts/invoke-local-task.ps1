param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("daily-evening", "preopen", "weekly-review")]
  [string]$Task,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot ".local-runtime"
$secretPath = Join-Path $runtimeRoot "task-secret.txt"
$eventLog = Join-Path $runtimeRoot "task-events.jsonl"
$startScript = Join-Path $PSScriptRoot "start-local.ps1"
$healthUrl = "http://127.0.0.1:$Port/"
$taskUrl = "http://127.0.0.1:$Port/api/tasks/dispatch"

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

function Test-LocalServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-LocalServer) -or -not (Test-Path -LiteralPath $secretPath)) {
  $startArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -Port $Port"
  Start-Process -FilePath "powershell.exe" -ArgumentList $startArguments -WindowStyle Hidden
  $ready = $false
  foreach ($attempt in 1..30) {
    Start-Sleep -Seconds 1
    if ((Test-LocalServer) -and (Test-Path -LiteralPath $secretPath)) { $ready = $true; break }
  }
  if (-not $ready) { throw "Local server did not become ready within 30 seconds." }
}

$taskSecret = (Get-Content -Raw -LiteralPath $secretPath).Trim()
if ($taskSecret.Length -lt 32) { throw "Local task secret is invalid." }

$headers = @{ Authorization = "Bearer $taskSecret" }
$body = @{ task = $Task } | ConvertTo-Json -Compress
try {
  $result = Invoke-RestMethod -Method Post -Uri $taskUrl -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 180
  $record = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString("o"); task = $Task; ok = $true; result = $result }
  ($record | ConvertTo-Json -Compress -Depth 8) | Add-Content -LiteralPath $eventLog -Encoding utf8
} catch {
  $record = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString("o"); task = $Task; ok = $false; error = $_.Exception.Message }
  ($record | ConvertTo-Json -Compress) | Add-Content -LiteralPath $eventLog -Encoding utf8
  throw
}
