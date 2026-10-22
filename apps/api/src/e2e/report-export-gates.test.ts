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
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';

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
    // pm-schedules too: the Quality Notifications page route the export is compared with (D04-01).
    app = await buildApp([{ plugin: pmScheduleRoutes, prefix: '/api/pm-schedules' }]);
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

  // D04-01 (deliverable 04, 2026-10-22): Quality Notifications has NO feature
  // permission. Who may see it is config `qnn-notifications.visibleRoles` (+
  // SUPER_ADMIN), checked by canSeeQnn (pm-schedules/qnn.ts) on GET
  // /api/pm-schedules/qnn. The export gate checked PM_READ instead, so OPERATOR
  // (PM_READ, not listed) could log an export of a page it is refused, and ADMIN
  // (listed, no PM_READ) could not export a page it sees. The export now answers
  // exactly like the page, for every role, whatever the list says.
  describe('Quality Notifications: the export follows the page rule (canSeeQnn), not a permission (D04-01)', () => {
    const OP = `qa_d0401_op_${STAMP}`;
    const AD = `qa_d0401_ad_${STAMP}`;
    const tokens: Record<string, string> = {};
    let snapshot: { configValue: unknown; configType: string; requiresReauth: boolean } | null = null;
    const setVisible = (roles: string[]) => prisma.systemConfig.upsert({
      where: { configKey: 'qnn-notifications' },
      update: { configValue: { ...((snapshot?.configValue as object | undefined) ?? {}), visibleRoles: roles } },
      create: { configKey: 'qnn-notifications', configValue: { visibleRoles: roles }, configType: 'notification' },
    });
    const page = (token: string) => app.inject({ method: 'GET', url: '/api/pm-schedules/qnn?page=1&limit=1', headers: { authorization: `Bearer ${token}` } });
    const exportQnn = (token: string) => app.inject({
      method: 'POST', url: '/api/audit/report-export-log',
      // Built-in roles may have EXPORT_QUALITY_NOTIFICATIONS on the action-reauth page; the password satisfies it.
      headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PASSWORD },
      payload: { reportType: 'Quality Notifications', format: 'PDF', recordCount: 0, search: 'QA-D0401' },
    });

    beforeAll(async () => {
      const row = await prisma.systemConfig.findUnique({ where: { configKey: 'qnn-notifications' } });
      snapshot = row ? { configValue: row.configValue, configType: row.configType, requiresReauth: row.requiresReauth } : null;
      const passwordHash = await hashPassword(PASSWORD);
      for (const [username, role] of [[OP, 'OPERATOR'], [AD, 'ADMIN']]) {
        await prisma.user.create({
          data: { username, fullName: username, passwordHash, role, status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-d0401-test' },
        });
        tokens[role] = await loginAs(app, username, PASSWORD);
      }
    });

    afterAll(async () => {
      if (snapshot) {
        await prisma.systemConfig.update({ where: { configKey: 'qnn-notifications' }, data: { configValue: snapshot.configValue as object, configType: snapshot.configType, requiresReauth: snapshot.requiresReauth } });
      } else {
        await prisma.systemConfig.deleteMany({ where: { configKey: 'qnn-notifications' } });
      }
      const users = await prisma.user.findMany({ where: { username: { in: [OP, AD] } }, select: { id: true } });
      const ids = users.map((u) => u.id);
      await prisma.session.deleteMany({ where: { userId: { in: ids } } });
      await prisma.passwordHistory.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    });

    it('default list (ADMIN): ADMIN may view AND export; OPERATOR may do neither', async () => {
      await setVisible(['ADMIN']);
      expect((await page(tokens.ADMIN)).statusCode).toBe(200);
      expect((await exportQnn(tokens.ADMIN)).statusCode).toBe(200);
      expect((await page(tokens.OPERATOR)).statusCode).toBe(403);
      expect((await exportQnn(tokens.OPERATOR)).statusCode).toBe(403);
    });

    it('the list decides, not a permission: with OPERATOR listed instead, both answers flip together', async () => {
      await setVisible(['OPERATOR']);
      for (const role of ['ADMIN', 'OPERATOR']) {
        const view = (await page(tokens[role])).statusCode;
        expect([200, 403], role).toContain(view);
        expect((await exportQnn(tokens[role])).statusCode, role).toBe(view);
      }
      expect((await page(tokens.OPERATOR)).statusCode).toBe(200);
      expect((await page(tokens.ADMIN)).statusCode).toBe(403);
    });

    it('a custom role not on the list is refused both, whatever it holds (the reader role)', async () => {
      await setVisible(['ADMIN']);
      expect((await page(readerToken)).statusCode).toBe(403);
      expect((await log(readerToken, 'Quality Notifications')).statusCode).toBe(403);
    });
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
