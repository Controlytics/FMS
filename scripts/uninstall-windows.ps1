#requires -RunAsAdministrator
<#
.SYNOPSIS
    Top-level uninstaller -- stops and removes the DigiLog API + Web services.
    Mosquitto is left in place by default (operator may have other apps using
    it); pass -RemoveMosquitto to also stop and remove the Mosquitto service.

.PARAMETER RemoveMosquitto
    Also stop and remove the Mosquitto service. Note: the Mosquitto config in
    Program Files is left in place; the actual broker binary is not uninstalled.

.PARAMETER RemoveLogs
    Delete the logs/ directory after the services are gone.

.NOTES
    Run from elevated PowerShell. Idempotent -- services that are already gone
    are skipped silently.

    File is intentionally ASCII-only so PS 5.1 tokenises it correctly.
#>

[CmdletBinding()]
param(
    [switch]$RemoveMosquitto,
    [switch]$RemoveLogs
)

$ErrorActionPreference = 'Stop'
$Worktree = (Resolve-Path "$PSScriptRoot\..").Path

function Write-Step($msg) { Write-Host "`n[uninstall] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[uninstall] OK: $msg"  -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "[uninstall] WARN: $msg" -ForegroundColor Yellow }

# Resolve NSSM (best-effort -- uninstall via Get-Service + sc.exe also works
# for stopping; the NSSM remove command is needed to clean its config blob).
$NssmPath = (Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\NSSM.NSSM_*\nssm-*\win64\nssm.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $NssmPath) {
    $pinFile = Join-Path $Worktree 'nssm-path.txt'
    if (Test-Path $pinFile) { $NssmPath = (Get-Content $pinFile -Raw).Trim() }
}

# 1. DigiLog services
$digiServices = @('DigiLogAPI-Phase5', 'DigiLogWeb-Phase5')
foreach ($name in $digiServices) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Warn2 "Service $name not found -- already gone."
        continue
    }
    Write-Step "Stopping $name"
    if ($svc.Status -eq 'Running') {
        Stop-Service -Name $name -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
    if ($NssmPath) {
        & $NssmPath remove $name confirm 2>&1 | Out-Null
        Write-Ok "Removed $name (via NSSM)"
    } else {
        & sc.exe delete $name 2>&1 | Out-Null
        Write-Ok "Removed $name (via sc.exe -- NSSM not found, config blob may linger)"
    }
}

# 2. Mosquitto (opt-in)
if ($RemoveMosquitto) {
    $mq = Get-Service -Name 'mosquitto' -ErrorAction SilentlyContinue
    if (-not $mq) {
        Write-Warn2 'mosquitto service not found.'
    } else {
        Write-Step 'Stopping + removing mosquitto'
        if ($mq.Status -eq 'Running') {
            Stop-Service -Name 'mosquitto' -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        }
        & sc.exe delete 'mosquitto' 2>&1 | Out-Null
        Write-Ok 'mosquitto service removed (binary in Program Files left intact)'
    }
}

# 3. Logs (opt-in)
if ($RemoveLogs) {
    $logsDir = Join-Path $Worktree 'logs'
    if (Test-Path $logsDir) {
        Write-Step "Removing $logsDir"
        Remove-Item -Path $logsDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok 'Logs removed'
    }
}

Write-Host ""
Write-Host "[uninstall] DONE." -ForegroundColor Green
Write-Host "[uninstall] To reinstall: scripts\install-windows.ps1" -ForegroundColor Cyan
