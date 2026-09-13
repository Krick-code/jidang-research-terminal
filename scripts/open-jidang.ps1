param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot "start-local.ps1"
$healthUrl = "http://127.0.0.1:$Port/"

try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
  if ($response.StatusCode -eq 200) {
    Start-Process $healthUrl
    exit 0
  }
} catch {
  # Start the local service below.
}

$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -Port $Port"
Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden

for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      Start-Process $healthUrl
      exit 0
    }
  } catch {
    # Keep waiting while the development server starts.
  }
}

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
  "Jidang local service did not start within 30 seconds. Please check the project logs.",
  "Jidang startup failed",
  "OK",
  "Error"
) | Out-Null
exit 1
