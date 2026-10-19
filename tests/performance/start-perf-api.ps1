# Starts a SECOND, production-build API instance for performance testing.
#
#   - port 3100 (the normal dev API on 3000 is untouched)
#   - database digilog_perf (a disposable clone; NEVER digilog_db / digilog_test_db)
#   - NODE_ENV=production, so Prisma does not log every query (dev mode would skew timings)
#
# Usage (from the repo root):
#   powershell -File tests\performance\start-perf-api.ps1            # builds, then starts
#   powershell -File tests\performance\start-perf-api.ps1 -NoBuild
# Stop it with tests\performance\stop-perf-api.ps1 (kills only the process listening on 3100).
param(
  [string]$Database = 'digilog_perf',
  [int]$Port = 3100,
  [switch]$NoBuild,
  # NODE_ENV=development so the app's slow-query log works (it is OFF in production,
  # lib/prisma.ts); logs under results\logs-profile. For finding WHICH query is slow
  # only - never quote its latencies as results. e.g. -NoBuild -Profile -Port 3101
  [switch]$Profile,
  [int]$SlowQueryMs = 100,
  # Prisma pool override for what-if runs (default = Prisma's own: 2 x physical cores + 1 = 9 here).
  [int]$PoolLimit = 0,
  [int]$PoolTimeoutSec = 10
)
$ErrorActionPreference = 'Stop'

if ($Database -notmatch '_perf\d*$') {
  throw "Refusing to start: database '$Database' does not end in _perf. Performance tests must never run against a real database."
}

$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$api  = Join-Path $repo 'apps\api'

if (-not $NoBuild) {
  Push-Location $api
  try { npx tsc -p tsconfig.json; if ($LASTEXITCODE -ne 0) { throw 'tsc failed' } } finally { Pop-Location }
}

$logDir = Join-Path $repo $(if ($Profile) { 'tests\performance\results\logs-profile' } else { 'tests\performance\results\logs' })
New-Item -ItemType Directory -Force $logDir | Out-Null

# dotenv never overrides variables that are already set, so these win over apps/api/.env.
$env:NODE_ENV     = $(if ($Profile) { 'development' } else { 'production' })
if ($Profile) { $env:SLOW_QUERY_MS = "$SlowQueryMs" }
$env:PORT         = "$Port"
$env:DATABASE_URL = "postgresql://digilog:digilog123@localhost:5432/$Database`?schema=public"
if ($PoolLimit -gt 0) { $env:DATABASE_URL += "&connection_limit=$PoolLimit&pool_timeout=$PoolTimeoutSec"; Write-Host "pool: connection_limit=$PoolLimit pool_timeout=$PoolTimeoutSec" }
$env:LOG_DIR      = $logDir
$env:API_DOCS     = 'on'

Push-Location $api
try {
  $p = Start-Process node -ArgumentList 'dist/app.js' -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir 'stdout.log') `
        -RedirectStandardError  (Join-Path $logDir 'stderr.log')
  Set-Content (Join-Path $logDir 'perf-api.pid') $p.Id
  Write-Host "perf API started: pid $($p.Id), https://localhost:$Port, db $Database"
} finally { Pop-Location }
