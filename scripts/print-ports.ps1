<#
  Prints "<apiPort> <webPort>" from digilog-addresses.ini (repo root) for batch
  files (start-digilog.bat). A missing or invalid file prints the defaults
  "3000 5175" and explains why on stderr, so the launcher still starts.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'address-config.ps1')
$file = Join-Path (Split-Path -Parent $PSScriptRoot) 'digilog-addresses.ini'
try {
  $c = Read-DigilogAddresses -Path $file -DefaultApiPort 3000
  $web = if ($c.WebPort) { $c.WebPort } else { 5175 }
  Write-Output "$($c.ApiPort) $web"
} catch {
  [Console]::Error.WriteLine("digilog-addresses.ini: $($_.Exception.Message) - using ports 3000 / 5175.")
  Write-Output '3000 5175'
}
