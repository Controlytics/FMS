# DigiLog — Production packaging script
#
# Run this on the DEVELOPMENT machine (where you've been building) to produce
# a self-contained `digilog-production/` folder and `digilog-production.zip`
# that can be handed to a customer for Windows deployment.
#
# Output zip is ~150 MB smaller than the pre-rewrite version (no bundled
# Chromium, no Redis/Memurai bundle, no EMQX). Stack: Mosquitto 2.0 (MQTT),
# graphile-worker on Postgres (job queue), puppeteer-core + Edge (PDF).
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/package-for-production.ps1
#
# Requires: Node.js, npm, Windows PowerShell 5.1+ or PowerShell 7+

$ErrorActionPreference = 'Stop'

# ─── Resolve paths ───────────────────────────────────────
$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$OutDir = Join-Path $RepoRoot 'digilog-production'
$OutZip = Join-Path $RepoRoot 'digilog-production.zip'
$ApiSrc = Join-Path $RepoRoot 'apps\api'
$WebSrc = Join-Path $RepoRoot 'apps\web'
$CertsSrc = Join-Path $RepoRoot 'certs'
$ApkSrc = Join-Path $RepoRoot 'DigiLog-FilterOps.apk'

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  DigiLog — Production Packaging Script" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Repo root: $RepoRoot"
Write-Host "Output:    $OutDir"
Write-Host ""

# ─── Clean output dir ────────────────────────────────────
if (Test-Path $OutDir) {
    Write-Host "[1/8] Removing previous $OutDir..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $OutDir
}
if (Test-Path $OutZip) { Remove-Item -Force $OutZip }
New-Item -ItemType Directory -Path $OutDir | Out-Null
Write-Host "[1/8] Fresh output directory created." -ForegroundColor Green

# ─── Build the API ───────────────────────────────────────
Write-Host ""
Write-Host "[2/8] Building API (tsc)..." -ForegroundColor Yellow
Push-Location $ApiSrc
try {
    & npx tsc
    if ($LASTEXITCODE -ne 0) { throw "API tsc build failed" }
} finally { Pop-Location }
Write-Host "[2/8] API build OK." -ForegroundColor Green

# ─── Build the web bundle ────────────────────────────────
Write-Host ""
Write-Host "[3/8] Building web (vite build)..." -ForegroundColor Yellow
Push-Location $WebSrc
try {
    & npx vite build
    if ($LASTEXITCODE -ne 0) { throw "Vite build failed" }
} finally { Pop-Location }
Write-Host "[3/8] Web build OK." -ForegroundColor Green

# ─── Assemble API folder ─────────────────────────────────
Write-Host ""
Write-Host "[4/8] Copying API artifacts..." -ForegroundColor Yellow
$ApiOut = Join-Path $OutDir 'api'
New-Item -ItemType Directory -Path $ApiOut | Out-Null

# Compiled JS
Copy-Item -Recurse -Force (Join-Path $ApiSrc 'dist') (Join-Path $ApiOut 'dist')
# Prisma schema + migrations (needed for `prisma migrate deploy`)
Copy-Item -Recurse -Force (Join-Path $ApiSrc 'prisma') (Join-Path $ApiOut 'prisma')
# package.json + package-lock for production npm install
Copy-Item -Force (Join-Path $ApiSrc 'package.json') (Join-Path $ApiOut 'package.json')
$LockSrc = Join-Path $RepoRoot 'package-lock.json'
if (Test-Path $LockSrc) {
    Copy-Item -Force $LockSrc (Join-Path $ApiOut 'package-lock.json')
}
Write-Host "[4/8] API folder assembled." -ForegroundColor Green

# ─── Assemble web folder ─────────────────────────────────
Write-Host ""
Write-Host "[5/8] Copying web artifacts..." -ForegroundColor Yellow
$WebOut = Join-Path $OutDir 'web'
Copy-Item -Recurse -Force (Join-Path $WebSrc 'dist') $WebOut
Write-Host "[5/8] Web folder assembled." -ForegroundColor Green

# ─── Copy certs ──────────────────────────────────────────
Write-Host ""
Write-Host "[6/8] Copying certs..." -ForegroundColor Yellow
if (Test-Path $CertsSrc) {
    $CertsOut = Join-Path $OutDir 'certs'
    New-Item -ItemType Directory -Path $CertsOut | Out-Null
    foreach ($f in @('server.crt', 'server.key', 'rootCA.pem')) {
        $src = Join-Path $CertsSrc $f
        if (Test-Path $src) {
            Copy-Item -Force $src (Join-Path $CertsOut $f)
            Write-Host "       copied $f" -ForegroundColor DarkGray
        } else {
            Write-Host "       WARNING: $f not found in $CertsSrc" -ForegroundColor Red
        }
    }
    Write-Host "[6/8] Certs copied." -ForegroundColor Green
} else {
    Write-Host "[6/8] WARNING: $CertsSrc not found. Customer will need to generate certs." -ForegroundColor Red
}

# ─── Copy APK ────────────────────────────────────────────
Write-Host ""
Write-Host "[7/8] Copying APK and install scripts..." -ForegroundColor Yellow
if (Test-Path $ApkSrc) {
    Copy-Item -Force $ApkSrc (Join-Path $OutDir 'DigiLog-FilterOps.apk')
    Write-Host "       copied DigiLog-FilterOps.apk" -ForegroundColor DarkGray
} else {
    Write-Host "       WARNING: $ApkSrc not found. Build the APK first:" -ForegroundColor Red
    Write-Host "         cd apps/web && npx vite build" -ForegroundColor DarkGray
    Write-Host "         cd ../android && npx cap sync android" -ForegroundColor DarkGray
    Write-Host "         cd android && .\gradlew assembleDebug" -ForegroundColor DarkGray
}

# Copy the install scripts and deploy guide
$ScriptsOut = Join-Path $OutDir 'scripts'
New-Item -ItemType Directory -Path $ScriptsOut | Out-Null
# install-on-target.ps1 invokes install-mosquitto.ps1 via $PSScriptRoot, so
# both scripts must ride along — no silent skip on missing.
foreach ($s in @('install-on-target.ps1', 'install-mosquitto.ps1')) {
    $src = Join-Path $RepoRoot "scripts\$s"
    if (-not (Test-Path $src)) { throw "Required script not found: $src" }
    Copy-Item -Force $src (Join-Path $ScriptsOut $s)
}
Copy-Item -Force (Join-Path $RepoRoot 'DEPLOY-WINDOWS.md') (Join-Path $OutDir 'DEPLOY-WINDOWS.md')

# Mosquitto config dir — install-mosquitto.ps1 reads mosquitto.conf and the
# dynsec template from here, so it must travel with the package.
$MosquittoSrc = Join-Path $RepoRoot 'mosquitto'
if (Test-Path $MosquittoSrc) {
    Copy-Item -Recurse -Force $MosquittoSrc (Join-Path $OutDir 'mosquitto')
    Write-Host "       copied mosquitto/ config" -ForegroundColor DarkGray
} else {
    throw "mosquitto/ config dir not found at $MosquittoSrc - required for the customer install."
}

# .env.example template
# Source of truth: apps/api/.env.example. Keep MQTT / queue / PDF blocks
# below in sync with it after every windows-friendly-rewrite phase.
$EnvExample = @"
# ─── PostgreSQL ────────────────────────────────────────
DATABASE_URL=postgresql://digilog:CHANGE_ME_STRONG_PASSWORD@localhost:5432/digilog_db?schema=public

# ─── TimescaleDB ───────────────────────────────────────
TSDB_HOST=localhost
TSDB_PORT=5432
TSDB_DATABASE=digilog_tsdb
TSDB_USER=digilog
TSDB_PASSWORD=CHANGE_ME_STRONG_PASSWORD
TSDB_POOL_MAX=10

# ─── MQTT (Mosquitto 2.0) ──────────────────────────────
# Phase 1 of windows-friendly-rewrite swapped from EMQX. Install via
# scripts/install-mosquitto.ps1 (elevated). After every POST
# /api/internal/mqtt/refresh-acl, copy the regenerated dynsec into
# C:\Program Files\mosquitto\ and Restart-Service mosquitto.
USE_MOSQUITTO=true
MOSQUITTO_ADMIN_PASSWORD=CHANGE_ME_RANDOM_12_PLUS_CHAR_STRING
MOSQUITTO_REFRESH_TOKEN=CHANGE_ME_RANDOM_BEARER_SECRET
MOSQUITTO_DYNSEC_PATH=./mosquitto/dynamic-security.json

# ─── Job queue ─────────────────────────────────────────
# Queue runs on Postgres via graphile-worker — no Redis required.
# (If pub/sub Redis is added later, set REDIS_HOST/PORT/PASSWORD here. Redis >=5.)

# ─── PDF rendering ─────────────────────────────────────
# Phase 3 of windows-friendly-rewrite — puppeteer-core + Edge (no bundled
# Chromium). detectEdgePath() probes Edge -> Chrome on Windows automatically.
# Set this only to override the auto-detected browser executable.
# PUPPETEER_EXECUTABLE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe

# ─── UNS ───────────────────────────────────────────────
UNS_ROOT_PREFIX=digilog/v1
UNS_VERSION=v1

# ─── JWT Configuration ─────────────────────────────────
# GENERATE these with:
#   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 64 | ForEach-Object {[char]\$_})
JWT_SECRET=REPLACE_WITH_A_RANDOM_64_CHAR_STRING
VERIFICATION_TOKEN_SECRET=REPLACE_WITH_A_DIFFERENT_RANDOM_64_CHAR_STRING
JWT_EXPIRES_IN=8h

# ─── Server Configuration ──────────────────────────────
NODE_ENV=production
API_PORT=3000
# Required for tablet APK (which uses HTTPS-baked URL). Keep on.
API_HTTPS=true

# ─── CORS ──────────────────────────────────────────────
# Replace 192.168.1.100 with your server's LAN IP or hostname
CORS_ORIGIN=https://192.168.1.100
ALLOWED_ORIGINS=https://192.168.1.100,capacitor://localhost,http://localhost

# ─── Upload Configuration ──────────────────────────────
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5242880
"@
Set-Content -Path (Join-Path $OutDir '.env.example') -Value $EnvExample -Encoding UTF8
Write-Host "[7/8] Scripts, deploy guide, and .env.example assembled." -ForegroundColor Green

# ─── Zip it ──────────────────────────────────────────────
Write-Host ""
Write-Host "[8/8] Creating $OutZip..." -ForegroundColor Yellow
Compress-Archive -Path $OutDir -DestinationPath $OutZip -Force
$ZipSize = (Get-Item $OutZip).Length / 1MB
Write-Host "[8/8] Created $OutZip ({0:N1} MB)" -f $ZipSize -ForegroundColor Green

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Done. Package ready to hand to the customer." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Folder: $OutDir"
Write-Host "  Zip:    $OutZip"
Write-Host ""
Write-Host "  Next: Copy the ZIP to the target machine, extract, then" -ForegroundColor White
Write-Host "        run scripts\install-on-target.ps1 from an elevated" -ForegroundColor White
Write-Host "        PowerShell. Follow DEPLOY-WINDOWS.md for the full" -ForegroundColor White
Write-Host "        flow (no Nginx / no PM2 required)." -ForegroundColor White
Write-Host ""
