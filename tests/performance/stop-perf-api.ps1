# Stops ONLY the performance-test API (the process listening on port 3100).
param([int]$Port = 3100)
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) { Write-Host "nothing listening on $Port"; exit 0 }
foreach ($c in $conns) {
  $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    Stop-Process -Id $proc.Id -Force
    Write-Host "stopped node pid $($proc.Id) on port $Port"
  } else {
    Write-Host "port $Port is held by '$($proc.ProcessName)' - not a node process, left alone"
  }
}
