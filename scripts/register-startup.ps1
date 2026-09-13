$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$schedulerScript = Join-Path $PSScriptRoot "run-local-scheduler.ps1"
$startupFolder = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupFolder "Jidang-Local-Scheduler.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$schedulerScript`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = "Jidang local research scheduler"
$shortcut.Save()

if (-not (Test-Path -LiteralPath $shortcutPath)) { throw "Startup shortcut was not created." }

$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$schedulerScript`""
Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WindowStyle Hidden

[pscustomobject]@{
  Shortcut = $shortcutPath
  SchedulerStarted = $true
}
