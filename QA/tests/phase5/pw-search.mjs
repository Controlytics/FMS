// Literal search for the shared perf password in every table row (text form) of the QA clone.
import { sql, PASSWORD } from './lib5.mjs';
const tables = sql(`select tablename from pg_tables where schemaname='public' order by 1`).split(/\r?\n/);
const esc = PASSWORD.replace(/'/g, "''");
let hits = 0;
for (const t of tables) {
  const n = +sql(`select count(*) from "${t}" x where x::text like '%${esc}%'`);
  if (n) { hits += n; console.log(t, n); }
}
console.log('password literal hits:', hits);
