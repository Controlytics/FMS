// Build-time only (scripts/build-installer.ps1; not shipped). Writes the installer's
// version into the `branding` setting of a STAGED prisma/install-baseline.json,
// which the fresh-install seed creates the login page's "Version" text from.
//
// That value used to be edited by hand per release and was forgotten twice:
// 1.2.0 / 1.2.1 shipped "1.1.0", and the first 1.2.3 build shipped "1.2.2"
// (test-results/10-deployment-readiness.md section 5). -AppVersion is now the one
// source. Node, not PowerShell 5.1: ConvertTo-Json defaults to depth 2 and would
// truncate the file, and Set-Content -Encoding utf8 writes a BOM the seed's
// JSON.parse rejects. Same formatting as export-install-baseline.ts.
//
// Usage: node stamp-install-version.mjs <install-baseline.json> <x.y.z>
import { readFileSync, writeFileSync } from 'node:fs';

const [file, version] = process.argv.slice(2);
if (!file || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error(`FAILED: usage: stamp-install-version.mjs <install-baseline.json> <x.y.z> (got '${version ?? ''}')`);
  process.exit(1);
}

const read = () => JSON.parse(readFileSync(file, 'utf8'));
const branding = (baseline) => baseline.settings?.find((s) => s.configKey === 'branding')?.configValue;

const baseline = read();
const current = branding(baseline);
if (!current) {
  console.error(`FAILED: ${file} has no 'branding' setting - a fresh install would show the web app's fallback version.`);
  process.exit(1);
}
const before = current.version;
current.version = version;
writeFileSync(file, JSON.stringify(baseline, null, 2) + '\n', 'utf8');

// Read it back the way the seed does.
const after = branding(read())?.version;
if (after !== version) {
  console.error(`FAILED: ${file} reads version '${after}' after stamping '${version}'.`);
  process.exit(1);
}
console.log(`    branding.version: '${before}' -> '${after}'`);
