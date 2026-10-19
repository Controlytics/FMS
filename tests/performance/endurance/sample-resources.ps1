# Samples the perf API process + Postgres every N seconds into a CSV, so a run's
# beginning / middle / end can be compared (memory growth, handle leaks, pool
# saturation, lock waits). Read-only: it never changes anything.
#
#   powershell -File tests\performance\endurance\sample-resources.ps1 -Seconds 1800 -Label soak30
param(
  [int]$Port = 3100,
  [string]$Database = 'digilog_perf',
  [int]$IntervalSec = 15,
  [int]$Seconds = 600,
  [string]$Label = 'run'
)
$ErrorActionPreference = 'Continue'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$outDir = Join-Path $repo 'tests\performance\results\resources'
New-Item -ItemType Directory -Force $outDir | Out-Null
$out = Join-Path $outDir ("{0}_{1}.csv" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Label)
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$env:PGPASSWORD = 'digilog123'
$cores = [Environment]::ProcessorCount

$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) { throw "nothing listening on $Port" }
$apiPid = $conn.OwningProcess

'time,elapsed_s,api_cpu_pct_of_machine,api_ws_mb,api_private_mb,api_handles,api_threads,sys_cpu_pct,sys_free_mb,pg_conns,pg_active,pg_idle_in_tx,pg_lock_waits,pg_db_mb' | Set-Content $out
$start = Get-Date
$prev = (Get-Process -Id $apiPid).TotalProcessorTime.TotalMilliseconds
$prevT = Get-Date
while (((Get-Date) - $start).TotalSeconds -lt $Seconds) {
  Start-Sleep -Seconds $IntervalSec
  $p = Get-Process -Id $apiPid -ErrorAction SilentlyContinue
  if (-not $p) { Add-Content $out ("{0},{1},API_PROCESS_GONE" -f (Get-Date -Format o), [int]((Get-Date) - $start).TotalSeconds); break }
  $now = Get-Date
  $cpuMs = $p.TotalProcessorTime.TotalMilliseconds
  $apiCpu = [math]::Round((($cpuMs - $prev) / (($now - $prevT).TotalMilliseconds * $cores)) * 100, 1)
  $prev = $cpuMs; $prevT = $now
  $os = Get-CimInstance Win32_OperatingSystem
  $sysCpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  $q = "select count(*), count(*) filter (where state='active'), count(*) filter (where state like 'idle in transaction%'), (select count(*) from pg_locks where not granted), pg_database_size('$Database')/1048576 from pg_stat_activity where datname='$Database'"
  $pg = (& $psql -h localhost -U digilog -d $Database -w -At -F ',' -c $q 2>$null) -join ''
  if (-not $pg) { $pg = ',,,,' }
  ('{0},{1},{2},{3},{4},{5},{6},{7},{8},{9}' -f $now.ToString('o'), [int]($now - $start).TotalSeconds, $apiCpu,
     [math]::Round($p.WorkingSet64 / 1MB), [math]::Round($p.PrivateMemorySize64 / 1MB), $p.HandleCount, $p.Threads.Count,
     $sysCpu, [math]::Round($os.FreePhysicalMemory / 1KB), $pg) | Add-Content $out
}
Write-Host "resource samples: $out"
