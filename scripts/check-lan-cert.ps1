<#
.SYNOPSIS
  INSTALLED SERVER, scheduled task "DigiLog Certificate Check" (SYSTEM): keeps
  the FMS's OWN HTTPS certificate covering the network this PC is on, so moving
  the server to another network range needs no one at the keyboard.

.DESCRIPTION
  2026-10-31 (operator: "some times ip will change"). The certificate covers the
  whole x.y.z.1-254 of the network it was made on, so a DHCP change inside it
  needs nothing (tablets find the server again by themselves). A move to ANOTHER
  range (192.168.1.x -> 192.168.5.x / 10.x) used to need Start menu > "Apply
  server addresses" by hand; until then every browser and tablet refused the
  server.

  Runs at startup and whenever a network connects (register-cert-check-task.ps1):
    - TLS_CERT_PATH points elsewhere (a company certificate, set-certificate.ps1):
      does nothing - that certificate belongs to IT.
    - No network: does nothing.
    - Otherwise issue-lan-cert.ps1 with the [server] names from
      digilog-addresses.ini: nothing when the certificate already covers this
      range; else re-issued from the SAME install CA (tablets keep trusting it;
      every address already on it is kept).
    - Restarts DigiLogAPI ONLY when the certificate file changed and the service
      is running (Node reads the certificate at start). Each range adds at most
      one re-issue + restart: a range, once covered, stays covered.
  Every action is written to logs\certificate-check.log; quiet runs write nothing.
#>
[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$DataRoot   = 'C:\ProgramData\DigiLog',
  [string]$ApiService = 'DigiLogAPI',
  [string]$OpenSsl,
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
# Resolved here: PS 5.1 leaves $PSScriptRoot empty in an advanced script's param() defaults.
if (-not $InstallDir) { $InstallDir = Split-Path -Parent $PSScriptRoot }
if (-not $OpenSsl)    { $OpenSsl    = Join-Path $InstallDir 'openssl\openssl.exe' }
. (Join-Path $PSScriptRoot 'address-config.ps1')
. (Join-Path $PSScriptRoot 'health-probe.ps1')

$envFile    = Join-Path $DataRoot 'config\digilog.env'
$iniFile    = Join-Path $DataRoot 'config\digilog-addresses.ini'
$certDir    = Join-Path $DataRoot 'certs'
$builtInCrt = Join-Path $certDir 'server.crt'
$logFile    = Join-Path $DataRoot 'logs\certificate-check.log'

function Write-CheckLog([string]$m) {
  Write-Host $m
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $logFile) | Out-Null
    Add-Content -Path $logFile -Encoding ascii -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m)
  } catch { Write-Host "(could not write $logFile)" }
}

if (-not (Test-Path $envFile)) { exit 0 }   # not installed (yet) / mid-uninstall
$crtNow = Get-DigilogEnvKey $envFile 'TLS_CERT_PATH'
if ($crtNow -and ([IO.Path]::GetFullPath($crtNow) -ne [IO.Path]::GetFullPath($builtInCrt))) { exit 0 }

$lanIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
if (-not $lanIp) { exit 0 }

$names = @()
if (Test-Path $iniFile) {
  try { $names = @((Read-DigilogAddresses -Path $iniFile).Addresses) }
  catch { Write-CheckLog "WARNING: digilog-addresses.ini could not be read ($($_.Exception.Message)); checking this network only." }
}
$hash = { if (Test-Path $builtInCrt) { (Get-FileHash $builtInCrt).Hash } else { '' } }
$before = & $hash
$certArgs = @{ CertDir = $certDir; OpenSsl = $OpenSsl; OpenSslConf = (Join-Path (Split-Path $OpenSsl) 'openssl.cnf'); ExtraNames = $names }
$eap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$global:LASTEXITCODE = 0
try { $out = @(& (Join-Path $PSScriptRoot 'issue-lan-cert.ps1') @certArgs *>&1 | ForEach-Object { "$_" }) }
catch { Write-CheckLog "FAILED for $lanIp : $($_.Exception.Message)"; exit 1 }
finally { $ErrorActionPreference = $eap }
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-CheckLog "FAILED (exit $code) for $lanIp : $(($out | Where-Object { $_ -match 'FATAL|WARNING' }) -join ' | ')"
  exit 1
}
if ((& $hash) -eq $before) {
  $warn = @($out | Where-Object { $_ -match '^WARNING' })
  if ($warn.Count) { Write-CheckLog ($warn -join ' | ') }
  exit 0
}
Write-CheckLog "Certificate re-issued for this PC's network ($lanIp): $(($out | Where-Object { $_ -match '^==>' }) -join ' | ')"
if ($NoRestart) { exit 0 }
$svc = Get-Service -Name $ApiService -ErrorAction SilentlyContinue
if (-not $svc -or $svc.Status -ne 'Running') {
  Write-CheckLog "$ApiService is not running; it uses the new certificate when it starts."
  exit 0
}
Restart-Service -Name $ApiService -Force
$port = Get-DigilogEnvKey $envFile 'PORT'
if (-not ($port -match '^\d+$')) { $port = '3000' }
if (Wait-DigilogHealth -Port ([int]$port) -Seconds 120) { Write-CheckLog "$ApiService restarted on the new certificate and is answering." }
else { Write-CheckLog "WARNING: $ApiService restarted but did not answer within 120 s - check $DataRoot\logs\app\error." }
exit 0
