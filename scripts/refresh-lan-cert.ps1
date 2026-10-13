<#
.SYNOPSIS
  DEV MACHINE: apply digilog-addresses.ini (repo root) to every part of the
  local DigiLog: the HTTPS certificate, the API's port + allowed origins, the
  firewall check, then reload the API (:api) and the Vite web page (:web).
  Usually run by double-clicking apply-addresses.bat.

.DESCRIPTION
  digilog-addresses.ini is the ONE place for this server's names / IPs / ports
  (tasks/AUTO-IP-RECOVERY-PLAN.md, Part 3). This script:
    1. reads + validates the whole file first - a bad line aborts with NOTHING changed;
    2. re-issues certs/server.crt via mkcert for: every [server] address, this PC's
       current IP and its whole /24, plus every name used before (certs/san-list.txt).
       The mkcert root does not change, so the tablet keeps trusting it;
    3. writes PORT (+ the legacy API_PORT) and ALLOWED_ORIGINS into apps/api/.env
       (backed up first);
    4. checks Windows Firewall allows both ports (adding a rule needs Administrator,
       so it only tells you the command);
    5. reloads the API (touch app.ts under tsx watch) and Vite (touch vite.config.ts,
       which also reads the ports from the ini);
    6. checks the served certificate lists every address.

  Customer installs use scripts\apply-addresses.ps1 instead (openssl + the install CA).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\refresh-lan-cert.ps1
#>
[CmdletBinding()]
param(
  # Override auto-detection, e.g. -IpAddress 192.168.1.200
  [string]$IpAddress,
  # Skip touching app.ts / vite.config.ts (use when nothing runs under watch)
  [switch]$NoApiReload
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'address-config.ps1')

$repo     = Split-Path -Parent $PSScriptRoot
$certDir  = Join-Path $repo 'certs'
$sanFile  = Join-Path $certDir 'san-list.txt'
$addrFile = Join-Path $repo 'digilog-addresses.ini'
$apiEnv   = Join-Path $repo 'apps\api\.env'
$appTs    = Join-Path $repo 'apps\api\src\app.ts'
$viteCfg  = Join-Path $repo 'apps\web\vite.config.ts'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }

# --- 1. Read the address file FIRST (a bad line must change nothing) ----------
if (-not (Test-Path $addrFile)) {
  throw "digilog-addresses.ini not found at $addrFile. Copy it from git (git checkout -- digilog-addresses.ini)."
}
$cfg = Read-DigilogAddresses -Path $addrFile -DefaultApiPort 3000
if (-not $cfg.WebPort) { $cfg.WebPort = 5175 }   # dev always runs the Vite page
Write-Step "digilog-addresses.ini: $($cfg.Addresses.Count) address(es) [$($cfg.Addresses -join ', ')]; api port $($cfg.ApiPort), web port $($cfg.WebPort)"

# --- 2. mkcert must be present -------------------------------------------------
$mkcert = (Get-Command mkcert -ErrorAction SilentlyContinue).Source
if (-not $mkcert) {
  throw "mkcert not found on PATH. Install with: winget install FiloSottile.mkcert"
}

# --- 3. This machine's LAN IP --------------------------------------------------
if ($IpAddress) {
  $ip = $IpAddress
} else {
  # Prefer an interface that actually has a default gateway; 169.254.* means the
  # adapter never got a DHCP lease and is not on a real network.
  $net = Get-NetIPConfiguration |
         Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
         Select-Object -First 1
  if ($net) {
    $ip = $net.IPv4Address[0].IPAddress
  } else {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 |
           Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
           Select-Object -First 1).IPAddress
  }
}
if (-not $ip) { throw "No usable IPv4 address found. Are you connected to a network?" }
if ($ip -like '169.254.*') { throw "Only a link-local address ($ip) is available - not on a real network yet." }
Write-Step "Current LAN IP: $ip"
if ($cfg.Ips.Count -and ($cfg.Ips -notcontains $ip)) {
  Write-Warn "This PC's IP $ip is not listed under [server] in digilog-addresses.ini (it is still trusted automatically)."
}

# --- 4. Certificate names: accumulated list + /24 + the file ------------------
if (-not (Test-Path $sanFile)) {
  Write-Warn "certs\san-list.txt missing - creating a fresh one."
  Set-Content -Path $sanFile -Value @('localhost','127.0.0.1','::1') -Encoding utf8
}
$sans = @(Get-Content $sanFile | ForEach-Object { $_.Trim().TrimStart([char]0xFEFF) } | Where-Object { $_ })
$before = $sans.Count
$prefix = ($ip -split '\.')[0..2] -join '.'
$wanted = @($ip) + (1..254 | ForEach-Object { "$prefix.$_" }) + $cfg.Addresses
foreach ($n in $wanted) { if ($sans -notcontains $n) { $sans += $n } }
if ($sans.Count -gt $before) {
  Write-Step "Adding $($sans.Count - $before) new name(s) to the certificate list (now $($sans.Count))."
  Set-Content -Path $sanFile -Value $sans -Encoding utf8
}

$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$crtPath = Join-Path $certDir 'server.crt'
$keyPath = Join-Path $certDir 'server.key'
if (Test-Path $crtPath) { Copy-Item $crtPath "$crtPath.bak-$stamp" }
if (Test-Path $keyPath) { Copy-Item $keyPath "$keyPath.bak-$stamp" }
Write-Step "Re-issuing certificate for $($sans.Count) names via mkcert..."
& $mkcert -cert-file $crtPath -key-file $keyPath @sans
if ($LASTEXITCODE -ne 0) { throw "mkcert failed with exit code $LASTEXITCODE" }

# --- 5. API settings: port + allowed origins ----------------------------------
# app.ts listens on PORT. API_PORT is read by nothing (deployment-check warns
# about it) - kept equal so the two can never disagree in front of a reader.
if (Test-Path $apiEnv) {
  Copy-Item $apiEnv "$apiEnv.bak-$stamp"
  $origins = Get-DigilogAllowedOrigins $cfg
  Set-DigilogEnvKey $apiEnv 'PORT' $cfg.ApiPort
  Set-DigilogEnvKey $apiEnv 'API_PORT' $cfg.ApiPort
  Set-DigilogEnvKey $apiEnv 'ALLOWED_ORIGINS' $origins
  Write-Step "apps\api\.env: PORT=$($cfg.ApiPort); ALLOWED_ORIGINS = $(($origins -split ',').Count) origins (backup: .env.bak-$stamp)"
} else {
  Write-Warn "apps\api\.env not found - port and origins NOT written."
}

# --- 6. Firewall ----------------------------------------------------------------
foreach ($p in @($cfg.ApiPort, $cfg.WebPort)) {
  $open = Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue |
          Where-Object { (($_ | Get-NetFirewallPortFilter).LocalPort) -contains "$p" }
  if ($open) { Write-Step "Firewall: port $p is open ($(@($open)[0].DisplayName))" }
  else { Write-Warn "Firewall: nothing allows port $p. As Administrator run:  netsh advfirewall firewall add rule name=`"DigiLog $p`" dir=in action=allow protocol=TCP localport=$p" }
}

# --- 7. Reload ------------------------------------------------------------------
# Both servers read the certificate (and the port) once at start. Under
# `tsx watch` / Vite, touching their entry/config file restarts them.
if (-not $NoApiReload) {
  $apiUp = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(3000, $cfg.ApiPort) }
  if ($apiUp) {
    Write-Step "Reloading the API (touching app.ts)..."
    (Get-Item $appTs).LastWriteTime = Get-Date
  } else {
    Write-Warn "The API is not running - start it (start-digilog.bat) to pick up the changes."
  }
  $webUp = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(5175, $cfg.WebPort) }
  if ($webUp) {
    Write-Step "Reloading the web page server (touching vite.config.ts)..."
    (Get-Item $viteCfg).LastWriteTime = Get-Date
  }
  if ($apiUp -or $webUp) { Start-Sleep -Seconds 15 }
}

# --- 8. Verify what is actually served -----------------------------------------
function Get-ServedNames([string]$h, [int]$port) {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect($h, $port)
  $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, { $true })
  $ssl.AuthenticateAsClient($h)
  $c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
  $ext = $c.Extensions | Where-Object { $_.Oid.FriendlyName -match 'Subject Alternative Name' }
  $ssl.Dispose(); $tcp.Close()
  # .NET writes "DNS Name=x, IP Address=1.2.3.4"
  return @($ext.Format($false) -split ',\s*' | ForEach-Object { ($_ -split '[=:]', 2)[1].Trim().ToLowerInvariant() })
}
$need = @($ip) + $cfg.Addresses | Select-Object -Unique
$allOk = $true
foreach ($p in @($cfg.ApiPort, $cfg.WebPort)) {
  try {
    $served = Get-ServedNames $ip $p
    $missing = @($need | Where-Object { $served -notcontains $_ })
    if ($missing.Count) { $allOk = $false; Write-Warn "Port ${p}: the served certificate does not yet list $($missing -join ', ')" }
    else { Write-Step "Port ${p}: certificate OK for $($need -join ', ')" }
  } catch {
    $allOk = $false
    Write-Warn "Port ${p}: could not check ($($_.Exception.Message))"
  }
}

Write-Host ""
if ($allOk) { Write-Host "SUCCESS - every address in digilog-addresses.ini is applied." -ForegroundColor Green }
else { Write-Warn "Not everything could be confirmed - see the lines above. Restart start-digilog.bat, then run this again." }
Write-Host ""
Write-Host "Tablet Server Address:  https://${ip}:$($cfg.ApiPort)" -ForegroundColor Green
foreach ($n in $cfg.Names) { Write-Host "  or, once the network knows the name:  https://${n}:$($cfg.ApiPort)" -ForegroundColor Gray }
Write-Host "Web page:               https://${ip}:$($cfg.WebPort)" -ForegroundColor Green
