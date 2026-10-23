<#
  Stand-in for install.ps1 / upgrade.ps1, run by run-setup-script-harness.iss.
  Prints the kinds of output the real scripts print (Write-Host, a native
  program's stdout and stderr), records the secret it received in a file the
  test reads (so the secret itself is never printed), then exits per -Mode.
#>
param(
  [ValidateSet('ok', 'warn', 'fail')] [string]$Mode = 'ok',
  [Parameter(Mandatory)] [string]$DataRoot
)

Write-Host "==> harness step one ($Mode)" -ForegroundColor Cyan
cmd /c "echo harness-native-stdout & echo harness-native-stderr 1>&2"
$secret = $env:FMS_SETUP_ADMIN_PASSWORD
Set-Content -Path (Join-Path $DataRoot 'received-secret.txt') -Value "$secret" -Encoding ascii -NoNewline
Write-Host "secret received: $($secret.Length) characters"

if ($Mode -eq 'warn') { Write-Host "WARN: harness warning line" -ForegroundColor Yellow; exit 0 }
if ($Mode -eq 'fail') {
  Write-Host "FAILED: harness step two (exit 1)" -ForegroundColor Red
  Write-Host "FATAL: harness failure line" -ForegroundColor Red
  exit 3
}
Write-Host "harness finished"
exit 0
