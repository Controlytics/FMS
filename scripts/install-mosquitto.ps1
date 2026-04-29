# scripts/install-mosquitto.ps1
# Installs Mosquitto 2.0.x silently and registers it as a Windows service.
# Idempotent: safe to re-run.
#
# Replaces the EMQX install step in scripts/install-on-target.ps1 when
# USE_MOSQUITTO=true. See windowsIssues.md § 3 for rationale.

[CmdletBinding()]
param(
    [string]$Version = '2.0.18',
    [string]$InstallDir = 'C:\Program Files\mosquitto'
)

$ErrorActionPreference = 'Stop'
$Url = "https://mosquitto.org/files/binary/win64/mosquitto-$Version-install-windows-x64.exe"
$InstallerPath = Join-Path $env:TEMP "mosquitto-$Version-installer.exe"

# 1. Download (skip if already cached)
if (-not (Test-Path $InstallerPath)) {
    Write-Output "Downloading Mosquitto $Version from $Url ..."
    Invoke-WebRequest -Uri $Url -OutFile $InstallerPath -UseBasicParsing
} else {
    Write-Output "Mosquitto $Version installer already cached at $InstallerPath"
}

# 2. Install silently (skip if already installed)
$mosquittoExe = Join-Path $InstallDir 'mosquitto.exe'
if (-not (Test-Path $mosquittoExe)) {
    Write-Output "Installing Mosquitto silently to $InstallDir ..."
    Start-Process -FilePath $InstallerPath -ArgumentList '/S' -Wait
    if (-not (Test-Path $mosquittoExe)) {
        throw "Mosquitto install appears to have failed - $mosquittoExe not found after silent install."
    }
} else {
    Write-Output "Mosquitto already installed at $InstallDir"
}

# 3. Copy our config + dynsec bootstrap from the repo
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ConfigSrc = Join-Path $RepoRoot 'mosquitto'
if (-not (Test-Path $ConfigSrc)) {
    throw "Repo Mosquitto config dir not found: $ConfigSrc"
}
Write-Output "Copying repo mosquitto/ config files into $InstallDir ..."
Copy-Item -Path (Join-Path $ConfigSrc 'mosquitto.conf') -Destination $InstallDir -Force

# 4. Ensure data/ subdir exists (for persistence)
$DataDir = Join-Path $InstallDir 'data'
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir | Out-Null
}

# 5. Grant Mosquitto service account read access to the install dir
#    (NetworkService is the default service account; adjust if your install uses a different one)
Write-Output "Granting NetworkService read access to $InstallDir ..."
icacls $InstallDir /grant 'NT AUTHORITY\NetworkService:(OI)(CI)RX' /T 2>&1 | Out-Null
icacls $DataDir /grant 'NT AUTHORITY\NetworkService:(OI)(CI)M' /T 2>&1 | Out-Null

# 6. Register + start Windows service
$service = Get-Service -Name mosquitto -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Output "Registering Mosquitto Windows service ..."
    & $mosquittoExe install
    $service = Get-Service -Name mosquitto -ErrorAction SilentlyContinue
    if (-not $service) {
        throw "Failed to register Mosquitto Windows service"
    }
}

if ($service.Status -ne 'Running') {
    Write-Output "Starting Mosquitto service ..."
    Start-Service mosquitto
} else {
    Write-Output "Mosquitto service already running"
}

# 7. Final status
$running = Get-Service mosquitto
Write-Output ""
Write-Output "==================================="
Write-Output "Mosquitto installation complete."
Write-Output "  Install dir: $InstallDir"
Write-Output "  Service:     $($running.Status)"
Write-Output "  Listener:    tcp://localhost:1883"
Write-Output ""
Write-Output "Next step: from the API, POST /api/internal/mqtt/refresh-acl"
Write-Output "with Bearer `$env:MOSQUITTO_REFRESH_TOKEN to populate"
Write-Output "$InstallDir\dynamic-security.json from the DeviceCredential table."
Write-Output "==================================="
