<#
.SYNOPSIS
  Shared helpers for digilog-addresses.ini - the ONE file where the operator
  lists every address the DigiLog server is reached by, and its ports.
  Dot-source it:  . (Join-Path $PSScriptRoot 'address-config.ps1')

  Used by: refresh-lan-cert.ps1 (dev), apply-addresses.ps1 (customer),
  install.ps1, upgrade.ps1. See tasks/AUTO-IP-RECOVERY-PLAN.md, Part 3.

  File format (INI; ';' or '#' start a comment):
    [server]
    address = 192.168.1.200          ; repeat the key once per address
    address = https://cai-fms.caipl  ; full URLs are fine: scheme/port/path dropped
    [ports]
    api = 3000
    web = 5175                       ; dev only (the Vite page); ignored by installs
    [tablet] / [in-app settings]     ; reference notes only, never applied
#>

function ConvertTo-DigilogHost([string]$raw) {
  $h = $raw.Trim()
  $h = $h -replace '^[a-zA-Z][a-zA-Z0-9+.-]*://', ''        # scheme
  $h = ($h -split '[/?#]')[0]                                # path / query
  if ($h -match '^\[(.+)\](:\d+)?$') { $h = $Matches[1] }    # [IPv6]:port
  elseif ($h -match '^([^:]+):\d+$') { $h = $Matches[1] }    # host:port
  return $h.ToLowerInvariant()
}

function Test-DigilogHost([string]$h) {
  if ($h -match '^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$') { return 'ip' }
  if (($h -match '^[0-9a-f:]+$') -and $h.Contains(':')) { return 'ip' }
  if ((-not ($h -match '^[\d.]+$')) -and
      ($h -match '^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$')) { return 'dns' }
  return $null
}

<#
  Reads and validates the file. Throws (naming every bad line) rather than
  applying half a file. Returns:
    @{ Addresses = [string[]] (normalised, unique, in file order)
       Ips = [string[]]; Names = [string[]]
       ApiPort = [int]; WebPort = [int] (0 when absent) }
#>
function Read-DigilogAddresses([string]$Path, [int]$DefaultApiPort = 3000) {
  if (-not (Test-Path $Path)) { throw "Address file not found: $Path" }
  $section = ''
  $addresses = New-Object System.Collections.Generic.List[string]
  $ports = @{}
  $bad = @()
  $n = 0
  foreach ($line in Get-Content -Path $Path) {
    $n++
    $t = ($line -replace '^\uFEFF', '').Trim()
    if (-not $t -or $t.StartsWith(';') -or $t.StartsWith('#')) { continue }
    if ($t -match '^\[(.+)\]$') { $section = $Matches[1].Trim().ToLowerInvariant(); continue }
    if ($section -in @('tablet', 'in-app settings')) { continue }   # reference only
    if ($t -notmatch '^([A-Za-z_-]+)\s*=\s*(.*)$') { $bad += "line ${n}: '$t' (expected key = value)"; continue }
    $key = $Matches[1].ToLowerInvariant()
    $val = ($Matches[2] -replace '\s[;#].*$', '').Trim()             # trailing comment
    switch ($section) {
      'server' {
        if ($key -ne 'address') { $bad += "line ${n}: [server] only takes 'address = ...'"; break }
        $h = ConvertTo-DigilogHost $val
        if (-not (Test-DigilogHost $h)) { $bad += "line ${n}: '$val' is not a host name or IP address"; break }
        if (-not $addresses.Contains($h)) { $addresses.Add($h) }
      }
      'ports' {
        if ($key -notin @('api', 'web')) { $bad += "line ${n}: [ports] takes 'api' or 'web'"; break }
        $p = 0
        if (-not [int]::TryParse($val, [ref]$p) -or $p -lt 1 -or $p -gt 65535) { $bad += "line ${n}: port '$val' must be 1-65535"; break }
        $ports[$key] = $p
      }
      default { $bad += "line ${n}: '$t' is outside a known section ([server], [ports])" }
    }
  }
  if ($bad.Count) {
    throw "Problems in ${Path}:`n  " + ($bad -join "`n  ") + "`nNothing was changed. Fix the file and run again."
  }
  $api = if ($ports.ContainsKey('api')) { $ports['api'] } else { $DefaultApiPort }
  $web = if ($ports.ContainsKey('web')) { $ports['web'] } else { 0 }
  if ($web -and $web -eq $api) { throw "Problems in ${Path}: [ports] api and web cannot both be $api." }
  return @{
    Addresses = @($addresses)
    Ips       = @($addresses | Where-Object { (Test-DigilogHost $_) -eq 'ip' })
    Names     = @($addresses | Where-Object { (Test-DigilogHost $_) -eq 'dns' })
    ApiPort   = $api
    WebPort   = $web
  }
}

<#
  Browser origins allowed to call the API (ALLOWED_ORIGINS, comma-separated, no
  spaces - app.ts splits on ',' without trimming). Same shape the installer
  always wrote, generalised to every listed address and both ports.
#>
function Get-DigilogAllowedOrigins($Config, [string[]]$Extra = @()) {
  $hosts = @('localhost') + $Config.Addresses
  $origins = New-Object System.Collections.Generic.List[string]
  foreach ($h in $hosts) {
    $hh = if ($h.Contains(':')) { "[$h]" } else { $h }
    foreach ($p in @($Config.ApiPort, $Config.WebPort) | Where-Object { $_ }) {
      $o = "https://${hh}:$p"
      if (-not $origins.Contains($o)) { $origins.Add($o) }
    }
  }
  # Capacitor WebView origins (the tablet APK).
  foreach ($o in @('https://localhost', 'capacitor://localhost', 'http://localhost') + $Extra) {
    if ($o -and -not $origins.Contains($o)) { $origins.Add($o) }
  }
  return ($origins -join ',')
}

<#
  Sets KEY=value in an env file: replaces an existing line, else appends. Keeps
  every other byte's meaning. Read AND written as UTF-8 WITHOUT a BOM: PS 5.1's
  Get-Content/Set-Content default to the ANSI code page, and `-Encoding ascii`
  turned every non-ASCII character (box-drawing lines, dashes, the section sign in .env comments, or a value) into
  '?' (2026-10-10). `-Encoding utf8` is no fix either - it adds a BOM, which
  dotenv would read as part of the first key's name.
#>
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding $false
function Set-DigilogEnvKey([string]$Path, [string]$Key, [string]$Value) {
  $text = if (Test-Path $Path) { [IO.File]::ReadAllText($Path, $script:Utf8NoBom) } else { '' }
  $text = $text -replace '^\uFEFF', ''
  # Keep the file's own line endings and final newline.
  $nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
  $trailing = $text.EndsWith("`n") -or $text -eq ''
  $lines = if ($text -eq '') { @() } else { @(($text -replace "`r?`n$", '') -split "`r?`n") }
  $found = $false
  $out = foreach ($l in $lines) {
    if ($l -match "^\s*$([regex]::Escape($Key))\s*=") { $found = $true; "$Key=$Value" } else { $l }
  }
  if (-not $found) { $out = @($out) + "$Key=$Value" }
  $body = (@($out) -join $nl) + $(if ($trailing) { $nl } else { '' })
  [IO.File]::WriteAllText($Path, $body, $script:Utf8NoBom)
}

function Get-DigilogEnvKey([string]$Path, [string]$Key) {
  if (-not (Test-Path $Path)) { return $null }
  foreach ($l in [IO.File]::ReadAllLines($Path, $script:Utf8NoBom)) {
    if ($l -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") { return $Matches[1].Trim() }
  }
  return $null
}

<# Starting content for a new file (fresh install / first upgrade / dev). #>
function New-DigilogAddressFile([string]$Path, [string[]]$Addresses, [int]$ApiPort, [int]$WebPort = 0, [string]$Apply = 'apply-addresses') {
  $server = ($Addresses | Where-Object { $_ } | ForEach-Object { "address = $_" }) -join "`r`n"
  $webLine = if ($WebPort) { "web = $WebPort        ; the web page (dev only)" } else { "; web = (not used - the app is served by the API on the api port)" }
  $first = ($Addresses | Where-Object { $_ } | Select-Object -First 1)
  $body = @"
; =============================================================================
; DigiLog server addresses - THE place to change the server's IP, name or port.
;
; After editing, run "$Apply" so every part of DigiLog picks it up:
; the HTTPS certificate, the allowed web origins, the port and the firewall.
; Lines starting with ; or # are notes.
; =============================================================================

[server]
; Every name or IP this server is reached by. One "address =" line each.
; Full URLs are fine: https://192.168.1.200:3000 is the same as 192.168.1.200.
; A NAME (e.g. cai-fms.caipl) is only trusted here - the network's DNS must
; also point it at this PC, or nothing can reach it by that name.
; Every address on the current network (x.y.z.1-254) is trusted automatically.
$server

[ports]
api = $ApiPort        ; the DigiLog API (and, on an installed server, the app itself)
$webLine

[tablet]
; Reference only - the tablet keeps its own Server Address.
; Use: https://${first}:$ApiPort
; The tablet app also finds the server by itself after an IP change on the same
; network, and has a "Find server" button on its Server Address screen.

[in-app settings]
; Reference only - these are changed inside DigiLog (every change is audited):
;   Instrument reading URLs        Equipment Groups (sidebar)
;   Email (SMTP), SMS, Slack,
;   Telegram, webhooks             Configuration -> Notification Channels
;   LDAP server                    Configuration -> LDAP / Active Directory
"@
  Set-Content -Path $Path -Value $body -Encoding utf8
}
