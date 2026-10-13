<#
.SYNOPSIS
  Make sure the DigiLog HTTPS certificate covers EVERY address on this PC's LAN
  (the whole /24 of the default-route interface), so a DHCP address change never
  breaks the tablet. Shared by install.ps1 (fresh) and upgrade.ps1.

.DESCRIPTION
  2026-10-10 (tasks/AUTO-IP-RECOVERY-PLAN.md, Part 1). The tablet can rediscover
  the server anywhere in the same /24, so the certificate covers x.y.z.1-254 up
  front and nothing has to run when the address changes.

  - No certificate yet: creates the install's local CA ("DigiLog Local CA") and a
    server certificate, and trusts the CA on this PC (unchanged from before).
  - Certificate exists and already covers this /24: does nothing.
  - Certificate exists but not for this /24: re-issues it from the SAME install CA
    (rootCA.key), so tablets that already trust rootCA.pem keep trusting it. Every
    IP already on the certificate is kept. The old file is backed up.
  - Certificate exists but rootCA.key is missing: warns and leaves it alone.

  -ExtraNames: the [server] addresses from digilog-addresses.ini (names and IPs);
  apply-addresses.ps1 passes them. Names already on the certificate are kept too.

  Normally run through apply-addresses.ps1 (Start menu: "Apply server addresses"),
  which also updates digilog.env and restarts the API.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$CertDir,
  [Parameter(Mandatory)][string]$OpenSsl,
  [string]$OpenSslConf,
  # Extra names / IPs the certificate must cover (digilog-addresses.ini [server]).
  [string[]]$ExtraNames = @(),
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if ($OpenSslConf) { $env:OPENSSL_CONF = $OpenSslConf }

$srvKey = Join-Path $CertDir 'server.key'
$srvCrt = Join-Path $CertDir 'server.crt'
$caPem  = Join-Path $CertDir 'rootCA.pem'
$caKey  = Join-Path $CertDir 'rootCA.key'
$ext    = Join-Path $CertDir 'server.ext'
$csr    = Join-Path $CertDir 'server.csr'

# LAN IPv4 the tablet will use (default-route interface).
$lanIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } |
          Select-Object -First 1).IPv4Address.IPAddress
if (-not $lanIp) { $lanIp = '127.0.0.1' }
$prefix = ($lanIp -split '\.')[0..2] -join '.'
$subnet = if ($lanIp -eq '127.0.0.1') { @() } else { 1..254 | ForEach-Object { "$prefix.$_" } }

# One spelling per IP (openssl prints IPv6 expanded: 0:0:0:0:0:0:0:1).
function Format-Ip([string]$ip) { return [System.Net.IPAddress]::Parse($ip).ToString().ToLowerInvariant() }
function Test-IsIp([string]$s) { $a = $null; return [System.Net.IPAddress]::TryParse($s, [ref]$a) }

function Get-CertSans([string]$path) {
  $text = (& $OpenSsl x509 -in $path -noout -text) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw "openssl could not read $path" }
  return @{
    Ips = @([regex]::Matches($text, 'IP Address:([0-9A-Fa-f.:]+)') | ForEach-Object { Format-Ip $_.Groups[1].Value })
    Dns = @([regex]::Matches($text, 'DNS:([^,\s]+)') | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() })
  }
}

# `-File script.ps1 -ExtraNames a,b` arrives as ONE string "a,b" (only `&` passes
# a real array) - split here so both call styles give the same certificate.
$ExtraNames = @($ExtraNames | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })
$extraIps = @($ExtraNames | Where-Object { $_ -and (Test-IsIp $_) } | ForEach-Object { Format-Ip $_ })
$extraDns = @($ExtraNames | Where-Object { $_ -and -not (Test-IsIp $_) } | ForEach-Object { $_.ToLowerInvariant() })

if ($DryRun -and -not (Test-Path $OpenSsl)) {
  # Dry run on a machine without the bundled OpenSSL (e.g. checking the
  # installer on a dev box): say what would happen, as before this script existed.
  Write-Host "[dry-run] openssl: issue server cert for $prefix.1-254$(if ($ExtraNames) { ' + ' + ($ExtraNames -join ', ') }) in $CertDir" -ForegroundColor Yellow
  exit 0
}
if (-not (Test-Path $OpenSsl)) {
  Write-Host "FATAL: openssl.exe not found at $OpenSsl (needed for HTTPS-on-LAN)." -ForegroundColor Red; exit 1
}
if ($OpenSslConf -and -not (Test-Path $OpenSslConf)) {
  Write-Host "FATAL: openssl.cnf not found at $OpenSslConf (openssl req/x509 cannot run without it)." -ForegroundColor Red; exit 1
}

$keepIps = @()
$keepDns = @()
if (Test-Path $srvCrt) {
  $have = Get-CertSans $srvCrt
  $missing = @(@($subnet + $lanIp + $extraIps | Where-Object { $have.Ips -notcontains $_ }) +
               @($extraDns | Where-Object { $have.Dns -notcontains $_ }) | Select-Object -Unique)
  if ($missing.Count -eq 0) {
    Write-Host "==> HTTPS certificate already covers $prefix.1-254$(if ($ExtraNames.Count) { ' and ' + ($ExtraNames -join ', ') }) - unchanged" -ForegroundColor Cyan
    exit 0
  }
  if (-not (Test-Path $caKey) -or -not (Test-Path $caPem)) {
    Write-Host "WARNING: $srvCrt does not cover $($missing -join ', '), but the install CA key ($caKey) is missing - certificate left as is. The tablet may refuse those addresses." -ForegroundColor Yellow
    exit 0
  }
  $keepIps = @($have.Ips | Where-Object { $_ -ne '127.0.0.1' })
  $keepDns = @($have.Dns | Where-Object { $_ -ne 'localhost' })
  Write-Host "==> Re-issuing HTTPS certificate (adds $($missing.Count): $(($missing | Select-Object -First 5) -join ', ')$(if ($missing.Count -gt 5) { ', ...' }); keeps $($keepIps.Count + $keepDns.Count) existing; same CA)" -ForegroundColor Cyan
} else {
  Write-Host "==> Generating HTTPS certificates for $prefix.1-254$(if ($ExtraNames.Count) { ' and ' + ($ExtraNames -join ', ') })" -ForegroundColor Cyan
}

$ips = @('127.0.0.1') + $keepIps + $subnet + $lanIp + $extraIps | Select-Object -Unique
$dns = @('localhost') + $keepDns + $extraDns | Select-Object -Unique
if ($DryRun) {
  Write-Host "[dry-run] server cert SAN: $($dns.Count) names + $($ips.Count) IPs (CA in $CertDir)" -ForegroundColor Yellow
  exit 0
}

New-Item -ItemType Directory -Force -Path $CertDir | Out-Null
$lines = @(
  'authorityKeyIdentifier=keyid,issuer'
  'basicConstraints=CA:FALSE'
  'keyUsage = digitalSignature, keyEncipherment'
  'subjectAltName = @alt'
  '[alt]'
)
$n = 1
foreach ($d in $dns) { $lines += "DNS.$n = $d"; $n++ }
$n = 1
foreach ($ip in $ips) { $lines += "IP.$n = $ip"; $n++ }
Set-Content -Path $ext -Encoding ascii -Value $lines

$newCa = -not (Test-Path $caKey)
if ($newCa) {
  & $OpenSsl genrsa -out $caKey 2048
  if ($LASTEXITCODE -ne 0) { Write-Host "FATAL: openssl genrsa (CA) failed." -ForegroundColor Red; exit 1 }
  & $OpenSsl req -x509 -new -nodes -key $caKey -sha256 -days 3650 -subj "/CN=DigiLog Local CA" -out $caPem
  if ($LASTEXITCODE -ne 0) { Write-Host "FATAL: openssl CA cert failed." -ForegroundColor Red; exit 1 }
}
if (-not (Test-Path $srvKey)) {
  & $OpenSsl genrsa -out $srvKey 2048
  if ($LASTEXITCODE -ne 0) { Write-Host "FATAL: openssl genrsa (server) failed." -ForegroundColor Red; exit 1 }
}
if (Test-Path $srvCrt) {
  Copy-Item $srvCrt "$srvCrt.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
}
& $OpenSsl req -new -key $srvKey -subj "/CN=$lanIp" -out $csr
if ($LASTEXITCODE -ne 0) { Write-Host "FATAL: openssl server CSR failed." -ForegroundColor Red; exit 1 }
& $OpenSsl x509 -req -in $csr -CA $caPem -CAkey $caKey -CAcreateserial -days 3650 -sha256 -extfile $ext -out $srvCrt
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $srvCrt)) { Write-Host "FATAL: server cert generation failed." -ForegroundColor Red; exit 1 }

& $OpenSsl verify -CAfile $caPem $srvCrt | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "FATAL: new server cert does not verify against $caPem." -ForegroundColor Red; exit 1 }

if ($newCa) {
  # Trust the CA on the SERVER so the PC browser does not warn under HTTPS.
  Import-Certificate -FilePath $caPem -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
}
Write-Host "==> HTTPS certificate covers $prefix.1-254 ($($ips.Count) IPs); rootCA.pem = $caPem" -ForegroundColor Cyan
exit 0
