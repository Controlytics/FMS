// Groups the app's "Slow query" log lines (a -Profile instance) by statement.
//   node tests/performance/profile/slow-queries.mjs [--since "2026-10-17 18:40:00"] [logfile]
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const si = args.indexOf('--since');
const since = si >= 0 ? args.splice(si, 2)[1] : '';
const dir = path.join(import.meta.dirname, '../results/logs-profile/app/database');
const file = args[0] ?? path.join(dir, fs.readdirSync(dir).sort().pop());
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const groups = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/Slow query \((\d+)ms\)/);
  if (!m || lines[i].slice(0, 19) < since) continue;
  let block = '';
  for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) block += ' ' + lines[j].trim();
  const q = (block.match(/query="?(.*?)"?\s+params=/) ?? block.match(/query="?(.*)/) ?? [, block])[1]
    .replace(/\\"/g, '"').replace(/"public"\./g, '').replace(/\s+/g, ' ');
  const key = q.replace(/\$\d+/g, '?').slice(0, 400);
  const g = groups.get(key) ?? { n: 0, total: 0, max: 0 };
  g.n++; g.total += +m[1]; g.max = Math.max(g.max, +m[1]);
  groups.set(key, g);
}
for (const [k, g] of [...groups].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`${String(g.max).padStart(6)} ms max  ${String(Math.round(g.total / g.n)).padStart(6)} avg  x${g.n}\n    ${k}\n`);
}
