<#
.SYNOPSIS
  Register DigiLog as two auto-starting Windows services so it survives reboots
  with no console window. The customer installer runs this (elevated).
  See tasks/EXE-PACKAGING-PLAN.md section 3 + section 7 (M4).

.DESCRIPTION
  Two services:
    DigiLogDB  - the bundled PostgreSQL cluster, via native `pg_ctl register`
    DigiLogAPI - node.exe dist/app.js, wrapped by WinSW, depends on DigiLogDB

  The Node API reads ALL runtime config (DATABASE_URL, secrets, PORT, SERVE_WEB,
  etc.) from -EnvFile via dotenv: WinSW sets DOTENV_CONFIG_PATH to that file, and
  the app's `import 'dotenv/config'` honours it. Keeping config in one env file
  (not the service XML) means upgrades never rewrite the service definition.

  This script GENERATES the WinSW XML from parameters (single source of truth,
  concrete paths) then installs both services. Use -DryRun to print every
  privileged command without executing (review before a real run).

.PARAMETER PgBin / PgDataDir / PgPort   Bundled Postgres + its private cluster
.PARAMETER NodeExe / AppEntry           Bundled node.exe + dist/app.js
.PARAMETER EnvFile                      digilog.env the API loads (DOTENV_CONFIG_PATH)
.PARAMETER WinswExe                     Path to WinSW-x64.exe (bundled by installer)
.PARAMETER ServiceDir                   Where to place DigiLogAPI.exe + .xml
.PARAMETER LogDir                       Service log directory
.PARAMETER DryRun                       Print commands instead of running them
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$PgBin,
  [Parameter(Mandatory)] [string]$PgDataDir,
  [int]$Port = 5433,
  [Parameter(Mandatory)] [string]$NodeExe,
  [Parameter(Mandatory)] [string]$AppEntry,
  [Parameter(Mandatory)] [string]$EnvFile,
  [Parameter(Mandatory)] [string]$WinswExe,
  [Parameter(Mandatory)] [string]$ServiceDir,
  [string]$LogDir,
  [string]$DbService  = 'DigiLogDB',
  [string]$ApiService = 'DigiLogAPI',
  # upgrade.ps1 (reinstall over kept data): register only the service(s) that do
  # not exist yet, and start nothing - it starts the DB itself and the API only
  # after the migration. A fresh install passes neither and behaves as before.
  [switch]$SkipExisting,
  [switch]$NoStart,
  [switch]$DryRun
)

$pgctl = Join-Path $PgBin 'pg_ctl.exe'
if (-not $LogDir) { $LogDir = Join-Path (Split-Path $PgDataDir -Parent) 'logs' }
$apiWorkdir = Split-Path $AppEntry -Parent
$apiExe = Join-Path $ServiceDir "$ApiService.exe"
$apiXml = Join-Path $ServiceDir "$ApiService.xml"

function Do-Cmd($desc, $exe, [string[]]$argList) {
  if ($DryRun) {
    Write-Host "[dry-run] $desc" -ForegroundColor Yellow
    Write-Host "          $exe $($argList -join ' ')" -ForegroundColor DarkGray
    return
  }
  Write-Host "==> $desc" -ForegroundColor Cyan
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $desc (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
}

# WinSW XML (concrete paths). <depend> makes the API wait for the DB service.
# onfailure restart keeps the API up across transient crashes. Config flows from
# DOTENV_CONFIG_PATH so the service XML never carries secrets.
$xml = @"
<service>
  <id>$ApiService</id>
  <name>DigiLog API</name>
  <description>DigiLog 21 CFR Part 11 application server (serves API + web UI).</description>
  <executable>$NodeExe</executable>
  <arguments>"$AppEntry"</arguments>
  <workingdirectory>$apiWorkdir</workingdirectory>
  <depend>$DbService</depend>
  <env name="NODE_ENV" value="production" />
  <env name="DOTENV_CONFIG_PATH" value="$EnvFile" />
  <!-- 2026-10-17 load test: bcrypt (cost 12, ~230 ms per check) runs on the libuv
       threadpool, default 4 threads. 40 concurrent logins: 17/s at 4 threads,
       29/s at 8 (tests/performance/security/bcrypt-throughput.mjs). -->
  <env name="UV_THREADPOOL_SIZE" value="8" />
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <logpath>$LogDir</logpath>
</service>
"@

Write-Host "DigiLog service registration" -ForegroundColor Cyan
Write-Host "  DB : $DbService  (pg_ctl, data=$PgDataDir, port=$Port)"
Write-Host "  API: $ApiService (WinSW -> $NodeExe $AppEntry)"
Write-Host ""

# 1. Stage service dir + WinSW exe + generated XML
if ($DryRun) {
  Write-Host "[dry-run] write WinSW XML to $apiXml :" -ForegroundColor Yellow
  Write-Host $xml -ForegroundColor DarkGray
  Write-Host "[dry-run] copy $WinswExe -> $apiExe" -ForegroundColor Yellow
} else {
  New-Item -ItemType Directory -Force -Path $ServiceDir, $LogDir | Out-Null
  Set-Content -Path $apiXml -Value $xml -Encoding ascii
  Copy-Item -Path $WinswExe -Destination $apiExe -Force
}

function ServiceExists($name) { [bool](Get-Service -Name $name -ErrorAction SilentlyContinue) }

# 2. Register the DB as a native PostgreSQL service (auto-start)
if ($SkipExisting -and (ServiceExists $DbService)) {
  Write-Host "==> $DbService already registered - kept" -ForegroundColor DarkGray
} else {
  Do-Cmd "register $DbService (PostgreSQL service, auto-start)" `
    $pgctl @('register','-N',$DbService,'-D',$PgDataDir,'-S','auto','-o',"-p $Port")
}

# 3. Install the API service via WinSW (reads the adjacent XML)
if ($SkipExisting -and (ServiceExists $ApiService)) {
  Write-Host "==> $ApiService already registered - kept" -ForegroundColor DarkGray
} else {
  Do-Cmd "install $ApiService (WinSW)" $apiExe @('install')
}

# 4. Start both (DB first; the API <depend> also enforces ordering)
if ($NoStart) {
  Write-Host "==> Not starting the services here (-NoStart); the caller starts them in order" -ForegroundColor DarkGray
} else {
  Do-Cmd "start $DbService"  'sc.exe' @('start', $DbService)
  Do-Cmd "start $ApiService" 'sc.exe' @('start', $ApiService)
}

Write-Host "`nServices registered. Both set to auto-start on boot." -ForegroundColor Green
Write-Host "Verify: Get-Service $DbService, $ApiService" -ForegroundColor Gray
exit 0  # explicit so callers reading $LASTEXITCODE see success (PS scripts don't set it otherwise)
