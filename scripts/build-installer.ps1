<#
.SYNOPSIS
  Build pipeline that produces DigiLog-Setup-<ver>.exe. Run on a BUILD MACHINE
  (needs Inno Setup 6 + internet for the bundled binaries).
  See tasks/EXE-PACKAGING-PLAN.md section 4 + M5.

.DESCRIPTION
  Stages everything the installer ships into <OutDir>\stage, then compiles the
  Inno Setup script. Steps:
    1. build the app bundle (scripts/build-bundle.ps1)
    2. clean-room production deps (npm ci --omit=dev in an isolated checkout)
    3. stage runtime/ (scripts/stage-runtime.ps1)
    4. stage pgsql/  (portable PostgreSQL binaries)
    5. stage service/ (WinSW-x64.exe)
    6. stage scripts/ (provision/register/install/uninstall)
    7. stage prereq/  (VC++ 2015-2022 x64 redistributable)
    8. stage openssl/ (OpenSSL CLI - PostgreSQL does NOT ship one)
    9. ISCC -> Setup.exe

  Prerequisites (the build machine provides these; not committed to the repo):
    -NodeZip   path to node-vXX-win-x64.zip      (ABI must match the native build)
    -PgZip     path to postgresql-18-...-windows-x64-binaries.zip
    -WinswExe  path to WinSW-x64.exe              (github.com/winsw/winsw releases)
    -VcRedist  path to VC_redist.x64.exe          (aka.ms/vs/17/release/vc_redist.x64.exe)
    -OpenSslZip path to openssl-3.5.x.zip           (FireDaemon OpenSSL, EV-signed + published SHA-256)
    -Iscc      path to ISCC.exe                   (Inno Setup 6)

  This script is authored + structured here; a full run requires those external
  binaries + Inno Setup and is performed on the build machine.

.PARAMETER AppVersion  Version stamped into the installer + filename
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$NodeZip,
  [Parameter(Mandatory)] [string]$PgZip,
  [Parameter(Mandatory)] [string]$WinswExe,
  # Microsoft VC++ 2015-2022 x64 redistributable. MANDATORY: the bundled PostgreSQL
  # binaries import VCRUNTIME140.dll / vcruntime140_1.dll / msvcp140.dll, which are
  # not part of Windows. Without it the installer compiles cleanly and then fails on
  # any machine that lacks the runtime - so this is a build-time hard requirement,
  # not an option. Download: https://aka.ms/vs/17/release/vc_redist.x64.exe
  [Parameter(Mandatory)] [string]$VcRedistExe,
  # OpenSSL CLI zip. MANDATORY: install.ps1 step 1b shells out to openssl.exe to
  # generate the local CA + HTTPS server certificate, and the PostgreSQL "binaries"
  # distribution does NOT contain openssl.exe (only the libcrypto/libssl DLLs and
  # C headers). Without this every FRESH install aborts at cert generation with
  # "FATAL: openssl.exe not found". Download + verify the published SHA-256 from
  # https://kb.firedaemon.com/support/solutions/articles/4000121705
  [Parameter(Mandatory)] [string]$OpenSslZip,
  [string]$Iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  [string]$AppVersion = '0.1.0',
  [string]$OutDir,
  # --- Code signing (M7). Optional: omit -Sign to build an UNSIGNED installer
  #     (SmartScreen/AV will warn on customer machines - see the acceptance
  #     runbook). Supply EITHER a PFX file (-CertPath [+ -CertPassword]) OR a
  #     cert already in the Windows store (-CertSubject "CN=..."). -TimestampUrl
  #     is an RFC3161 server so signatures stay valid after the cert expires. ---
  [switch]$Sign,
  [string]$CertPath,
  [string]$CertPassword,
  [string]$CertSubject,
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $repoRoot 'dist' }
$stage    = Join-Path $OutDir 'stage'
$cleanDir = Join-Path $OutDir 'cleanroom'

function Step($name, $block) {
  Write-Host "==> $name" -ForegroundColor Cyan
  & $block
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $name (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
}

# Locate signtool.exe from the newest installed Windows SDK (not bundled - it
# ships with the Windows 10/11 SDK on the build machine).
function Find-SignTool {
  $roots = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "$env:ProgramFiles\Windows Kits\10\bin")
  foreach ($r in $roots) {
    if (Test-Path $r) {
      $st = Get-ChildItem $r -Recurse -Filter 'signtool.exe' -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\' } |
            Sort-Object FullName -Descending | Select-Object -First 1
      if ($st) { return $st.FullName }
    }
  }
  return $null
}

# Authenticode-sign one file with SHA-256 + RFC3161 timestamp. Fails hard if
# signing was requested but cannot proceed (a silently-unsigned "signed" build
# is worse than an openly unsigned one).
function Sign-File($signtool, $file) {
  $common = @('sign', '/fd', 'sha256', '/tr', $TimestampUrl, '/td', 'sha256')
  if ($CertPath)         { $common += @('/f', $CertPath); if ($CertPassword) { $common += @('/p', $CertPassword) } }
  elseif ($CertSubject)  { $common += @('/n', $CertSubject) }
  else { Write-Host "FAILED: -Sign requires -CertPath (PFX) or -CertSubject (store cert)." -ForegroundColor Red; exit 1 }
  & $signtool @common $file
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: signtool on $file (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
  Write-Host "    signed: $(Split-Path $file -Leaf)" -ForegroundColor DarkGray
}

# Fresh staging
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage, $cleanDir | Out-Null

# 1. Build the app (shared/queue/api/web)
Step "Build app bundle" { & (Join-Path $PSScriptRoot 'build-bundle.ps1') }

# 2. Clean-room production deps. We do `npm ci --omit=dev` in an isolated tree so
#    the live repo node_modules (with dev deps) is never disturbed. git archive
#    gives a pristine checkout; then we build the workspace packages there too.
Step "Clean-room npm ci --omit=dev" {
  Push-Location $repoRoot
  try {
    # Pristine, tracked-files-only checkout (no node_modules) via git archive.
    # Use ZIP + Expand-Archive, NOT `git archive --format=tar | tar -x`: piping a
    # native command's binary output through the PowerShell pipeline re-encodes it
    # as text and corrupts the tar stream (and `tar` flavour/PATH is not
    # guaranteed on a build box). Writing a zip and expanding it is fully
    # PowerShell-native and deterministic.
    if (Test-Path $cleanDir) { Remove-Item -Recurse -Force $cleanDir }
    New-Item -ItemType Directory -Force -Path $cleanDir | Out-Null
    $archiveZip = Join-Path $OutDir 'repo-archive.zip'
    if (Test-Path $archiveZip) { Remove-Item -Force $archiveZip }
    git archive --format=zip -o $archiveZip HEAD
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: git archive" -ForegroundColor Red; exit 1 }
    Expand-Archive -Path $archiveZip -DestinationPath $cleanDir -Force
    # SAFETY GUARD: never run `npm ci` unless the clean-room actually holds its own
    # package manifest. Without this, an empty $cleanDir makes npm walk UP to the
    # live repo root and `npm ci --omit=dev` WIPES the developer's dev deps.
    if (-not (Test-Path (Join-Path $cleanDir 'package.json')) -or -not (Test-Path (Join-Path $cleanDir 'package-lock.json'))) {
      Write-Host "FAILED: clean-room checkout missing package.json/package-lock.json at $cleanDir (archive/extract failed). Aborting before npm ci can touch the live repo." -ForegroundColor Red
      exit 1
    }
    Push-Location $cleanDir
    npm ci --omit=dev
    # Generate the Prisma CLIENT (.prisma/client/index.js). `npm ci --omit=dev`
    # does NOT reliably run @prisma/client's generate postinstall in a monorepo
    # clean-room (it can't find apps/api/prisma/schema.prisma on its own), and
    # without the generated client `node prisma/seed.mjs` throws "@prisma/client
    # did not initialize yet" on the customer box. `prisma` is a prod dep now, so
    # it is present here. This is separate from the query-engine .node (staged by
    # stage-runtime) and from the schema engine (used only by migrate deploy).
    if ($LASTEXITCODE -eq 0) { node node_modules/prisma/build/index.js generate --schema apps/api/prisma/schema.prisma }
    Pop-Location
  } finally { Pop-Location }
}

# 3. Extract portable node.exe
$nodeTmp = Join-Path $OutDir 'node-extract'
if (Test-Path $nodeTmp) { Remove-Item -Recurse -Force $nodeTmp }
Expand-Archive -Path $NodeZip -DestinationPath $nodeTmp -Force
$nodeExe = (Get-ChildItem $nodeTmp -Recurse -Filter 'node.exe' | Select-Object -First 1).FullName

# 4. Stage runtime/ (uses the clean-room production node_modules)
Step "Stage runtime" {
  & (Join-Path $PSScriptRoot 'stage-runtime.ps1') `
    -NodeExe $nodeExe -NodeModulesSrc (Join-Path $cleanDir 'node_modules') `
    -RepoRoot $repoRoot -OutDir (Join-Path $stage 'runtime')
}

# 5. Stage pgsql/ - ONLY the three directories the server actually needs.
#    The EDB "binaries" zip is 877 MB, and 736 MB of that is software DigiLog never
#    touches: pgAdmin 4 (690 MB - an Electron app with its own node_modules, a full
#    Python interpreter and SQLAlchemy), doc (31 MB), include (14 MB, C headers for
#    building extensions) and StackBuilder. Copying the whole tree shipped all of it
#    to customers, where it is never launched and never patched - pure bloat on a
#    validated GMP server, and an audit surface nobody knows is there.
#
#    What IS needed:
#      bin   - postgres/initdb/pg_ctl/pg_dump/pg_isready/psql and their DLLs.
#              NOTE: no openssl.exe here - PostgreSQL does not ship one at all,
#              which is why step 7b stages the CLI separately.
#      lib   - loadable modules: plpgsql.dll (24 functions in our SQL), ltree.dll and
#              pgcrypto.dll (prisma/sql/extensions.sql does CREATE EXTENSION on both)
#      share - initdb's bootstrap catalogs + sample configs + timezone data, and the
#              .control/.sql scripts for those extensions. initdb fails without it.
#    Verified by grep: nothing in scripts/, installer/ or apps/ references any other
#    pgsql subdirectory. (The pgAdmin mentions in the backup module are comments about
#    the -Fc dump format being restorable in a DBA's OWN pgAdmin, not this one.)
Write-Host "==> Stage pgsql (bin/lib/share only)" -ForegroundColor Cyan
$pgTmp = Join-Path $OutDir 'pg-extract'
if (Test-Path $pgTmp) { Remove-Item -Recurse -Force $pgTmp }
Expand-Archive -Path $PgZip -DestinationPath $pgTmp -Force
# EDB zip extracts to a 'pgsql' subfolder
$pgRoot = (Get-ChildItem $pgTmp -Recurse -Directory -Filter 'bin' | Where-Object { Test-Path (Join-Path $_.FullName 'initdb.exe') } | Select-Object -First 1).Parent.FullName
if (-not $pgRoot) { Write-Host "FAILED: could not locate pgsql root (no bin\initdb.exe) in $PgZip" -ForegroundColor Red; exit 1 }
$pgDest = Join-Path $stage 'pgsql'
New-Item -ItemType Directory -Force -Path $pgDest | Out-Null
foreach ($sub in 'bin','lib','share') {
  $src = Join-Path $pgRoot $sub
  if (-not (Test-Path $src)) { Write-Host "FAILED: bundled PostgreSQL is missing '$sub' - refusing to ship an unusable cluster." -ForegroundColor Red; exit 1 }
  Copy-Item $src (Join-Path $pgDest $sub) -Recurse -Force
}
# Fail loud if a binary an orchestrator calls did not survive the prune.
# NOTE: openssl.exe is deliberately NOT in this list. PostgreSQL ships no OpenSSL CLI;
# it is staged separately into stage\openssl from -OpenSslZip (see step 7b).
foreach ($exe in 'postgres.exe','initdb.exe','pg_ctl.exe','pg_dump.exe','pg_isready.exe','psql.exe') {
  if (-not (Test-Path (Join-Path $pgDest "bin\$exe"))) { Write-Host "FAILED: pgsql\bin\$exe missing after staging." -ForegroundColor Red; exit 1 }
}
# Same for the loadable modules our schema needs (silent at install, fatal at runtime).
foreach ($mod in 'plpgsql.dll','ltree.dll','pgcrypto.dll') {
  if (-not (Test-Path (Join-Path $pgDest "lib\$mod"))) { Write-Host "FAILED: pgsql\lib\$mod missing after staging." -ForegroundColor Red; exit 1 }
}
$pgMb = [math]::Round(((Get-ChildItem $pgDest -Recurse -File | Measure-Object Length -Sum).Sum/1MB),1)
Write-Host "    staged pgsql: $pgMb MB (pgAdmin/doc/include/StackBuilder excluded)" -ForegroundColor DarkGray

# 6. Stage service/ + scripts/
Write-Host "==> Stage service + scripts + prereq" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'service'), (Join-Path $stage 'scripts'), (Join-Path $stage 'prereq') | Out-Null
Copy-Item $WinswExe (Join-Path $stage 'service\WinSW-x64.exe') -Force
# VC++ runtime. The .iss carries it with Flags: dontcopy and PrepareToInstall()
# runs it (registry-gated) before ANY other install step. Name is fixed because
# [Files] and ExtractTemporaryFile() both reference it literally.
if (-not (Test-Path $VcRedistExe)) { Write-Host "FAILED: -VcRedistExe not found: $VcRedistExe" -ForegroundColor Red; exit 1 }
Copy-Item $VcRedistExe (Join-Path $stage 'prereq\VC_redist.x64.exe') -Force
# apply-schema.ps1 is shared by provision-db (fresh) + upgrade; upgrade.ps1 drives
# the upgrade [Run] entry. BOTH must ship or fresh install AND upgrade break.
# NAMED LIST, not a glob - anything omitted here silently does not ship, and the
# orchestrators call siblings with `& (Join-Path ...)`, which THROWS on a missing
# file rather than degrading. register-backup-task.ps1 + backup-db.ps1 are the
# nightly-backup pair (21 CFR §11.10(c)); both install.ps1 and upgrade.ps1 invoke
# the former, which invokes the latter nightly. Add new sibling scripts HERE.
foreach ($s in 'provision-db.ps1','apply-schema.ps1','register-services.ps1','unregister-services.ps1','install.ps1','upgrade.ps1','uninstall.ps1','register-backup-task.ps1','backup-db.ps1') {
  Copy-Item (Join-Path $PSScriptRoot $s) (Join-Path $stage 'scripts') -Force
}
Copy-Item (Join-Path $repoRoot 'apps\api\prisma\sql') (Join-Path $stage 'runtime\api\prisma\sql') -Recurse -Force -ErrorAction SilentlyContinue

# 7b. Stage openssl/ - the OpenSSL CLI, in its OWN directory.
#     NOT into pgsql\bin: this build ships libcrypto-3-x64.dll / libssl-3-x64.dll
#     under the SAME filenames PostgreSQL uses, at a different patch level (3.5.7 vs
#     PG's 3.5.5). Copying them over PostgreSQL's would silently swap the crypto
#     libraries the database itself loads - never do that to get a CLI.
#     Only 3 files are needed; the .pdb debug symbols in the zip are 37 MB of the 46
#     and are deliberately excluded. LICENSE.txt ships because we redistribute.
Write-Host "==> Stage openssl" -ForegroundColor Cyan
$sslTmp = Join-Path $OutDir 'ssl-extract'
if (Test-Path $sslTmp) { Remove-Item -Recurse -Force $sslTmp }
Expand-Archive -Path $OpenSslZip -DestinationPath $sslTmp -Force
$sslBin = Join-Path $sslTmp 'x64\bin'
if (-not (Test-Path (Join-Path $sslBin 'openssl.exe'))) {
  Write-Host "FAILED: no x64\bin\openssl.exe inside $OpenSslZip" -ForegroundColor Red; exit 1
}
$sslDest = Join-Path $stage 'openssl'
New-Item -ItemType Directory -Force -Path $sslDest | Out-Null
foreach ($f in 'openssl.exe','libcrypto-3-x64.dll','libssl-3-x64.dll') {
  $src = Join-Path $sslBin $f
  if (-not (Test-Path $src)) { Write-Host "FAILED: $f missing from the OpenSSL zip." -ForegroundColor Red; exit 1 }
  Copy-Item $src (Join-Path $sslDest $f) -Force
}
# openssl.cnf is NOT optional. OpenSSL 3.x resolves its config from a compiled-in
# OPENSSLDIR ("C:\Program Files\Common Files\FireDaemon SSL 3.5") that does not exist
# on a customer machine; without a config the `req` and `x509` subcommands fail with
# "No store loader found ... default or base providers", while `genrsa` still works -
# so the failure looks like a certificate bug rather than a missing file.
# install.ps1 points OPENSSL_CONF at this copy. Verified end-to-end: CA + server cert
# + correct SANs + `openssl verify` OK. (Provider modules are NOT needed - default and
# base are built into libcrypto.)
$sslCnf = Join-Path $sslTmp 'ssl\openssl.cnf'
if (-not (Test-Path $sslCnf)) { Write-Host "FAILED: ssl\openssl.cnf missing from the OpenSSL zip." -ForegroundColor Red; exit 1 }
Copy-Item $sslCnf (Join-Path $sslDest 'openssl.cnf') -Force
Copy-Item (Join-Path $sslTmp 'LICENSE.txt') (Join-Path $sslDest 'LICENSE.txt') -Force -ErrorAction SilentlyContinue
$sslMb = [math]::Round(((Get-ChildItem $sslDest -Recurse -File | Measure-Object Length -Sum).Sum/1MB),1)
Write-Host "    staged openssl: $sslMb MB (pdb symbols excluded)" -ForegroundColor DarkGray

# 9. Compile the installer
Write-Host "==> Compile installer (ISCC)" -ForegroundColor Cyan
if (-not (Test-Path $Iscc)) { Write-Host "Inno Setup not found at $Iscc - install Inno Setup 6 to compile. Staging is ready at $stage." -ForegroundColor Yellow; exit 0 }
& $Iscc "/DStageDir=$stage" "/DAppVersion=$AppVersion" "/DOutputDir=$OutDir" (Join-Path $repoRoot 'installer\DigiLog.iss')
if ($LASTEXITCODE -ne 0) { Write-Host "ISCC failed" -ForegroundColor Red; exit 1 }
$setupExe = Join-Path $OutDir "DigiLog-Setup-$AppVersion.exe"

# 10. Code sign the finished Setup.exe (M7). Skipped unless -Sign is passed; when
#    skipped the installer is unsigned and SmartScreen/AV will warn (expected -
#    see the clean-VM acceptance runbook). To sign a build later, re-run with
#    -Sign -CertPath <pfx> -CertPassword <pw>  (or -CertSubject "CN=...").
if ($Sign) {
  Write-Host "==> Code sign Setup.exe" -ForegroundColor Cyan
  $signtool = Find-SignTool
  if (-not $signtool) { Write-Host "FAILED: -Sign requested but signtool.exe not found (install the Windows 10/11 SDK)." -ForegroundColor Red; exit 1 }
  if (-not (Test-Path $setupExe)) { Write-Host "FAILED: Setup.exe not found to sign: $setupExe" -ForegroundColor Red; exit 1 }
  Sign-File $signtool $setupExe
  Write-Host "`nInstaller built + SIGNED: $setupExe" -ForegroundColor Green
} else {
  Write-Host "`nInstaller built (UNSIGNED - SmartScreen/AV will warn): $setupExe" -ForegroundColor Yellow
  Write-Host "  To sign: re-run with -Sign -CertPath <pfx> -CertPassword <pw> (or -CertSubject 'CN=...')." -ForegroundColor Gray
}
