<#
.SYNOPSIS
  The ONE "is the FMS API answering?" check, shared by install.ps1, upgrade.ps1,
  restore-database.ps1 and apply-addresses.ps1. Dot-source it:
    . (Join-Path $PSScriptRoot 'health-probe.ps1')

.DESCRIPTION
  Asks https://127.0.0.1:<port>/api/health and reports whether it answered 200.

  - 127.0.0.1, never localhost: the API listens on IPv4 only and Windows tries
    ::1 first, whose refusal outlasts a 2 s timeout, so every try failed while the
    API was up (laptop install 2026-10-31).
  - NO certificate check. This answers "is FMS running?" and nothing else; only a
    GET goes to this same PC. A site running its company certificate
    (TLS_CERT_PATH, set by set-certificate.ps1) normally names neither 127.0.0.1
    nor localhost, so a checked probe failed while FMS was healthy and Setup said
    "installation did NOT finish" (2026-10-31).
  - curl.exe (Windows 10 1803+, Server 2019+): -k skips the check and
    --ssl-no-revoke stops Schannel failing on a company CRL it cannot reach.
    Without curl.exe (Server 2016): an HttpWebRequest with its OWN callback, in
    compiled C#. A PowerShell scriptblock callback never runs on the .NET worker
    thread (no runspace), and the global ServicePointManager callback would
    switch the check off for the rest of the calling script.
#>

function Get-DigilogHealthCode {
  param([Parameter(Mandatory)][int]$Port, [int]$TimeoutSec = 2, [switch]$NoCurl)
  $url = "https://127.0.0.1:$Port/api/health"
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  if (-not $NoCurl -and (Test-Path $curl)) {
    # Callers run with ErrorActionPreference 'Stop', under which Windows
    # PowerShell 5.1 turns a native tool's stderr into a terminating error.
    # -s keeps curl quiet; nothing is redirected.
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = & $curl -s -k --ssl-no-revoke --max-time $TimeoutSec -o NUL -w '%{http_code}' $url }
    finally { $ErrorActionPreference = $eap }
    $code = 0
    if ([int]::TryParse(("$out").Trim(), [ref]$code)) { return $code }
    return 0
  }
  if (-not ('DigilogHealthProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Net;
public static class DigilogHealthProbe {
  public static int Get(string url, int timeoutMs) {
    try {
      ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
      HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
      req.Timeout = timeoutMs;
      req.ReadWriteTimeout = timeoutMs;
      req.ServerCertificateValidationCallback = delegate { return true; };
      using (HttpWebResponse res = (HttpWebResponse)req.GetResponse()) { return (int)res.StatusCode; }
    } catch (WebException e) {
      HttpWebResponse r = e.Response as HttpWebResponse;
      return r != null ? (int)r.StatusCode : 0;
    } catch (Exception) {
      return 0;
    }
  }
}
'@
  }
  return [DigilogHealthProbe]::Get($url, $TimeoutSec * 1000)
}

# $true once /api/health answers 200, $false after $Seconds of wall-clock time.
# Size $Seconds for a slow PC: the laptop of 2026-10-31 (i5-8350U) listened 40 s
# after its service started.
function Wait-DigilogHealth {
  param([Parameter(Mandatory)][int]$Port, [int]$Seconds = 120, [switch]$NoCurl)
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    if ((Get-DigilogHealthCode -Port $Port -NoCurl:$NoCurl) -eq 200) { return $true }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  return $false
}
