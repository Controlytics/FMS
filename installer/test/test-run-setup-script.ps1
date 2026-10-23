<#
.SYNOPSIS
  Proves installer\run-setup-script.iss (how FMS Setup runs install.ps1 /
  upgrade.ps1) without installing FMS: no admin, no services, no ProgramData.

.DESCRIPTION
  1. Compiles installer\DigiLog.iss against a dummy staging folder (catches any
     [Code] error in seconds instead of at the end of a 20-minute build).
  2. Compiles run-setup-script-harness.iss with a fake password and runs it
     silently three times (fake-setup-script.ps1 -Mode fail / warn / ok), checking:
       - Setup's exit code: 10 when the script fails, 0 otherwise;
       - the install-*.log holds the script's Write-Host lines AND a native
         program's stdout and stderr, plus the exit code;
       - the password reached the script (environment variable) and appears in
         neither that log nor Setup's own log.
  Exit 0 = all checks passed.

.PARAMETER Iscc  ISCC.exe (Inno Setup 6.3 or newer - ExecAndLogOutput).
#>
[CmdletBinding()]
param(
  [string]$Iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  [string]$WorkDir = (Join-Path $env:TEMP "fms-run-setup-script-test-$(Get-Date -Format 'yyyyMMdd-HHmmss')")
)

$here = $PSScriptRoot
$failures = New-Object System.Collections.Generic.List[string]
function Check([bool]$ok, [string]$what) {
  if ($ok) { Write-Host "  PASS  $what" -ForegroundColor Green }
  else     { Write-Host "  FAIL  $what" -ForegroundColor Red; $failures.Add($what) }
}

if (-not (Test-Path $Iscc)) { Write-Host "FAILED: ISCC not found at $Iscc" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
Write-Host "Work folder: $WorkDir"

# 1. DigiLog.iss compiles (dummy payload: one small file per staged folder).
Write-Host "==> Compile installer\DigiLog.iss against a dummy stage" -ForegroundColor Cyan
$stage = Join-Path $WorkDir 'stage'
foreach ($d in 'prereq','pgsql','runtime','service','openssl','scripts','tablet') { New-Item -ItemType Directory -Force -Path (Join-Path $stage $d) | Out-Null }
Set-Content (Join-Path $stage 'prereq\VC_redist.x64.exe') 'dummy' -Encoding ascii
foreach ($d in 'pgsql','runtime','service','openssl','scripts','tablet') { Set-Content (Join-Path $stage "$d\placeholder.txt") 'dummy' -Encoding ascii }
& $Iscc /Q "/DStageDir=$stage" '/DAppVersion=0.0.1' "/DOutputDir=$(Join-Path $WorkDir 'digilog-out')" (Join-Path (Split-Path $here -Parent) 'DigiLog.iss')
Check ($LASTEXITCODE -eq 0) 'DigiLog.iss compiles'

# 2. The harness. The secret has the characters that broke the old command line
#    (a double quote cannot be compiled into a Pascal literal; & % ^ $ ! < > | can).
$secret = 'Hx7&9%x^$!<>|Qz'
Write-Host "==> Compile the harness" -ForegroundColor Cyan
$hOut = Join-Path $WorkDir 'harness-out'
& $Iscc /Q "/DTestSecret=$secret" "/DOutDir=$hOut" (Join-Path $here 'run-setup-script-harness.iss')
Check ($LASTEXITCODE -eq 0) 'harness compiles'
$harness = Join-Path $hOut 'run-setup-script-harness.exe'
if (-not (Test-Path $harness)) { Write-Host "FAILED: no harness exe" -ForegroundColor Red; exit 1 }

foreach ($case in @(
    @{ Mode = 'fail'; Exit = 10; Lines = @('==> harness step one (fail)', 'harness-native-stdout', 'harness-native-stderr', 'FATAL: harness failure line', 'Exit code: 3', ' - FAILED') },
    @{ Mode = 'warn'; Exit = 0;  Lines = @('WARN: harness warning line', 'harness-native-stderr', 'Exit code: 0', ' - OK') },
    @{ Mode = 'ok';   Exit = 0;  Lines = @('harness finished', 'harness-native-stdout', 'Exit code: 0', ' - OK') })) {
  $m = $case.Mode
  Write-Host "==> Run the harness, mode $m" -ForegroundColor Cyan
  $dir = Join-Path $WorkDir "run-$m"; $data = Join-Path $dir 'data'; $setupLog = Join-Path $dir 'setup.log'
  # Setup cannot create its /LOG file in a missing folder (it exits 1, "failed to initialize").
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $p = Start-Process -FilePath $harness -Wait -PassThru -ArgumentList @(
         '/VERYSILENT', '/SUPPRESSMSGBOXES', "/LOG=`"$setupLog`"", "/DIR=`"$dir\app`"", "/DataRoot=`"$data`"", "/Mode=$m")
  Check ($p.ExitCode -eq $case.Exit) "mode $m`: Setup exit code $($p.ExitCode) (expected $($case.Exit))"
  $log = Get-ChildItem (Join-Path $data 'logs') -Filter 'install-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
  Check ($null -ne $log) "mode $m`: an install-*.log was written in data\logs"
  if (-not $log) { continue }
  $text = Get-Content $log.FullName -Raw
  foreach ($l in $case.Lines) { Check ($text.Contains($l)) "mode $m`: log contains '$l'" }
  Check (-not $text.Contains($secret)) "mode $m`: password absent from the install log"
  $setupText = if (Test-Path $setupLog) { Get-Content $setupLog -Raw } else { '' }
  Check ($setupText.Length -gt 0) "mode $m`: Setup's own log was written"
  Check (-not $setupText.Contains($secret)) "mode $m`: password absent from Setup's own log"
  $received = Get-Content (Join-Path $data 'received-secret.txt') -Raw -ErrorAction SilentlyContinue
  Check ($received -eq $secret) "mode $m`: the script received the exact password through the environment"
}

Write-Host ""
if ($failures.Count -gt 0) { Write-Host "$($failures.Count) check(s) FAILED" -ForegroundColor Red; exit 1 }
Write-Host "All checks passed. (Work folder kept: $WorkDir)" -ForegroundColor Green
exit 0
