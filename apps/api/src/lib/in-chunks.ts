/**
 * Run a query over a caller-sized id list in chunks (D-DB-9, 2026-10-22).
 *
 * Postgres caps ONE statement at 32,767 bind variables. A Prisma
 * `where: { x: { in: ids } }` binds every id, so an id list taken from a page the
 * caller sized (the cycles list has no page-size cap; the tablet asks for
 * limit=1000000) failed outright once a page passed ~32k rows: "too many bind
 * variables in prepared statement". The query runs once per chunk instead, one
 * after the other (not in parallel: the pool is small), and the rows come back
 * in chunk order — so per-chunk ordering is kept for rows that belong to one id.
 */
export const IN_LIST_CHUNK = 10_000;

export async function findInChunks<T>(
  ids: readonly string[],
  query: (chunk: string[]) => Promise<T[]>,
  size: number = IN_LIST_CHUNK,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const rows = await query(ids.slice(i, i + size));
    // No push(...rows): spreading a very large array overflows the call stack.
    for (const r of rows) out.push(r);
  }
  return out;
}
