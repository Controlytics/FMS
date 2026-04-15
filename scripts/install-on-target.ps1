# DigiLog — Run-once install script for the TARGET Windows machine
#
# Assumes:
#   - You've already unzipped digilog-production.zip to this folder
#   - Node.js 20+, PostgreSQL 18 + TimescaleDB, Memurai, EMQX, and Nginx are
#     all installed (see DEPLOY-WINDOWS.md section 3)
#   - You've created digilog_db and digilog_tsdb databases (section 5.2)
#   - You've filled in .env with real passwords and secrets (section 5.3)
#
# Run from the digilog-production folder:
#   powershell -ExecutionPolicy Bypass -File scripts/install-on-target.ps1

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path "$PSScriptRoot\..").Path
$ApiDir = Join-Path $Root 'api'
$EnvFile = Join-Path $Root '.env'

function Step($n, $msg) {
    Write-Host ""
    Write-Host "[$n] $msg" -ForegroundColor Cyan
}

function Die($msg) {
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  DigiLog — Target machine install script" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ─── Sanity checks ───────────────────────────────────────
Step "1/8" "Verifying prerequisites..."
if (-not (Test-Path $ApiDir)) { Die "api/ folder not found at $ApiDir. Did you unzip the package here?" }
if (-not (Test-Path $EnvFile)) { Die ".env not found at $EnvFile. Copy .env.example to .env and fill it in first (see DEPLOY-WINDOWS.md section 5.3)." }

try {
    $nodeVer = & node --version
    Write-Host "     Node:    $nodeVer" -ForegroundColor DarkGray
} catch { Die "node not found on PATH. Install Node.js 20+ from nodejs.org" }

try {
    $npmVer = & npm --version
    Write-Host "     npm:     $npmVer" -ForegroundColor DarkGray
} catch { Die "npm not found on PATH." }

# Redis/Memurai check
$redisOk = $false
try {
    $pong = & redis-cli -p 6379 ping 2>&1
    if ($pong -eq 'PONG') { $redisOk = $true; Write-Host "     Redis:   PONG (Memurai OK)" -ForegroundColor DarkGray }
} catch { }
if (-not $redisOk) {
    Write-Host "     Redis:   NOT RESPONDING — install Memurai and make sure it's running" -ForegroundColor Yellow
    Write-Host "              (https://www.memurai.com/get-memurai)" -ForegroundColor Yellow
}

# Postgres check (via psql if available)
try {
    $null = & psql --version
    Write-Host "     psql:    available" -ForegroundColor DarkGray
} catch {
    Write-Host "     psql:    not on PATH (install Postgres 18 or add bin to PATH)" -ForegroundColor Yellow
}

# ─── Copy .env into api/ ─────────────────────────────────
Step "2/8" "Copying .env into api/..."
Copy-Item -Force $EnvFile (Join-Path $ApiDir '.env')
Write-Host "     .env copied into api/" -ForegroundColor DarkGray

# ─── Install API dependencies ────────────────────────────
Step "3/8" "Installing API dependencies (npm ci --omit=dev)..."
Push-Location $ApiDir
try {
    if (Test-Path (Join-Path $ApiDir 'package-lock.json')) {
        & npm ci --omit=dev
    } else {
        Write-Host "     No lockfile found — falling back to npm install --omit=dev" -ForegroundColor Yellow
        & npm install --omit=dev
    }
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
} finally { Pop-Location }

# ─── Generate Prisma client ──────────────────────────────
Step "4/8" "Generating Prisma client..."
Push-Location $ApiDir
try {
    & npx prisma generate
    if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
} finally { Pop-Location }

# ─── Apply migrations ────────────────────────────────────
Step "5/8" "Applying database migrations (prisma migrate deploy)..."
Push-Location $ApiDir
try {
    & npx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) {
        Die "prisma migrate deploy failed. Check DATABASE_URL in .env and that digilog_db exists."
    }
} finally { Pop-Location }

# ─── Seed default data ───────────────────────────────────
Step "6/8" "Seeding default roles, config, and superadmin user..."
Push-Location $ApiDir
try {
    # Prisma seed if a seed script is configured, otherwise skip
    try {
        & npx prisma db seed 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Host "     prisma db seed returned non-zero — config auto-seeds on first API start, so this is usually fine." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "     Seed command not configured — config registry will auto-seed on first start." -ForegroundColor Yellow
    }
} finally { Pop-Location }

# ─── Install PM2 globally ────────────────────────────────
Step "7/8" "Installing PM2 process manager (if not already)..."
try {
    $pm2ver = & pm2 --version 2>&1
    Write-Host "     PM2 already installed: $pm2ver" -ForegroundColor DarkGray
} catch {
    & npm install -g pm2
    if ($LASTEXITCODE -ne 0) { Die "npm install -g pm2 failed" }
    Write-Host "     PM2 installed." -ForegroundColor Green
}

# Start the API under PM2
Write-Host "     Starting digilog-api under PM2..."
Push-Location $ApiDir
try {
    & pm2 delete digilog-api 2>&1 | Out-Null
    & pm2 start dist/app.js --name digilog-api
    if ($LASTEXITCODE -ne 0) { Die "pm2 start failed — check pm2 logs digilog-api" }
    & pm2 save
} finally { Pop-Location }

# ─── Open Windows Firewall ports ─────────────────────────
Step "8/8" "Opening Windows Firewall ports (admin required)..."
function Open-Port($name, $port, $proto = 'TCP') {
    try {
        $existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
        if ($existing) {
            Write-Host "     $name already exists — skipping" -ForegroundColor DarkGray
            return
        }
        New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol $proto -LocalPort $port -Action Allow | Out-Null
        Write-Host "     opened $port/$proto ($name)" -ForegroundColor Green
    } catch {
        Write-Host "     FAILED to open $port — run PowerShell as admin and re-run this step" -ForegroundColor Yellow
    }
}
Open-Port 'DigiLog Web HTTP'   80
Open-Port 'DigiLog Web HTTPS'  443
Open-Port 'DigiLog API HTTPS'  3000
Open-Port 'DigiLog EMQX MQTT'  1883
Open-Port 'DigiLog EMQX UI'    18083

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Install complete." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    1. Configure Nginx with the cert paths from DEPLOY-WINDOWS.md section 5.5"
Write-Host "    2. Start Nginx: C:\nginx\nginx.exe"
Write-Host "    3. Verify smoke tests in DEPLOY-WINDOWS.md section 6"
Write-Host "    4. Install rootCA.pem on tablets (section 5.6)"
Write-Host "    5. Install DigiLog-FilterOps.apk on tablets (section 5.7)"
Write-Host "    6. Make PM2 auto-start on boot: pm2-startup install"
Write-Host ""
Write-Host "  Default login: superadmin / Admin@123   (CHANGE THIS IMMEDIATELY)"
Write-Host ""
