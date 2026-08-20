<#
.SYNOPSIS
  Re-issue the dev TLS certificate so it covers this PC's CURRENT LAN IP, then
  reload the API so it serves the new cert.

.DESCRIPTION
  Run this whenever the PC lands on a new network (new Wi-Fi / hotspot) and the
  tablet can no longer reach the API.

  It does NOT require an APK rebuild. The APK reads its server address from
  localStorage (apps/web/src/lib/api-base.ts getApiBase), so after running this
  you only retype the address on the tablet's Server Address screen.

  The mkcert CA is NOT regenerated, so the tablet keeps trusting the cert and
  does not need the root CA reinstalled.

  Accumulated SAN entries live in certs/san-list.txt; every IP this machine has
  ever used is kept, so moving back to an old network needs no re-run.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\refresh-lan-cert.ps1
#>
[CmdletBinding()]
param(
  # Override auto-detection, e.g. -IpAddress 192.168.1.53
  [string]$IpAddress,
  # Skip touching app.ts (use when the API is not running under tsx watch)
  [switch]$NoApiReload
)

$ErrorActionPreference = 'Stop'
$repo    = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $repo 'certs'
$sanFile = Join-Path $certDir 'san-list.txt'
$appTs   = Join-Path $repo 'apps\api\src\app.ts'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }

# --- 1. mkcert must be present -------------------------------------------------
$mkcert = (Get-Command mkcert -ErrorAction SilentlyContinue).Source
if (-not $mkcert) {
  throw "mkcert not found on PATH. Install with: winget install FiloSottile.mkcert"
}

# --- 2. Work out this machine's LAN IP ----------------------------------------
if ($IpAddress) {
  $ip = $IpAddress
} else {
  # Prefer an interface that actually has a default gateway; 169.254.* means the
  # adapter never got a DHCP lease and is not on a real network.
  $cfg = Get-NetIPConfiguration |
         Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
         Select-Object -First 1
  if ($cfg) {
    $ip = $cfg.IPv4Address[0].IPAddress
  } else {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 |
           Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
           Select-Object -First 1).IPAddress
  }
}

if (-not $ip) { throw "No usable IPv4 address found. Are you connected to a network?" }
if ($ip -like '169.254.*') { throw "Only a link-local address ($ip) is available - not on a real network yet." }
Write-Step "Current LAN IP: $ip"

# --- 3. Merge into the accumulated SAN list -----------------------------------
if (-not (Test-Path $sanFile)) {
  Write-Warn "certs\san-list.txt missing - creating a fresh one."
  Set-Content -Path $sanFile -Value @('localhost','127.0.0.1','::1') -Encoding utf8
}

$sans = @(Get-Content $sanFile | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($sans -contains $ip) {
  Write-Step "$ip is already in the certificate SAN list - re-issuing anyway."
} else {
  Write-Step "Adding $ip to the SAN list (was $($sans.Count) entries)."
  $sans += $ip
  Set-Content -Path $sanFile -Value $sans -Encoding utf8
}

# --- 4. Back up the current cert, then re-issue -------------------------------
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$crtPath = Join-Path $certDir 'server.crt'
$keyPath = Join-Path $certDir 'server.key'
if (Test-Path $crtPath) { Copy-Item $crtPath "$crtPath.bak-$stamp" }
if (Test-Path $keyPath) { Copy-Item $keyPath "$keyPath.bak-$stamp" }

Write-Step "Re-issuing certificate for $($sans.Count) names via mkcert..."
& $mkcert -cert-file $crtPath -key-file $keyPath @sans
if ($LASTEXITCODE -ne 0) { throw "mkcert failed with exit code $LASTEXITCODE" }

# --- 5. Reload the API so it reads the new cert -------------------------------
# The cert is read once at startup (apps/api/src/app.ts fs.readFileSync), so the
# process must restart. Under `tsx watch` touching app.ts is enough.
if (-not $NoApiReload) {
  $listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
  if ($listening) {
    Write-Step "Reloading the API (touching app.ts)..."
    (Get-Item $appTs).LastWriteTime = Get-Date
    Start-Sleep -Seconds 12
  } else {
    Write-Warn "Nothing is listening on port 3000 - start the API yourself to pick up the new cert."
  }
}

# --- 6. Verify what is actually being served ----------------------------------
$verified = $false
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect($ip, 3000)
  $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, { $true })
  $ssl.AuthenticateAsClient($ip)
  $served = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
  $sanExt = ($served.Extensions | Where-Object { $_.Oid.FriendlyName -match 'Subject Alternative Name' })
  if ($sanExt) {
    $text = $sanExt.Format($false)
    if ($text -match [regex]::Escape($ip)) { $verified = $true }
  }
  $ssl.Dispose(); $tcp.Close()
} catch {
  Write-Warn "Could not verify the served certificate: $($_.Exception.Message)"
}

Write-Host ""
if ($verified) {
  Write-Host "SUCCESS - the API is serving a certificate valid for $ip" -ForegroundColor Green
} else {
  Write-Warn "The new cert was written but could not be confirmed on the wire."
  Write-Warn "Restart the API manually, then re-run this script."
}

Write-Host ""
Write-Host "On the tablet, set Server Address to:" -ForegroundColor White
Write-Host "    https://${ip}:3000" -ForegroundColor Green
Write-Host ""
Write-Host "No APK rebuild is needed - the address is read from the device, not the build." -ForegroundColor Gray
