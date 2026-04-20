#!/usr/bin/env node
/**
 * Push telemetry data from CSV to DigiLog entities via HTTP API.
 *
 * Usage:
 *   node push-telemetry.mjs                          # Push to default token (test@1234)
 *   node push-telemetry.mjs --token "my_token"       # Push to specific token
 *   node push-telemetry.mjs --all                    # Push to ALL active entities
 *   node push-telemetry.mjs --delay 500              # 500ms delay between rows (default: 200)
 *   node push-telemetry.mjs --file telemetry-200.csv # Custom CSV file
 *   node push-telemetry.mjs --api http://localhost:3000  # Custom API URL
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Parse CLI args ─────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}
const hasFlag = (name) => args.includes(`--${name}`);

const API_URL  = getArg('api', 'http://localhost:3000');
const CSV_FILE = resolve(__dirname, getArg('file', 'telemetry-200.csv'));
const DELAY_MS = parseInt(getArg('delay', '200'), 10);
const TOKEN    = getArg('token', 'test@1234');
const PUSH_ALL = hasFlag('all');

// ─── Read CSV ───────────────────────────────────────────
const csv = readFileSync(CSV_FILE, 'utf-8').trim().split('\n');
const headers = csv[0].split(',');
const rows = csv.slice(1).map(line => {
  const values = line.split(',');
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i].trim();
    const val = values[i]?.trim();
    if (key === 'timestamp') {
      obj._ts = val;
    } else {
      // Parse numbers
      const num = Number(val);
      obj[key] = isNaN(num) ? val : num;
    }
  }
  return obj;
});

console.log(`\n📄 CSV: ${CSV_FILE}`);
console.log(`📊 Rows: ${rows.length} | Keys: ${headers.filter(h => h !== 'timestamp').join(', ')}`);
console.log(`🌐 API: ${API_URL}`);
console.log(`⏱️  Delay: ${DELAY_MS}ms between rows\n`);

// ─── Fetch all active tokens if --all ───────────────────
async function getActiveTokens() {
  if (!PUSH_ALL) return [{ token: TOKEN, name: 'specified' }];

  // Use the admin API to get credentials (need admin JWT)
  // Instead, we'll use the known tokens from the DB
  console.log('🔍 Fetching active device credentials...\n');

  // Try to get credentials by calling each entity's connectivity endpoint
  // For simplicity, use predefined tokens from the system
  const knownTokens = [
    { token: 'test@1234', name: 'test 01' },
    { token: 'unique_custom_token_xyz', name: 'temperature sensor' },
    { token: 'my_test_custom_token_12345', name: 'CCTV3' },
    { token: 'welcome@123', name: 'CPU1' },
    { token: 'Tele@123', name: 'CPU2' },
    { token: 'Chatgpt@123', name: 'Alarm' },
    { token: 'Smoke@1234', name: 'smoke 1' },
    { token: 'Airs@123', name: 'air 1' },
    { token: 'Token@123', name: 'gas 1' },
    { token: 'Saivenna@123', name: 'sensor 1' },
    { token: 'Test@123', name: 'device 1' },
    { token: 'Welcome@123', name: 'TempSensor_01' },
    { token: 'Active@123', name: 'fir 1' },
    { token: 'Actives@123', name: 'alarm' },
    { token: 'Wass@123', name: 'checker' },
  ];
  return knownTokens;
}

// ─── Send telemetry ─────────────────────────────────────
async function sendRow(token, data) {
  const { _ts, ...telemetry } = data;
  const res = await fetch(`${API_URL}/api/data/telemetry`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(telemetry),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ───────────────────────────────────────────────
async function main() {
  const tokens = await getActiveTokens();

  console.log(`🎯 Targets: ${tokens.length} entity(s)\n`);
  console.log('─'.repeat(60));

  let totalSent = 0;
  let totalFailed = 0;

  for (const { token, name } of tokens) {
    console.log(`\n🏷️  Entity: ${name} (token: ${token.slice(0, 12)}...)`);
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const { _ts, ...display } = row;
      try {
        await sendRow(token, row);
        sent++;
        // Progress bar every 10 rows
        if ((i + 1) % 10 === 0 || i === rows.length - 1) {
          const pct = ((i + 1) / rows.length * 100).toFixed(0);
          const bar = '█'.repeat(Math.floor((i + 1) / rows.length * 30));
          const empty = '░'.repeat(30 - bar.length);
          process.stdout.write(`\r   ${bar}${empty} ${pct}% (${i + 1}/${rows.length}) | Last: temp=${display.temperature}, hum=${display.humidity}`);
        }
      } catch (err) {
        failed++;
        if (failed <= 3) {
          console.error(`\n   ❌ Row ${i + 1} failed: ${err.message}`);
        } else if (failed === 4) {
          console.error(`\n   ❌ Suppressing further errors...`);
        }
      }

      if (DELAY_MS > 0 && i < rows.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    console.log(`\n   ✅ Sent: ${sent} | ❌ Failed: ${failed}`);
    totalSent += sent;
    totalFailed += failed;
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`\n📊 Summary: ${totalSent} sent, ${totalFailed} failed across ${tokens.length} entity(s)`);
  console.log('✅ Done!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
