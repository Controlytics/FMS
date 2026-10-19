// M10 equivalence: the SQL-filtered getRfidTrackRecord must return what the old
// in-memory version returned, on the QA clone's real assign/remove history.
//   npx tsx QA/tests/equivalence/rfid-track-record-compare.mts
// Needs apps/api/src/modules/assets/services/identifier.service.old-qa-tmp.ts
// (= git show HEAD:… of the service) next to the live one.
process.env.DATABASE_URL = 'postgresql://digilog:digilog123@localhost:5432/digilog_qa_perf?schema=public';
if (!/\/digilog_qa_perf\?/.test(process.env.DATABASE_URL)) throw new Error('refusing: not the QA clone');

const { identifierService: NEW } = await import('../../../apps/api/src/modules/assets/services/identifier.service.ts');
const { identifierService: OLD } = await import('../../../apps/api/src/modules/assets/services/identifier.service.old-qa-tmp.ts');
const { prisma } = await import('../../../apps/api/src/lib/prisma.ts');

const cases: Array<Record<string, unknown>> = [
  {}, { limit: 25 }, { page: 2, limit: 25 }, { page: 40, limit: 25 }, { page: 999, limit: 25 }, { limit: 1 },
  { rfid: 'ca000c' }, { rfid: 'CA000C3A' }, { rfid: 'zzz-none' }, { rfid: '%' }, { rfid: '_' },
  { user: '121216' }, { user: '1212' }, { user: 'nobody' },
  { filterName: 'a' }, { filterName: 'F-' }, { ahu: 'ahu' }, { ahu: 'AHU-0' },
  { from: '2026-01-01' }, { to: '2026-01-01' }, { from: '2026-10-01', to: '2026-10-12T23:59:59Z' },
  { rfid: 'ca', user: '121', limit: 10, page: 3 }, { filterName: 'a', ahu: 'a', limit: 50 },
];

// Old order had no tie-break for equal timestamps; compare with the same stable order.
const key = (r: any) => `${new Date(r.timestamp).toISOString()}|${r.id}`;
const sortDesc = (a: any[]) => [...a].sort((x, y) => (key(x) < key(y) ? 1 : key(x) > key(y) ? -1 : 0));

let failures = 0;
for (const q of cases) {
  const newR = await NEW.getRfidTrackRecord(q as any);
  let oldR: any;
  if (q.limit) {
    // re-page the old FULL result with the stable order, so a tie straddling a page edge is not a false diff
    const all = await OLD.getRfidTrackRecord({ ...q, page: undefined, limit: undefined } as any);
    const sorted = sortDesc(all.data);
    const page = (q.page as number) ?? 1; const limit = q.limit as number;
    oldR = { data: sorted.slice((page - 1) * limit, page * limit), total: all.total, page, limit, totalPages: Math.ceil(all.total / limit) };
  } else {
    const all = await OLD.getRfidTrackRecord(q as any);
    oldR = { ...all, data: sortDesc(all.data) };
  }
  const a = JSON.stringify({ ...oldR, data: oldR.data });
  const b = JSON.stringify({ ...newR, data: q.limit ? newR.data : sortDesc(newR.data) });
  const ok = a === b;
  if (!ok) failures++;
  console.log(`${ok ? 'same' : 'DIFF'}  total=${newR.total} rows=${newR.data.length}  ${JSON.stringify(q)}`);
  if (!ok) console.log('   old:', a.slice(0, 300), '\n   new:', b.slice(0, 300));
}
await prisma.$disconnect();
console.log(`cases ${cases.length}, differences ${failures}`);
process.exitCode = failures ? 1 : 0;
