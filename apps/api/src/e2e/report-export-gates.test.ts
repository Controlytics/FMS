/**
 * QA Phase 4, P4-02 (2026-10-21): the dedicated export toggles must be enforced
 * by the server, not only by the Export button. POST /api/audit/report-export-log
 * (the audit write every download makes first) used to accept the report's READ
 * permission, so a role with AUDIT_READ but not AUDIT_EXPORT could export the
 * Audit Trail through the API.
 *
 * A throwaway custom role holds the READ permissions of the four toggle-gated
 * reports but none of their EXPORT permissions; a second one holds the export
 * permissions. Custom roles have no action-reauth entry, so a permitted call
 * answers 200 with no password. Real Fastify + auth + Prisma on digilog_test_db.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PERMISSION_TREE } from '@digilog/shared';
import { buildApp, loginAs } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { invalidateRolePermsCache } from '../plugins/rbac.js';

const STAMP = Date.now();
const READER_ROLE = `QAEXPR${STAMP % 1e8}`; // role columns elsewhere are VarChar(20)
const EXPORTER_ROLE = `QAEXPX${STAMP % 1e8}`;
const READER = `qa_p402_r_${STAMP}`;
const EXPORTER = `qa_p402_x_${STAMP}`;
const PASSWORD = 'QaP402@Test2026';

// report → [read permission the old gate accepted, export permission the button checks, tree node]
const CASES = [
  ['Audit Trail', 'AUDIT_READ', 'AUDIT_EXPORT', 'audit.export'],
  ['Filters', 'ASSET_READ', 'FILTER_LIST_EXPORT', 'filters.export'],
  ['Retirement List', 'ASSET_READ', 'RETIREMENT_LIST_EXPORT', 'retirement_list.export'],
  ['Replacement List', 'ASSET_READ', 'REPLACEMENT_LIST_EXPORT', 'replacement_list.export'],
  ['Cleaning Record', 'CYCLE_READ', 'REPORT_EXPORT', 'cleaning_record.export'],
  ['Cleaning Lifecycle', 'CYCLE_READ', 'REPORT_EXPORT', 'lifecycle.export'],
] as const;

let app: FastifyInstance;
let readerToken: string;
let exporterToken: string;

const log = (token: string, reportType: string) => app.inject({
  method: 'POST', url: '/api/audit/report-export-log',
  headers: { authorization: `Bearer ${token}` },
  payload: { reportType, format: 'PDF', recordCount: 0, search: 'QA-P402' },
});

describe('report export is gated on the export permission (P4-02)', () => {
  beforeAll(async () => {
    app = await buildApp();
    const reads = [...new Set(CASES.map((c) => c[1]))];
    const exports = [...new Set(CASES.map((c) => c[2]))];
    for (const [name, permissions] of [[READER_ROLE, reads], [EXPORTER_ROLE, exports]] as const) {
      await prisma.role.create({ data: { name, displayName: name, hierarchyLevel: 1, permissions: [...permissions], createdBy: 'qa-p402-test' } });
    }
    invalidateRolePermsCache();
    const passwordHash = await hashPassword(PASSWORD);
    for (const [username, role] of [[READER, READER_ROLE], [EXPORTER, EXPORTER_ROLE]]) {
      await prisma.user.create({
        data: { username, fullName: username, passwordHash, role, status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-p402-test' },
      });
    }
    readerToken = await loginAs(app, READER, PASSWORD);
    exporterToken = await loginAs(app, EXPORTER, PASSWORD);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { username: { in: [READER, EXPORTER] } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.passwordHistory.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.role.deleteMany({ where: { name: { in: [READER_ROLE, EXPORTER_ROLE] } } });
    invalidateRolePermsCache();
    await app?.close();
  });

  for (const [report] of CASES) {
    it(`${report}: read permission alone is refused`, async () => {
      const res = await log(readerToken, report);
      expect(res.statusCode).toBe(403);
    });
    it(`${report}: the export permission is accepted`, async () => {
      const res = await log(exporterToken, report);
      expect(res.statusCode).toBe(200);
    });
  }

  it('Quality Notifications needs PM_READ like its page (was open to every signed-in user)', async () => {
    expect((await log(readerToken, 'Quality Notifications')).statusCode).toBe(403);
  });

  it('each server gate equals the gate of the page Export button (PERMISSION_TREE)', () => {
    const nodes = new Map<string, { gate?: string[] }>();
    const walk = (n: any) => { if (n?.id) nodes.set(n.id, n); for (const c of n?.children ?? n?.actions ?? n?.nodes ?? []) walk(c); };
    (Array.isArray(PERMISSION_TREE) ? PERMISSION_TREE : Object.values(PERMISSION_TREE)).forEach(walk);
    for (const [report, , exportPerm, nodeId] of CASES) {
      const node = nodes.get(nodeId);
      expect(node, nodeId).toBeTruthy();
      expect(node!.gate, `${report} → ${nodeId}`).toContain(exportPerm);
    }
  });
});
