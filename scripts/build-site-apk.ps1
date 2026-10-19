<#
.SYNOPSIS
  Build the tablet app for ONE site with that site's certificate authority built
  in, so the tablets at that site need no certificate install.

.DESCRIPTION
  Every DigiLog server makes its own local certificate authority at install time
  ("DigiLog Local CA", C:\ProgramData\DigiLog\certs\rootCA.pem, valid 10 years).
  The tablet app trusts exactly one built-in authority, the file
  apps/android/android/app/src/main/res/raw/rootca.pem (see
  res/xml/network_security_config.xml). In the repo that file is THIS dev PC's
  test authority, which no customer server uses.

  This script:
    1. checks the given file is a certificate authority certificate and NOT a
       private key (rootCA.key sits next to rootCA.pem - a key inside an APK lets
       anyone who has the APK pretend to be the server);
    2. optionally checks the site's server.crt is signed by it (-ServerCert);
    3. swaps it into res/raw/rootca.pem (REPLACES the dev authority - it is not
       added beside it), builds the APK with Gradle, and ALWAYS puts the original
       file back, even when the build fails;
    4. proves the result: the APK is a valid zip, its rootca.pem is byte-for-byte
       the site's authority, and every other file is identical to the released
       DigiLog-FilterOps.apk except the signature files (META-INF/*);
    5. writes dist\site-apks\FMS-<Site>.apk and FMS-<Site>.txt (fingerprints).

  It does NOT rebuild the web UI or run `cap sync`. The web files already inside
  the Android project are the ones in the released APK, and step 4 proves the
  site APK carries them unchanged. Rebuild DigiLog-FilterOps.apk first if the web
  UI changed, then run this.

  Signing: the APK is signed with this PC's debug key (~\.android\debug.keystore),
  the same key as DigiLog-FilterOps.apk, so it installs as an UPDATE over either.
  An APK signed with any other key will not install over the existing app; the
  tablet would have to uninstall first, which deletes its offline queue and any
  cleaning records not yet synced. Build site APKs on this PC, or back up that key.

  When to rebuild a site APK: only when that site's authority changes (a fresh
  install that created a new one, or its expiry). Never for an IP change.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-site-apk.ps1 `
    -RootCa D:\from-site\rootCA.pem -ServerCert D:\from-site\server.crt -Site PlantA
#>
[CmdletBinding()]
param(
  # The site's rootCA.pem (copied from C:\ProgramData\DigiLog\certs\ on that server).
  [Parameter(Mandatory)][string]$RootCa,
  # Short site name for the file name: letters, digits, dot, dash, underscore.
  [Parameter(Mandatory)][string]$Site,
  # Optional: the site's server.crt (same folder). Proves the authority is the one
  # that signed that server's certificate - catches copying the wrong file.
  [string]$ServerCert,
  [string]$OutDir,
  [string]$OpenSsl,
  [string]$JavaHome = $env:JAVA_HOME,
  [string]$AndroidHome = $env:ANDROID_HOME
)

$ErrorActionPreference = 'Stop'
$repoRoot   = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $repoRoot 'apps\android\android'
$rawRel     = 'apps/android/android/app/src/main/res/raw/rootca.pem'
$rawFile    = Join-Path $repoRoot ($rawRel -replace '/', '\')
$baseApk    = Join-Path $repoRoot 'DigiLog-FilterOps.apk'
$builtApk   = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'
if (-not $OutDir) { $OutDir = Join-Path $repoRoot 'dist\site-apks' }

function Fail($msg) { throw $msg }

# Run a native tool and capture stdout+stderr as text. With ErrorActionPreference
# 'Stop', Windows PowerShell 5.1 turns any redirected stderr line into a
# terminating error, so the tool's own message would be lost.
function Invoke-Captured([string]$exe, [string[]]$argList) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $exe @argList 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $prev }
  return ,@($out)
}

function Find-OpenSsl {
  if ($OpenSsl) { if (Test-Path $OpenSsl) { return $OpenSsl } ; Fail "openssl not found at $OpenSsl" }
  $c = Get-Command openssl -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\Git\mingw64\bin\openssl.exe", "$env:ProgramFiles\Git\usr\bin\openssl.exe")) {
    if (Test-Path $p) { return $p }
  }
  Fail 'openssl.exe not found. Install Git for Windows or pass -OpenSsl <path>.'
}

function Get-Sha256Hex([byte[]]$bytes) {
  $h = [System.Security.Cryptography.SHA256]::Create()
  try { return (($h.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}

# name -> sha256 of every entry; also reads every byte, so a truncated or corrupt
# zip throws here (the "BUILD SUCCESSFUL but truncated APK" case).
function Get-ZipEntryHashes([string]$path) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $map = @{}
  $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
  try {
    foreach ($e in $zip.Entries) {
      if ($e.FullName.EndsWith('/')) { continue }
      $s = $e.Open(); $ms = New-Object System.IO.MemoryStream
      try { $s.CopyTo($ms) } finally { $s.Dispose() }
      $map[$e.FullName] = Get-Sha256Hex $ms.ToArray()
    }
  } finally { $zip.Dispose() }
  return $map
}

$original = $null
$failed = $false
try {
  # --- 0. inputs -------------------------------------------------------------
  if ($Site -notmatch '^[A-Za-z0-9._-]{1,40}$') { Fail "-Site '$Site': use 1-40 letters, digits, dot, dash or underscore." }
  if (-not (Test-Path $RootCa)) { Fail "-RootCa file not found: $RootCa" }
  if (-not (Test-Path $baseApk)) { Fail "Released APK not found: $baseApk (build it first)." }
  if (-not (Test-Path $rawFile)) { Fail "Built-in authority file not found: $rawFile" }
  if (-not $JavaHome -or -not (Test-Path $JavaHome)) { Fail 'JAVA_HOME is not set (JDK 21). Pass -JavaHome.' }
  if (-not $AndroidHome -or -not (Test-Path $AndroidHome)) { Fail 'ANDROID_HOME is not set (Android SDK). Pass -AndroidHome.' }
  $ossl = Find-OpenSsl

  # A previous run that died before restoring would leave the file changed.
  & git -C $repoRoot diff --quiet -- $rawRel
  if ($LASTEXITCODE -ne 0) { Fail "$rawRel has local changes (a previous run may have died). Restore it with: git checkout -- $rawRel" }

  # --- 1. the file must be ONE certificate-authority certificate, no key -------
  Write-Host '==> Checking the site certificate authority' -ForegroundColor Cyan
  $text = [System.IO.File]::ReadAllText((Resolve-Path $RootCa))
  if ($text -match 'PRIVATE KEY') {
    Fail "$RootCa contains a PRIVATE KEY. Use rootCA.pem, never rootCA.key - a key inside the app lets anyone with the APK impersonate the server."
  }
  $blocks = [regex]::Matches($text, '-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----')
  if ($blocks.Count -ne 1) { Fail "$RootCa must hold exactly one certificate (found $($blocks.Count))." }

  $info = Invoke-Captured $ossl @('x509', '-in', $RootCa, '-noout', '-subject', '-issuer', '-enddate', '-fingerprint', '-sha256', '-ext', 'basicConstraints')
  if ($LASTEXITCODE -ne 0) { Fail "openssl cannot read $RootCa as a certificate: $info" }
  $infoText = ($info | Out-String)
  if ($infoText -notmatch 'CA:TRUE') {
    Fail "$RootCa is not a certificate authority (no CA:TRUE). It looks like a server certificate; use rootCA.pem."
  }
  Invoke-Captured $ossl @('x509', '-in', $RootCa, '-noout', '-checkend', '0') | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "$RootCa has EXPIRED. Re-create the site's certificates first." }
  Invoke-Captured $ossl @('x509', '-in', $RootCa, '-noout', '-checkend', '31536000') | Out-Null
  $expiresSoon = ($LASTEXITCODE -ne 0)
  $subject  = (($info | Where-Object { $_ -match '^subject=' }) -replace '^subject=\s*', '')
  $notAfter = (($info | Where-Object { $_ -match '^notAfter=' }) -replace '^notAfter=', '')
  $finger   = (($info | Where-Object { $_ -match 'Fingerprint=' }) -replace '^.*Fingerprint=', '')
  Write-Host "  subject     : $subject"
  Write-Host "  valid until : $notAfter"
  Write-Host "  SHA-256     : $finger"
  if ($expiresSoon) { Write-Host '  WARNING: expires within a year - tablets will stop trusting the server then.' -ForegroundColor Yellow }

  if ($ServerCert) {
    if (-not (Test-Path $ServerCert)) { Fail "-ServerCert file not found: $ServerCert" }
    $v = Invoke-Captured $ossl @('verify', '-CAfile', $RootCa, $ServerCert)
    if ($LASTEXITCODE -ne 0) { Fail "The server certificate is NOT signed by this authority - wrong rootCA.pem? openssl: $($v | Out-String)" }
    Write-Host "  server.crt  : signed by this authority - OK"
  }
  $caBytes = [System.Text.Encoding]::ASCII.GetBytes($blocks[0].Value.Replace("`r`n", "`n") + "`n")

  # --- 2. swap in, build -----------------------------------------------------
  $original = [System.IO.File]::ReadAllBytes($rawFile)
  [System.IO.File]::WriteAllBytes($rawFile, $caBytes)

  Write-Host '==> Building the APK (Gradle)' -ForegroundColor Cyan
  $env:JAVA_HOME = $JavaHome
  $env:ANDROID_HOME = $AndroidHome
  $env:PATH = "$JavaHome\bin;$env:PATH"
  Push-Location $androidDir
  try {
    & .\gradlew.bat --stop | Out-Null
    if (Test-Path $builtApk) { Remove-Item $builtApk -Force }
    & .\gradlew.bat clean assembleDebug --no-daemon
    if ($LASTEXITCODE -ne 0) { Fail "Gradle build failed (exit $LASTEXITCODE)." }
  } finally { Pop-Location }
  if (-not (Test-Path $builtApk)) { Fail "Gradle reported success but $builtApk is missing." }

  # --- 3. prove the result ---------------------------------------------------
  Write-Host '==> Verifying the APK' -ForegroundColor Cyan
  $siteMap = Get-ZipEntryHashes $builtApk
  $baseMap = Get-ZipEntryHashes $baseApk
  $rawEntry = 'res/raw/rootca.pem'
  if (-not $siteMap.ContainsKey($rawEntry)) { Fail "$rawEntry missing from the built APK." }
  if ($siteMap[$rawEntry] -ne (Get-Sha256Hex $caBytes)) { Fail "$rawEntry in the APK is not the site authority." }
  $diff = @()
  foreach ($k in (@($siteMap.Keys) + @($baseMap.Keys) | Select-Object -Unique)) {
    if ($k -eq $rawEntry -or $k -like 'META-INF/*') { continue }
    if ($siteMap[$k] -ne $baseMap[$k]) { $diff += $k }
  }
  if ($diff.Count) {
    Fail ("The site APK differs from DigiLog-FilterOps.apk in more than the certificate: " + (($diff | Select-Object -First 10) -join ', ') +
          ". Rebuild DigiLog-FilterOps.apk from the current code first, then run this again.")
  }
  Write-Host "  valid zip, $($siteMap.Count) files; only the certificate and signature differ from DigiLog-FilterOps.apk - OK"

  # --- 4. output -------------------------------------------------------------
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $outApk = Join-Path $OutDir "FMS-$Site.apk"
  Copy-Item $builtApk $outApk -Force
  # The Gradle output now carries THIS site's authority. Remove it so it can never
  # be copied to the repo root as the general DigiLog-FilterOps.apk by mistake.
  Remove-Item $builtApk -Force
  $apkSha = (Get-FileHash $outApk -Algorithm SHA256).Hash.ToLower()
  $commit = (& git -C $repoRoot rev-parse --short HEAD)
  $baseSha = (Get-FileHash $baseApk -Algorithm SHA256).Hash.ToLower()
  $notes = @(
    "Site            : $Site"
    "Built           : $(Get-Date -Format 'yyyy-MM-dd HH:mm') on $env:COMPUTERNAME, code $commit"
    "APK SHA-256     : $apkSha"
    "Same app as     : DigiLog-FilterOps.apk $baseSha (only the built-in certificate differs)"
    "Trusts CA       : $subject"
    "CA valid until  : $notAfter"
    "CA SHA-256      : $finger"
    "Server cert     : $(if ($ServerCert) { 'checked - signed by this CA' } else { 'not checked (-ServerCert not given)' })"
    "Signed with     : this PC's debug key - installs as an update over DigiLog-FilterOps.apk"
    "Rebuild when    : this site's CA changes. NOT for an IP change."
  )
  [System.IO.File]::WriteAllLines((Join-Path $OutDir "FMS-$Site.txt"), $notes)
  Write-Host "==> Site APK: $outApk" -ForegroundColor Green
  $notes | ForEach-Object { Write-Host "  $_" }
}
catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  $failed = $true
}
finally {
  if ($null -ne $original) {
    [System.IO.File]::WriteAllBytes($rawFile, $original)
    & git -C $repoRoot diff --quiet -- $rawRel
    if ($LASTEXITCODE -ne 0) {
      Write-Host "FAILED: could not restore $rawRel - run: git checkout -- $rawRel" -ForegroundColor Red
      $failed = $true
    } else {
      Write-Host "  restored the repo's built-in certificate ($rawRel)" -ForegroundColor Gray
    }
  }
}
if ($failed) { exit 1 }
exit 0
