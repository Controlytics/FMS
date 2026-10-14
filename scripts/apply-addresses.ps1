<#
.SYNOPSIS
  INSTALLED SERVER: apply C:\ProgramData\DigiLog\config\digilog-addresses.ini -
  the ONE file listing this server's names / IPs and its port - to every part
  of DigiLog, then restart the API.

.DESCRIPTION
  Start menu: "FMS > Edit server addresses" opens the file; "Apply server
  addresses" runs this (apply-addresses.cmd asks for Administrator first).
  tasks/AUTO-IP-RECOVERY-PLAN.md, Part 3.

    1. Reads + validates the whole file. A bad line stops here - NOTHING changes.
    2. HTTPS certificate: issue-lan-cert.ps1 -ExtraNames <[server] addresses>.
       Re-issued from the SAME install CA, so tablets keep trusting it.
    3. digilog.env: PORT and ALLOWED_ORIGINS (backed up first; everything else kept).
    4. Firewall rule "DigiLog API" follows the port.
    5. Desktop / Start-menu "DigiLog" shortcut follows the port.
    6. Restarts DigiLogAPI and waits for https://localhost:<port>/api/health.

  install.ps1 and upgrade.ps1 call this with -CreateIfMissing -NoRestart: a file
  is created from this PC's IP and the current port when there is none yet.

  The [tablet] and [in-app settings] sections are notes only. Settings stored in
  the database (instrument URLs, email/SMS/LDAP servers) are changed in the app,
  where every change is audited - never from a file.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Split-Path -Parent $PSScriptRoot),
  [string]$DataRoot   = 'C:\ProgramData\DigiLog',
  [string]$ApiService = 'DigiLogAPI',
  # Defaults to the bundled OpenSSL; overridable for testing outside an install.
  [string]$OpenSsl     = (Join-Path $InstallDir 'openssl\openssl.exe'),
  [string]$OpenSslConf = (Join-Path $InstallDir 'openssl\openssl.cnf'),
  # Port for a NEW file when digilog.env has no PORT either.
  [int]$DefaultApiPort = 3000,
  [switch]$CreateIfMissing,
  [switch]$NoRestart,
  [switch]$NoFirewall,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'address-config.ps1')

$configDir = Join-Path $DataRoot 'config'
$envFile   = Join-Path $configDir 'digilog.env'
$iniFile   = Join-Path $configDir 'digilog-addresses.ini'
$certDir   = Join-Path $DataRoot 'certs'
$urlFile   = Join-Path $InstallDir 'DigiLog.url'
$stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Warn($m) { Write-Host "!!  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "FAILED: $m" -ForegroundColor Red; exit 1 }

$needsAdmin = -not $DryRun -and (-not $NoFirewall -or -not $NoRestart)
if ($needsAdmin) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { Fail 'Run this as Administrator (Start menu: FMS > Apply server addresses).' }
}

$lanIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
$envPort = Get-DigilogEnvKey $envFile 'PORT'
$currentPort = if ($envPort -match '^\d+$') { [int]$envPort } else { $DefaultApiPort }

# --- 1. The file ------------------------------------------------------------------
if (-not (Test-Path $iniFile)) {
  if (-not $CreateIfMissing) { Fail "$iniFile not found. Re-run the DigiLog installer to create it." }
  $first = if ($lanIp) { @($lanIp) } else { @() }
  if ($DryRun) { Write-Host "[dry-run] create $iniFile (address $($first -join ', '), api $currentPort)" -ForegroundColor Yellow }
  else {
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    New-DigilogAddressFile -Path $iniFile -Addresses $first -ApiPort $currentPort -Apply 'Start menu: FMS > Apply server addresses'
    Write-Step "Created $iniFile"
  }
}
try {
  $cfg = if (Test-Path $iniFile) { Read-DigilogAddresses -Path $iniFile -DefaultApiPort $currentPort }
         else { @{ Addresses = @($lanIp | Where-Object { $_ }); Ips = @(); Names = @(); ApiPort = $currentPort; WebPort = 0 } }
} catch { Fail $_.Exception.Message }
$cfg.WebPort = 0   # an installed server serves the app from the API port; [ports] web is dev-only
Write-Step "Addresses: $(if ($cfg.Addresses.Count) { $cfg.Addresses -join ', ' } else { '(none listed)' }); port $($cfg.ApiPort)"
if ($lanIp -and $cfg.Ips.Count -and ($cfg.Ips -notcontains $lanIp)) {
  Write-Warn "This PC's current IP $lanIp is not under [server] (it is still trusted - the whole $((($lanIp -split '\.')[0..2]) -join '.').x network is)."
}

# --- 2. Certificate ---------------------------------------------------------------
$certArgs = @{ CertDir = $certDir; OpenSsl = $OpenSsl; ExtraNames = $cfg.Addresses }
if ($OpenSslConf) { $certArgs['OpenSslConf'] = $OpenSslConf }
if ($DryRun) { $certArgs['DryRun'] = $true }
$certBefore = if (Test-Path (Join-Path $certDir 'server.crt')) { (Get-FileHash (Join-Path $certDir 'server.crt')).Hash } else { '' }
& (Join-Path $PSScriptRoot 'issue-lan-cert.ps1') @certArgs
if ($LASTEXITCODE -ne 0) { Fail 'HTTPS certificate could not be updated (see above). Nothing else was changed.' }
$certChanged = $certBefore -ne $(if (Test-Path (Join-Path $certDir 'server.crt')) { (Get-FileHash (Join-Path $certDir 'server.crt')).Hash } else { '' })

# --- 3. digilog.env ---------------------------------------------------------------
$origins = Get-DigilogAllowedOrigins $cfg
$envChanged = ((Get-DigilogEnvKey $envFile 'PORT') -ne "$($cfg.ApiPort)") -or ((Get-DigilogEnvKey $envFile 'ALLOWED_ORIGINS') -ne $origins)
if (-not (Test-Path $envFile)) {
  Write-Warn "$envFile not found - port and origins NOT written (the installer creates it)."
  $envChanged = $false
} elseif (-not $envChanged) {
  Write-Step 'digilog.env already matches - unchanged'
} elseif ($DryRun) {
  Write-Host "[dry-run] digilog.env: PORT=$($cfg.ApiPort); ALLOWED_ORIGINS=$origins" -ForegroundColor Yellow
} else {
  Copy-Item $envFile "$envFile.bak-$stamp"
  Set-DigilogEnvKey $envFile 'PORT' $cfg.ApiPort
  Set-DigilogEnvKey $envFile 'ALLOWED_ORIGINS' $origins
  Write-Step "digilog.env: PORT=$($cfg.ApiPort), $(($origins -split ',').Count) allowed origins (backup digilog.env.bak-$stamp)"
}

# --- 4. Firewall ------------------------------------------------------------------
if (-not $NoFirewall) {
  if ($DryRun) { Write-Host "[dry-run] firewall rule 'DigiLog API' -> TCP $($cfg.ApiPort)" -ForegroundColor Yellow }
  else {
    netsh advfirewall firewall delete rule name="DigiLog API" 2>$null | Out-Null
    netsh advfirewall firewall add rule name="DigiLog API" dir=in action=allow protocol=TCP localport=$($cfg.ApiPort) | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warn "Could not set the firewall rule for port $($cfg.ApiPort) - tablets may not connect." }
    else { Write-Step "Firewall: 'DigiLog API' allows TCP $($cfg.ApiPort)" }
  }
}

# --- 5. Browser shortcut -----------------------------------------------------------
$url = "https://localhost:$($cfg.ApiPort)"
if ($DryRun) { Write-Host "[dry-run] $urlFile -> $url" -ForegroundColor Yellow }
elseif (Test-Path $InstallDir) {
  Set-Content -Path $urlFile -Encoding ascii -Value @('[InternetShortcut]', "URL=$url")
}

# --- 6. Restart ---------------------------------------------------------------------
if ($NoRestart -or $DryRun) {
  if ($certChanged -or $envChanged) { Write-Step "Changes take effect when $ApiService next starts." }
} else {
  Write-Step "Restarting $ApiService..."
  Restart-Service -Name $ApiService -Force
  $ok = $false
  foreach ($i in 1..45) {
    try { $r = Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $ok) { Fail "$ApiService did not answer on $url within 45 s. Check $DataRoot\logs\app\error. Previous settings: digilog.env.bak-$stamp" }
  Write-Step "DigiLog is answering on $url"
}

Write-Host ''
Write-Host 'Done. On the tablet, Server Address:' -ForegroundColor Green
$shown = @($cfg.Addresses) + @($lanIp | Where-Object { $_ -and ($cfg.Addresses -notcontains $_) })
foreach ($a in $shown) { Write-Host "    https://${a}:$($cfg.ApiPort)" -ForegroundColor Green }
if ($cfg.Names.Count) { Write-Host '  (a NAME works only once the network''s DNS points it at this PC)' -ForegroundColor Gray }
exit 0
