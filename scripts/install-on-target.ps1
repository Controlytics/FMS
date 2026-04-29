# DigiLog — Run-once install script for the TARGET Windows machine
#
# Assumes:
#   - You've already unzipped digilog-production.zip to this folder
#   - Node.js 20+ and PostgreSQL 18 + TimescaleDB are installed
#     (see DEPLOY-WINDOWS.md section 3)
#   - Mosquitto 2.0 is installed by this script (step 3 below) — no separate
#     prereq install required
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
Step "1/9" "Verifying prerequisites..."
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

# Postgres check (via psql if available)
try {
    $null = & psql --version
    Write-Host "     psql:    available" -ForegroundColor DarkGray
} catch {
    Write-Host "     psql:    not on PATH (install Postgres 18 or add bin to PATH)" -ForegroundColor Yellow
}

# Microsoft Edge check (puppeteer-core uses Edge for PDF rendering)
$edgeX86 = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$edgeX64 = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
if ((Test-Path $edgeX86) -or (Test-Path $edgeX64)) {
    $foundEdge = if (Test-Path $edgeX86) { $edgeX86 } else { $edgeX64 }
    Write-Host "     Edge:    found at $foundEdge" -ForegroundColor DarkGray
} else {
    Write-Host "     Edge:    NOT FOUND — Reports/PDF rendering will fail" -ForegroundColor Yellow
    Write-Host "              Install Microsoft Edge (https://www.microsoft.com/edge)" -ForegroundColor Yellow
    Write-Host "              OR set PUPPETEER_EXECUTABLE_PATH in .env to a Chromium-family browser" -ForegroundColor Yellow
}

# ─── Enable Windows long paths ───────────────────────────
Step "2/9" "Enabling Windows long-paths support..."
try {
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -Type DWord -Force
    Write-Host "     LongPathsEnabled = 1 (HKLM\SYSTEM\CurrentControlSet\Control\FileSystem)" -ForegroundColor Green
} catch {
    Write-Host "     FAILED to set LongPathsEnabled — re-run as admin if Node module paths fail later" -ForegroundColor Yellow
    Write-Host "     ($($_.Exception.Message))" -ForegroundColor DarkGray
}

# ─── Install Mosquitto MQTT broker ───────────────────────
Step "3/9" "Installing/registering Mosquitto 2.0 (idempotent)..."
$mosquittoScript = Join-Path $PSScriptRoot 'install-mosquitto.ps1'
if (-not (Test-Path $mosquittoScript)) {
    Die "install-mosquitto.ps1 not found at $mosquittoScript"
}
& $mosquittoScript

# ─── Copy .env into api/ ─────────────────────────────────
Step "4/9" "Copying .env into api/..."
Copy-Item -Force $EnvFile (Join-Path $ApiDir '.env')
Write-Host "     .env copied into api/" -ForegroundColor DarkGray

# ─── Install API dependencies ────────────────────────────
Step "5/9" "Installing API dependencies (npm ci --omit=dev)..."
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
Step "6/9" "Generating Prisma client..."
Push-Location $ApiDir
try {
    & npx prisma generate
    if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
} finally { Pop-Location }

# ─── Apply migrations ────────────────────────────────────
Step "7/9" "Applying database migrations (prisma migrate deploy)..."
Push-Location $ApiDir
try {
    & npx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) {
        Die "prisma migrate deploy failed. Check DATABASE_URL in .env and that digilog_db exists."
    }
} finally { Pop-Location }

# ─── Seed default data ───────────────────────────────────
Step "8/9" "Seeding default roles, config, and superadmin user..."
Push-Location $ApiDir
try {
    # Prisma seed if a seed script is configured, otherwise skip
    try {
        & npx prisma db seed
        if ($LASTEXITCODE -ne 0) {
            Write-Host "     prisma db seed returned non-zero — config auto-seeds on first API start, so this is usually fine." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "     Seed command not configured — config registry will auto-seed on first start." -ForegroundColor Yellow
    }
} finally { Pop-Location }

# ─── Open Windows Firewall ports ─────────────────────────
Step "9/9" "Opening Windows Firewall ports (admin required)..."
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
Open-Port 'DigiLog Web HTTP'        80
Open-Port 'DigiLog Web HTTPS'       443
Open-Port 'DigiLog API HTTPS'       3000
Open-Port 'DigiLog Mosquitto MQTT'  1883

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Install complete." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Start the API (smoke test only):" -ForegroundColor White
Write-Host "    cd api" -ForegroundColor White
Write-Host "    node dist/app.js" -ForegroundColor White
Write-Host ""
Write-Host "  NOTE: this runs in the foreground in a console window — no auto-restart," -ForegroundColor Yellow
Write-Host "        no boot persistence, no log rotation. It is for smoke testing only." -ForegroundColor Yellow
Write-Host "        A managed Windows-service launcher is tracked as Phase 5 work" -ForegroundColor Yellow
Write-Host "        (verify-windows-deployment.ps1 + service registration)." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    1. Verify smoke tests in DEPLOY-WINDOWS.md section 6"
Write-Host "    2. Install rootCA.pem on tablets (section 5.5)"
Write-Host "    3. Install DigiLog-FilterOps.apk on tablets (section 5.6)"
Write-Host "    4. CHANGE THE DEFAULT PASSWORD on first login"
Write-Host ""
Write-Host "  Default login: superadmin / Admin@123   (CHANGE THIS IMMEDIATELY)"
Write-Host ""
