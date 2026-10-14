<#
.SYNOPSIS
  DigiLog post-install orchestrator. Run elevated by the Inno Setup installer
  after files are copied. Generates secrets, writes the runtime env file,
  provisions the bundled Postgres, and registers the Windows services.
  See tasks/EXE-PACKAGING-PLAN.md section 7 (M5).

.DESCRIPTION
  Fresh install path (this script). Upgrade safety is M6 (see -Upgrade stub).
  Idempotent on secrets: an existing config\digilog.env is REUSED, never
  regenerated (regenerating would invalidate sessions + offline-replay grants).

  Layout (parameters default to the standard install):
    InstallDir   C:\Program Files\DigiLog   (program - replaced on upgrade)
    DataRoot     C:\ProgramData\DigiLog     (data - survives upgrade/uninstall)

.PARAMETER AdminPassword  INITIAL_ADMIN_PASSWORD for the seed (required on fresh
                          install). The app forces a change on first login.
.PARAMETER DryRun         Print the plan + commands without executing.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\Program Files\DigiLog',
  [string]$DataRoot   = 'C:\ProgramData\DigiLog',
  [int]$ApiPort = 3000,
  [int]$PgPort  = 5433,
  [string]$AdminPassword,
  [int]$BackupRetainDays = 14,
  [switch]$Upgrade,
  [switch]$DryRun
)

$pgBin      = Join-Path $InstallDir 'pgsql\bin'
$nodeExe    = Join-Path $InstallDir 'runtime\node.exe'
$appEntry   = Join-Path $InstallDir 'runtime\api\dist\app.js'
$webDist    = Join-Path $InstallDir 'runtime\web\dist'
$apiDir     = Join-Path $InstallDir 'runtime\api'
$winswExe   = Join-Path $InstallDir 'service\WinSW-x64.exe'
$serviceDir = Join-Path $InstallDir 'service'
# Sibling scripts (provision/register) are co-located with this one under
# {app}\scripts; resolve via $PSScriptRoot so the orchestrator is location-robust.
$scriptsDir = $PSScriptRoot

$dbDir     = Join-Path $DataRoot 'db'
$uploadDir = Join-Path $DataRoot 'uploads'
$logDir    = Join-Path $DataRoot 'logs'
$configDir = Join-Path $DataRoot 'config'
$envFile   = Join-Path $configDir 'digilog.env'

function NewSecret([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })   # hex, env-safe
}

Write-Host "DigiLog install orchestrator" -ForegroundColor Cyan
Write-Host "  InstallDir : $InstallDir"
Write-Host "  DataRoot   : $DataRoot"
Write-Host "  API :$ApiPort   DB :$PgPort"
if ($DryRun) { Write-Host "  (DRY RUN - no changes)" -ForegroundColor Yellow }
Write-Host ""

if ($Upgrade) {
  Write-Host "==> Upgrade requested; delegating to upgrade.ps1 (backup + migrate deploy + reseed)" -ForegroundColor Cyan
  $upgArgs = @{ InstallDir = $InstallDir; DataRoot = $DataRoot; ApiPort = $ApiPort }
  if ($DryRun) { $upgArgs['DryRun'] = $true }
  & (Join-Path $scriptsDir 'upgrade.ps1') @upgArgs
  exit $LASTEXITCODE
}

# 1. Data directories (survive program upgrades)
if ($DryRun) { Write-Host "[dry-run] create $dbDir, $uploadDir, $logDir, $configDir" -ForegroundColor Yellow }
else { New-Item -ItemType Directory -Force -Path $dbDir, $uploadDir, $logDir, $configDir | Out-Null }

# 1b. M8: HTTPS-on-LAN certs (so the Android tablet can connect over HTTPS)
$certDir = Join-Path $DataRoot 'certs'
# OpenSSL CLI ships in its OWN {app}\openssl directory, NOT in pgsql\bin: the
# PostgreSQL "binaries" distribution contains libcrypto/libssl but no openssl.exe,
# and the CLI build carries those DLLs under identical filenames at a different
# patch level - so it must not be unpacked over PostgreSQL's copies.
$openssl = Join-Path $InstallDir 'openssl\openssl.exe'
# OpenSSL 3.x reads its config from a compiled-in OPENSSLDIR that does not exist here.
# Without it `req`/`x509` fail ("No store loader found ... default or base providers")
# while `genrsa` still succeeds - i.e. it half-works and looks like a cert bug.
$env:OPENSSL_CONF = Join-Path $InstallDir 'openssl\openssl.cnf'
# 2026-10-10: the certificate covers the LAN's whole /24 so a DHCP address change
# never breaks the tablet (tasks/AUTO-IP-RECOVERY-PLAN.md). Shared with upgrade.ps1.
$lanIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } |
          Select-Object -First 1).IPv4Address.IPAddress
if (-not $lanIp) { $lanIp = '127.0.0.1' }
$srvKey = Join-Path $certDir 'server.key'
$srvCrt = Join-Path $certDir 'server.crt'

# 1c. digilog-addresses.ini - the ONE place for this server's names / IPs / port
#     (tasks/AUTO-IP-RECOVERY-PLAN.md, Part 3). Created here on a fresh install;
#     a file left by an earlier install is kept and wins over -ApiPort, so the
#     port, certificate, origins and firewall all agree with it.
. (Join-Path $scriptsDir 'address-config.ps1')
$addrFile = Join-Path $configDir 'digilog-addresses.ini'
if (-not (Test-Path $addrFile)) {
  if ($DryRun) { Write-Host "[dry-run] create $addrFile (address $lanIp, api $ApiPort)" -ForegroundColor Yellow }
  else {
    New-DigilogAddressFile -Path $addrFile -Addresses @($lanIp | Where-Object { $_ -ne '127.0.0.1' }) -ApiPort $ApiPort -Apply 'Start menu: FMS > Apply server addresses'
    Write-Host "==> Created $addrFile" -ForegroundColor Cyan
  }
}
try {
  $addrCfg = if (Test-Path $addrFile) { Read-DigilogAddresses -Path $addrFile -DefaultApiPort $ApiPort }
             else { @{ Addresses = @($lanIp | Where-Object { $_ -ne '127.0.0.1' }); Ips = @(); Names = @(); ApiPort = $ApiPort; WebPort = 0 } }
} catch { Write-Host "FATAL: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
$addrCfg.WebPort = 0
if ($addrCfg.ApiPort -ne $ApiPort) {
  Write-Host "==> Using port $($addrCfg.ApiPort) from $addrFile (not $ApiPort)" -ForegroundColor Cyan
  $ApiPort = $addrCfg.ApiPort
}

$certArgs = @{ CertDir = $certDir; OpenSsl = $openssl; OpenSslConf = $env:OPENSSL_CONF; ExtraNames = $addrCfg.Addresses }
if ($DryRun) { $certArgs['DryRun'] = $true }
& (Join-Path $scriptsDir 'issue-lan-cert.ps1') @certArgs
if ($LASTEXITCODE -ne 0) { exit 1 }

# 2. Secrets + env file. Reuse if present (idempotent); never regenerate.
$appDbPassword = $null
$allowedOrigins = Get-DigilogAllowedOrigins $addrCfg
if (Test-Path $envFile) {
  Write-Host "==> Reusing existing $envFile (secrets preserved)" -ForegroundColor Cyan
  # An UPGRADE reuses the existing env file, so a key added in a later release is
  # never present on an upgraded box unless it is appended here. Without this,
  # an upgraded install would fall back to the compiled-in default and write its
  # logs INSIDE the program dir - which the next upgrade deletes.
  # Append-only and idempotent: never rewrite a key the operator may have tuned.
  $existing = Get-Content -Path $envFile -Raw
  if ($existing -notmatch '(?m)^\s*LOG_DIR\s*=') {
    if ($DryRun) {
      Write-Host "[dry-run] append LOG_DIR=$logDir to $envFile" -ForegroundColor Yellow
    } else {
      Add-Content -Path $envFile -Encoding ascii -Value "`r`n# Added on upgrade: operational log directory (7-day rolling, per channel).`r`nLOG_DIR=$logDir"
      Write-Host "==> Added LOG_DIR to $envFile" -ForegroundColor Cyan
    }
  }
  # PORT + ALLOWED_ORIGINS belong to digilog-addresses.ini now, so a reinstall
  # over a kept env file must follow it (everything else stays untouched).
  if ($DryRun) { Write-Host "[dry-run] set PORT=$ApiPort + ALLOWED_ORIGINS in $envFile" -ForegroundColor Yellow }
  else {
    Set-DigilogEnvKey $envFile 'PORT' $ApiPort
    Set-DigilogEnvKey $envFile 'ALLOWED_ORIGINS' $allowedOrigins
  }
} else {
  if (-not $AdminPassword) { Write-Host "FATAL: -AdminPassword required on fresh install." -ForegroundColor Red; exit 1 }
  $appDbPassword = NewSecret 18
  $jwt           = NewSecret 48
  $verify        = NewSecret 48
  $offline       = NewSecret 48
  $auditKey      = NewSecret 48
  $dbUrl = "postgresql://digilog:$appDbPassword@localhost:$PgPort/digilog_db?schema=public"
  $envBody = @"
DATABASE_URL=$dbUrl
JWT_SECRET=$jwt
VERIFICATION_TOKEN_SECRET=$verify
OFFLINE_REPLAY_SECRET=$offline
# 21 CFR Part 11 tamper-evidence: keyed HMAC-SHA256 audit chain (checksum_version=3).
# Generated per-install and MUST be backed up OUTSIDE the database. If lost/changed,
# all v3 audit rows become permanently unverifiable. Do NOT remove to "fix" a verify
# error - losing this key is itself the compliance failure. See lib/hash-chain.ts.
AUDIT_CHAIN_KEY=$auditKey
# Cutover anchor for the keyed HMAC chain. A fresh install starts with an
# empty audit_trail, so the very first audited row (chain_position 1) is
# already keyed - every row must be v3 from the start. Do NOT change.
AUDIT_CHAIN_KEYED_FROM=1
# JWT lifetime ceiling in hours (integer). The Session Settings page can offer
# a longer 'Session Duration', but signToken clamps every token to this value.
# Unset = 1 hour. The old JWT_EXPIRES_IN key was read by nothing and was
# removed 2026-08-18 (security assessment API-15).
JWT_EXPIRY_HOURS=1
NODE_ENV=production
# API_DOCS is deliberately NOT set: Swagger UI at /docs is opt-in and fail-closed.
# Adding it here would publish the full API map on the customer machine.
# Security assessment 2026-08-17, finding F-01 / API-07. See lib/swagger.ts.
PORT=$ApiPort
API_HTTPS=true
TLS_KEY_PATH=$srvKey
TLS_CERT_PATH=$srvCrt
SERVE_WEB=true
WEB_DIST_DIR=$webDist
UPLOAD_DIR=$uploadDir
# Operational logs (error / application / http / database / services / security
# and per-module files) land in <LOG_DIR>\app\, alongside WinSW's own service
# logs in <LOG_DIR>\. MUST point at the data root: the program dir is read-only
# and replaced wholesale on upgrade, so logs written there would be destroyed by
# the next upgrade - and lost exactly when someone needs them to explain it.
# Retention is 7 days per channel; override with LOG_RETENTION_DAYS.
# These are NOT the 21 CFR Part 11 audit trail (that lives in the database,
# hash-chained and retained permanently) - they are rotated and deleted.
LOG_DIR=$logDir
# Browser origins allowed to call the API - generated from digilog-addresses.ini.
# Change the addresses there and use Start menu > FMS > Apply server addresses.
ALLOWED_ORIGINS=$allowedOrigins
"@
  if ($DryRun) { Write-Host "[dry-run] write $envFile (secrets generated, app-db password random)" -ForegroundColor Yellow }
  else { Set-Content -Path $envFile -Value $envBody -Encoding ascii; Write-Host "==> Wrote $envFile (secrets generated)" -ForegroundColor Cyan }
}

# 3. Provision the bundled Postgres (fresh cluster + schema + seed).
#    On reuse we already have a populated cluster; skip if the data dir exists.
$dbAlreadyInit = Test-Path (Join-Path $dbDir 'PG_VERSION')
if ($dbAlreadyInit) {
  Write-Host "==> DB cluster already initialized at $dbDir - skipping provision (fresh install only)" -ForegroundColor Cyan
} else {
  if (-not $appDbPassword) { Write-Host "FATAL: env file exists but DB not initialized - inconsistent state. Manual review needed." -ForegroundColor Red; exit 1 }
  # Hashtable splatting (binds by NAME). Array splatting would bind positionally.
  $provArgs = @{
    PgBin = $pgBin; DataDir = $dbDir; Port = $PgPort;
    AppPassword = $appDbPassword; SuperPassword = (NewSecret 18);
    AdminPassword = $AdminPassword; ApiDir = $apiDir; LogDir = $logDir;
    NodeExe = $nodeExe
    # Fresh install: seed the approved roles / re-auth / tablet access / settings
    # (prisma install-baseline.json), not the code defaults.
    UseInstallBaseline = $true
    # MUST be $true. provision-db starts the cluster directly (pg_ctl start) to run
    # migrate+seed. If it is left running it keeps the data dir, port and
    # postmaster.pid, so `sc start DigiLogDB` launches a SECOND postmaster which
    # immediately dies on the lock; DigiLogAPI then fails 1068 (dependency not
    # running) and this script exits before the firewall rule and backup task are
    # created. A running cluster CANNOT be adopted by the Windows service - the
    # service must start its own. (Fixed 2026-08-19; the old default left it up.)
    StopWhenDone = $true
  }
  if ($DryRun) { Write-Host "[dry-run] provision-db.ps1 (DataDir=$dbDir Port=$PgPort ApiDir=$apiDir)" -ForegroundColor Yellow }
  else {
    & (Join-Path $scriptsDir 'provision-db.ps1') @provArgs
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: provisioning" -ForegroundColor Red; exit 1 }
    # Prove the cluster really stopped before we register the service over the same
    # data dir. pg_isready succeeding here means a postmaster is still holding the
    # port, and registration would produce the 1068 cascade described above.
    $pgReadyExe = Join-Path $pgBin 'pg_isready.exe'
    & $pgReadyExe -h localhost -p $PgPort 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "==> cluster still accepting connections after provisioning; stopping it" -ForegroundColor Yellow
      & (Join-Path $pgBin 'pg_ctl.exe') -D $dbDir -m fast -w stop 2>&1 | Out-Null
      Start-Sleep -Seconds 2
      & $pgReadyExe -h localhost -p $PgPort 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Host "FATAL: a PostgreSQL process is still holding port $PgPort / $dbDir." -ForegroundColor Red
        Write-Host "       The DigiLogDB service cannot start while it runs. Stop it and re-run Setup." -ForegroundColor Red
        exit 1
      }
    }
  }
}

# 4. Register the Windows services (DB + API), auto-start.
$regArgs = @{
  PgBin = $pgBin; PgDataDir = $dbDir; Port = $PgPort;
  NodeExe = $nodeExe; AppEntry = $appEntry; EnvFile = $envFile;
  WinswExe = $winswExe; ServiceDir = $serviceDir; LogDir = $logDir
}
if ($DryRun) { $regArgs['DryRun'] = $true }
& (Join-Path $scriptsDir 'register-services.ps1') @regArgs
if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: service registration" -ForegroundColor Red; exit 1 }

# 4b. Nightly DB backup task (21 CFR S11.10(c) - record protection). Non-fatal:
#     a missing backup job must not block the install, but register-backup-task
#     WARNs loudly so it is not signed off at IQ. upgrade.ps1 calls the same
#     script, because the installer's upgrade path never runs this file.
$btArgs = @{ InstallDir = $InstallDir; DataRoot = $DataRoot; RetainDays = $BackupRetainDays }
if ($DryRun) { $btArgs['DryRun'] = $true }
& (Join-Path $scriptsDir 'register-backup-task.ps1') @btArgs

# 5. Firewall rule (optional - lets the Android tablet reach the API over LAN).
if ($DryRun) { Write-Host "[dry-run] netsh advfirewall add rule DigiLog-API TCP $ApiPort" -ForegroundColor Yellow }
else {
  netsh advfirewall firewall add rule name="DigiLog API" dir=in action=allow protocol=TCP localport=$ApiPort | Out-Null
}

# 6. Health check.
if (-not $DryRun) {
  Write-Host "==> Waiting for API health..." -ForegroundColor Cyan
  $ok = $false
  foreach ($i in 1..30) {
    try { $r = Invoke-WebRequest "https://localhost:$ApiPort/api/health" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if ($ok) { Write-Host "`nDigiLog is running. Open https://localhost:$ApiPort  (login: superadmin)" -ForegroundColor Green }
  else { Write-Host "`nWARN: API did not report healthy within 30s. Check $logDir." -ForegroundColor Yellow; exit 1 }
}

Write-Host "Install orchestration complete." -ForegroundColor Green
exit 0
