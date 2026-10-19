# Times a full backup of a *_perf clone and a restore into a NEW *_perf database,
# the two ways the product does it:
#   1. nightly: plain-SQL pg_dump (scripts/backup-db.ps1)      -> restore with psql
#   2. in-app "dump" format: pg_dump -Fc (backup.service.ts)   -> restore with pg_restore
# Then counts rows in the restored copy so the result can be compared with the source.
# Clone-only: refuses any database name not ending in _perf. Never touches digilog_db.
#
#   powershell -File tests\performance\recovery\backup-restore-timing.ps1 -Source digilog_perf
param(
  [string]$Source = 'digilog_perf',
  [string]$RestoreDb = 'digilog_restore_perf',
  [switch]$SkipPlain
)
$ErrorActionPreference = 'Stop'
foreach ($n in @($Source, $RestoreDb)) { if ($n -notmatch '_perf\d*$') { throw "refusing database '$n' (only *_perf)" } }
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$env:PGPASSWORD = 'digilog123'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$out = Join-Path $repo 'tests\performance\results\backups'
New-Item -ItemType Directory -Force $out | Out-Null
$psql = Join-Path $pgBin 'psql.exe'
function Q($db, $sql) { & $psql -h localhost -U digilog -d $db -w -At -c $sql }
function Report($label, $sw, $file) {
  $mb = if ($file -and (Test-Path $file)) { [math]::Round((Get-Item $file).Length / 1MB) } else { '' }
  "{0,-34} {1,8:N1} s  {2,8} MB" -f $label, $sw.Elapsed.TotalSeconds, $mb
}
$srcSize = Q $Source "select pg_size_pretty(pg_database_size('$Source'))"
"source $Source = $srcSize"
$counts = Q $Source "select (select count(*) from audit_trail)||' audit, '||(select count(*) from cleaning_cycles)||' cycles, '||(select count(*) from filter_events)||' events'"
"source rows: $counts"

# 2. custom-format dump + pg_restore (the in-app full backup)
$dumpFile = Join-Path $out "$Source.dump"
$sw = [Diagnostics.Stopwatch]::StartNew()
& (Join-Path $pgBin 'pg_dump.exe') -h localhost -U digilog -w -Fc -f $dumpFile $Source
$sw.Stop(); Report 'pg_dump -Fc (custom)' $sw $dumpFile

& (Join-Path $pgBin 'dropdb.exe') -h localhost -U digilog -w --if-exists $RestoreDb
& (Join-Path $pgBin 'createdb.exe') -h localhost -U digilog -w $RestoreDb
$sw = [Diagnostics.Stopwatch]::StartNew()
& (Join-Path $pgBin 'pg_restore.exe') -h localhost -U digilog -w -d $RestoreDb --no-owner --jobs=4 $dumpFile
$sw.Stop(); Report 'pg_restore --jobs=4' $sw $null
"restored rows: " + (Q $RestoreDb "select (select count(*) from audit_trail)||' audit, '||(select count(*) from cleaning_cycles)||' cycles, '||(select count(*) from filter_events)||' events'")
"restored size: " + (Q $RestoreDb "select pg_size_pretty(pg_database_size('$RestoreDb'))")

if (-not $SkipPlain) {
  # 1. plain SQL (what the nightly task writes) + psql replay
  $sqlFile = Join-Path $out "$Source.sql"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & (Join-Path $pgBin 'pg_dump.exe') -h localhost -U digilog -w -f $sqlFile $Source
  $sw.Stop(); Report 'pg_dump plain SQL (nightly)' $sw $sqlFile
  & (Join-Path $pgBin 'dropdb.exe') -h localhost -U digilog -w --if-exists $RestoreDb
  & (Join-Path $pgBin 'createdb.exe') -h localhost -U digilog -w $RestoreDb
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & $psql -h localhost -U digilog -w -q -d $RestoreDb -v ON_ERROR_STOP=1 -f $sqlFile | Out-Null
  $sw.Stop(); Report 'psql -f plain SQL restore' $sw $null
  "restored rows (plain): " + (Q $RestoreDb "select (select count(*) from audit_trail)||' audit, '||(select count(*) from cleaning_cycles)||' cycles'")
}
"done; files in $out"
