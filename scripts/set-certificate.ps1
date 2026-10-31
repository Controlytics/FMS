<#
.SYNOPSIS
  INSTALLED SERVER: switch FMS to a company / bought HTTPS certificate, or back
  to its own one - checked first, rolled back automatically if FMS does not come
  up on it. Start menu: "FMS > Change SSL certificate" (set-certificate.cmd).

.DESCRIPTION
  2026-10-31 (operator: "some times ssl will change"). Before this the swap was a
  hand edit of digilog.env, and a wrong file stopped the whole site.

    1. Takes a .pfx/.p12 (with its password), or a .crt/.pem/.cer plus its .key.
       A password-protected key is opened here; FMS needs it unprotected.
    2. check-certificate.mjs refuses (nothing changes) a certificate that:
       does not match its key, is a CA, is expired / not yet valid, is not made
       for servers, lacks an intermediate (tablets never fetch one), does not end
       at a trusted root (this PC's, or -RootCa), names none of this server's
       addresses (digilog-addresses.ini + this PC's IP; -Force accepts), or that
       Node cannot load.
    3. Copies the key + chain into C:\ProgramData\DigiLog\custom-cert\<time>\
       (SYSTEM + Administrators only), with root-ca.pem = the root the tablets
       must trust.
    4. Points TLS_KEY_PATH / TLS_CERT_PATH in digilog.env at them (backup first),
       restarts DigiLogAPI, and checks FMS answers AND serves the new certificate.
       Otherwise it puts digilog.env back, restarts, and says so.
    5. Writes one line per change to logs\certificate-changes.log.

  -UseBuiltIn goes back to the FMS's own certificate (DigiLog Local CA, certs\).
  -CheckOnly checks a file and changes nothing (no Administrator needed).

  Tablets trust the ROOT, not this file: renewing under the same company root
  needs nothing on any tablet. Upgrades never touch TLS_KEY_PATH/TLS_CERT_PATH.
  NOT the 21 CFR Part 11 audit trail: a certificate is not an electronic record;
  the change is logged locally (the in-app SA upload page that would audit it was
  deferred 2026-10-22).

.EXAMPLE
  set-certificate.ps1 -Pfx D:\fms.company.local.pfx
  set-certificate.ps1 -CertFile D:\fms.crt -KeyFile D:\fms.key -RootCa D:\company-root.cer
  set-certificate.ps1 -UseBuiltIn
#>
[CmdletBinding()]
param(
  [string]$Pfx,
  [string]$CertFile,
  [string]$KeyFile,
  # The company ROOT certificate, when this PC does not already trust it.
  [string]$RootCa,
  # .pfx or key password. Asked for when needed and not given.
  [securestring]$Password,
  [switch]$UseBuiltIn,
  [switch]$CheckOnly,
  # Accept a certificate that names none of this server's addresses.
  [switch]$Force,
  # Do not ask "switch now?".
  [switch]$Yes,
  # Defaults are resolved in the body (Windows PowerShell 5.1 leaves $PSScriptRoot
  # empty in an advanced script's param() defaults).
  [string]$InstallDir,
  [string]$DataRoot   = 'C:\ProgramData\DigiLog',
  [string]$ApiService = 'DigiLogAPI',
  [string]$NodeExe,
  [string]$OpenSsl,
  # Tests only: a script run INSTEAD of Restart-Service (a throwaway HTTPS server).
  [string]$RestartWith
)

$ErrorActionPreference = 'Stop'
if (-not $InstallDir) { $InstallDir = Split-Path -Parent $PSScriptRoot }
if (-not $NodeExe)    { $NodeExe    = Join-Path $InstallDir 'runtime\node.exe' }
if (-not $OpenSsl)    { $OpenSsl    = Join-Path $InstallDir 'openssl\openssl.exe' }
. (Join-Path $PSScriptRoot 'address-config.ps1')
. (Join-Path $PSScriptRoot 'health-probe.ps1')

$configDir  = Join-Path $DataRoot 'config'
$envFile    = Join-Path $configDir 'digilog.env'
$iniFile    = Join-Path $configDir 'digilog-addresses.ini'
$certDir    = Join-Path $DataRoot 'certs'
$builtInKey = Join-Path $certDir 'server.key'
$builtInCrt = Join-Path $certDir 'server.crt'
$ownRootCa  = Join-Path $certDir 'rootCA.pem'
$customRoot = Join-Path $DataRoot 'custom-cert'
$logFile    = Join-Path $DataRoot 'logs\certificate-changes.log'
$checker    = Join-Path $PSScriptRoot 'check-certificate.mjs'
$stamp      = Get-Date -Format 'yyyyMMdd-HHmmss'

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Warn($m) { Write-Host "!!  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "FAILED: $m" -ForegroundColor Red; exit 1 }
function Write-ChangeLog([string]$line) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $logFile) | Out-Null
    $who = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    Add-Content -Path $logFile -Encoding ascii -Value ("{0}  user={1}  {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $who, $line)
  } catch { Write-Warn "Could not write $logFile ($($_.Exception.Message))." }
}
function ConvertTo-Plain([securestring]$s) {
  if (-not $s) { return '' }
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
# Native tool, stdout+stderr as text. Under 'Stop', Windows PowerShell 5.1 turns
# a native tool's stderr line into a terminating error.
function Invoke-Native([string]$exe, [string[]]$argList) {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $exe @argList 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $eap }
  return ,@($out)
}
function Invoke-Checker([string[]]$argList, [string]$keyPass) {
  if ($keyPass) { $env:DIGILOG_KEY_PASSPHRASE = $keyPass }
  try {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $json = & $NodeExe $checker @argList 2>$null } finally { $ErrorActionPreference = $eap }
  } finally { Remove-Item Env:\DIGILOG_KEY_PASSPHRASE -ErrorAction SilentlyContinue }
  $line = @($json | Where-Object { "$_".Trim().StartsWith('{') }) | Select-Object -Last 1
  if (-not $line) { Fail "The certificate checker gave no answer ($NodeExe)." }
  return ($line | ConvertFrom-Json)
}
function Get-Served([int]$port) {
  try { return Invoke-Checker @('served', '--port', "$port") '' } catch { return $null }
}
function Restart-Api {
  if ($RestartWith) { & $RestartWith -EnvFile $envFile; return }
  Restart-Service -Name $ApiService -Force
}
function Protect-Folder([string]$dir) {
  # SYSTEM (the DigiLogAPI service account) + Administrators + whoever runs this.
  # Not the inherited ProgramData ACL, under which every local user can read.
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $null = Invoke-Native 'icacls.exe' @($dir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', "*${me}:(OI)(CI)F")
  if ($LASTEXITCODE -ne 0) { Write-Warn "Could not restrict access to $dir (icacls exit $LASTEXITCODE)." }
}

# --- 0. What to do ----------------------------------------------------------------
$interactive = -not ($Pfx -or $CertFile -or $UseBuiltIn)
if ($interactive) {
  Write-Host ''
  Write-Host ' CHANGE THE FMS HTTPS (SSL) CERTIFICATE' -ForegroundColor Cyan
  Write-Host '   1  Use a certificate from IT (.pfx / .p12 file, or .crt + .key files)'
  Write-Host '   2  Go back to the FMS''s own certificate (DigiLog Local CA)'
  Write-Host '   3  Only CHECK a certificate file (nothing is changed)'
  Write-Host ''
  $choice = (Read-Host 'Type 1, 2 or 3 (Enter = cancel)').Trim()
  if ($choice -eq '2') { $UseBuiltIn = $true }
  elseif ($choice -eq '1' -or $choice -eq '3') {
    if ($choice -eq '3') { $CheckOnly = $true }
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = 'Choose the certificate from IT'
    $dlg.Filter = 'Certificate (*.pfx;*.p12;*.crt;*.cer;*.pem)|*.pfx;*.p12;*.crt;*.cer;*.pem|All files (*.*)|*.*'
    if ($dlg.ShowDialog($owner) -ne 'OK') { Write-Host 'Cancelled. Nothing was changed.'; exit 1 }
    if ($dlg.FileName -match '\.(pfx|p12)$') { $Pfx = $dlg.FileName }
    else {
      $CertFile = $dlg.FileName
      if (-not ([IO.File]::ReadAllText($CertFile) -match 'PRIVATE KEY-----')) {
        $dlg.Title = 'Choose the PRIVATE KEY file that belongs to this certificate'
        $dlg.Filter = 'Private key (*.key;*.pem)|*.key;*.pem|All files (*.*)|*.*'
        if ($dlg.ShowDialog($owner) -ne 'OK') { Write-Host 'Cancelled. Nothing was changed.'; exit 1 }
        $KeyFile = $dlg.FileName
      }
    }
  } else { Write-Host 'Cancelled. Nothing was changed.'; exit 1 }
}
if ($Pfx -and $CertFile) { Fail 'Give either -Pfx or -CertFile, not both.' }
foreach ($f in @($Pfx, $CertFile, $KeyFile, $RootCa)) { if ($f -and -not (Test-Path -LiteralPath $f)) { Fail "File not found: $f" } }

$needsAdmin = -not $CheckOnly -and -not $RestartWith
if ($needsAdmin) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { Fail 'Run this as Administrator (Start menu: FMS > Change SSL certificate).' }
}
if (-not (Test-Path $envFile)) { Fail "$envFile not found - is FMS installed here?" }
if (-not (Test-Path $NodeExe)) { Fail "node.exe not found at $NodeExe." }
$envPort = Get-DigilogEnvKey $envFile 'PORT'
$apiPort = if ($envPort -match '^\d+$') { [int]$envPort } else { 3000 }
$curKey = Get-DigilogEnvKey $envFile 'TLS_KEY_PATH'
$curCrt = Get-DigilogEnvKey $envFile 'TLS_CERT_PATH'

# Every address this server is reached by: the certificate must name one.
$lanIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
$names = @()
if (Test-Path $iniFile) {
  try { $names = @((Read-DigilogAddresses -Path $iniFile -DefaultApiPort $apiPort).Addresses) }
  catch { Write-Warn "digilog-addresses.ini could not be read ($($_.Exception.Message)); checking against this PC's IP only." }
}
if ($lanIp -and ($names -notcontains $lanIp)) { $names += $lanIp }

# --- 1. The new files, as PEM -----------------------------------------------------
$work = $null
$plain = ConvertTo-Plain $Password
if ($UseBuiltIn) {
  if (-not (Test-Path $builtInCrt) -or -not (Test-Path $builtInKey)) { Fail "The FMS's own certificate is missing ($certDir). Re-run the installer." }
  if (-not $CheckOnly) {
    # It may predate a network change made while the company certificate was in
    # use (the certificate check task leaves certs\ alone then).
    $certArgs = @{ CertDir = $certDir; OpenSsl = $OpenSsl; OpenSslConf = (Join-Path (Split-Path $OpenSsl) 'openssl.cnf'); ExtraNames = $names }
    & (Join-Path $PSScriptRoot 'issue-lan-cert.ps1') @certArgs
    if ($LASTEXITCODE -ne 0) { Fail 'The FMS certificate could not be brought up to date (see above). Nothing was changed.' }
  }
  $certIn = $builtInCrt; $keyIn = $builtInKey
  $newCrt = $builtInCrt; $newKey = $builtInKey
} else {
  New-Item -ItemType Directory -Force -Path $customRoot | Out-Null
  $work = Join-Path $customRoot $stamp
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  Protect-Folder $work
  if ($Pfx) {
    if (-not (Test-Path $OpenSsl)) { Fail "openssl.exe not found at $OpenSsl (needed to open a .pfx)." }
    $env:OPENSSL_CONF = Join-Path (Split-Path $OpenSsl) 'openssl.cnf'
    $env:OPENSSL_MODULES = Join-Path (Split-Path $OpenSsl) 'ossl-modules'
    $pfxCerts = Join-Path $work 'pfx-certs.pem'
    $pfxKey   = Join-Path $work 'pfx-key.pem'
    $asked = $false
    while ($true) {
      $pass = if ($plain) { @('-passin', 'env:DIGILOG_PFX_PASS') } else { @('-passin', 'pass:') }
      if ($plain) { $env:DIGILOG_PFX_PASS = $plain }
      try {
        $ok = $false; $lastOut = ''
        foreach ($legacy in @($false, $true)) {
          $extra = if ($legacy) { @('-legacy') } else { @() }
          $o1 = Invoke-Native $OpenSsl (@('pkcs12', '-in', $Pfx, '-nokeys', '-out', $pfxCerts) + $pass + $extra)
          $e1 = $LASTEXITCODE
          $o2 = Invoke-Native $OpenSsl (@('pkcs12', '-in', $Pfx, '-nocerts', '-nodes', '-out', $pfxKey) + $pass + $extra)
          $e2 = $LASTEXITCODE
          $lastOut = (@($o1) + @($o2)) -join ' '
          if ($e1 -eq 0 -and $e2 -eq 0) { $ok = $true; break }
          if ($lastOut -notmatch 'unsupported|RC2|legacy') { break }   # not an old-algorithm problem
        }
      } finally { Remove-Item Env:\DIGILOG_PFX_PASS -ErrorAction SilentlyContinue }
      if ($ok) { break }
      if ($lastOut -match 'invalid password|mac verify|bad decrypt' -and -not $asked -and ($interactive -or -not $Yes)) {
        $plain = ConvertTo-Plain (Read-Host -AsSecureString $(if ($plain) { 'Wrong password. Password of the .pfx file' } else { 'Password of the .pfx file' }))
        $asked = $true
        continue
      }
      Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
      if ($lastOut -match 'invalid password|mac verify|bad decrypt') { Fail 'The .pfx password is wrong. Nothing was changed.' }
      Fail "The .pfx file could not be opened: $lastOut"
    }
    $certIn = $pfxCerts; $keyIn = $pfxKey
  } else {
    $certIn = $CertFile; $keyIn = if ($KeyFile) { $KeyFile } else { $CertFile }
  }
  $newCrt = Join-Path $work 'server.crt'
  $newKey = Join-Path $work 'server.key'
}

# --- 2. Check -----------------------------------------------------------------------
$checkArgs = @('check', '--cert', $certIn, '--key', $keyIn, '--names', ($names -join ','))
if ($RootCa) { $checkArgs += @('--root-ca', $RootCa) }
if (Test-Path $ownRootCa) { $checkArgs += @('--extra-roots', $ownRootCa) }
if ($curCrt -and (Test-Path $curCrt)) { $checkArgs += @('--current', $curCrt) }
if ($Force) { $checkArgs += '--allow-unmatched-names' }
if ($work) { $checkArgs += @('--out', $work) }
$r = Invoke-Checker $checkArgs $plain
if ($r.fatal) { if ($work) { Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue }; Fail "The certificate checker failed: $($r.fatal)" }
if (-not $r.ok -and @($r.errors | Where-Object { $_.code -eq 'KEY_ENCRYPTED' }).Count -and -not $Yes) {
  $plain = ConvertTo-Plain (Read-Host -AsSecureString 'The private key has a password. Password')
  $r = Invoke-Checker $checkArgs $plain
}
$plain = $null
if ($work) { Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $work 'pfx-certs.pem'), (Join-Path $work 'pfx-key.pem') }

Write-Host ''
if ($r.leaf) {
  Write-Host "  Certificate : $($r.leaf.subject)"
  Write-Host "  Names       : $(@($r.leaf.sans) -join ', ')"
  Write-Host "  Valid until : $($r.leaf.validTo) ($($r.leaf.daysLeft) days)"
  Write-Host "  Issued by   : $($r.leaf.issuer)$(if (@($r.chain).Count) { "  ($(@($r.chain).Count) intermediate(s) included)" })"
}
if ($r.root) { Write-Host "  Root        : $($r.root.subject)  [SHA-256 $($r.root.fingerprint256)]" }
foreach ($w in @($r.warnings)) { if ($w) { Write-Warn $w.message } }
if (-not $r.ok) {
  foreach ($e in @($r.errors)) { Write-Host "  X  $($e.message)" -ForegroundColor Red }
  if ($work) { Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue }
  Write-Host ''
  Fail 'This certificate cannot be used. Nothing was changed.'
}
Write-Host '  OK - the certificate and key can be used.' -ForegroundColor Green

# What the tablets need. They trust the ROOT, never the server certificate.
$tablet = @()
if ($r.root -and $r.root.source -eq 'public') { $tablet += 'Issued by a public authority that Android already trusts: nothing to install on the tablets.' }
elseif ($r.rootChanged -eq $false) { $tablet += 'Same root as the certificate in use now: NOTHING to do on the tablets.' }
elseif ($CheckOnly) {
  $tablet += "The tablets must trust the root ""$($r.root.subject)"" ONCE. After the switch its file is root-ca.pem in $customRoot\<time>\."
} else {
  $rootFile = if ($UseBuiltIn) { $ownRootCa } else { Join-Path $work 'root-ca.pem' }
  $tablet += "The tablets must trust this root ONCE: $rootFile"
  $tablet += '  (copy it to each tablet: Settings > Security > Install certificate, or build a site APK with it).'
}
if ($r.serverIdChanged -and $r.rootChanged -eq $false) {
  $tablet += 'Tablets keep working at the same address. If the server''s IP also changes before a tablet reconnects,'
  $tablet += '  press "Find server" on the tablet and confirm "Use this server".'
}
$ipSans = @($r.leaf.sans | Where-Object { $_ -match '^[\d.]+$' -or $_ -match ':' })
if (-not $ipSans.Count) {
  $tablet += "This certificate names only server NAMES. Tablets and browsers must use https://$((@($r.leaf.sans) | Select-Object -First 1)):$apiPort - not an IP address."
}
Write-Host ''
Write-Host 'Tablets:' -ForegroundColor Cyan
$tablet | ForEach-Object { Write-Host "  $_" }

if ($CheckOnly) {
  if ($work) { Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue }
  Write-Host ''
  Write-Host 'Check only: nothing was changed.' -ForegroundColor Green
  exit 0
}
if (-not $Yes) {
  Write-Host ''
  $a = Read-Host 'Switch the FMS server to this certificate now? FMS restarts (about a minute). Type Y to switch'
  if ($a.Trim() -notmatch '^(y|yes)$') {
    if ($work) { Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue }
    Write-Host 'Not switched. Nothing was changed.'
    exit 1
  }
}

# --- 3. Switch, prove, or roll back ------------------------------------------------
$before = Get-Served $apiPort
$envBackup = "$envFile.bak-$stamp"
Copy-Item $envFile $envBackup
Set-DigilogEnvKey $envFile 'TLS_KEY_PATH' $newKey
Set-DigilogEnvKey $envFile 'TLS_CERT_PATH' $newCrt
Write-Step "digilog.env now points at $(Split-Path $newCrt) (backup: $(Split-Path -Leaf $envBackup))"
Write-Step "Restarting $ApiService..."
Restart-Api
$healthy = Wait-DigilogHealth -Port $apiPort -Seconds 120
$after = if ($healthy) { Get-Served $apiPort } else { $null }
$what = if ($UseBuiltIn) { 'action=use-built-in' } else { 'action=switch' }
$newDesc = "new=""$($r.leaf.subject)"" newExpires=$($r.leaf.validTo) newSha256=$($r.leaf.fingerprint256)"
$oldDesc = if ($before -and $before.ok) { "old=""$($before.subject)"" oldSha256=$($before.fingerprint256)" } else { 'old=(not answering)' }
if ($healthy -and $after -and $after.ok -and $after.fingerprint256 -eq $r.leaf.fingerprint256) {
  Write-ChangeLog "$what result=OK $newDesc $oldDesc folder=$(Split-Path $newCrt)"
  Write-Host ''
  Write-Host "Done. FMS is serving the new certificate on port $apiPort." -ForegroundColor Green
  if ($curCrt -and ($curCrt -ne $newCrt)) { Write-Host "  The previous certificate files were kept ($(Split-Path $curCrt))." -ForegroundColor Gray }
  Write-Host '  Browsers: refresh the page (users may need to sign in again).' -ForegroundColor Gray
  exit 0
}

$why = if (-not $healthy) { "FMS did not answer within 120 s" } elseif (-not ($after -and $after.ok)) { 'the served certificate could not be read' } else { "FMS is serving a different certificate ($($after.subject))" }
Write-Warn "Switch failed: $why. Putting the previous certificate back..."
Copy-Item $envBackup $envFile -Force
Restart-Api
$back = Wait-DigilogHealth -Port $apiPort -Seconds 120
Write-ChangeLog "$what result=FAILED reason=""$why"" rolledBack=$back $newDesc $oldDesc"
if ($work -and (Test-Path $work)) { Rename-Item $work "$stamp-FAILED" -ErrorAction SilentlyContinue }
if ($back) { Fail "Switch failed ($why). FMS is back on the previous certificate. Check $DataRoot\logs\app\error." }
Fail "Switch failed ($why) and FMS did not come back on the previous certificate either. digilog.env is restored; check $DataRoot\logs\app\error and the DigiLogAPI service."
