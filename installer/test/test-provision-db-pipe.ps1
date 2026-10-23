<#
.SYNOPSIS
  Proves that scripts\provision-db.ps1 never leaves the database running when it
  fails after `pg_ctl start` - the one way FMS Setup could hang with no message.

.DESCRIPTION
  Setup captures install.ps1's output through a pipe (installer\run-setup-script.iss)
  and waits until EVERY holder of that pipe has gone (test-run-setup-script.ps1,
  mode 'orphan'). The postmaster started by provision-db inherits the pipe, so a
  failure that exits with the cluster still up would leave Setup on "Setting up the
  FMS database..." for ever. Until 2026-10-23 the start sat outside the try/finally
  that stops it.

  This test copies provision-db.ps1, injects `exit 1` straight after the start,
  runs it with stdout/stderr redirected to pipes (as Setup does) on a scratch data
  directory, and checks the pipe closes promptly and nothing is left listening.
  Needs PostgreSQL binaries (the staged ones from a build, or any PostgreSQL 18).
  No admin, nothing installed. Exit 0 = pass.
#>
[CmdletBinding()]
param(
  [string]$PgBin = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'dist\stage\pgsql\bin'),
  [int]$Port = 5497,
  [string]$WorkDir = (Join-Path $env:TEMP "fms-provision-db-pipe-test-$(Get-Date -Format 'yyyyMMdd-HHmmss')")
)

$source = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'scripts\provision-db.ps1'
if (-not (Test-Path (Join-Path $PgBin 'pg_ctl.exe'))) { Write-Host "FAILED: no pg_ctl.exe in $PgBin (pass -PgBin)" -ForegroundColor Red; exit 1 }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { Write-Host "FAILED: port $Port is in use (pass -Port)" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

# Inject the failure straight after the start line.
$marker = "Run `$pgctl @('-D', `$DataDir, '-l', `$pgLog, '-w', 'start')"
$copy = Join-Path $WorkDir 'provision-db.ps1'
$injected = $false
$lines = foreach ($l in (Get-Content $source)) {
  $l
  if ($l.Contains($marker)) { 'Write-Host "INJECTED: exit right after the cluster start"; exit 1'; $injected = $true }
}
if (-not $injected) { Write-Host "FAILED: start line not found in $source - update this test" -ForegroundColor Red; exit 1 }
Set-Content -Path $copy -Value $lines -Encoding ascii

$psArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$copy`" -PgBin `"$PgBin`" -DataDir `"$WorkDir\db`" -Port $Port " +
          "-AppPassword p1 -SuperPassword Sup3r-test -AdminPassword Adm1n-test -ApiDir `"$WorkDir`" -LogDir `"$WorkDir\logs`" -StopWhenDone"
$psi = New-Object Diagnostics.ProcessStartInfo 'powershell.exe', $psArgs
$psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = [Diagnostics.Process]::Start($psi)
$out = $p.StandardOutput.ReadToEndAsync(); $err = $p.StandardError.ReadToEndAsync()
$p.WaitForExit()
$closed = $out.Wait(30000) -and $err.Wait(1000)
$sw.Stop()
$listening = [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listening) {
  # Never leave a postmaster behind, whatever the result.
  Start-Process -FilePath (Join-Path $PgBin 'pg_ctl.exe') -ArgumentList @('-D', "`"$WorkDir\db`"", '-m', 'fast', '-w', 'stop') -WindowStyle Hidden -Wait
}

$failures = 0
function Check([bool]$ok, [string]$what) {
  if ($ok) { Write-Host "  PASS  $what" -ForegroundColor Green } else { Write-Host "  FAIL  $what" -ForegroundColor Red; $script:failures++ }
}
Check ($closed -and $out.Result.Contains('INJECTED: exit right after the cluster start')) 'the injected failure ran (the cluster had started)'
Check ($p.ExitCode -eq 1) "provision-db exited 1 (got $($p.ExitCode))"
Check $closed ("the output pipe closed ({0:N1} s) - Setup would continue and show the failure" -f $sw.Elapsed.TotalSeconds)
Check (-not $listening) "nothing left listening on port $Port"
if ($failures) { Write-Host "$failures check(s) FAILED (work folder kept: $WorkDir)" -ForegroundColor Red; exit 1 }
Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue
Write-Host "All checks passed." -ForegroundColor Green
exit 0
