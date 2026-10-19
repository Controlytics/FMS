# Failure injection on a *_perf API instance ONLY: kills the API process while a
# load run (started separately) is in progress, restarts it, and measures how
# long until /api/health answers 200 again. The load run's own 10 s timeline
# (results/runs/<id>.json) shows what the clients saw meanwhile.
#
#   powershell -File tests\performance\recovery\restart-under-load.ps1 -Port 3102 -Database digilog_day1_perf -KillAfterSec 90
param(
  [int]$Port = 3102,
  [string]$Database = 'digilog_day1_perf',
  [int]$KillAfterSec = 90
)
$ErrorActionPreference = 'Stop'
if ($Port -eq 3000) { throw 'refusing port 3000 (the dev API)' }
if ($Database -notmatch '_perf\d*$') { throw "refusing database '$Database'" }
$t = Resolve-Path (Join-Path $PSScriptRoot '..')
Start-Sleep -Seconds $KillAfterSec
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) { throw "nothing listening on $Port" }
$proc = Get-Process -Id $conn.OwningProcess
"{0}  KILL pid {1} (WS {2} MB)" -f (Get-Date -Format 'HH:mm:ss.fff'), $proc.Id, [int]($proc.WorkingSet64 / 1MB)
$sw = [Diagnostics.Stopwatch]::StartNew()
Stop-Process -Id $proc.Id -Force
# WinSW would restart the service itself; here we do what it does, immediately.
& powershell -ExecutionPolicy Bypass -File (Join-Path $t 'start-perf-api.ps1') -NoBuild -Database $Database -Port $Port | Out-Null
$started = $sw.Elapsed.TotalSeconds
$ok = $false
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Milliseconds 500
  try { $code = & curl.exe -sk -o NUL -w '%{http_code}' "https://localhost:$Port/api/health" } catch { $code = '000' }
  if ($code -eq '200') { $ok = $true; break }
}
$sw.Stop()
"{0}  process started after {1:N1} s; /api/health 200 after {2:N1} s (ok={3})" -f (Get-Date -Format 'HH:mm:ss.fff'), $started, $sw.Elapsed.TotalSeconds, $ok
