<#
.SYNOPSIS
  Registers the "DigiLog Certificate Check" Windows Task Scheduler job, which runs
  check-lan-cert.ps1 at startup and whenever a network connects. Called by
  install.ps1 (fresh) AND upgrade.ps1 (the installer's upgrade path never runs
  install.ps1), like register-backup-task.ps1.

.DESCRIPTION
  2026-10-31. Keeps the FMS's own HTTPS certificate covering the network range
  the server is on (see check-lan-cert.ps1), so moving the server to another
  range needs no one at the keyboard.

  Triggers: at startup (2 min delay, so the network and DigiLogAPI are up) and
  on Microsoft-Windows-NetworkProfile/Operational event 10000 = "connected to a
  network" (1 min delay, so DHCP has finished). No timer: nothing changes between
  those events, and a restart is only ever made when the certificate changed.

  Runs as SYSTEM (no stored password; it must write C:\ProgramData\DigiLog\certs
  and restart the service). Idempotent (-Force replaces the definition).
  NON-FATAL like the backup task: a missing check must not block an install,
  but it says so loudly.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\Program Files\DigiLog',
  [string]$DataRoot   = 'C:\ProgramData\DigiLog',
  [switch]$DryRun
)

$script   = Join-Path $InstallDir 'scripts\check-lan-cert.ps1'
$taskName = 'DigiLog Certificate Check'
$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -InstallDir `"$InstallDir`" -DataRoot `"$DataRoot`""

if ($DryRun) {
  Write-Host "[dry-run] register task '$taskName' (at startup + network connected, SYSTEM)" -ForegroundColor Yellow
  Write-Host "[dry-run]   powershell.exe $taskArgs" -ForegroundColor Yellow
  exit 0
}

try {
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
  $boot    = New-ScheduledTaskTrigger -AtStartup
  $boot.Delay = 'PT2M'
  $cls     = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace 'Root/Microsoft/Windows/TaskScheduler'
  $network = New-CimInstance -CimClass $cls -ClientOnly
  $network.Enabled = $true
  $network.Delay = 'PT1M'
  $network.Subscription = '<QueryList><Query Id="0" Path="Microsoft-Windows-NetworkProfile/Operational">' +
    '<Select Path="Microsoft-Windows-NetworkProfile/Operational">*[System[Provider[@Name=''Microsoft-Windows-NetworkProfile''] and EventID=10000]]</Select>' +
    '</Query></QueryList>'
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($boot, $network) `
    -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
} catch {
  Write-Host "WARN: could not register '$taskName': $($_.Exception.Message)" -ForegroundColor Yellow
}

# Verify by READ-BACK, not by the cmdlet's own return.
$t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($t -and @($t.Triggers).Count -eq 2) {
  Write-Host "==> Registered '$taskName' (at startup + when a network connects)" -ForegroundColor Cyan
  exit 0
}
Write-Host "WARN: '$taskName' is not registered. FMS runs, but after a move to another" -ForegroundColor Yellow
Write-Host "      network range use Start menu > FMS > Apply server addresses by hand." -ForegroundColor Yellow
exit 0
