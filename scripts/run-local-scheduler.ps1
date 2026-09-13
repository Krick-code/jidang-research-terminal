$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot ".local-runtime"
$statePath = Join-Path $runtimeRoot "scheduler-state.json"
$schedulerLog = Join-Path $runtimeRoot "scheduler.log"
$startScript = Join-Path $PSScriptRoot "start-local.ps1"
$invokeScript = Join-Path $PSScriptRoot "invoke-local-task.ps1"
$healthUrl = "http://127.0.0.1:3000/"

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\JidangResearchScheduler", [ref]$createdNew)
if (-not $createdNew) { exit 0 }

function Write-SchedulerLog {
  param([string]$Message)
  "[$(Get-Date -Format o)] $Message" | Add-Content -LiteralPath $schedulerLog -Encoding utf8
}

function Test-LocalSite {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Start-LocalSiteIfNeeded {
  if (Test-LocalSite) { return }
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -Port 3000"
  Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WindowStyle Hidden
  Write-SchedulerLog "local server start requested"
}

function Read-State {
  if (-not (Test-Path -LiteralPath $statePath)) { return @{} }
  try {
    $value = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    $table = @{}
    $value.PSObject.Properties | ForEach-Object { $table[$_.Name] = [string]$_.Value }
    return $table
  } catch {
    Write-SchedulerLog "state file was invalid and has been reset"
    return @{}
  }
}

function Save-State {
  param([hashtable]$State)
  ($State | ConvertTo-Json) | Set-Content -LiteralPath $statePath -Encoding utf8
}

function Invoke-ScheduledResearchTask {
  param([string]$Task, [string]$StateKey, [hashtable]$State)
  $today = Get-Date -Format "yyyy-MM-dd"
  if ($State[$StateKey] -eq $today) { return }
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $invokeScript -Task $Task
    if ($LASTEXITCODE -eq 0) {
      $State[$StateKey] = $today
      Save-State $State
      Write-SchedulerLog "$Task completed"
    } else {
      Write-SchedulerLog "$Task returned exit code $LASTEXITCODE"
    }
  } catch {
    Write-SchedulerLog "$Task failed: $($_.Exception.Message)"
  }
}

try {
  Write-SchedulerLog "scheduler started for current Windows user"
  while ($true) {
    Start-LocalSiteIfNeeded
    $now = Get-Date
    $clock = $now.ToString("HH:mm")
    $weekday = [int]$now.DayOfWeek
    $state = Read-State
    if ($clock -ge "20:00") {
      Invoke-ScheduledResearchTask -Task "daily-evening" -StateKey "dailyEvening" -State $state
    }
    if ($weekday -ge 1 -and $weekday -le 5 -and $clock -ge "08:30" -and $clock -le "09:15") {
      Invoke-ScheduledResearchTask -Task "preopen" -StateKey "preopen" -State $state
    }
    if ($weekday -eq 6 -and $clock -ge "20:00") {
      Invoke-ScheduledResearchTask -Task "weekly-review" -StateKey "weeklyReview" -State $state
    }
    Start-Sleep -Seconds 30
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
