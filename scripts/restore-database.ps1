<#
.SYNOPSIS
  Restore the DigiLog database from a pg_dump backup of ANY size - the nightly
  backup (nightly-*.sql), a pre-upgrade backup (pre-upgrade-*.sql), or a .dump
  downloaded from the in-app Backup page. Operator guide: docs\RESTORE-LARGE-DATABASE.md

.DESCRIPTION
  Why this exists (D-DB-6, 2026-10-22): the in-app restore refuses uploads over
  100 MB, which a site reaches about 3-4 weeks after go-live. The nightly
  Scheduled Task (backup-db.ps1) works at any size, but nothing restored its files.

  What it does, in order. Nothing in the live database changes before step 6, and
  the live data is only deleted in step 9, after every check has passed:
    1. Checks the backup file completely (a truncated or damaged file is refused
       here, while the application is still running).
    2. Checks the current database: ownership, free disk space, leftovers of an
       interrupted restore.
    3. Asks for the reason and a confirmation (type RESTORE), then the electronic
       signature: a Super Admin's username and password, checked by the app's own
       code (REAUTH_SUCCESS / REAUTH_FAILED rows, as the app's re-auth gate writes).
       Then verifies the audit-trail hash chain of the CURRENT database, so the
       result after the restore can be compared with it (-ChainCheck Full). The
       application is still running.
    4. Sets the DigiLogAPI service to Disabled and stops it, so a reboot during the
       restore cannot start the application on a half-finished database.
    5. Takes a SAFETY backup of the current database (backups\pre-restore-*.dump).
    6. In ONE database transaction: moves every application object out of schema
       `public` into a side schema and loads the backup into the empty `public`.
       Any error, or a backup that stops early, rolls the whole transaction back.
    7. Checks the result: schema version against this program's migrations, table
       row counts, then carries over every audit row the backup does not have
       (the application's own preserveUnbackedAuditRows, as the in-app restore does
       - BR-100) and realigns the audit chain-position sequence.
    8. Verifies the audit-trail hash chain of the restored database with the
       application's own verifier and compares it with step 2. Anything new needs
       a typed ACCEPT. Writes a BACKUP_RESTORED audit row (application's auditLog).
    9. Deletes the side schema (the old data - the safety backup keeps a copy),
       restores the service start type and starts the application.
  If any check in 7-8 fails, the side schema is moved back: the database is
  exactly as it was before step 6.

  Why not "restore into a new database and rename it": the installed database
  role (provision-db.ps1) cannot create or rename databases, and the cluster
  superuser password is generated at install and stored nowhere. Everything here
  runs as the application's own role from digilog.env.

  CREDENTIALS: the database password is read from digilog.env and handed to the
  PostgreSQL tools through the PGPASSWORD environment variable of this process
  only - never on a command line, never in the log.

.PARAMETER DumpFile
  The backup to restore: a plain SQL file from pg_dump (nightly-*.sql,
  pre-upgrade-*.sql) or a pg_dump custom archive (.dump from the in-app Backup page).
.PARAMETER SignerUsername
  The restore is a SIGNED act, as in the app (RESTORE_BACKUP always takes a Super
  Admin password, OD-01): the username of an enabled SUPER_ADMIN. The password is
  ALWAYS typed at a hidden prompt - never a parameter, never logged or stored - and
  checked with the app's own password check against the current database. The
  BACKUP_RESTORED row is written as that user and links to the REAUTH_SUCCESS row.
  Asked for when not given.
.PARAMETER Reason
  Why the database is restored (at least 5 characters). Recorded in the audit row.
  Asked for when not given.
.PARAMETER EmergencyUnsigned
  ONLY when no signature can be checked because the current database's users
  cannot be read (damaged or empty database). Refused while a Super Admin could
  sign. Records the Windows account and -PerformedBy, and flags the row
  signature = UNSIGNED_EMERGENCY.
.PARAMETER PerformedBy
  With -EmergencyUnsigned only: the full name of the person doing the restore.
.PARAMETER Force
  Do not ask for typed confirmations (RESTORE). Never skips a safety check, and
  never the Super Admin password.
.PARAMETER ApplyMigrations
  The backup comes from an OLDER program version: bring its schema up to this
  version (prisma migrate deploy + the create-only seed, exactly as an upgrade does)
  before it is put into service. Without this switch such a backup is refused.
.PARAMETER ChainCheck
  Full (default): verify the whole audit-trail hash chain before and after the
  restore. Takes about 20 minutes per year of data on each side.
  Tail: verify only the rows written after the backup (carried-over rows and the
  BACKUP_RESTORED row) and the seam to the backup. Recorded in the audit row.
.PARAMETER AcceptChainAnomalies
  Do not ask before continuing when the restored audit chain shows anomalies the
  current database did not have. Recorded in the audit row (forced=true).
.PARAMETER RollBackInterrupted
  A previous run was interrupted (power cut, window closed) after step 6. Put the
  pre-restore data back, restore the service start type and start the service.
.PARAMETER SkipDiskSpaceCheck
  Do not refuse when the free-space estimate says the disk may be too small.
.PARAMETER TestDatabaseUrl
  TEST MODE (development PC only). postgresql:// URL of a DISPOSABLE database whose
  name ends in _perf. No service is stopped or started. Uses the repo's
  apps/api/src through tsx.
.PARAMETER TestEnvFile
  TEST MODE: env file holding AUDIT_CHAIN_KEY / AUDIT_CHAIN_KEYED_FROM (default
  apps\api\.env). Its DATABASE_URL is ignored.
.PARAMETER TestWorkDir
  TEST MODE: where the safety backup, work files and logs go.
.PARAMETER TestFailAfter
  TEST MODE fault injection: load | carry-over | verify (exercise the move-back),
  crash-after-load (leave an interrupted restore for -RollBackInterrupted).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File "C:\Program Files\DigiLog\scripts\restore-database.ps1" -DumpFile "C:\ProgramData\DigiLog\backups\nightly-dfms-20261022-013000.sql"
#>
[CmdletBinding()]
param(
  [string]$DumpFile,
  [string]$SignerUsername,
  [string]$Reason,
  [switch]$EmergencyUnsigned,
  [string]$PerformedBy,
  [switch]$Force,
  [switch]$ApplyMigrations,
  [ValidateSet('Full', 'Tail')] [string]$ChainCheck = 'Full',
  [switch]$AcceptChainAnomalies,
  [switch]$RollBackInterrupted,
  [switch]$SkipDiskSpaceCheck,
  [string]$InstallDir = 'C:\Program Files\DigiLog',
  [string]$DataRoot   = 'C:\ProgramData\DigiLog',
  [string]$ApiService = 'DigiLogAPI',
  [string]$TestDatabaseUrl,
  [string]$TestEnvFile,
  [string]$TestWorkDir,
  [string]$TestPgBin = 'C:\Program Files\PostgreSQL\18\bin',
  [ValidateSet('', 'load', 'carry-over', 'verify', 'crash-after-load')] [string]$TestFailAfter = ''
)

$ErrorActionPreference = 'Stop'
# Node and the PostgreSQL tools write UTF-8; decode their output as such.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$TestMode = [bool]$TestDatabaseUrl
$AsideTag = 'digilog-restore-aside'   # schema COMMENT marker; how an interrupted run is found

# ---------------------------------------------------------------------------
# Mode, paths, configuration
# ---------------------------------------------------------------------------
function Fail([string]$msg) { throw [System.Exception]::new($msg) }

function Get-EnvValue([string]$file, [string]$key) {
  $line = Get-Content $file | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^\s*$key\s*=", '').Trim()
}

function Split-DbUrl([string]$url) {
  # Same parse as backup-db.ps1 / upgrade.ps1 (libpq does not accept Prisma's ?schema=).
  if ($url -notmatch '^postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)') { return $null }
  return @{ User = [uri]::UnescapeDataString($Matches[1]); Password = [uri]::UnescapeDataString($Matches[2]);
            Host = $Matches[3]; Port = $Matches[4]; Database = [uri]::UnescapeDataString($Matches[5]) }
}

$repoRoot = Split-Path $PSScriptRoot -Parent
if ($TestFailAfter -and -not $TestMode) {
  Write-Host 'REFUSED: -TestFailAfter is a test-mode switch (it can leave the service Disabled and the data moved aside).' -ForegroundColor Red; exit 2
}
if ($TestMode) {
  $conn = Split-DbUrl $TestDatabaseUrl
  if (-not $conn) { Write-Host 'REFUSED: -TestDatabaseUrl is not a postgresql://user:password@host:port/database URL.' -ForegroundColor Red; exit 2 }
  # TEST MODE may only ever touch a disposable *_perf database. digilog_db,
  # digilog_test_db and every installed database are refused by this one rule.
  if ($conn.Database -notmatch '_perf$') {
    Write-Host "REFUSED: test mode only restores into a disposable database whose name ends in _perf (got '$($conn.Database)')." -ForegroundColor Red; exit 2
  }
  if (-not $TestWorkDir) { Write-Host 'REFUSED: test mode needs -TestWorkDir.' -ForegroundColor Red; exit 2 }
  if (-not $TestEnvFile) { $TestEnvFile = Join-Path $repoRoot 'apps\api\.env' }
  $dbUrl       = $TestDatabaseUrl
  $envFile     = $TestEnvFile
  $pgBin       = $TestPgBin
  $nodeExe     = 'node'
  $apiCodeArgs = @('--api-src', (Join-Path $repoRoot 'apps\api\src'))
  $nodePrefix  = @('--import', 'tsx')
  $apiDir      = Join-Path $repoRoot 'apps\api'
  $backupDir   = Join-Path $TestWorkDir 'backups'
  $logDir      = Join-Path $TestWorkDir 'logs'
  $dbDataDir   = $null
} else {
  $envFile     = Join-Path $DataRoot 'config\digilog.env'
  $pgBin       = Join-Path $InstallDir 'pgsql\bin'
  $nodeExe     = Join-Path $InstallDir 'runtime\node.exe'
  $apiDir      = Join-Path $InstallDir 'runtime\api'
  $apiCodeArgs = @('--api-dist', (Join-Path $apiDir 'dist'))
  $nodePrefix  = @()
  $backupDir   = Join-Path $DataRoot 'backups'
  $dbDataDir   = Join-Path $DataRoot 'db'
  $missing = @($envFile, (Join-Path $apiDir 'dist\app.js'), $nodeExe) | Where-Object { -not (Test-Path $_) }
  if ($missing) {
    Write-Host "REFUSED: this is not an installed DigiLog server (missing: $($missing -join ', '))." -ForegroundColor Red
    Write-Host 'On a development PC use test mode (-TestDatabaseUrl) against a *_perf database.' -ForegroundColor Yellow
    exit 2
  }
  $dbUrl = Get-EnvValue $envFile 'DATABASE_URL'
  $conn = Split-DbUrl $dbUrl
  if (-not $conn) { Write-Host "REFUSED: could not read DATABASE_URL from $envFile." -ForegroundColor Red; exit 2 }
  $logDir = Get-EnvValue $envFile 'LOG_DIR'
  if (-not $logDir) { $logDir = Join-Path $DataRoot 'logs' }
}
$psql      = Join-Path $pgBin 'psql.exe'
$pgDump    = Join-Path $pgBin 'pg_dump.exe'
$pgRestore = Join-Path $pgBin 'pg_restore.exe'
$helper    = Join-Path $PSScriptRoot 'restore-database-helper.mjs'
$migrationsDir = Join-Path $apiDir 'prisma\migrations'
$stateFile = Join-Path $backupDir 'restore-in-progress.json'
$workDir   = Join-Path $backupDir "restore-work-$stamp"
$db        = $conn.Database

New-Item -ItemType Directory -Force -Path $backupDir, $logDir, $workDir | Out-Null
$runLog     = Join-Path $logDir "restore-database-$stamp.log"
$historyLog = Join-Path $logDir 'restore-database.log'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Log([string]$msg, [string]$color = 'Gray') {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  [System.IO.File]::AppendAllText($runLog, $line + "`r`n", $utf8)
  Write-Host $msg -ForegroundColor $color
}
function LogFileOnly([string]$msg) {
  [System.IO.File]::AppendAllText($runLog, "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg`r`n", $utf8)
}
function Add-RestoreHistory([string]$verdict, [string]$detail) {
  [System.IO.File]::AppendAllText($historyLog, "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $verdict  db=$db  file=$DumpFile  $detail  log=$runLog`r`n", $utf8)
}

# libpq reads these, so no password or address ever appears on a command line.
$env:PGHOST = $conn.Host; $env:PGPORT = $conn.Port; $env:PGUSER = $conn.User
$env:PGDATABASE = $db; $env:PGPASSWORD = $conn.Password; $env:PGAPPNAME = 'digilog-restore'
function Clear-PgEnv { foreach ($v in 'PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGAPPNAME','DATABASE_URL') { Remove-Item "Env:$v" -ErrorAction SilentlyContinue } }

# ---------------------------------------------------------------------------
# Running programs (PowerShell 5.1: stderr arrives as ErrorRecords under 2>&1)
# ---------------------------------------------------------------------------
function Invoke-Native([string]$exe, [string[]]$argList, [switch]$Echo) {
  $out = New-Object System.Collections.Generic.List[string]
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $exe @argList 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) {
        $t = $_.Exception.Message
        LogFileOnly "  | $t"
        if ($Echo) { Write-Host "  $t" -ForegroundColor DarkGray }
      } else {
        $out.Add([string]$_)
      }
    }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev }
  return @{ Code = $code; Out = $out }
}

function Sql([string]$query) {
  # Through a file: PowerShell 5.1 does not escape double quotes inside arguments
  # passed to native programs, so SQL with quoted identifiers cannot go on -c.
  $f = Join-Path $workDir ("q-" + [guid]::NewGuid().ToString('N') + '.sql')
  [System.IO.File]::WriteAllText($f, $query, $utf8)
  $r = Invoke-Native $psql @('-X', '-q', '-t', '-A', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-f', $f)
  Remove-Item $f -ErrorAction SilentlyContinue
  if ($r.Code -ne 0) { Fail "A database query failed (psql exit $($r.Code)); see $runLog." }
  return ,@($r.Out | Where-Object { $_ -ne '' })
}

function Invoke-SqlFile([string]$path, [switch]$SingleTransaction) {
  $a = @('-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', $path)
  if ($SingleTransaction) { $a = @('-1') + $a }
  $r = Invoke-Native $psql $a -Echo
  foreach ($l in $r.Out) { LogFileOnly "  > $l" }
  return $r.Code
}

function Invoke-Helper([string[]]$helperArgs, [switch]$AppCode) {
  $a = @() + $nodePrefix + @($helper) + $helperArgs
  if ($AppCode) { $a += $apiCodeArgs + @('--env-file', $envFile, '--expect-db', $db) }
  if ($AppCode) { $env:DATABASE_URL = $dbUrl }
  if ($TestMode) { $env:LOG_DIR = $logDir; Push-Location $repoRoot }
  try { $r = Invoke-Native $nodeExe $a -Echo }
  finally {
    if ($TestMode) { Pop-Location; Remove-Item Env:LOG_DIR -ErrorAction SilentlyContinue }
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  }
  # The app's logger shares stdout; the result line carries a marker.
  $json = $r.Out | Where-Object { $_.StartsWith('@@restore-result@@') } | Select-Object -Last 1
  if ($json) { $json = $json.Substring('@@restore-result@@'.Length) }
  if (-not $json) { return [pscustomobject]@{ ok = $false; error = "helper produced no result (exit $($r.Code))"; exitCode = $r.Code } }
  LogFileOnly "  helper $($helperArgs[0]) -> $(if ($json.Length -gt 4000) { $json.Substring(0, 4000) + '...' } else { $json })"
  $o = $json | ConvertFrom-Json
  $o | Add-Member -NotePropertyName exitCode -NotePropertyValue $r.Code -Force
  return $o
}

# ---------------------------------------------------------------------------
# The schema mover. Defined as a pg_temp function at the top of every script
# that moves objects, so prelude / rollback share one definition.
# ---------------------------------------------------------------------------
$MoverSql = @'
SET search_path = '';
SET client_min_messages = warning;
SET statement_timeout = 0;
SET lock_timeout = '60s';
CREATE FUNCTION pg_temp.digilog_move_objects(src text, dst text) RETURNS integer
LANGUAGE plpgsql AS $mover$
DECLARE
  r record;
  n integer := 0;
  leftover text;
BEGIN
  -- Tables, views, materialized views, foreign tables. Their indexes,
  -- constraints, triggers, row types and column-owned sequences move with them.
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_catalog.pg_class c
     WHERE c.relnamespace = src::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
     ORDER BY c.relname
  LOOP
    EXECUTE pg_catalog.format('ALTER %s %I.%I SET SCHEMA %I',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
      src, r.relname, dst);
    n := n + 1;
  END LOOP;
  -- Sequences no column owns (deviation_number_seq, qnn_seq).
  FOR r IN
    SELECT c.relname FROM pg_catalog.pg_class c
     WHERE c.relnamespace = src::regnamespace AND c.relkind = 'S'
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE pg_catalog.format('ALTER SEQUENCE %I.%I SET SCHEMA %I', src, r.relname, dst);
    n := n + 1;
  END LOOP;
  -- Functions, procedures, aggregates (before the types their signatures use).
  FOR r IN
    SELECT p.oid, p.prokind FROM pg_catalog.pg_proc p
     WHERE p.pronamespace = src::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE pg_catalog.format('ALTER %s %s SET SCHEMA %I',
      CASE r.prokind WHEN 'a' THEN 'AGGREGATE' WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      r.oid::regprocedure, dst);
    n := n + 1;
  END LOOP;
  -- Enums, domains, standalone composite types, ranges. Array types follow
  -- their element type; table row types already moved with the table.
  FOR r IN
    SELECT t.oid, t.typtype FROM pg_catalog.pg_type t
     WHERE t.typnamespace = src::regnamespace AND t.typtype IN ('e', 'd', 'c', 'r')
       AND (t.typtype <> 'c' OR (SELECT c.relkind FROM pg_catalog.pg_class c WHERE c.oid = t.typrelid) = 'c')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE pg_catalog.format('ALTER %s %s SET SCHEMA %I',
      CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, r.oid::regtype, dst);
    n := n + 1;
  END LOOP;
  -- Anything left that is not part of an extension is a kind this mover does not
  -- handle: stop, and the transaction undoes every move above.
  SELECT pg_catalog.string_agg(x, ', ') INTO leftover FROM (
    SELECT 'relation ' || c.relname::text AS x FROM pg_catalog.pg_class c
     WHERE c.relnamespace = src::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'function ' || p.oid::regprocedure::text FROM pg_catalog.pg_proc p
     WHERE p.pronamespace = src::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'type ' || t.oid::regtype::text FROM pg_catalog.pg_type t
     WHERE t.typnamespace = src::regnamespace
       AND NOT (t.typelem <> 0 AND t.typsubscript = 'pg_catalog.array_subscript_handler'::regproc)
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_type'::regclass AND d.objid = t.oid AND d.deptype IN ('e', 'i'))
    UNION ALL
    SELECT 'operator ' || o.oid::regoperator::text FROM pg_catalog.pg_operator o
     WHERE o.oprnamespace = src::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_operator'::regclass AND d.objid = o.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'operator class ' || oc.opcname::text FROM pg_catalog.pg_opclass oc
     WHERE oc.opcnamespace = src::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_opclass'::regclass AND d.objid = oc.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'operator family ' || f.opfname::text FROM pg_catalog.pg_opfamily f
     WHERE f.opfnamespace = src::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_opfamily'::regclass AND d.objid = f.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'collation ' || co.collname::text FROM pg_catalog.pg_collation co WHERE co.collnamespace = src::regnamespace
    UNION ALL
    SELECT 'conversion ' || cv.conname::text FROM pg_catalog.pg_conversion cv WHERE cv.connamespace = src::regnamespace
    UNION ALL
    SELECT 'statistics ' || s.stxname::text FROM pg_catalog.pg_statistic_ext s WHERE s.stxnamespace = src::regnamespace
    UNION ALL
    SELECT 'text search config ' || ts.cfgname::text FROM pg_catalog.pg_ts_config ts WHERE ts.cfgnamespace = src::regnamespace
    UNION ALL
    SELECT 'text search dictionary ' || td.dictname::text FROM pg_catalog.pg_ts_dict td
     WHERE td.dictnamespace = src::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_ts_dict'::regclass AND d.objid = td.oid AND d.deptype = 'e')
  ) q;
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'restore-database: cannot move these objects from schema % to %: % (nothing was changed)', src, dst, leftover;
  END IF;
  RETURN n;
END
$mover$;
'@

function Read-SignerPassword {
  # Always typed at a hidden prompt. Test mode alone may take it from an environment
  # variable so the automated tests can run; it is never a parameter.
  if ($TestMode -and $env:DIGILOG_RESTORE_TEST_SIGNER_PASSWORD) { return $env:DIGILOG_RESTORE_TEST_SIGNER_PASSWORD }
  $sec = Read-Host 'Super Admin password' -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

function Test-Ident([string]$name) { return ($name -cmatch '^[a-z_][a-z0-9_]{0,62}$') }
function Quote-Literal([string]$s) { if ($null -eq $s) { return 'NULL' } return "'" + $s.Replace("'", "''") + "'" }

$script:ownState = $false   # only a state file THIS run wrote may be removed by it
function Save-State($state) {
  [System.IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json -Depth 6), $utf8)
  $script:ownState = $true
}

# ---------------------------------------------------------------------------
# Service handling (installed mode only)
# ---------------------------------------------------------------------------
function Get-StartType([string]$name) {
  $qc = & sc.exe qc $name
  $line = $qc | Where-Object { $_ -match 'START_TYPE' } | Select-Object -First 1
  if ($line -match 'DELAYED') { return 'delayed-auto' }
  if ($line -match 'AUTO_START') { return 'auto' }
  if ($line -match 'DEMAND_START') { return 'demand' }
  if ($line -match 'DISABLED') { return 'disabled' }
  return 'auto'
}
function Set-StartType([string]$name, [string]$type) {
  & sc.exe config $name start= $type | Out-Null
  if ($LASTEXITCODE -ne 0) { Log "WARNING: could not set $name start type to $type (sc.exe exit $LASTEXITCODE)." Yellow }
}
function Stop-Api {
  Log "Stopping $ApiService (start type set to Disabled while the restore runs)" Cyan
  Set-StartType $ApiService 'disabled'
  & sc.exe stop $ApiService | Out-Null
  foreach ($i in 1..60) {
    if ((Get-Service $ApiService).Status -eq 'Stopped') { return }
    Start-Sleep -Seconds 1
  }
  Fail "$ApiService did not stop within 60 seconds."
}
function Start-Api([string]$startType) {
  Set-StartType $ApiService $startType
  if ($startType -eq 'disabled') { Log "$ApiService was Disabled before the restore; not starting it." Yellow; return $true }
  Log "Starting $ApiService" Cyan
  & sc.exe start $ApiService | Out-Null
  $port = Get-EnvValue $envFile 'PORT'
  if (-not $port) { $port = '3000' }
  foreach ($i in 1..60) {
    try { $r = Invoke-WebRequest "https://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { Log "API healthy at https://localhost:$port" Green; return $true } } catch {}
    Start-Sleep -Seconds 1
  }
  Log "WARNING: the API did not report healthy within 60 seconds. Check $logDir\app\error and the WinSW logs in $logDir." Yellow
  return $false
}

# ---------------------------------------------------------------------------
# Database facts
# ---------------------------------------------------------------------------
function Get-Fingerprint {
  # Per-table exact row counts + the tip of the audit chain + schema list. Used to
  # show what changed, and to PROVE the database is unchanged after a refusal.
  $tables = Sql "SELECT c.relname FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') ORDER BY 1;"
  $counts = [ordered]@{}
  if ($tables.Count -gt 0) {
    $q = ($tables | ForEach-Object { "SELECT '$_', count(*) FROM public.`"$_`"" }) -join "`nUNION ALL "
    foreach ($row in (Sql ($q + ';'))) { $k, $v = $row -split '\|', 2; $counts[$k] = [long]$v }
  }
  $tip = $null
  if ($counts.Contains('audit_trail')) {
    $t = Sql "SELECT chain_position, checksum FROM public.audit_trail WHERE chain_position IS NOT NULL ORDER BY chain_position DESC LIMIT 1;"
    if ($t.Count) { $p, $c = $t[0] -split '\|', 2; $tip = @{ Position = [long]$p; Checksum = $c } }
  }
  $schemas = Sql "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema' ORDER BY 1;"
  return @{ Counts = $counts; Tip = $tip; Schemas = @($schemas) }
}

function Compare-Fingerprint($a, $b) {
  $diff = @()
  foreach ($k in (@($a.Counts.Keys) + @($b.Counts.Keys) | Sort-Object -Unique)) {
    $x = $a.Counts[$k]; $y = $b.Counts[$k]
    if ($x -ne $y) { $diff += "$k ($x -> $y)" }
  }
  if (($a.Tip | ConvertTo-Json -Compress) -ne ($b.Tip | ConvertTo-Json -Compress)) { $diff += 'audit chain tip' }
  if (($a.Schemas -join ',') -ne ($b.Schemas -join ',')) { $diff += "schemas ($($a.Schemas -join ',') -> $($b.Schemas -join ','))" }
  return $diff
}

function Get-AsideSchemas {
  $rows = Sql "SELECT n.nspname, pg_catalog.obj_description(n.oid, 'pg_namespace') FROM pg_catalog.pg_namespace n WHERE pg_catalog.obj_description(n.oid, 'pg_namespace') LIKE '$AsideTag %' ORDER BY 1;"
  $list = @()
  foreach ($r in $rows) {
    $name, $comment = $r -split '\|', 2
    # "<tag> <stamp> of <original schema>"
    if ($comment -match "^$AsideTag (\d{14}) of ([a-z0-9_]+)$") { $list += [pscustomobject]@{ Aside = $name; Stamp = $Matches[1]; Original = $Matches[2] } }
  }
  return ,$list
}

# ---------------------------------------------------------------------------
# Move back: the one way out of a restore that did not finish. Used by a failed
# check (steps 7-8) and by -RollBackInterrupted. ONE transaction.
# ---------------------------------------------------------------------------
function Invoke-MoveBack($asides, [string[]]$preSchemas, [string]$keepSchema, $origComments) {
  $public = $asides | Where-Object { $_.Original -eq 'public' } | Select-Object -First 1
  $others = @($asides | Where-Object { $_.Original -ne 'public' })
  $failed = "digilog_failed_restore_$stamp"
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine($MoverSql)
  if ($public) {
    [void]$sb.AppendLine("CREATE SCHEMA $failed;")
    [void]$sb.AppendLine("DO `$`$ BEGIN PERFORM pg_temp.digilog_move_objects('public', '$failed'); PERFORM pg_temp.digilog_move_objects('$($public.Aside)', 'public'); END `$`$;")
    [void]$sb.AppendLine("DROP SCHEMA $($public.Aside);")
  }
  # Schemas the restore created that did not exist before it (including any that
  # replaced a moved-aside one) are dropped; the moved-aside ones get their name back.
  $asideNames = @($asides | ForEach-Object { $_.Aside })
  $now = Sql "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema';"
  foreach ($s in $now) {
    if ($s -eq 'public' -or $asideNames -contains $s -or $s -eq $failed) { continue }
    $existedBefore = ($preSchemas -contains $s) -and -not ($others | Where-Object { $_.Original -eq $s })
    if (-not $existedBefore) { [void]$sb.AppendLine("DROP SCHEMA `"$s`" CASCADE;") }
  }
  foreach ($o in $others) {
    [void]$sb.AppendLine("ALTER SCHEMA $($o.Aside) RENAME TO `"$($o.Original)`";")
    $c = $null; if ($origComments) { $c = $origComments.($o.Original) }
    [void]$sb.AppendLine("COMMENT ON SCHEMA `"$($o.Original)`" IS $(Quote-Literal $c);")
  }
  if ($public) { [void]$sb.AppendLine("DROP SCHEMA $failed CASCADE;") }
  if ($keepSchema) { [void]$sb.AppendLine("DROP SCHEMA IF EXISTS $keepSchema CASCADE;") }
  $f = Join-Path $workDir 'move-back.sql'
  [System.IO.File]::WriteAllText($f, $sb.ToString(), $utf8)
  return (Invoke-SqlFile $f -SingleTransaction)
}

# ===========================================================================
# -RollBackInterrupted
# ===========================================================================
if ($RollBackInterrupted) {
  $state = $null
  if (Test-Path $stateFile) { $state = Get-Content $stateFile -Raw | ConvertFrom-Json }
  $exitCode = 0
  try {
    Log "DigiLog restore - roll back an interrupted restore ($db)" Cyan
    $asides = Get-AsideSchemas
    if ($asides.Count -eq 0) {
      Log 'No moved-aside data found: the interrupted run never changed the database (or already finished).' Green
    } else {
      $stamps = @($asides | ForEach-Object { $_.Stamp } | Sort-Object -Unique)
      if ($stamps.Count -ne 1) { Fail "Moved-aside schemas from more than one run were found ($($stamps -join ', ')). Do not continue; contact support with $runLog." }
      $pre = @(); $keep = $null; $comments = $null
      if ($state -and $state.stamp -eq $stamps[0]) { $pre = @($state.preSchemas); $keep = $state.keepSchema; $comments = $state.originalSchemaComments }
      else { $pre = @('public') + @($asides | Where-Object { $_.Original -ne 'public' } | ForEach-Object { $_.Original }) }
      Log "Moving the pre-restore data back from $(@($asides | ForEach-Object { $_.Aside }) -join ', ')" Cyan
      if (-not $TestMode -and (Get-Service $ApiService -ErrorAction SilentlyContinue).Status -ne 'Stopped') { Stop-Api }
      $code = Invoke-MoveBack $asides $pre $keep $comments
      if ($code -ne 0) { Fail "Moving the data back failed (psql exit $code). The data is still intact in the moved-aside schema; nothing was lost. Contact support with $runLog." }
      Log 'Pre-restore data is back in place.' Green
    }
    if (-not $TestMode) {
      $st = 'auto'; if ($state -and $state.serviceStartType) { $st = $state.serviceStartType }
      [void](Start-Api $st)
    }
    if (Test-Path $stateFile) { Remove-Item $stateFile }
    Add-RestoreHistory 'ROLLED-BACK' 'interrupted restore undone'
  } catch {
    Log "FAILED: $($_.Exception.Message)" Red
    Add-RestoreHistory 'FAIL' "rollback of interrupted restore: $($_.Exception.Message)"
    $exitCode = 1
  } finally { Clear-PgEnv; Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue }
  exit $exitCode
}

# ===========================================================================
# Restore
# ===========================================================================
$serviceStartType = $null
$apiStopped = $false
$movedAside = $false
$asides = @()
$preFp = $null
$preSchemas = @()
$keepSchema = "digilog_restore_keep_$stamp"
$origComments = @{}
$finalOk = $false
$exitCode = 1
$keepWorkDir = $false

try {
  Log "DigiLog database restore  ($(if ($TestMode) { 'TEST MODE' } else { 'installed server' }))" Cyan
  Log "  Database : $db on $($conn.Host):$($conn.Port) as $($conn.User)"
  Log "  Log      : $runLog"

  if (-not $TestMode) {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) { Fail 'Run this as Administrator (it stops and starts the DigiLogAPI service).' }
    if (-not (Get-Service $ApiService -ErrorAction SilentlyContinue)) { Fail "Service $ApiService not found." }
  }
  foreach ($exe in $psql, $pgDump, $pgRestore) { if (-not (Test-Path $exe)) { Fail "PostgreSQL tool not found: $exe" } }
  if (-not (Test-Path $helper)) { Fail "Missing $helper (it ships next to this script)." }
  if (-not (Test-Path $migrationsDir)) { Fail "Missing $migrationsDir." }
  if (Test-Path $stateFile) {
    Fail "A previous restore did not finish ($stateFile exists). Run this script with -RollBackInterrupted first."
  }

  # --- 1. The backup file ---------------------------------------------------
  Log '[1/9] Checking the backup file' Cyan
  if (-not $DumpFile) { Fail 'Give the backup to restore with -DumpFile <path>.' }
  if (-not (Test-Path $DumpFile -PathType Leaf)) { Fail "Backup file not found: $DumpFile" }
  $DumpFile = (Resolve-Path $DumpFile).Path
  $dumpItem = Get-Item $DumpFile
  if ($dumpItem.Length -eq 0) { Fail 'The backup file is empty.' }
  $fs = [System.IO.File]::OpenRead($DumpFile); $head = New-Object byte[] 5; [void]$fs.Read($head, 0, 5); $fs.Close()
  $magic = [System.Text.Encoding]::ASCII.GetString($head)
  $dumpSha = (Get-FileHash -Algorithm SHA256 -Path $DumpFile).Hash.ToLower()
  Log "  File     : $DumpFile ($([math]::Round($dumpItem.Length / 1MB, 1)) MB, modified $($dumpItem.LastWriteTime))"
  Log "  SHA-256  : $dumpSha"

  $dumpSchemas = @()
  $dataTables = @()
  $listFile = $null
  if ($magic -eq 'PGDMP') {
    $format = 'custom'
    $r = Invoke-Native $pgRestore @('--list', $DumpFile)
    if ($r.Code -ne 0) { Fail "pg_restore cannot read this file as a pg_dump archive (exit $($r.Code))." }
    $ver = $r.Out | Where-Object { $_ -match 'Dumped from database version: (\S+)' } | Select-Object -First 1
    if ($ver -match 'version: (\S+)') { $dumpVersion = $Matches[1] }
    # The restore list: everything except what must not run against an existing
    # database (see SKIP_LINE in restore-database-helper.mjs for why).
    $kept = New-Object System.Collections.Generic.List[string]
    foreach ($l in $r.Out) {
      if ($l -match '^\d+; \d+ \d+ SCHEMA - (\S+)') { if ($Matches[1] -ne 'public') { $dumpSchemas += $Matches[1] } }
      if ($l -match '^\d+; \d+ \d+ TABLE DATA (\S+) (\S+) ') { $dataTables += "$($Matches[1]).$($Matches[2])" }
      if ($l -match '^\d+; \d+ \d+ (SCHEMA - public |COMMENT - SCHEMA public |COMMENT - EXTENSION )') { $kept.Add(';' + $l); LogFileOnly "  skipped from the restore list: $l" }
      else { $kept.Add($l) }
    }
    $listFile = Join-Path $workDir 'restore.list'
    [System.IO.File]::WriteAllLines($listFile, $kept, $utf8)
    Log '  Reading the whole archive (a truncated or damaged file is refused here) ...'
    $r = Invoke-Native $pgRestore @('-f', 'NUL', $DumpFile)
    if ($r.Code -ne 0) { Fail "The archive is damaged or incomplete: pg_restore could not read it to the end (exit $($r.Code)). Nothing was changed. Use another backup." }
  } else {
    $format = 'plain'
    Log '  Reading the whole SQL file (a truncated file is refused here) ...'
    $insp = Invoke-Helper @('inspect-sql', $DumpFile)
    if (-not $insp.header) { Fail 'This is not a pg_dump file (no "-- PostgreSQL database dump" header). JSON / BAK / CSV backups are restored on the in-app Backup page.' }
    if (-not $insp.complete) { Fail 'The SQL backup is incomplete: it does not end with "-- PostgreSQL database dump complete" (the file was cut short). Nothing was changed. Use another backup.' }
    $dumpVersion = $insp.dumpedFromVersion
    $dumpSchemas = @($insp.schemas)
    $dataTables = @($insp.copyTargets)
  }
  Log "  Format   : $format pg_dump$(if ($dumpVersion) { ", from PostgreSQL $dumpVersion" })"
  foreach ($need in 'public.audit_trail', 'public._prisma_migrations', 'public.users') {
    if ($dataTables -notcontains $need) { Fail "The backup has no data for $need - it is not a full DigiLog database backup." }
  }
  foreach ($s in $dumpSchemas) { if (-not (Test-Ident $s)) { Fail "The backup contains a schema with an unexpected name ('$s')." } }

  # --- 2. The current database ----------------------------------------------
  Log '[2/9] Checking the current database' Cyan
  $who = Sql "SELECT current_user, pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE'), pg_catalog.pg_database_size(current_database()), pg_catalog.current_setting('server_version');"
  $cu, $canCreate, $dbSize, $serverVersion = $who[0] -split '\|'
  if ($canCreate -ne 't') { Fail "Role $cu may not create schemas in $db." }
  Log "  PostgreSQL $serverVersion, database size $([math]::Round([long]$dbSize / 1MB)) MB"
  $notMine = Sql @"
SELECT x FROM (
  SELECT c.relname::text AS x, c.relowner AS o FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f','S')
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  UNION ALL SELECT p.proname::text, p.proowner FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  UNION ALL SELECT t.typname::text, t.typowner FROM pg_catalog.pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e','d','r')
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
) q WHERE o <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) LIMIT 20;
"@
  if ($notMine.Count) { Fail "These objects in schema public are not owned by $cu, so they cannot be moved aside: $($notMine -join ', ')" }
  $leftover = Get-AsideSchemas
  if ($leftover.Count) { Fail "The database holds data moved aside by an earlier restore that did not finish ($(@($leftover | ForEach-Object { $_.Aside }) -join ', ')). Run this script with -RollBackInterrupted first." }
  $conflicts = @($dumpSchemas | Where-Object { $_ -ne 'public' })
  foreach ($s in $conflicts) { if (("${s}_$stamp").Length -gt 63) { Fail "Schema name too long to move aside: $s" } }

  $preFp = Get-Fingerprint
  $preSchemas = @($preFp.Schemas)
  LogFileOnly "  pre-restore row counts: $(($preFp.Counts.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ')"
  $liveAudit = 0; if ($preFp.Counts.Contains('audit_trail')) { $liveAudit = $preFp.Counts['audit_trail'] }
  Log "  Audit trail now: $liveAudit rows$(if ($preFp.Tip) { ", last chain position $($preFp.Tip.Position)" })"

  # Free space. Rough on purpose; the numbers are printed so the operator can judge.
  $factor = 1.4; if ($format -eq 'custom') { $factor = 6.5 }
  $restoredEst = [math]::Max([double]$dbSize, $dumpItem.Length * $factor)
  $needs = @{}
  $backupDrive = (Split-Path -Qualifier ([System.IO.Path]::GetFullPath($backupDir)))
  $needs[$backupDrive] = [double]$dbSize * 0.35
  if ($dbDataDir) {
    $dataDrive = (Split-Path -Qualifier ([System.IO.Path]::GetFullPath($dbDataDir)))
    if (-not $needs.ContainsKey($dataDrive)) { $needs[$dataDrive] = 0 }
    $needs[$dataDrive] += $restoredEst * 1.6
  } else {
    Log '  (test mode: the database server''s own disk is not checked)' DarkGray
  }
  foreach ($d in @($needs.Keys)) {
    $free = (Get-PSDrive -Name $d.TrimEnd(':')).Free
    $msg = "  Free space on ${d}: $([math]::Round($free / 1GB, 1)) GB, estimated need $([math]::Round($needs[$d] / 1GB, 1)) GB"
    if ($free -lt $needs[$d]) {
      if ($SkipDiskSpaceCheck) { Log "$msg - LOW, continuing (-SkipDiskSpaceCheck)" Yellow }
      else { Fail "$msg. Free some space or use -SkipDiskSpaceCheck if you are sure." }
    } else { Log $msg }
  }

  # --- 3. Confirmation -------------------------------------------------------
  Log '[3/9] Confirmation and signature' Cyan
  $winAccount = "$env:USERDOMAIN\$env:USERNAME"
  if (-not $Reason) {
    if ($Force) { Fail '-Reason is required with -Force (it is recorded in the audit trail).' }
    $Reason = Read-Host 'Reason for this restore (recorded in the audit trail)'
  }
  $Reason = "$Reason".Trim()
  if ($Reason.Length -lt 5) { Fail 'The reason must be at least 5 characters.' }
  Write-Host ''
  Write-Host "  The database '$db' will be REPLACED by the backup:" -ForegroundColor Yellow
  Write-Host "    $DumpFile" -ForegroundColor Yellow
  Write-Host '  Everything entered after that backup was taken is lost, EXCEPT audit-trail rows,' -ForegroundColor Yellow
  Write-Host '  which are kept. Users will have to sign in again. A safety backup of the current' -ForegroundColor Yellow
  Write-Host "  database is taken first ($backupDir)." -ForegroundColor Yellow
  if (-not $TestMode) { Write-Host "  The application ($ApiService) is stopped until the restore ends." -ForegroundColor Yellow }
  Write-Host ''
  if (-not $Force) {
    $typed = Read-Host 'Type RESTORE to continue'
    if ($typed -cne 'RESTORE') { Log 'Cancelled by the operator. Nothing was changed.' Yellow; Add-RestoreHistory 'CANCELLED' ''; exit 3 }
  }

  # The electronic signature (OD-01: an in-app restore always takes a Super Admin
  # password). Checked against the CURRENT database by the app's own code; the
  # REAUTH_SUCCESS row it writes is carried into the restored trail and the
  # BACKUP_RESTORED row points at it.
  $signer = $null
  if ($EmergencyUnsigned) {
    $probe = Invoke-Helper @('signer-probe') -AppCode
    if (-not $probe.ok) { Fail "Could not check whether a Super Admin can sign: $($probe.error)" }
    if ($probe.available) { Fail "-EmergencyUnsigned is only for a database whose users cannot be read. This one has $($probe.reason): sign with a Super Admin account instead." }
    if (-not $PerformedBy) {
      if ($Force) { Fail '-PerformedBy is required with -EmergencyUnsigned -Force.' }
      $PerformedBy = Read-Host 'Your full name (recorded in the audit trail)'
    }
    $PerformedBy = "$PerformedBy".Trim()
    if (-not $PerformedBy) { Fail 'A name is required.' }
    Log "  UNSIGNED EMERGENCY restore: no signature can be checked ($($probe.reason)). Recorded as such, by $PerformedBy ($winAccount)." Yellow
  } else {
    $tries = 3; if ($Force) { $tries = 1 }
    for ($i = 1; $i -le $tries; $i++) {
      if (-not $SignerUsername) { $SignerUsername = Read-Host 'Super Admin username (electronic signature)' }
      $SignerUsername = "$SignerUsername".Trim()
      $env:DIGILOG_RESTORE_SIGNER_PASSWORD = Read-SignerPassword
      try { $v = Invoke-Helper @('verify-signer', '--username', $SignerUsername, '--windows-account', $winAccount) -AppCode }
      finally { Remove-Item Env:DIGILOG_RESTORE_SIGNER_PASSWORD -ErrorAction SilentlyContinue }
      if ($v.ok) { $signer = $v; break }
      if ($v.unavailable) { Fail "The Super Admin signature cannot be checked ($($v.error)). If the database is damaged, run again with -EmergencyUnsigned -PerformedBy ""Your Name"". Nothing was changed." }
      Log "  Signature refused: $($v.error)" Yellow
      if (-not $v.wrongPassword) { $SignerUsername = $null }
    }
    if (-not $signer) { Fail 'No valid Super Admin signature. Nothing was changed.' }
    Log "  Signed by $($signer.userId) ($($signer.userName), $($signer.userRole)) from $winAccount" Green
  }

  # The current chain, so the restored one can be compared with it. After the
  # confirmation (it can take a while) but before the application stops.
  $preChain = $null
  if ($ChainCheck -eq 'Full') {
    Log '  Verifying the CURRENT audit-trail hash chain. The application keeps running; about 20 min per year of data ...'
    $preChain = Invoke-Helper @('verify-chain') -AppCode
    if (-not $preChain.ok) { Log "  WARNING: the current chain could not be verified ($($preChain.error)). Anomalies after the restore cannot be compared with it." Yellow; $preChain = $null }
    else { Log "  Current chain: $($preChain.totalRows) rows, $(if ($preChain.intact) { 'intact' } else { "$($preChain.tamperingCount) anomalies" }) ($($preChain.seconds) s)" }
  }

  # --- 4. Stop the application ----------------------------------------------
  Log '[4/9] Stopping the application' Cyan
  $state = [ordered]@{ stamp = $stamp; database = $db; dumpFile = $DumpFile; phase = 'stopping'; preSchemas = $preSchemas;
                       keepSchema = $keepSchema; serviceStartType = $null; originalSchemaComments = @{}; safetyDump = $null }
  if (-not $TestMode) {
    $serviceStartType = Get-StartType $ApiService
    $state.serviceStartType = $serviceStartType
    Save-State $state
    $apiStopped = $true   # set first: a failed stop must still restore the start type
    Stop-Api
  } else { Save-State $state; Log '  (test mode: no service)' DarkGray }
  # No other CLIENT may hold the database: the moves need exclusive locks, and work
  # done in another session during the restore would be lost. Background workers
  # (autovacuum - always busy right after a big load) have no user and are not
  # counted: a normal autovacuum cancels itself when a lock request waits on it, and
  # the prelude's lock_timeout bounds anything else.
  $others = @()
  foreach ($i in 1..30) {
    $others = Sql "SELECT pid || ' ' || usename || ' ' || coalesce(application_name, '') || ' ' || coalesce(state, '') FROM pg_catalog.pg_stat_activity WHERE datname = current_database() AND usename IS NOT NULL AND pid <> pg_catalog.pg_backend_pid() AND coalesce(application_name, '') <> 'digilog-restore';"
    if ($others.Count -eq 0) { break }
    Start-Sleep -Seconds 1
  }
  if ($others.Count) { Fail "Other connections to $db are still open ($($others -join '; ')). Close them (pgAdmin, a running backup) and run again. Nothing was changed." }
  # The "before" picture used to prove a move-back left the database unchanged.
  # Taken now - the application is stopped and nobody else is connected - and not
  # in step 2: the signature in step 3 has written its own audit row since then.
  $preFp = Get-Fingerprint
  $preSchemas = @($preFp.Schemas)
  $state.preSchemas = $preSchemas
  Save-State $state

  # --- 5. Safety backup ------------------------------------------------------
  Log '[5/9] Safety backup of the current database' Cyan
  $safety = Join-Path $backupDir "pre-restore-$db-$stamp.dump"
  $r = Invoke-Native $pgDump @('-Fc', '--no-owner', '--no-privileges', '-f', $safety) -Echo
  if ($r.Code -ne 0 -or -not (Test-Path $safety) -or (Get-Item $safety).Length -eq 0) {
    if (Test-Path $safety) { Remove-Item $safety -Force }
    Fail "The safety backup failed (pg_dump exit $($r.Code)). Nothing was changed."
  }
  $r = Invoke-Native $pgRestore @('--list', $safety)
  if ($r.Code -ne 0) { Fail 'The safety backup cannot be read back. Nothing was changed.' }
  $safetySha = (Get-FileHash -Algorithm SHA256 -Path $safety).Hash.ToLower()
  $state.safetyDump = $safety
  Log "  $safety ($([math]::Round((Get-Item $safety).Length / 1MB, 1)) MB, SHA-256 $safetySha)"

  # --- 6. Move aside + load, one transaction ----------------------------------
  Log '[6/9] Loading the backup (one transaction - any error leaves the database as it was)' Cyan
  $asidePublic = "digilog_prerestore_$stamp"
  $prelude = New-Object System.Text.StringBuilder
  [void]$prelude.AppendLine($MoverSql)
  [void]$prelude.AppendLine("CREATE SCHEMA $asidePublic;")
  [void]$prelude.AppendLine("COMMENT ON SCHEMA $asidePublic IS '$AsideTag $stamp of public';")
  [void]$prelude.AppendLine("DO `$`$ BEGIN PERFORM pg_temp.digilog_move_objects('public', '$asidePublic'); END `$`$;")
  $asides = @([pscustomobject]@{ Aside = $asidePublic; Stamp = $stamp; Original = 'public'; IsPark = $false })
  # Park schemas (digilog_keep, digilog_keep_<hex>) of the LIVE database are recovery
  # copies an earlier failed in-app restore left: TRUSTED (in-app rule, eadcf9a +
  # 7321f87). Every one gets a fresh unique name before the load, so a park the
  # backup brings under the same name cannot replace it. Other schemas the backup
  # also contains are moved aside the same way.
  $liveParks = @($preSchemas | Where-Object { $_ -cmatch '^digilog_keep(_[0-9a-f]+)?$' })
  foreach ($s in (@($liveParks) + @($conflicts | Where-Object { $preSchemas -contains $_ -and $liveParks -notcontains $_ }))) {
    if ($s) {
      $c = Sql "SELECT pg_catalog.obj_description('`"$s`"'::regnamespace, 'pg_namespace');"
      $origComments[$s] = $(if ($c.Count) { $c[0] } else { $null })
      $isPark = $liveParks -contains $s
      $a = "${s}_$stamp"
      if ($isPark) { $a = 'digilog_keep_' + (-join (1..16 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })) }
      [void]$prelude.AppendLine("ALTER SCHEMA `"$s`" RENAME TO $a;")
      [void]$prelude.AppendLine("COMMENT ON SCHEMA $a IS '$AsideTag $stamp of $s';")
      $asides += [pscustomobject]@{ Aside = $a; Stamp = $stamp; Original = $s; IsPark = $isPark }
    }
  }
  $state.originalSchemaComments = $origComments
  $state.phase = 'loading'
  Save-State $state
  $preludeFile = Join-Path $workDir 'prelude.sql'
  $postludeFile = Join-Path $workDir 'postlude.sql'
  [System.IO.File]::WriteAllText($preludeFile, $prelude.ToString(), $utf8)
  [System.IO.File]::WriteAllText($postludeFile, @'
DO $check$
BEGIN
  IF pg_catalog.current_setting('digilog.stream_complete', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'restore-database: the backup stream did not finish - nothing was changed';
  END IF;
  IF pg_catalog.to_regclass('public.audit_trail') IS NULL OR pg_catalog.to_regclass('public._prisma_migrations') IS NULL
     OR pg_catalog.to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'restore-database: the backup did not create the application tables - nothing was changed';
  END IF;
END
$check$;
'@, $utf8)
  $loadArgs = @('load', '--psql', $psql, '--prelude', $preludeFile, '--postlude', $postludeFile)
  if ($format -eq 'custom') { $loadArgs += @('--pg-restore', $pgRestore, '--archive', $DumpFile, '--list', $listFile) }
  else { $loadArgs += @('--sql', $DumpFile) }
  $t0 = Get-Date
  $load = Invoke-Helper $loadArgs
  if (-not $load.committed) {
    $post = Get-Fingerprint
    $diff = Compare-Fingerprint $preFp $post
    if ($diff.Count) { Fail "The load failed AND the database differs from before: $($diff -join '; '). Restore the safety backup $safety with this script." }
    Fail "Loading the backup failed (psql exit $($load.psqlExit)$(if ($load.source.pgRestoreExit) { ", pg_restore exit $($load.source.pgRestoreExit)" })). The transaction was rolled back; the database is unchanged (verified). Details: $runLog"
  }
  $movedAside = $true
  $state.phase = 'loaded'
  Save-State $state
  Log "  Loaded in $([math]::Round(((Get-Date) - $t0).TotalMinutes, 1)) min."
  if ($load.source.skippedStatements) { foreach ($s in $load.source.skippedStatements) { LogFileOnly "  skipped statement: $s" } }

  # Every table holds exactly the rows the backup carried: the helper counted the
  # data lines of each COPY block on the way in (before any migration or carry-over).
  $postLoad = Get-Fingerprint
  $mismatch = @()
  $reconciled = 0; $reconciledRows = [long]0
  foreach ($prop in $load.source.copyRows.PSObject.Properties) {
    if ($prop.Name -notlike 'public.*') { continue }
    $t = $prop.Name.Substring(7).Trim('"')
    $have = $postLoad.Counts[$t]
    if ($null -eq $have -or [long]$have -ne [long]$prop.Value) { $mismatch += "$t (backup $($prop.Value), loaded $have)" }
    else { $reconciled++; $reconciledRows += [long]$prop.Value }
  }
  if ($mismatch.Count) { Fail "Row counts after the load do not match the backup: $($mismatch -join '; ')" }
  if ($reconciled -eq 0) { Fail 'No table data was counted in the backup stream.' }
  Log "  Row counts match the backup: $reconciled tables, $reconciledRows rows."
  if ($TestFailAfter -eq 'crash-after-load') { $keepWorkDir = $true; Log 'TEST: simulating a crash after the load.' Magenta; [Environment]::Exit(9) }
  if ($TestFailAfter -eq 'load') { Fail 'TEST: injected failure after the load.' }

  # --- 7. Checks + audit rows ------------------------------------------------
  Log '[7/9] Checking the restored data' Cyan
  $appMigrations = @(Get-ChildItem $migrationsDir -Directory | ForEach-Object { $_.Name } | Sort-Object)
  $restoredMigrations = Sql "SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1;"
  $newer = @($restoredMigrations | Where-Object { $appMigrations -notcontains $_ })
  $older = @($appMigrations | Where-Object { $restoredMigrations -notcontains $_ })
  $migrationsApplied = @()
  if ($newer.Count) { Fail "The backup comes from a NEWER program version (it has migrations this program does not: $($newer -join ', ')). Install that version first." }
  # Migrations run BEFORE the audit carry-over: an older backup's audit_trail can
  # lack a column the carried rows have (signature_audit_id, 2026-09-25), and
  # preserveUnbackedAuditRows matches columns by name - it would drop that value
  # and the carried row would no longer verify.
  if ($older.Count) {
    if (-not $ApplyMigrations) { Fail "The backup comes from an OLDER program version (missing migrations: $($older -join ', ')). Run again with -ApplyMigrations to upgrade it during the restore, or install the matching program version." }
    Log "  The backup is from an older version; applying $($older.Count) migration(s) (-ApplyMigrations)" Yellow
    $throwaway = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    $schemaNode = $nodeExe; if ($TestMode) { $schemaNode = 'node' }
    & (Join-Path $PSScriptRoot 'apply-schema.ps1') -NodeExe $schemaNode -ApiDir $apiDir -DatabaseUrl $dbUrl -AdminPassword $throwaway
    if ($LASTEXITCODE -ne 0) { Fail 'Upgrading the restored schema failed.' }
    $migrationsApplied = $older
  }
  Log "  Schema version matches this program ($($appMigrations.Count) migrations)."

  $postFp = $postLoad
  if ($migrationsApplied.Count) { $postFp = Get-Fingerprint }
  foreach ($t in 'users', 'roles', '_prisma_migrations') {
    if (-not $postFp.Counts.Contains($t) -or $postFp.Counts[$t] -lt 1) { Fail "The restored table $t is empty - this backup cannot run the application." }
  }
  $missingTables = @($preFp.Counts.Keys | Where-Object { -not $postFp.Counts.Contains($_) })
  if ($missingTables.Count -and $older.Count -eq 0) { Fail "Tables of this program are missing from the restored data: $($missingTables -join ', ')" }
  LogFileOnly '  table                         before      restored'
  foreach ($k in (@($preFp.Counts.Keys) + @($postFp.Counts.Keys) | Sort-Object -Unique)) {
    LogFileOnly ('  {0,-28} {1,10} {2,12}' -f $k, $preFp.Counts[$k], $postFp.Counts[$k])
  }
  foreach ($k in 'users', 'asset_instances', 'cleaning_cycles', 'filter_events', 'audit_trail') {
    if ($postFp.Counts.Contains($k)) { Log ('  {0,-18} before {1,10}   restored {2,10}' -f $k, $preFp.Counts[$k], $postFp.Counts[$k]) }
  }
  $backupTip = $postFp.Tip
  Log "  Backup's audit trail ends at chain position $(if ($backupTip) { $backupTip.Position } else { '(none)' })"

  # Every LIVE audit row the backup lacks survives the load (BR-100), with the
  # in-app rule for park schemas (eadcf9a + 7321f87): first this run's own source,
  # the live trail moved aside with public, then each park of the LIVE database
  # (trusted recovery copies, renamed in step 6), in one transaction with the same
  # dedupe. A park that came WITH the backup is not trusted: never a source,
  # dropped in step 9.
  $sources = @()
  $sourceLabel = @{}
  $has = Sql "SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace = '$asidePublic'::regnamespace AND relname = 'audit_trail' AND relkind = 'r';"
  if ($has.Count) { $sources += "$asidePublic.audit_trail"; $sourceLabel["$asidePublic.audit_trail"] = 'the current audit trail' }
  foreach ($a in ($asides | Where-Object { $_.IsPark })) {
    $has = Sql "SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace = '$($a.Aside)'::regnamespace AND relname = 'audit_trail' AND relkind = 'r';"
    if ($has.Count) { $sources += "$($a.Aside).audit_trail"; $sourceLabel["$($a.Aside).audit_trail"] = "live park $($a.Original) (renamed $($a.Aside))" }
  }
  $copy = New-Object System.Text.StringBuilder
  [void]$copy.AppendLine("SET client_min_messages = warning;")
  [void]$copy.AppendLine("CREATE SCHEMA $keepSchema;")
  $keepTables = @()
  $i = 0
  foreach ($src in $sources) {
    $i++
    # A plain copy: the moved-aside table keeps its no-delete trigger, and
    # preserveUnbackedAuditRows deletes from / renumbers in the table it is given.
    # Only rows the restored trail lacks are copied - the function's first step
    # deletes the others anyway, and at one-year volume that is ~7 M rows copied
    # just to be deleted again. Same rows reach the function's later steps.
    [void]$copy.AppendLine("CREATE TABLE $keepSchema.src$i AS SELECT * FROM $src s WHERE NOT EXISTS (SELECT 1 FROM public.audit_trail p WHERE p.id = s.id);")
    $keepTables += "$keepSchema.src$i"
  }
  $copyFile = Join-Path $workDir 'keep.sql'
  [System.IO.File]::WriteAllText($copyFile, $copy.ToString(), $utf8)
  if ((Invoke-SqlFile $copyFile -SingleTransaction) -ne 0) { Fail 'Could not copy the current audit trail aside.' }
  # Copies of earlier (live) parks lose every row a recorded hard delete names
  # before they are carried (app's dropRecordedDeletions, 16223ce): a restore must
  # not undo a recorded deletion. This run's own copy of the live trail is not filtered.
  $carryArgs = @('carry-over')
  for ($j = 0; $j -lt $keepTables.Count; $j++) {
    if ($sources[$j] -eq "$asidePublic.audit_trail") { $carryArgs += @('--keep-table', $keepTables[$j]) }
    else { $carryArgs += @('--park-keep-table', $keepTables[$j]) }
  }
  foreach ($s in ($sources | Where-Object { $_ -ne "$asidePublic.audit_trail" })) { $carryArgs += @('--park-source', $s) }
  Log "  Carrying over audit rows the backup does not have (from $(@($sources | ForEach-Object { $sourceLabel[$_] }) -join ', '))"
  $carry = Invoke-Helper $carryArgs -AppCode
  if (-not $carry.ok) { Fail "Carrying over the audit rows failed: $($carry.error)" }
  for ($j = 0; $j -lt $keepTables.Count; $j++) {
    $n = $carry.perTable.($keepTables[$j])
    $skipped = $carry.skippedDeleted.($keepTables[$j])
    $note = ''; if ($null -ne $skipped) { $note = "; $skipped row(s) skipped because a recorded hard delete names them" }
    Log "    $n row(s) from $($sourceLabel[$sources[$j]])$note"
  }
  Log "  $($carry.total) audit row(s) carried over; chain-position sequence realigned." Green
  if ($TestFailAfter -eq 'carry-over') { Fail 'TEST: injected failure after the carry-over.' }

  # --- 8. Audit chain + BACKUP_RESTORED -------------------------------------
  Log '[8/9] Verifying the restored audit trail' Cyan
  $from = 0
  if ($ChainCheck -eq 'Tail' -and $backupTip) { $from = [math]::Max(0, $backupTip.Position - 1) }
  $chain = Invoke-Helper @('verify-chain', '--from-position', "$from") -AppCode
  if (-not $chain.ok) { Fail "The audit-chain verification could not run: $($chain.error)" }
  $real = @($chain.anomalies | Where-Object { -not $_.informational -and $_.kind -notlike 'LEGACY_*' })
  $known = @{}
  if ($preChain) { foreach ($a in $preChain.anomalies) { $known["$($a.id)|$($a.kind)"] = $true } }
  $new = @($real | Where-Object { -not $known.ContainsKey("$($_.id)|$($_.kind)") })
  $newCount = $new.Count
  if ($chain.anomaliesTruncated -or ($preChain -and $preChain.anomaliesTruncated)) {
    # Too many to list one by one: no row-by-row comparison is possible, so every
    # anomaly counts as new and needs the operator's decision.
    Log "  More than 10000 anomalies: they cannot be compared one by one with the current chain." Yellow
    $newCount = [int]$chain.tamperingCount
  }
  $fromBackup = @($new | Where-Object { $backupTip -and $_.position -le $backupTip.Position })
  $fromCarry = @($new | Where-Object { -not $backupTip -or $_.position -gt $backupTip.Position })
  Log "  $($chain.totalRows) rows checked from position $($chain.fromPosition) in $($chain.seconds) s: $(if ($chain.tamperingCount -eq 0) { 'intact' } else { "$($chain.tamperingCount) anomalies, $newCount not present before the restore" })"
  $forced = $false
  if ($newCount) {
    $byKind = ($new | Group-Object kind | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', '
    Log "  NEW anomalies: $byKind ($($fromBackup.Count) in the backup's own rows, $($fromCarry.Count) in carried-over rows)" Yellow
    foreach ($a in ($new | Select-Object -First 20)) { Log "    position $($a.position)  $($a.kind)  $($a.id)" Yellow }
    if ($ChainCheck -eq 'Tail' -or -not $preChain) { Log '    (the current chain was not verified first, so "new" means every anomaly found)' Yellow }
    $mismatch = @($fromBackup | Where-Object { $_.kind -eq 'PER_ROW_CHECKSUM_MISMATCH' }).Count
    if ($mismatch -gt 0 -and $mismatch -ge 0.5 * [math]::Max(1, $fromBackup.Count)) {
      Log '    Most anomalies are checksum mismatches. If this backup comes from ANOTHER installation (or this server was' Yellow
      Log '    reinstalled), AUDIT_CHAIN_KEY in digilog.env must be the one that wrote the backup - see the guide.' Yellow
    }
    if ($fromCarry.Count) { Log '    Anomalies in carried-over rows are expected when the backup is not from this database''s own history (their links point to rows the backup does not have).' Yellow }
    if ($AcceptChainAnomalies) { Log '  Continuing (-AcceptChainAnomalies); recorded as forced in the audit trail.' Yellow; $forced = $true }
    elseif ($Force) { Fail 'New audit-chain anomalies after the restore. Re-run with -AcceptChainAnomalies to restore anyway (recorded), or use another backup.' }
    else {
      $typed = Read-Host 'Type ACCEPT to put this restore into service anyway (recorded in the audit trail), anything else to undo it'
      if ($typed -cne 'ACCEPT') { Fail 'Not accepted by the operator.' }
      $forced = $true
    }
  }
  if ($TestFailAfter -eq 'verify') { Fail 'TEST: injected failure after the chain verification.' }

  # Signed: the row belongs to the Super Admin who signed (so it is visible exactly
  # as an in-app restore's row is) and points at the REAUTH_SUCCESS signature row.
  # Emergency: the Windows account and the typed name, flagged - never silently.
  if ($signer) {
    $who = @{ userId = $signer.userId; userName = $signer.userName; userRole = $signer.userRole; signatureAuditId = $signer.signatureAuditId
              meaning = 'Database restored from a pg_dump backup on the server (restore-database.ps1), signed by a Super Admin'; signature = 'SIGNED' }
  } else {
    $who = @{ userId = "windows:$winAccount"; userName = $PerformedBy; userRole = $null; signatureAuditId = $null
              meaning = 'UNSIGNED EMERGENCY database restore on the server (restore-database.ps1): no electronic signature could be checked'; signature = 'UNSIGNED_EMERGENCY' }
  }
  $payload = @{
    userId = $who.userId
    userName = $who.userName
    userRole = $who.userRole
    signatureAuditId = $who.signatureAuditId
    reason = $Reason
    signatureMeaning = $who.meaning
    afterValue = [ordered]@{
      format = $format; method = 'restore-database.ps1'; timestamp = (Get-Date).ToUniversalTime().ToString('o')
      signature = $who.signature; reason = $Reason
      dumpFile = $DumpFile; dumpBytes = $dumpItem.Length; dumpSha256 = $dumpSha; dumpedFromVersion = $dumpVersion
      performedBy = $who.userName; windowsAccount = $winAccount; host = $env:COMPUTERNAME
      safetyDump = $safety; safetyDumpSha256 = $safetySha
      auditRowsPreserved = $carry.total; preservedBySource = $carry.perTable
      backupChainTip = $(if ($backupTip) { $backupTip.Position } else { $null })
      migrationsApplied = $migrationsApplied
      chainCheck = [ordered]@{ mode = $ChainCheck; rowsChecked = $chain.totalRows; anomalies = $chain.tamperingCount; newAnomalies = $newCount; forced = $forced }
    }
  }
  $payloadFile = Join-Path $workDir 'restored-row.json'
  [System.IO.File]::WriteAllText($payloadFile, ($payload | ConvertTo-Json -Depth 6), $utf8)
  $tipBefore = Invoke-Helper @('chain-tip') -AppCode
  $row = Invoke-Helper @('write-restored-row', '--payload', $payloadFile) -AppCode
  if (-not $row.ok) { Fail "Writing the BACKUP_RESTORED audit row failed: $($row.error)" }
  $tail = Invoke-Helper @('verify-chain', '--from-position', "$([math]::Max(0, $tipBefore.position - 1))") -AppCode
  # The window starts one row before the new row, so this checks its own checksum
  # and its link to the row before it - nothing else.
  $tailNew = @($tail.anomalies | Where-Object { -not $_.informational -and $_.kind -notlike 'LEGACY_*' -and $_.position -ge $row.chainPosition })
  if (-not $tail.ok -or $tailNew.Count) { Fail "The BACKUP_RESTORED row does not link into the chain ($(@($tailNew | ForEach-Object { $_.kind }) -join ', '))." }
  Log "  BACKUP_RESTORED written at chain position $($row.chainPosition) and verified." Green

  # --- 9. Finish -------------------------------------------------------------
  Log '[9/9] Finishing' Cyan
  $fin = New-Object System.Text.StringBuilder
  [void]$fin.AppendLine("SET client_min_messages = warning;")
  $asideNames = @($asides | ForEach-Object { $_.Aside })
  foreach ($a in $asideNames) { [void]$fin.AppendLine("DROP SCHEMA $a CASCADE;") }
  [void]$fin.AppendLine("DROP SCHEMA $keepSchema CASCADE;")
  # Parks that came WITH the backup (every live park was renamed in step 6 and is
  # among the asides above): untrusted, never a source, dropped.
  $parkRows = Sql "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname ~ '^digilog_keep(_[0-9a-f]+)?$' ORDER BY 1;"
  $parks = @($parkRows | Where-Object { $asideNames -notcontains $_ })
  foreach ($p in $parks) { [void]$fin.AppendLine("DROP SCHEMA `"$p`" CASCADE;") }
  $finFile = Join-Path $workDir 'finish.sql'
  [System.IO.File]::WriteAllText($finFile, $fin.ToString(), $utf8)
  if ((Invoke-SqlFile $finFile -SingleTransaction) -ne 0) { Fail 'Could not remove the moved-aside data.' }
  $movedAside = $false
  $finalOk = $true
  Remove-Item $stateFile -ErrorAction SilentlyContinue
  foreach ($p in $parks) {
    Log "  Dropped park schema $p that came with the backup. Not trusted; its rows were not carried over." Yellow
  }
  foreach ($a in ($asides | Where-Object { $_.IsPark })) {
    Log "  Dropped park schema $($a.Original) of the current database after its rows were carried over (renamed $($a.Aside) during the restore)." Yellow
  }
  $final = Get-Fingerprint
  Log "  Restored database: audit trail $($final.Counts['audit_trail']) rows, last chain position $($final.Tip.Position)."
  if ($apiStopped) { [void](Start-Api $serviceStartType); $apiStopped = $false }
  Log ''
  Log "RESTORE COMPLETE. Safety backup of the previous database: $safety" Green
  Add-RestoreHistory 'OK' "signature=$($who.signature) by=$($who.userId) audit-carried=$($carry.total) chain=$ChainCheck new-anomalies=$newCount forced=$forced safety=$safety"
  $exitCode = 0
}
catch {
  $failMsg = $_.Exception.Message
  Log "FAILED: $failMsg" Red
  if ($movedAside) {
    Log 'Putting the pre-restore data back ...' Yellow
    $code = Invoke-MoveBack $asides $preSchemas $keepSchema $origComments
    if ($code -eq 0) {
      $post = Get-Fingerprint
      $diff = Compare-Fingerprint $preFp $post
      if ($diff.Count -eq 0) { Log 'The database is exactly as it was before the restore (row counts, audit chain tip and schemas verified).' Green; Remove-Item $stateFile -ErrorAction SilentlyContinue }
      foreach ($a in ($asides | Where-Object { $_.IsPark })) {
        Log "The audit rows parked by an earlier restore are still in schema $($a.Original) (renamed $($a.Aside) during this attempt); they were not carried over." Yellow
      }
      else { Log "WARNING: after moving back, these differ from before: $($diff -join '; '). The safety backup is $safety." Red; $keepWorkDir = $true }
    } else {
      $keepWorkDir = $true
      Log "Moving the data back FAILED (psql exit $code). Nothing is lost: the pre-restore data is intact in schema $($asides[0].Aside)." Red
      Log 'Run this script again with -RollBackInterrupted, or contact support with the log.' Red
    }
  } elseif ($script:ownState -and -not $finalOk) {
    # Failed before the load committed: the database never changed.
    Remove-Item $stateFile -ErrorAction SilentlyContinue
  }
  if ($apiStopped -and -not (Test-Path $stateFile)) { [void](Start-Api $serviceStartType); $apiStopped = $false }
  elseif ($apiStopped) { Log "$ApiService stays stopped and Disabled until the interrupted restore is rolled back." Red }
  Add-RestoreHistory 'FAIL' $failMsg
  $exitCode = 1
}
finally {
  Clear-PgEnv
  if (-not $keepWorkDir) { Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue }
  Log "Log: $runLog" DarkGray
}
exit $exitCode
