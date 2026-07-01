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

# 2. Secrets + env file. Reuse if present (idempotent); never regenerate.
$appDbPassword = $null
if (Test-Path $envFile) {
  Write-Host "==> Reusing existing $envFile (secrets preserved)" -ForegroundColor Cyan
} else {
  if (-not $AdminPassword) { Write-Host "FATAL: -AdminPassword required on fresh install." -ForegroundColor Red; exit 1 }
  $appDbPassword = NewSecret 18
  $jwt           = NewSecret 48
  $verify        = NewSecret 48
  $offline       = NewSecret 48
  $dbUrl = "postgresql://digilog:$appDbPassword@localhost:$PgPort/digilog_db?schema=public"
  $envBody = @"
DATABASE_URL=$dbUrl
JWT_SECRET=$jwt
VERIFICATION_TOKEN_SECRET=$verify
OFFLINE_REPLAY_SECRET=$offline
JWT_EXPIRES_IN=1h
NODE_ENV=production
PORT=$ApiPort
API_HTTPS=false
SERVE_WEB=true
WEB_DIST_DIR=$webDist
UPLOAD_DIR=$uploadDir
ALLOWED_ORIGINS=http://localhost:$ApiPort
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
  }
  if ($DryRun) { Write-Host "[dry-run] provision-db.ps1 (DataDir=$dbDir Port=$PgPort ApiDir=$apiDir)" -ForegroundColor Yellow }
  else {
    & (Join-Path $scriptsDir 'provision-db.ps1') @provArgs
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: provisioning" -ForegroundColor Red; exit 1 }
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
    try { $r = Invoke-WebRequest "http://localhost:$ApiPort/api/health" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if ($ok) { Write-Host "`nDigiLog is running. Open http://localhost:$ApiPort  (login: superadmin)" -ForegroundColor Green }
  else { Write-Host "`nWARN: API did not report healthy within 30s. Check $logDir." -ForegroundColor Yellow; exit 1 }
}

Write-Host "Install orchestration complete." -ForegroundColor Green
exit 0
