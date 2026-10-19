process.env.DATABASE_URL = 'postgresql://digilog:digilog123@localhost:5432/digilog_qa_perf?schema=public';
const { identifierService: NEW } = await import('../../../apps/api/src/modules/assets/services/identifier.service.ts');
const { identifierService: OLD } = await import('../../../apps/api/src/modules/assets/services/identifier.service.old-qa-tmp.ts');
const { prisma } = await import('../../../apps/api/src/lib/prisma.ts');
const t = async (fn: () => Promise<unknown>) => { const s = performance.now(); await fn(); return performance.now() - s; };
for (const [name, svc] of [['old', OLD], ['new', NEW]] as const) {
  await svc.getRfidTrackRecord({ limit: 25 }); // warm
  const ms: number[] = [];
  for (let i = 0; i < 5; i++) ms.push(await t(() => svc.getRfidTrackRecord({ limit: 25, page: 3 })));
  ms.sort((a, b) => a - b);
  console.log(`${name}: median ${ms[2].toFixed(0)} ms for one 25-row page (3,044 records)`);
}
await prisma.$disconnect();
