<#
  Self-test for address-config.ps1 (the digilog-addresses.ini reader).
  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-address-config.ps1
  Exit code 0 = all passed.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'address-config.ps1')

$tmp = Join-Path ([IO.Path]::GetTempPath()) "digilog-addr-test-$PID"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$failures = 0
function Check([string]$name, [bool]$ok) {
  if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green }
  else { Write-Host "  FAIL  $name" -ForegroundColor Red; $script:failures++ }
}
function WriteIni([string]$body) { $p = Join-Path $tmp 'a.ini'; Set-Content -Path $p -Value $body -Encoding utf8; return $p }
function Throws([scriptblock]$b, [string]$match) {
  try { & $b; return $false } catch { return ($_.Exception.Message -match $match) }
}

# 1. A file written by New-DigilogAddressFile reads back exactly.
$p = Join-Path $tmp 'gen.ini'
New-DigilogAddressFile -Path $p -Addresses @('192.168.1.200', 'cai-fms.caipl') -ApiPort 3000 -WebPort 5175
$c = Read-DigilogAddresses $p
Check 'generated file: addresses' (($c.Addresses -join ',') -eq '192.168.1.200,cai-fms.caipl')
Check 'generated file: ips/names split' ((($c.Ips -join ',') -eq '192.168.1.200') -and (($c.Names -join ',') -eq 'cai-fms.caipl'))
Check 'generated file: ports' (($c.ApiPort -eq 3000) -and ($c.WebPort -eq 5175))
$p2 = Join-Path $tmp 'gen2.ini'
New-DigilogAddressFile -Path $p2 -Addresses @('10.0.0.5') -ApiPort 8443
$c2 = Read-DigilogAddresses $p2
Check 'customer file: no web port' (($c2.WebPort -eq 0) -and ($c2.ApiPort -eq 8443))

# 2. URLs, ports, case, duplicates, comments, BOM, IPv6.
$c = Read-DigilogAddresses (WriteIni @"
; note
[server]
address = HTTPS://CAI-FMS.caipl:5175/login   ; trailing note
address = https://192.168.1.200:3000
address = 192.168.1.200
# another note
address = [fe80::1]:3000
[ports]
api = 3443
[tablet]
anything goes here = it is ignored
[in-app settings]
; Instrument URLs ...
"@)
Check 'url/port/case normalised + deduped' (($c.Addresses -join ',') -eq 'cai-fms.caipl,192.168.1.200,fe80::1')
Check 'ipv6 counted as ip' ($c.Ips -contains 'fe80::1')
Check 'api port read, web absent' (($c.ApiPort -eq 3443) -and ($c.WebPort -eq 0))
Check 'reference sections ignored' ($c.Addresses.Count -eq 3)

# 3. Default api port when [ports] is missing.
$c = Read-DigilogAddresses (WriteIni "[server]`naddress = 1.2.3.4") -DefaultApiPort 3000
Check 'default api port' ($c.ApiPort -eq 3000)

# 4. Every mistake is reported, and nothing partial is returned.
Check 'bad host rejected' (Throws { Read-DigilogAddresses (WriteIni "[server]`naddress = bad name!") } "not a host name")
Check 'bad ip rejected (999)' (Throws { Read-DigilogAddresses (WriteIni "[server]`naddress = 192.168.1.999") } "not a host name")
Check 'bad port rejected' (Throws { Read-DigilogAddresses (WriteIni "[ports]`napi = 70000") } "1-65535")
Check 'same api/web port rejected' (Throws { Read-DigilogAddresses (WriteIni "[ports]`napi = 3000`nweb = 3000") } "cannot both")
Check 'unknown key rejected' (Throws { Read-DigilogAddresses (WriteIni "[server]`nhost = 1.2.3.4") } "only takes")
Check 'line outside a section rejected' (Throws { Read-DigilogAddresses (WriteIni "address = 1.2.3.4") } "outside a known section")
Check 'all bad lines listed' (Throws { Read-DigilogAddresses (WriteIni "[server]`naddress = a b`naddress = c d") } "(?s)line 2.*line 3")
Check 'missing file' (Throws { Read-DigilogAddresses (Join-Path $tmp 'nope.ini') } "not found")

# 5. Origins: localhost + every address x both ports + Capacitor; no spaces.
$c = Read-DigilogAddresses (WriteIni "[server]`naddress = 192.168.1.200`naddress = cai-fms.caipl`n[ports]`napi = 3000`nweb = 5175")
$o = Get-DigilogAllowedOrigins $c
$list = $o -split ','
Check 'origins: no spaces' (-not $o.Contains(' '))
Check 'origins: address x ports' ((@('https://192.168.1.200:3000', 'https://192.168.1.200:5175', 'https://cai-fms.caipl:3000', 'https://cai-fms.caipl:5175', 'https://localhost:3000') | Where-Object { $list -notcontains $_ }).Count -eq 0)
Check 'origins: capacitor' ((@('capacitor://localhost', 'https://localhost', 'http://localhost') | Where-Object { $list -notcontains $_ }).Count -eq 0)
Check 'origins: extra kept, unique' ((Get-DigilogAllowedOrigins $c @('http://localhost:5173', 'https://localhost') -split ',' | Group-Object | Where-Object Count -gt 1).Count -eq 0)

# 6. Env writer replaces in place, appends when missing, keeps the rest.
$e = Join-Path $tmp 'x.env'
Set-Content $e @('A=1', 'PORT=3000', '# c', 'B=2') -Encoding ascii
Set-DigilogEnvKey $e 'PORT' '3443'
Set-DigilogEnvKey $e 'ALLOWED_ORIGINS' 'https://x:1'
$lines = Get-Content $e
Check 'env: replaced in place' ($lines[1] -eq 'PORT=3443')
Check 'env: appended' ($lines[-1] -eq 'ALLOWED_ORIGINS=https://x:1')
Check 'env: rest kept' ((($lines[0], $lines[2], $lines[3]) -join '|') -eq 'A=1|# c|B=2')
Check 'env: read back' ((Get-DigilogEnvKey $e 'PORT') -eq '3443')

# 7. Env writer never damages non-ASCII text, never adds a BOM, keeps LF / CRLF.
$u = Join-Path $tmp 'u.env'
$box = [string][char]0x2500 * 3; $dash = [char]0x2014; $sect = [char]0x00A7; $e = [char]0x00E9
$orig = "# $box Server $dash $sect 11 $box`nNAME=Caf$e`nPORT=3000`n"
[IO.File]::WriteAllText($u, $orig, (New-Object System.Text.UTF8Encoding $false))
Set-DigilogEnvKey $u 'PORT' '3443'
$bytes = [IO.File]::ReadAllBytes($u)
$back = [IO.File]::ReadAllText($u, (New-Object System.Text.UTF8Encoding $false))
Check 'env utf8: comment + value kept' ($back -eq ($orig -replace 'PORT=3000', 'PORT=3443'))
Check 'env utf8: no BOM added' (-not ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB))
Check 'env utf8: LF kept' (-not $back.Contains("`r`n"))
$w = Join-Path $tmp 'w.env'
[IO.File]::WriteAllText($w, "A=1`r`nPORT=1`r`n", (New-Object System.Text.UTF8Encoding $false))
Set-DigilogEnvKey $w 'PORT' '2'; Set-DigilogEnvKey $w 'NEW' 'x'
Check 'env: CRLF kept + trailing newline' ([IO.File]::ReadAllText($w) -eq "A=1`r`nPORT=2`r`nNEW=x`r`n")
$bom = Join-Path $tmp 'bom.env'
[IO.File]::WriteAllText($bom, "PORT=1`n", (New-Object System.Text.UTF8Encoding $true))
Set-DigilogEnvKey $bom 'PORT' '9'
Check 'env: existing BOM removed, key readable' (((Get-DigilogEnvKey $bom 'PORT') -eq '9') -and ([IO.File]::ReadAllBytes($bom)[0] -eq [byte][char]'P'))

Remove-Item -Recurse -Force $tmp
if ($failures) { Write-Host "`n$failures FAILED" -ForegroundColor Red; exit 1 }
Write-Host "`nAll passed" -ForegroundColor Green
exit 0
