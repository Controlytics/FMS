// node snapshot.mjs <name>   -> per-table count + content hash of digilog_qa_perf
// node snapshot.mjs diff <a> <b> -> tables whose content changed
import fs from 'node:fs';
import path from 'node:path';
import { sql, OUT } from './lib5.mjs';
const [a, b, c] = process.argv.slice(2);
if (a === 'diff') {
  const A = JSON.parse(fs.readFileSync(path.join(OUT, `snap-${b}.json`)));
  const B = JSON.parse(fs.readFileSync(path.join(OUT, `snap-${c}.json`)));
  for (const t of Object.keys(B.tables)) if (JSON.stringify(A.tables[t]) !== JSON.stringify(B.tables[t])) console.log(t, A.tables[t]?.n, '->', B.tables[t].n);
  console.log('audit chain_position', A.maxChain, '->', B.maxChain);
} else {
  const tables = sql(`select tablename from pg_tables where schemaname='public' order by 1`).split(/\r?\n/);
  const out = { at: new Date().toISOString(), tables: {}, maxChain: sql('select max(chain_position) from audit_trail') };
  for (const t of tables) {
    const r = sql(`select count(*)||'|'||coalesce(md5(string_agg(md5(x::text), '' order by md5(x::text))),'') from "${t}" x`).split('|');
    out.tables[t] = { n: +r[0], h: r[1] };
  }
  fs.writeFileSync(path.join(OUT, `snap-${a}.json`), JSON.stringify(out, null, 1));
  console.log('snapshot', a, Object.keys(out.tables).length, 'tables, maxChain', out.maxChain);
}
