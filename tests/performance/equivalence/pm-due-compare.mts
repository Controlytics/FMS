// Read-only: runs the ORIGINAL getDueTasks (pm-due-tasks.orig-compare.ts, a
// temporary copy) and the CURRENT one against the same database and diffs the
// JSON. Used to prove the 2026-10-17 bounded-query fix changes no result.
//   DATABASE_URL=... npx tsx ../../tests/performance/equivalence/pm-due-compare.mts [yyyy-mm-dd ...]
import { getDueTasks as current } from '../../../apps/api/src/modules/pm-schedules/pm-due-tasks.js';
// The ORIGINAL is restored for a comparison with: git show <commit>:apps/api/src/modules/pm-schedules/pm-due-tasks.ts > apps/api/src/modules/pm-schedules/pm-due-tasks.orig-compare.ts (delete it afterwards)
import { getDueTasks as original } from "../../../apps/api/src/modules/pm-schedules/pm-due-tasks.orig-compare.js";
import { prisma } from '../../../apps/api/src/lib/prisma.js';

const ctx = {} as any;
const cases: Array<{ from?: string; to?: string } | undefined> = [undefined];
for (const d of process.argv.slice(2)) {
  const [from, to] = d.split(':');
  cases.push({ from, to: to ?? from });
}
let bad = 0;
for (const opts of cases) {
  const t0 = Date.now();
  let a: string;
  try { a = JSON.stringify(await original(ctx, opts)); } catch (e: any) { a = `ORIGINAL FAILED: ${e.code ?? ''} ${String(e.message).split(/\r?\n/).filter(Boolean).pop()}`; }
  const t1 = Date.now();
  const b = JSON.stringify(await current(ctx, opts)); const t2 = Date.now();
  if (a.startsWith('ORIGINAL FAILED')) {
    const n = JSON.parse(b);
    console.log(`ORIG-FAILED  ${JSON.stringify(opts ?? 'default')}  (${a}) after ${t1 - t0} ms; new ok: tasks=${n.tasks.length} overdue=${n.overdue.length} ${(b.length / 1024).toFixed(0)} KB in ${t2 - t1} ms`);
    continue;
  }
  const same = a === b;
  if (!same) bad++;
  const n = JSON.parse(b);
  console.log(`${same ? 'SAME' : 'DIFF'}  ${JSON.stringify(opts ?? 'default')}  tasks=${n.tasks.length} overdue=${n.overdue.length}  ${(b.length / 1024).toFixed(0)} KB  original ${t1 - t0} ms / new ${t2 - t1} ms`);
  if (!same) {
    let i = 0; while (a[i] === b[i]) i++;
    console.log('   first difference at char', i, '\n   original:', a.slice(Math.max(0, i - 120), i + 120), '\n   new:     ', b.slice(Math.max(0, i - 120), i + 120));
  }
}
await prisma.$disconnect();
console.log(bad ? `${bad} case(s) DIFFER` : 'all cases identical');
process.exit(bad ? 1 : 0);
