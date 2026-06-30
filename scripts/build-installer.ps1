<#
.SYNOPSIS
  Build pipeline that produces DigiLog-Setup-<ver>.exe. Run on a BUILD MACHINE
  (needs Inno Setup 6 + internet for the bundled binaries).
  See tasks/EXE-PACKAGING-PLAN.md section 4 + M5.

.DESCRIPTION
  Stages everything the installer ships into <OutDir>\stage, then compiles the
  Inno Setup script. Steps:
    1. build the app bundle (scripts/build-bundle.ps1)
    2. clean-room production deps (npm ci --omit=dev in an isolated checkout)
    3. stage runtime/ (scripts/stage-runtime.ps1)
    4. stage pgsql/  (portable PostgreSQL binaries)
    5. stage service/ (WinSW-x64.exe)
    6. stage scripts/ (provision/register/install/uninstall)
    7. ISCC -> Setup.exe

  Prerequisites (the build machine provides these; not committed to the repo):
    -NodeZip   path to node-vXX-win-x64.zip      (ABI must match the native build)
    -PgZip     path to postgresql-18-...-windows-x64-binaries.zip
    -WinswExe  path to WinSW-x64.exe              (github.com/winsw/winsw releases)
    -Iscc      path to ISCC.exe                   (Inno Setup 6)

  This script is authored + structured here; a full run requires those external
  binaries + Inno Setup and is performed on the build machine.

.PARAMETER AppVersion  Version stamped into the installer + filename
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$NodeZip,
  [Parameter(Mandatory)] [string]$PgZip,
  [Parameter(Mandatory)] [string]$WinswExe,
  [string]$Iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  [string]$AppVersion = '0.1.0',
  [string]$OutDir
)

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $repoRoot 'dist' }
$stage    = Join-Path $OutDir 'stage'
$cleanDir = Join-Path $OutDir 'cleanroom'

function Step($name, $block) {
  Write-Host "==> $name" -ForegroundColor Cyan
  & $block
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $name (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
}

# Fresh staging
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage, $cleanDir | Out-Null

# 1. Build the app (shared/queue/api/web)
Step "Build app bundle" { & (Join-Path $PSScriptRoot 'build-bundle.ps1') }

# 2. Clean-room production deps. We do `npm ci --omit=dev` in an isolated tree so
#    the live repo node_modules (with dev deps) is never disturbed. git archive
#    gives a pristine checkout; then we build the workspace packages there too.
Step "Clean-room npm ci --omit=dev" {
  Push-Location $repoRoot
  try {
    if (Test-Path (Join-Path $cleanDir '.git-archive')) { Remove-Item -Recurse -Force (Join-Path $cleanDir '.git-archive') }
    git archive --format=tar HEAD | tar -x -C $cleanDir
    Push-Location $cleanDir
    npm ci --omit=dev
    Pop-Location
  } finally { Pop-Location }
}

# 3. Extract portable node.exe
$nodeTmp = Join-Path $OutDir 'node-extract'
if (Test-Path $nodeTmp) { Remove-Item -Recurse -Force $nodeTmp }
Expand-Archive -Path $NodeZip -DestinationPath $nodeTmp -Force
$nodeExe = (Get-ChildItem $nodeTmp -Recurse -Filter 'node.exe' | Select-Object -First 1).FullName

# 4. Stage runtime/ (uses the clean-room production node_modules)
Step "Stage runtime" {
  & (Join-Path $PSScriptRoot 'stage-runtime.ps1') `
    -NodeExe $nodeExe -NodeModulesSrc (Join-Path $cleanDir 'node_modules') `
    -RepoRoot $repoRoot -OutDir (Join-Path $stage 'runtime')
}

# 5. Stage pgsql/ (portable PostgreSQL binaries)
Write-Host "==> Stage pgsql" -ForegroundColor Cyan
$pgTmp = Join-Path $OutDir 'pg-extract'
if (Test-Path $pgTmp) { Remove-Item -Recurse -Force $pgTmp }
Expand-Archive -Path $PgZip -DestinationPath $pgTmp -Force
# EDB zip extracts to a 'pgsql' subfolder
$pgRoot = (Get-ChildItem $pgTmp -Recurse -Directory -Filter 'bin' | Where-Object { Test-Path (Join-Path $_.FullName 'initdb.exe') } | Select-Object -First 1).Parent.FullName
Copy-Item $pgRoot (Join-Path $stage 'pgsql') -Recurse -Force

# 6. Stage service/ + scripts/
Write-Host "==> Stage service + scripts" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'service'), (Join-Path $stage 'scripts') | Out-Null
Copy-Item $WinswExe (Join-Path $stage 'service\WinSW-x64.exe') -Force
foreach ($s in 'provision-db.ps1','register-services.ps1','unregister-services.ps1','install.ps1','uninstall.ps1') {
  Copy-Item (Join-Path $PSScriptRoot $s) (Join-Path $stage 'scripts') -Force
}
Copy-Item (Join-Path $repoRoot 'apps\api\prisma\sql') (Join-Path $stage 'runtime\api\prisma\sql') -Recurse -Force -ErrorAction SilentlyContinue

# 7. Compile the installer
Write-Host "==> Compile installer (ISCC)" -ForegroundColor Cyan
if (-not (Test-Path $Iscc)) { Write-Host "Inno Setup not found at $Iscc - install Inno Setup 6 to compile. Staging is ready at $stage." -ForegroundColor Yellow; exit 0 }
& $Iscc "/DStageDir=$stage" "/DAppVersion=$AppVersion" (Join-Path $repoRoot 'installer\DigiLog.iss')
if ($LASTEXITCODE -ne 0) { Write-Host "ISCC failed" -ForegroundColor Red; exit 1 }
Write-Host "`nInstaller built: $OutDir\DigiLog-Setup-$AppVersion.exe" -ForegroundColor Green
