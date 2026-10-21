/**
 * The per-table row cap on row-level backups (May 16 §1.9 / delta-audit C6),
 * end to end (coverage campaign 2026-10-21). BACKUP_MAX_ROWS_PER_TABLE is read
 * once when backup.repository loads, so it is set in vi.hoisted — before any
 * import — and put back in afterAll (singleFork shares process.env with later
 * files). Read-only against digilog_test_db: the pre-flight COUNT(*) refuses
 * before a single table is fetched.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const saved = vi.hoisted(() => {
  const prev = process.env.BACKUP_MAX_ROWS_PER_TABLE;
  process.env.BACKUP_MAX_ROWS_PER_TABLE = '1';
  return { prev };
});

import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { uniq, ensureUser, deleteUsersAndRoles, login } from '../modules/notification-delivery/__tests__/cov-fixtures.js';

const SA = `covtl_sa_${uniq()}`;
const PW = 'CovTooLarge@2026';
let app: FastifyInstance;
let token = '';

beforeAll(async () => {
  app = await buildApp();
  await ensureUser({ username: SA, password: PW, role: 'SUPER_ADMIN' });
  token = await login(app, SA, PW);
}, 60_000);

afterAll(async () => {
  if (saved.prev === undefined) delete process.env.BACKUP_MAX_ROWS_PER_TABLE;
  else process.env.BACKUP_MAX_ROWS_PER_TABLE = saved.prev;
  await deleteUsersAndRoles([SA], []);
  await app?.close();
}, 60_000);

describe('BACKUP_MAX_ROWS_PER_TABLE', () => {
  it.each(['json', 'bak', 'sql', 'csv'])('a %s export over the cap is a 413 naming the table, and nothing is audited', async (format) => {
    const res = await app.inject({
      method: 'GET', url: `/api/backup/export?format=${format}`,
      headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PW },
    });
    expect(res.statusCode).toBe(413);
    const body = res.json();
    expect(body).toMatchObject({ error: 'BACKUP_TOO_LARGE', limit: 1 });
    expect(body.rowCount).toBeGreaterThan(1);
    expect(body.message).toMatch(new RegExp(`^Backup blocked: table "${body.table}" has [\\d,]+ rows \\(per-table limit 1\\)`));
    // the named table really is over the cap
    const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT COUNT(*)::int AS n FROM "${body.table}"`);
    expect(n).toBeGreaterThan(1);
    expect(await prisma.auditTrail.count({ where: { action: 'BACKUP_CREATED', userId: SA } })).toBe(0);
  });
});
