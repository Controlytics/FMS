<#
.SYNOPSIS
  Build the single-process DigiLog bundle: compiled backend that also serves the
  built web UI. The output runs with one command and no Vite - the foundation
  for the customer Setup.exe (see tasks/EXE-PACKAGING-PLAN.md M1).

.DESCRIPTION
  Produces:
    apps/api/dist/   - compiled backend (entry: dist/app.js)
    apps/web/dist/   - built React UI (served by the backend when SERVE_WEB=true)
    packages/shared/dist, packages/queue/dist - workspace deps

  After building, run the whole app from one process:

    $env:SERVE_WEB='true'; $env:API_HTTPS='false'; node apps/api/dist/app.js

  then open http://localhost:3000. Requires PostgreSQL running and a valid
  apps/api/.env (DATABASE_URL etc.).

.PARAMETER SkipWeb
  Skip the (slow) `vite build` and reuse the existing apps/web/dist.
#>
[CmdletBinding()]
param([switch]$SkipWeb)

# Gate on $LASTEXITCODE explicitly; don't use Stop (native stderr would abort).
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Step($name, $block) {
  Write-Host "==> $name" -ForegroundColor Cyan
  & $block
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $name (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
}

Step "Build @digilog/shared" { npm run build -w @digilog/shared }
Step "Build @digilog/queue"  { npm run build -w @digilog/queue }
Step "Compile backend (tsc)" { npx tsc -p apps/api/tsconfig.json }

# Precompile the DB seed to a self-contained ESM file the CUSTOMER runtime can run
# with just node.exe. tsx is a devDependency and is pruned by `npm ci --omit=dev`,
# so `tsx prisma/seed.ts` cannot run on a customer machine. esbuild bundles seed.ts
# + its local ./default-roles import into prisma/seed.mjs, keeping @prisma/client +
# bcrypt (native runtime deps that survive the prune) external. The installer runs
# `node prisma/seed.mjs` from runtime/api. See EXE-PACKAGING-PLAN.md M6 / apply-schema.ps1.
Step "Precompile DB seed (esbuild -> prisma/seed.mjs)" {
  npx esbuild apps/api/prisma/seed.ts --bundle --platform=node --format=esm --packages=external --outfile=apps/api/prisma/seed.mjs
}

if ($SkipWeb) {
  Write-Host "==> Skipping web build (reusing apps/web/dist)" -ForegroundColor Yellow
  if (-not (Test-Path "apps/web/dist/index.html")) {
    Write-Host "FAILED: -SkipWeb but apps/web/dist/index.html is missing. Run without -SkipWeb." -ForegroundColor Red
    exit 1
  }
} else {
  # Force a SAME-ORIGIN production build. apps/web/.env.production is
  # skip-worktree and tracked blank, but a developer's working copy typically
  # holds their own LAN IP in VITE_API_URL. Baking that into the shipped SPA
  # makes it call the wrong host on a customer machine
  # and - because the API's CSP is `connect-src 'self'` - the cross-origin call
  # is blocked and LOGIN FAILS ("Failed to fetch") until the operator manually
  # sets a Server Address. Empty VITE_API_URL wins over the .env file (Vite gives
  # the process environment the highest priority), so getApiBase() falls back to
  # '' = same origin, which works on any host and satisfies the CSP.
  # NOTE: we cannot force same-origin with an empty environment variable on
  # Windows - PowerShell `$env:VITE_API_URL = ''` deletes the variable (Windows
  # keeps no empty env vars), so Vite falls back to .env.production and bakes the
  # dev URL anyway. Instead, blank the .env.production FILE for the duration of
  # the build and restore it afterward. The file is skip-worktree, so restoring
  # its content leaves the dev's local convenience value intact and never touches
  # git.
  # Read/write with .NET (UTF-8, NO BOM). Windows PowerShell 5.1's
  # `Set-Content -Encoding utf8` prepends a BOM, which would corrupt the restored
  # .env.production (its first key becomes "<BOM>VITE_API_URL", silently unset).
  Step "Build web UI (vite build, same-origin)" {
    $envProd = Join-Path $repoRoot 'apps/web/.env.production'
    $noBom = New-Object System.Text.UTF8Encoding($false)
    $backup = if (Test-Path $envProd) { [System.IO.File]::ReadAllText($envProd) } else { $null }
    try {
      [System.IO.File]::WriteAllText($envProd, "VITE_API_URL=`n", $noBom)
      npm run build -w @digilog/web
    }
    finally {
      if ($null -ne $backup) { [System.IO.File]::WriteAllText($envProd, $backup, $noBom) }
      elseif (Test-Path $envProd) { Remove-Item $envProd -ErrorAction SilentlyContinue }
    }
  }
  # Guard: fail the build if the developer's VITE_API_URL leaked into the bundle.
  # We look specifically for the value that WOULD have leaked - the current
  # apps/web/.env.production VITE_API_URL - not any IP, because the UI carries
  # legitimate example IPs in placeholders/hints (the Server Address field's
  # example URL) that are expected in the bundle.
  Step "Verify the dev VITE_API_URL did not leak into the web bundle" {
    $envUrl = $null
    $envFile = "apps/web/.env.production"
    if (Test-Path $envFile) {
      $line = (Get-Content $envFile | Where-Object { $_ -match '^\s*VITE_API_URL\s*=\s*(\S+)' })
      if ($line -and $matches[1]) { $envUrl = $matches[1].Trim() }
    }
    if ([string]::IsNullOrWhiteSpace($envUrl)) {
      Write-Host "  .env.production VITE_API_URL is blank (same-origin) - nothing could leak. OK." -ForegroundColor Gray
      $global:LASTEXITCODE = 0
    } else {
      $hit = Select-String -Path "apps/web/dist/assets/*.js" -Pattern ([regex]::Escape($envUrl)) -List -ErrorAction SilentlyContinue
      if ($hit) {
        Write-Host "FAILED: the dev VITE_API_URL ($envUrl) leaked into the shipped web bundle." -ForegroundColor Red
        Write-Host "        The build must be same-origin. The VITE_API_URL='' override above should prevent this." -ForegroundColor Red
        $global:LASTEXITCODE = 1
      } else {
        Write-Host "  dev VITE_API_URL ($envUrl) is NOT in the bundle - same-origin build confirmed. OK." -ForegroundColor Gray
        $global:LASTEXITCODE = 0
      }
    }
  }
}

Write-Host "`nBundle built." -ForegroundColor Green
Write-Host "Run the single-process app with:" -ForegroundColor Green
Write-Host "  `$env:SERVE_WEB='true'; `$env:API_HTTPS='false'; node apps/api/dist/app.js" -ForegroundColor Gray
Write-Host "  then open http://localhost:3000   (PostgreSQL must be running)" -ForegroundColor Gray
