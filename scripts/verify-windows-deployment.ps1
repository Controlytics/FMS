<#
.SYNOPSIS
    Post-install smoke-check for the DigiLog Windows deployment.

.DESCRIPTION
    Runs a sequence of read-only checks to confirm the four critical pieces of
    the stack are alive after install-on-target.ps1 has finished:

        1. API /api/health responds 200
        2. Mosquitto MQTT broker is listening on tcp://localhost:1883
        3. graphile_worker schema exists in the application database
        4. The /api/reports/generate path can render a 1-page PDF
           (login as superadmin, find an ACTIVE template, generate, fetch PDF,
           verify the response begins with the PDF magic bytes "%PDF-")

    Each check is wrapped in its own try/catch so one failure does not abort
    the rest. The script prints a colour-coded pass/fail summary at the end
    and returns exit code 0 only when every check passed.

.PARAMETER ApiBase
    Base URL of the API. Default: https://localhost:3000

.PARAMETER AdminUser
    Login username for the report-render check. Default: superadmin

.PARAMETER AdminPassword
    Plaintext password for the AdminUser. If omitted, the script reads
    INITIAL_ADMIN_PASSWORD from the .env at the repo root. The reports check
    is skipped (WARN) when neither source supplies a password.

.PARAMETER Insecure
    Bypass TLS certificate validation. Auto-enabled when ApiBase points at
    localhost / *.local; pass -Insecure:$false to force strict validation.

.PARAMETER Help
    Print usage and exit.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/verify-windows-deployment.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/verify-windows-deployment.ps1 `
        -ApiBase https://digilog.example.com:3000 -AdminPassword 'S3cret!' -Insecure:$false

.NOTES
    PowerShell 5.1 compatible. Read-only — no destructive operations.
    Does NOT manage services; it only observes their state.
#>

[CmdletBinding()]
param(
    [string]$ApiBase = 'https://localhost:3000',
    [string]$AdminUser = 'superadmin',
    [string]$AdminPassword = '',
    [Nullable[bool]]$Insecure = $null,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

# ───── Help ──────────────────────────────────────────────
if ($Help -or $args -contains '-h') {
    Get-Help $PSCommandPath -Detailed
    exit 0
}

# ───── Paths + env ───────────────────────────────────────
$Root    = (Resolve-Path "$PSScriptRoot\..").Path
$EnvFile = Join-Path $Root '.env'

# Default Insecure to $true for localhost / *.local; $false otherwise.
if ($null -eq $Insecure) {
    if ($ApiBase -match '^https?://(localhost|127\.0\.0\.1|\[::1\]|[^/]*\.local)(:|/|$)') {
        $Insecure = $true
    } else {
        $Insecure = $false
    }
}

# ───── Helpers ───────────────────────────────────────────
function Read-EnvVar {
    param([string]$Name)
    if (-not (Test-Path $EnvFile)) { return $null }
    $line = Select-String -Path $EnvFile -Pattern "^\s*$([regex]::Escape($Name))\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $line) { return $null }
    $raw = $line.Line
    $eq  = $raw.IndexOf('=')
    if ($eq -lt 0) { return $null }
    $val = $raw.Substring($eq + 1).Trim()
    # Strip surrounding quotes
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or
        ($val.StartsWith("'") -and $val.EndsWith("'"))) {
        $val = $val.Substring(1, $val.Length - 2)
    }
    # Strip trailing inline comment ( # ... )
    $hashIdx = $val.IndexOf(' #')
    if ($hashIdx -gt 0) { $val = $val.Substring(0, $hashIdx).Trim() }
    if ([string]::IsNullOrWhiteSpace($val)) { return $null }
    return $val
}

function Set-CertCallback {
    param([bool]$Skip)
    if ($Skip) {
        if ($PSVersionTable.PSVersion.Major -lt 7) {
            # PS 5.1: install a permissive callback for the duration of the run.
            try {
                [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
                [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls11 -bor [System.Net.SecurityProtocolType]::Tls
            } catch {
                Write-Host "     (could not relax TLS validation: $($_.Exception.Message))" -ForegroundColor Yellow
            }
        }
        # PS 7+ uses the per-call -SkipCertificateCheck switch; nothing to do here.
    }
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Url,
        [object]$Body,
        [hashtable]$Headers
    )
    $params = @{ Method = $Method; Uri = $Url; UseBasicParsing = $true; TimeoutSec = 30 }
    if ($Headers) { $params['Headers'] = $Headers }
    if ($null -ne $Body) {
        $params['Body']        = ($Body | ConvertTo-Json -Depth 8 -Compress)
        $params['ContentType'] = 'application/json'
    }
    if ($Insecure -and $PSVersionTable.PSVersion.Major -ge 7) {
        $params['SkipCertificateCheck'] = $true
    }
    return Invoke-WebRequest @params
}

function Parse-DatabaseUrl {
    param([string]$Url)
    # postgresql://user:pass@host:port/dbname?...
    $m = [regex]::Match($Url, '^postgres(?:ql)?://(?<user>[^:@/]+)(?::(?<pass>[^@/]*))?@(?<host>[^:/]+)(?::(?<port>\d+))?/(?<db>[^?]+)')
    if (-not $m.Success) { return $null }
    return @{
        User = $m.Groups['user'].Value
        Pass = $m.Groups['pass'].Value
        Host = $m.Groups['host'].Value
        Port = $(if ($m.Groups['port'].Success) { $m.Groups['port'].Value } else { '5432' })
        Db   = $m.Groups['db'].Value
    }
}

# ───── Banner ────────────────────────────────────────────
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  DigiLog - Windows deployment verification" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  ApiBase:  $ApiBase"
Write-Host "  Insecure: $Insecure"
Write-Host "  EnvFile:  $EnvFile  (exists: $([bool](Test-Path $EnvFile)))"
Write-Host ""

Set-CertCallback -Skip:$Insecure

# Result accumulators
$results = New-Object System.Collections.ArrayList
function Add-Result {
    param([string]$Name, [string]$Status, [string]$Detail)
    $null = $results.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail })
}

# ───── [1/4] API health ──────────────────────────────────
Write-Host "[1/4] Checking API health..." -ForegroundColor Cyan
try {
    $healthUrl = "$ApiBase/api/health"
    $resp = Invoke-Api -Method GET -Url $healthUrl
    $code = [int]$resp.StatusCode
    Write-Host "     GET $healthUrl -> $code" -ForegroundColor DarkGray
    if ($code -eq 200) {
        Add-Result 'API health (GET /api/health)' 'PASS' "HTTP $code"
        Write-Host "     PASS" -ForegroundColor Green
    } else {
        Add-Result 'API health (GET /api/health)' 'FAIL' "HTTP $code"
        Write-Host "     FAIL: HTTP $code" -ForegroundColor Red
    }
} catch {
    $msg = $_.Exception.Message
    Add-Result 'API health (GET /api/health)' 'FAIL' $msg
    Write-Host "     FAIL: $msg" -ForegroundColor Red
}

# ───── [2/4] Mosquitto port ──────────────────────────────
Write-Host ""
Write-Host "[2/4] Checking Mosquitto MQTT (tcp://localhost:1883)..." -ForegroundColor Cyan
try {
    # Test-NetConnection is verbose — suppress its progress + warning stream.
    $tnc = Test-NetConnection -ComputerName 'localhost' -Port 1883 -WarningAction SilentlyContinue -InformationLevel Quiet
    # On PS 5.1 -InformationLevel Quiet returns a bool; otherwise we get the object.
    $ok = $false
    if ($tnc -is [bool]) { $ok = $tnc }
    elseif ($tnc -and $tnc.PSObject.Properties['TcpTestSucceeded']) { $ok = [bool]$tnc.TcpTestSucceeded }
    if ($ok) {
        Add-Result 'Mosquitto MQTT (localhost:1883)' 'PASS' 'TcpTestSucceeded'
        Write-Host "     PASS" -ForegroundColor Green
    } else {
        Add-Result 'Mosquitto MQTT (localhost:1883)' 'FAIL' 'TCP connect failed'
        Write-Host "     FAIL: could not connect to tcp://localhost:1883" -ForegroundColor Red
    }
} catch {
    $msg = $_.Exception.Message
    Add-Result 'Mosquitto MQTT (localhost:1883)' 'FAIL' $msg
    Write-Host "     FAIL: $msg" -ForegroundColor Red
}

# ───── [3/4] graphile_worker schema ──────────────────────
Write-Host ""
Write-Host "[3/4] Checking graphile_worker schema..." -ForegroundColor Cyan
try {
    $psqlOk = $false
    try {
        $null = & psql --version
        if ($LASTEXITCODE -eq 0) { $psqlOk = $true }
    } catch {}
    if (-not $psqlOk) {
        Add-Result 'graphile_worker schema' 'WARN' 'psql not on PATH'
        Write-Host "     WARN: psql not on PATH; install Postgres client tools or add bin to PATH" -ForegroundColor Yellow
    } else {
        $dbUrl = Read-EnvVar 'DATABASE_URL'
        if (-not $dbUrl) {
            Add-Result 'graphile_worker schema' 'WARN' 'DATABASE_URL not in .env'
            Write-Host "     WARN: DATABASE_URL not found in .env; cannot run psql query" -ForegroundColor Yellow
        } else {
            $dsn = Parse-DatabaseUrl $dbUrl
            if (-not $dsn) {
                Add-Result 'graphile_worker schema' 'WARN' 'DATABASE_URL not parseable'
                Write-Host "     WARN: could not parse DATABASE_URL" -ForegroundColor Yellow
            } else {
                $prevPg = $env:PGPASSWORD
                try {
                    $env:PGPASSWORD = $dsn.Pass
                    Write-Host "     querying $($dsn.User)@$($dsn.Host):$($dsn.Port)/$($dsn.Db)" -ForegroundColor DarkGray
                    $sql = 'SELECT count(*) FROM graphile_worker.jobs;'
                    # -t (tuples only), -A (unaligned), -X (skip psqlrc), -v ON_ERROR_STOP=1
                    $out = & psql -h $dsn.Host -p $dsn.Port -U $dsn.User -d $dsn.Db -X -A -t -v 'ON_ERROR_STOP=1' -c $sql 2>&1
                    $exit = $LASTEXITCODE
                    if ($exit -eq 0) {
                        $count = ($out | Select-Object -First 1).ToString().Trim()
                        Add-Result 'graphile_worker schema' 'PASS' "jobs row count = $count"
                        Write-Host "     PASS (graphile_worker.jobs reachable, count=$count)" -ForegroundColor Green
                    } else {
                        $err = ($out -join "`n").Trim()
                        Add-Result 'graphile_worker schema' 'FAIL' ("exit=$exit; $err")
                        Write-Host "     FAIL: psql exit=$exit" -ForegroundColor Red
                        Write-Host "     $err" -ForegroundColor DarkRed
                    }
                } finally {
                    $env:PGPASSWORD = $prevPg
                }
            }
        }
    }
} catch {
    $msg = $_.Exception.Message
    Add-Result 'graphile_worker schema' 'FAIL' $msg
    Write-Host "     FAIL: $msg" -ForegroundColor Red
}

# ───── [4/4] Reports - generate + fetch PDF ──────────────
Write-Host ""
Write-Host "[4/4] Checking report generation (login -> generate -> fetch PDF)..." -ForegroundColor Cyan
try {
    # Resolve admin password: explicit -AdminPassword wins, else INITIAL_ADMIN_PASSWORD from .env
    $pwd = $AdminPassword
    if ([string]::IsNullOrEmpty($pwd)) { $pwd = Read-EnvVar 'INITIAL_ADMIN_PASSWORD' }
    if ([string]::IsNullOrEmpty($pwd)) {
        Add-Result 'Reports - generate 1-page PDF' 'WARN' 'No admin password supplied (-AdminPassword or INITIAL_ADMIN_PASSWORD in .env)'
        Write-Host "     WARN: pass -AdminPassword or set INITIAL_ADMIN_PASSWORD in .env to enable this check" -ForegroundColor Yellow
    } else {
        # 4a. Login
        Write-Host "     logging in as $AdminUser..." -ForegroundColor DarkGray
        $loginResp = Invoke-Api -Method POST -Url "$ApiBase/api/auth/login" -Body @{ username = $AdminUser; password = $pwd }
        $login = $loginResp.Content | ConvertFrom-Json
        if (-not $login.token) { throw "login response did not contain a token" }
        $token = $login.token
        $authHeaders = @{ Authorization = "Bearer $token" }

        # 4b. Find an ACTIVE template
        Write-Host "     listing report templates..." -ForegroundColor DarkGray
        $tplResp = Invoke-Api -Method GET -Url "$ApiBase/api/report-templates?status=ACTIVE&limit=5" -Headers $authHeaders
        $tplBody = $tplResp.Content | ConvertFrom-Json
        $tpls = @()
        if ($tplBody.data) { $tpls = @($tplBody.data) }
        elseif ($tplBody -is [System.Array]) { $tpls = @($tplBody) }
        if ($tpls.Count -lt 1) {
            Add-Result 'Reports - generate 1-page PDF' 'WARN' 'no ACTIVE report template; create one in the UI to enable this check'
            Write-Host "     WARN: no ACTIVE report template exists yet (this is normal on a fresh install)" -ForegroundColor Yellow
        } else {
            $templateId = $tpls[0].id
            Write-Host "     using template $($tpls[0].name) ($templateId)" -ForegroundColor DarkGray

            # 4c. Generate (reauth via _currentPassword body field)
            $genBody = @{
                templateId       = $templateId
                entitySlots      = @{}
                _currentPassword = $pwd
                name             = "smoke-check $(Get-Date -Format 'yyyyMMddHHmmss')"
            }
            $genResp = Invoke-Api -Method POST -Url "$ApiBase/api/reports/generate" -Body $genBody -Headers $authHeaders
            $report = $genResp.Content | ConvertFrom-Json
            $reportId = $null
            if ($report.id) { $reportId = $report.id }
            elseif ($report.report -and $report.report.id) { $reportId = $report.report.id }
            if (-not $reportId) { throw "generate response missing report id" }

            # 4d. Fetch PDF + assert magic bytes
            $pdfUrl = "$ApiBase/api/reports/$reportId/pdf"
            Write-Host "     fetching $pdfUrl" -ForegroundColor DarkGray
            $pdfResp = Invoke-Api -Method GET -Url $pdfUrl -Headers $authHeaders
            $bytes = $null
            if ($pdfResp.RawContentStream) {
                $ms = New-Object System.IO.MemoryStream
                $pdfResp.RawContentStream.CopyTo($ms)
                $bytes = $ms.ToArray()
            } elseif ($pdfResp.Content -is [byte[]]) {
                $bytes = $pdfResp.Content
            } else {
                $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$pdfResp.Content)
            }
            if (-not $bytes -or $bytes.Length -lt 5) { throw "PDF response was empty or too short" }
            $magic = [System.Text.Encoding]::ASCII.GetString($bytes[0..4])
            if ($magic -ne '%PDF-') {
                throw "PDF magic bytes mismatch: got '$magic' (length=$($bytes.Length))"
            }
            Add-Result 'Reports - generate 1-page PDF' 'PASS' "PDF $($bytes.Length) bytes (template '$($tpls[0].name)')"
            Write-Host "     PASS (PDF $($bytes.Length) bytes, magic '%PDF-' verified)" -ForegroundColor Green
        }
    }
} catch {
    $msg = $_.Exception.Message
    Add-Result 'Reports - generate 1-page PDF' 'FAIL' $msg
    Write-Host "     FAIL: $msg" -ForegroundColor Red
}

# ───── Summary ───────────────────────────────────────────
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Verification summary" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
$failCount = 0
$warnCount = 0
foreach ($r in $results) {
    $color = 'Yellow'
    switch ($r.Status) {
        'PASS' { $color = 'Green' }
        'FAIL' { $color = 'Red';    $failCount++ }
        'WARN' { $color = 'Yellow'; $warnCount++ }
    }
    $line = "  [{0,-4}] {1,-40} {2}" -f $r.Status, $r.Name, $r.Detail
    Write-Host $line -ForegroundColor $color
}
Write-Host ""
if ($failCount -gt 0) {
    Write-Host "  $failCount check(s) FAILED, $warnCount WARN. Review the lines above." -ForegroundColor Red
    exit 1
} elseif ($warnCount -gt 0) {
    Write-Host "  All hard checks passed; $warnCount WARN (see above)." -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "  All checks passed." -ForegroundColor Green
    exit 0
}
