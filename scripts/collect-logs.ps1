<#
.SYNOPSIS
  Collect every DigiLog log source into ONE zip file for diagnosis.

.DESCRIPTION
  When something is wrong, the evidence is spread across four places that are
  written by four different things:

    1. <DataRoot>\logs\app\      - the application's own channels (error,
                                   application, http, database, services,
                                   security, and per-module files)
    2. <DataRoot>\logs\*.log     - WinSW service logs. THE MOST IMPORTANT ONES
                                   when the API will not start at all, because
                                   they capture a crash that happens before the
                                   application logger exists.
    3. <DataRoot>\db\log\        - the PostgreSQL server log. The only evidence
                                   when the database itself refuses connections.
    4. Windows Event Log         - what the Service Control Manager saw, which
                                   is the only record of "service failed to
                                   start" / "service terminated unexpectedly".

  This script gathers all four, plus a live snapshot (service states, port
  bindings, /api/health, disk free, versions), into a single timestamped zip you
  can attach to a support message.

  Read-only: it copies files and queries state. It never deletes or modifies a
  log, so it is safe to run while the services are up. Run it as soon as an
  incident happens - the app logs are pruned to 7 days.

.PARAMETER DataRoot   Where DigiLog keeps data + logs (default C:\ProgramData\DigiLog)
.PARAMETER OutDir     Where to write the zip (default: your Desktop)
.PARAMETER ApiPort    API port, for the /api/health probe (default 3000)
.PARAMETER Days       Only include app/PG log files modified in the last N days (default 7)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\collect-logs.ps1

.EXAMPLE
  # A dev machine running from the repo rather than an installed service
  .\scripts\collect-logs.ps1 -DataRoot .\apps\api -OutDir .
#>
[CmdletBinding()]
param(
  [string]$DataRoot = 'C:\ProgramData\DigiLog',
  [string]$OutDir   = [Environment]::GetFolderPath('Desktop'),
  [int]$ApiPort     = 3000,
  [int]$Days        = 7
)

$ErrorActionPreference = 'Continue'   # a missing source must not abort the collection
$stamp   = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$staging = Join-Path $env:TEMP "digilog-logs-$stamp"
$zipPath = Join-Path $OutDir "digilog-logs-$stamp.zip"
$cutoff  = (Get-Date).AddDays(-$Days)

Write-Host "DigiLog log collection" -ForegroundColor Cyan
Write-Host "  DataRoot : $DataRoot"
Write-Host "  Output   : $zipPath"
Write-Host ""

New-Item -ItemType Directory -Force -Path $staging | Out-Null

function Copy-Tree($label, $source, $destName) {
  if (-not (Test-Path $source)) {
    Write-Host "  [skip] $label - not found at $source" -ForegroundColor DarkGray
    return
  }
  $dest = Join-Path $staging $destName
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $files = Get-ChildItem -Path $source -Recurse -File |
           Where-Object { $_.LastWriteTime -ge $cutoff }
  foreach ($f in $files) {
    # Preserve the folder structure so channel names survive into the zip.
    $rel = $f.FullName.Substring((Resolve-Path $source).Path.Length).TrimStart('\')
    $target = Join-Path $dest $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item -Path $f.FullName -Destination $target -Force
  }
  $bytes = ($files | Measure-Object -Property Length -Sum).Sum
  $mb = if ($bytes) { [math]::Round($bytes / 1MB, 2) } else { 0 }
  Write-Host "  [ok]   $label - $($files.Count) file(s), $mb MB" -ForegroundColor Green
}

# ── 1-3: the file-based sources ──────────────────────────────────────────────
Copy-Tree 'application logs' (Join-Path $DataRoot 'logs\app')  'app-logs'
Copy-Tree 'PostgreSQL logs'  (Join-Path $DataRoot 'db\log')    'postgres-logs'

# WinSW writes DigiLogAPI.out.log / .err.log / .wrapper.log directly in logs\.
# Copied separately (not -Recurse from logs\) so they don't duplicate app-logs.
$winswDir = Join-Path $DataRoot 'logs'
if (Test-Path $winswDir) {
  $dest = Join-Path $staging 'service-logs'
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $svcFiles = Get-ChildItem -Path $winswDir -File -Filter '*.log*' |
              Where-Object { $_.LastWriteTime -ge $cutoff }
  $svcFiles | ForEach-Object { Copy-Item $_.FullName -Destination $dest -Force }
  Write-Host "  [ok]   service (WinSW) logs - $($svcFiles.Count) file(s)" -ForegroundColor Green
} else {
  Write-Host "  [skip] service (WinSW) logs - not found at $winswDir" -ForegroundColor DarkGray
}

# ── 4: Windows Event Log ─────────────────────────────────────────────────────
# The ONLY record of "the service would not start", because at that point the
# application never ran and wrote nothing of its own.
$evtFile = Join-Path $staging 'windows-event-log.txt'
try {
  $events = Get-WinEvent -FilterHashtable @{
    LogName   = 'Application', 'System'
    StartTime = $cutoff
  } -ErrorAction Stop |
    Where-Object { $_.Message -match 'DigiLog' -or $_.ProviderName -match 'DigiLog|Service Control Manager' } |
    Select-Object -First 500
  $events |
    Select-Object TimeCreated, LogName, ProviderName, Id, LevelDisplayName, Message |
    Format-List | Out-File -FilePath $evtFile -Encoding utf8
  Write-Host "  [ok]   Windows Event Log - $($events.Count) entr(ies)" -ForegroundColor Green
} catch {
  "Could not read the Windows Event Log: $($_.Exception.Message)" |
    Out-File -FilePath $evtFile -Encoding utf8
  Write-Host "  [warn] Windows Event Log - $($_.Exception.Message)" -ForegroundColor Yellow
}

# ── Live snapshot ────────────────────────────────────────────────────────────
$snapFile = Join-Path $staging 'snapshot.txt'
$snap = New-Object System.Collections.Generic.List[string]
$snap.Add("DigiLog diagnostic snapshot")
$snap.Add("Collected : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$snap.Add("Machine   : $env:COMPUTERNAME")
$snap.Add("User      : $env:USERNAME")
$snap.Add("DataRoot  : $DataRoot")
$snap.Add("Window    : last $Days day(s)")
$snap.Add("")

$snap.Add("=== Services ===")
foreach ($name in 'DigiLogDB', 'DigiLogAPI') {
  $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($svc) {
    $snap.Add("$name : $($svc.Status) (startup: $($svc.StartType))")
  } else {
    $snap.Add("$name : NOT INSTALLED")
  }
}
$snap.Add("")

$snap.Add("=== Listening ports ===")
try {
  Get-NetTCPConnection -State Listen -ErrorAction Stop |
    Where-Object { $_.LocalPort -in @($ApiPort, 5432, 5433) } |
    ForEach-Object { $snap.Add("  $($_.LocalAddress):$($_.LocalPort)  pid=$($_.OwningProcess)") }
} catch {
  $snap.Add("  (could not enumerate: $($_.Exception.Message))")
}
$snap.Add("")

$snap.Add("=== API health ===")
# The API uses a private CA, so certificate validation is deliberately bypassed
# HERE ONLY - this is a loopback diagnostic call, not a trust decision.
try {
  Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.ServerCertificateCustomValidationCallback = { $true }
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(10)
  $ok = $false
  foreach ($scheme in 'https', 'http') {
    try {
      $resp = $client.GetAsync("${scheme}://localhost:$ApiPort/api/health").Result
      $body = $resp.Content.ReadAsStringAsync().Result
      $snap.Add("  ${scheme}://localhost:$ApiPort/api/health -> $([int]$resp.StatusCode)")
      $snap.Add("  $body")
      $ok = $true
      break
    } catch { }
  }
  if (-not $ok) { $snap.Add("  UNREACHABLE on both https and http (port $ApiPort)") }
} catch {
  $snap.Add("  probe failed: $($_.Exception.Message)")
}
$snap.Add("")

$snap.Add("=== Disk ===")
try {
  Get-PSDrive -PSProvider FileSystem -ErrorAction Stop |
    Where-Object { $_.Used -ne $null } |
    ForEach-Object {
      $freeGb = [math]::Round($_.Free / 1GB, 1)
      $usedGb = [math]::Round($_.Used / 1GB, 1)
      $snap.Add("  $($_.Name): used ${usedGb} GB, free ${freeGb} GB")
    }
} catch { $snap.Add("  (unavailable)") }
$snap.Add("")

$snap.Add("=== Log directory sizes ===")
foreach ($p in @((Join-Path $DataRoot 'logs\app'), (Join-Path $DataRoot 'logs'), (Join-Path $DataRoot 'db\log'))) {
  if (Test-Path $p) {
    $sum = (Get-ChildItem $p -Recurse -File | Measure-Object -Property Length -Sum).Sum
    $snap.Add("  $p : $([math]::Round($sum / 1MB, 2)) MB")
  }
}
$snap.Add("")

$snap.Add("=== Versions ===")
$snap.Add("  OS         : $((Get-CimInstance Win32_OperatingSystem).Caption) $([Environment]::OSVersion.Version)")
$snap.Add("  PowerShell : $($PSVersionTable.PSVersion)")
$snap | Out-File -FilePath $snapFile -Encoding utf8
Write-Host "  [ok]   live snapshot" -ForegroundColor Green

# ── A short README so whoever opens the zip knows what they are looking at ───
$readme = @"
DigiLog diagnostic bundle - $stamp

WHERE TO LOOK FIRST
  1. app-logs\error\        Every warning and error from every part of the
                            application, newest file last. Start here.
  2. snapshot.txt           Service states, ports, /api/health, disk free.
  3. service-logs\          WinSW service logs. Look here when the API would
                            not START - a crash before the app logger exists
                            appears ONLY here.
  4. windows-event-log.txt  What Windows itself saw. "Service failed to start"
                            lives here.

THE OTHER APP CHANNELS (app-logs\)
  application\  boot, configuration actually resolved, shutdown, crashes
  http\         one line per API request: method, url, status, ms, user, IP
  database\     database connect/disconnect, Prisma errors, slow queries
  services\     background jobs (session sweep, PM overdue, notifications, LDAP)
  security\     logins, logouts, rejected tokens, permission denials
  modules\      per-module detail: filter-operations, sync, pm-schedules, backup

  postgres-logs\  the PostgreSQL server's own log - the only evidence when the
                  database refuses connections.

NOTE
  These are OPERATIONAL logs and they are deleted after 7 days. They are NOT
  the 21 CFR Part 11 audit trail, which is stored in the database, hash-chained,
  and retained permanently.

  Log lines may contain usernames, IP addresses and request URLs. Passwords and
  tokens are redacted at source. Treat this bundle as internal.
"@
$readme | Out-File -FilePath (Join-Path $staging 'README.txt') -Encoding utf8

# ── Zip it ───────────────────────────────────────────────────────────────────
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "Done. $zipPath ($sizeMb MB)" -ForegroundColor Green
Write-Host "Open README.txt inside the zip for what to look at first." -ForegroundColor Cyan
