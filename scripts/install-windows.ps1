#requires -RunAsAdministrator
<#
.SYNOPSIS
    Top-level Windows orchestration installer. Builds the repo, sets up
    Mosquitto, registers + starts the DigiLog API + Web services, then probes
    /health.

.DESCRIPTION
    Closes the Phase 5+ open item ("Windows-service launcher full automation")
    by tying together the existing piecemeal scripts:

      - scripts/install-mosquitto.ps1         (idempotent Mosquitto setup)
      - scripts/install-services-phase5.ps1   (NSSM-managed API + Web services)

    What this script does, in order:

      1. Sanity-check tooling: PowerShell 5.1+, Node, psql/PostgreSQL,
         NSSM (or winget-install on demand).
      2. Build:
           - packages/shared    (tsc)
           - apps/api           (tsc -> dist)
           - apps/web           (vite build -> dist)
         Skip with -SkipBuild if the artefacts are already current.
      3. Install/refresh Mosquitto via install-mosquitto.ps1 (skipped if the
         service is already running, unless -ReinstallMosquitto is given).
      4. Register the API + Web services via install-services-phase5.ps1.
      5. Start API + Web services.
      6. Probe https://localhost:3000/health and http://localhost:5175/.

    Idempotent: re-running on an existing install rebuilds, refreshes the
    service registrations (existing services are stopped + removed first),
    and restarts. No data is touched.

.PARAMETER SkipBuild
    Skip the npm/tsc/vite build phase. Use when artefacts are already current
    (e.g. after a CI build).

.PARAMETER ReinstallMosquitto
    Re-run install-mosquitto.ps1 even if the service is already present.
    Useful after a Mosquitto config change.

.PARAMETER NssmPath
    Override NSSM resolution (defaults to ./nssm-path.txt or winget package
    auto-discovery). Passed through to install-services-phase5.ps1.

.NOTES
    Run from an elevated PowerShell. Designed for a fresh Windows Server
    install: assumes the repo is cloned at $PSScriptRoot/.. and PostgreSQL 18
    is already installed (typically via the official PG installer).

    File is intentionally ASCII-only so PS 5.1 tokenises it correctly.
#>

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$ReinstallMosquitto,
    [string]$NssmPath = $null
)

$ErrorActionPreference = 'Stop'
$Worktree = (Resolve-Path "$PSScriptRoot\..").Path
$apiDir   = Join-Path $Worktree 'apps\api'
$webDir   = Join-Path $Worktree 'apps\web'
$sharedDir= Join-Path $Worktree 'packages\shared'

function Write-Step($msg) { Write-Host "`n[install] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[install] OK: $msg"  -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "[install] WARN: $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[install] FAIL: $msg" -ForegroundColor Red; exit 1 }

# 1. Tooling sanity
Write-Step 'Checking tooling'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js not found. Install Node 20+ first (e.g. winget install OpenJS.NodeJS.LTS).' }
Write-Ok "node: $($node.Source)"

$npx = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npx) { Fail 'npx not found.' }

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    Write-Warn2 'psql not on PATH -- that is fine for service install, but DB operations will need full path.'
}

# NSSM auto-discovery / install
if (-not $NssmPath) {
    $nssm = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\NSSM.NSSM_*\nssm-*\win64\nssm.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $nssm) {
        Write-Step 'NSSM not found -- installing via winget'
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if (-not $winget) { Fail 'winget not found and NSSM is missing. Install NSSM from https://nssm.cc/download manually, then re-run with -NssmPath.' }
        & winget install --id NSSM.NSSM --silent --accept-source-agreements --accept-package-agreements
        $nssm = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\NSSM.NSSM_*\nssm-*\win64\nssm.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $nssm) { Fail 'NSSM install via winget failed.' }
    }
    $NssmPath = $nssm.FullName
}
Write-Ok "NSSM: $NssmPath"

# 2. Build
if ($SkipBuild) {
    Write-Warn2 'Skipping build per -SkipBuild'
} else {
    Write-Step 'Building packages/shared'
    Push-Location $sharedDir
    try { & npx tsc; if ($LASTEXITCODE -ne 0) { Fail 'shared build failed.' } }
    finally { Pop-Location }
    Write-Ok 'shared built'

    Write-Step 'Building apps/api (tsc -> dist)'
    Push-Location $Worktree
    try { & npx tsc -p apps/api/tsconfig.json; if ($LASTEXITCODE -ne 0) { Fail 'api build failed.' } }
    finally { Pop-Location }
    Write-Ok 'api built'

    Write-Step 'Building apps/web (vite build -> dist)'
    Push-Location $webDir
    try { & npx vite build; if ($LASTEXITCODE -ne 0) { Fail 'web build failed.' } }
    finally { Pop-Location }
    Write-Ok 'web built'
}

# 3. Mosquitto
$mosquitto = Get-Service -Name 'mosquitto' -ErrorAction SilentlyContinue
if ($mosquitto -and -not $ReinstallMosquitto) {
    Write-Ok "Mosquitto service already present (status: $($mosquitto.Status)) -- skipping. Pass -ReinstallMosquitto to refresh."
} else {
    Write-Step 'Installing/refreshing Mosquitto'
    & "$PSScriptRoot\install-mosquitto.ps1"
    if ($LASTEXITCODE -ne 0) { Fail 'install-mosquitto.ps1 returned non-zero.' }
    Write-Ok 'Mosquitto setup done'
}

# 4. Register API + Web services
Write-Step 'Registering DigiLog services via NSSM (install-services-phase5.ps1)'
& "$PSScriptRoot\install-services-phase5.ps1" -Worktree $Worktree -NssmPath $NssmPath
if ($LASTEXITCODE -ne 0) { Fail 'install-services-phase5.ps1 returned non-zero.' }
Write-Ok 'Services registered'

# 5. Start services
Write-Step 'Starting services'
foreach ($svcName in @('DigiLogAPI-Phase5', 'DigiLogWeb-Phase5')) {
    $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
    if (-not $svc) { Fail "Service $svcName is missing post-install -- investigate logs." }
    if ($svc.Status -ne 'Running') {
        Start-Service -Name $svcName
        Start-Sleep -Seconds 2
    }
    $svc.Refresh()
    Write-Ok "$svcName : $($svc.Status)"
}

# 6. Health probes
Write-Step 'Probing service health'
Start-Sleep -Seconds 3 # give the API a moment to bind ports
try {
    # /health is auth-gated; 401 is fine -- it proves TLS is up and the route is registered.
    $apiCode = & curl.exe -sk -o NUL -w '%{http_code}' 'https://localhost:3000/health' 2>$null
    if ($apiCode -in @('200','401')) {
        Write-Ok "API responding (HTTP $apiCode on /health)"
    } else {
        Write-Warn2 "API returned HTTP $apiCode on /health -- check logs at $Worktree\logs\DigiLogAPI-Phase5.err.log"
    }
} catch {
    Write-Warn2 "API health probe threw: $_"
}

try {
    $webCode = & curl.exe -sk -o NUL -w '%{http_code}' 'http://localhost:5175/' 2>$null
    if ($webCode -in @('200','301','302')) {
        Write-Ok "Web responding (HTTP $webCode on /)"
    } else {
        Write-Warn2 "Web returned HTTP $webCode on / -- check logs at $Worktree\logs\DigiLogWeb-Phase5.err.log"
    }
} catch {
    Write-Warn2 "Web health probe threw: $_"
}

Write-Host ""
Write-Host "[install] DONE. Services running:" -ForegroundColor Green
Get-Service Digi*-Phase5 mosquitto -ErrorAction SilentlyContinue | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "[install] Tail logs with: Get-Content $Worktree\logs\DigiLogAPI-Phase5.out.log -Tail 50 -Wait" -ForegroundColor Cyan
Write-Host "[install] Uninstall with: scripts\uninstall-windows.ps1" -ForegroundColor Cyan
