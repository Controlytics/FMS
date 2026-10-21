/**
 * Owned-fixture helpers for the coverage suites of super-admin, debug-traces,
 * deployment-check, block-change-requests and report-reviews (2026-10-21).
 *
 * Every helper creates rows the calling file OWNS and hands back what it needs
 * to remove them. Nothing here touches the shared `admin` user, the shared
 * roles, or a system_config key it did not add itself:
 *
 *  - roles are created per file (names <= 20 chars, unique per run);
 *  - re-auth keys are MERGED into `action-reauth` and later removed by
 *    re-reading the row, so a concurrent writer's keys are never clobbered by a
 *    stale snapshot;
 *  - every reauth/RBAC cache this process holds is invalidated after a write.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { invalidateReauthCache } from '../../lib/reauth-check.js';
import { invalidateRolePermsCache } from '../../plugins/rbac.js';
import { loginAs } from '../test-helper.js';

/**
 * Run EVERY cleanup step even when an earlier one fails, then report all the
 * failures together. A plain sequence aborts at the first error (e.g. a fixture
 * id that was never set because beforeAll failed) and silently leaks every row
 * the later steps would have removed. Pass `null` for a step that does not apply.
 */
export async function cleanupAll(steps: Array<[label: string, fn: () => Promise<unknown>] | null>): Promise<void> {
  const failures: Error[] = [];
  for (const step of steps) {
    if (!step) continue;
    const [label, fn] = step;
    try { await fn(); } catch (e) { failures.push(new Error(`cleanup "${label}" failed: ${(e as Error)?.message ?? String(e)}`)); }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length} cleanup step(s) failed: ${failures.map((f) => f.message).join(' | ')}`);
}

export const runSuffix = () => (Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5)).toUpperCase();

export async function createRole(name: string, permissions: string[]): Promise<string> {
  if (name.length > 20) throw new Error(`role name too long: ${name}`);
  const r = await prisma.role.create({
    data: { name, displayName: name, hierarchyLevel: 1, permissions, isSystem: false, isActive: true, createdBy: 'coverage-test' },
  });
  invalidateRolePermsCache(name);
  return r.id;
}

export async function createUser(username: string, role: string, password: string, fullName?: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      username, fullName: fullName ?? `Coverage ${username}`, passwordHash: await hashPassword(password),
      role, status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'coverage-test',
    },
  });
  return u.id;
}

export async function login(app: FastifyInstance, username: string, password: string): Promise<string> {
  return loginAs(app, username, password);
}

/** Remove users this file created, with their sessions and password history. */
export async function deleteUsers(userIds: string[]): Promise<void> {
  const ids = userIds.filter(Boolean);
  if (!ids.length) return;
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.passwordHistory.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

export async function deleteRoles(names: string[]): Promise<void> {
  const n = names.filter(Boolean);
  if (!n.length) return;
  await prisma.roleConfig.deleteMany({ where: { role: { in: n } } });
  await prisma.role.deleteMany({ where: { name: { in: n } } });
  invalidateRolePermsCache();
}

export type ReauthGrant = Array<[action: string, role: string]>;

/** Add `role` to each `action`'s re-auth role list. Returns exactly what was added. */
export async function addReauth(grants: ReauthGrant): Promise<ReauthGrant> {
  const added: ReauthGrant = [];
  const row = await prisma.systemConfig.findUnique({ where: { configKey: 'action-reauth' } });
  const cfg = { ...((row?.configValue as Record<string, string[]> | null) ?? {}) };
  for (const [action, role] of grants) {
    const roles = Array.isArray(cfg[action]) ? [...cfg[action]] : [];
    if (!roles.includes(role)) { roles.push(role); added.push([action, role]); }
    cfg[action] = roles;
  }
  await prisma.systemConfig.upsert({
    where: { configKey: 'action-reauth' },
    update: { configValue: cfg },
    create: { configKey: 'action-reauth', configValue: cfg, configType: 'security' },
  });
  invalidateReauthCache();
  return added;
}

/** Undo `addReauth` by re-reading the row: only the pairs we added are removed. */
export async function removeReauth(added: ReauthGrant): Promise<void> {
  if (!added.length) return;
  const row = await prisma.systemConfig.findUnique({ where: { configKey: 'action-reauth' } });
  if (!row) return;
  const cfg = { ...((row.configValue as Record<string, string[]> | null) ?? {}) };
  for (const [action, role] of added) {
    if (!Array.isArray(cfg[action])) continue;
    const roles = cfg[action].filter((r) => r !== role);
    if (roles.length) cfg[action] = roles; else delete cfg[action];
  }
  await prisma.systemConfig.update({ where: { configKey: 'action-reauth' }, data: { configValue: cfg } });
  invalidateReauthCache();
}

/**
 * BLOCK -> AHU hierarchy as asset_instances (the forward mirror writes the
 * typed blocks / ahus rows with the same ids), plus typed filters under the AHU
 * (the reverse mirror writes their asset_instances rows).
 */
export async function createHierarchy(prefix: string) {
  for (const [code, label] of [['BLOCK', 'Block'], ['AHU', 'AHU'], ['FILTER', 'Filter']] as const) {
    await prisma.templateKind.upsert({ where: { code }, update: {}, create: { code, label, isSystem: true } });
  }
  const blockTemplateId = (await prisma.assetTemplate.create({ data: { name: `${prefix} Block Tpl`, templateKind: 'BLOCK' } })).id;
  const ahuTemplateId = (await prisma.assetTemplate.create({ data: { name: `${prefix} AHU Tpl`, templateKind: 'AHU' } })).id;
  // The typed->asset_instances reverse mirror (fn_mirror_typed_to_asset_instance)
  // RAISES when no active FILTER asset_template exists, and a freshly seeded DB
  // has none. Own one, so typed filter creation never depends on ambient rows.
  const filterTemplateId = (await prisma.assetTemplate.create({ data: { name: `${prefix} Filter Tpl`, templateKind: 'FILTER', isActive: true } })).id;
  const blockId = (await prisma.assetInstance.create({ data: { name: `${prefix}-BLOCK`, templateId: blockTemplateId } })).id;
  const ahuId = (await prisma.assetInstance.create({ data: { name: `${prefix}-AHU`, templateId: ahuTemplateId, parentId: blockId } })).id;
  return { blockTemplateId, ahuTemplateId, filterTemplateId, blockId, ahuId };
}

export async function createFilter(ahuId: string | null, name: string): Promise<string> {
  const f = await prisma.filter.create({ data: { ahuId, name, status: 'Active', attributes: {} } as any });
  return f.id;
}

/** Remove filters + everything this file hung off them, FK-safe. */
export async function deleteFilters(ids: string[]): Promise<void> {
  const f = ids.filter(Boolean);
  if (!f.length) return;
  await prisma.cleaningStageApproval.deleteMany({ where: { filterId: { in: f } } });
  await prisma.filterDetails.updateMany({ where: { assetInstanceId: { in: f } }, data: { currentCycleId: null } });
  await prisma.filterEvent.deleteMany({ where: { filterId: { in: f } } });
  await prisma.cleaningCycle.deleteMany({ where: { filterId: { in: f } } });
  await prisma.assetIdentifier.deleteMany({ where: { assetId: { in: f } } });
  await prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: f } }, { targetAssetId: { in: f } }] } });
  await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: f } } });
  await prisma.filter.deleteMany({ where: { id: { in: f } } });
  await prisma.assetInstance.deleteMany({ where: { id: { in: f } } });
}

export async function deleteHierarchy(h: { blockTemplateId?: string; ahuTemplateId?: string; filterTemplateId?: string; blockId?: string; ahuId?: string } | undefined, extraAhuIds: string[] = []): Promise<void> {
  if (!h) return;
  const ahus = [h.ahuId, ...extraAhuIds].filter(Boolean) as string[];
  const all = [...ahus, h.blockId].filter(Boolean) as string[];
  await prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: all } }, { targetAssetId: { in: all } }] } });
  for (const id of ahus) await prisma.assetInstance.delete({ where: { id } }).catch(() => undefined);
  if (h.blockId) await prisma.assetInstance.delete({ where: { id: h.blockId } }).catch(() => undefined);
  if (h.ahuTemplateId) await prisma.assetTemplate.delete({ where: { id: h.ahuTemplateId } }).catch(() => undefined);
  if (h.blockTemplateId) await prisma.assetTemplate.delete({ where: { id: h.blockTemplateId } }).catch(() => undefined);
  // The mirror picks the OLDEST active FILTER template, so a concurrent suite's
  // filters may have landed on ours; the FK then keeps it (best-effort delete).
  if (h.filterTemplateId) await prisma.assetTemplate.delete({ where: { id: h.filterTemplateId } }).catch(() => undefined);
}

export async function createCleaningProfile(name: string, createdBy: string): Promise<string> {
  const p = await prisma.filterCleaningProfile.create({
    data: { lineageId: crypto.randomUUID(), name, version: 3, status: 'ACTIVE', createdBy },
  });
  return p.id;
}

/** Audit rows this file wrote, newest first. */
export async function auditRows(where: Record<string, unknown>) {
  return prisma.auditTrail.findMany({ where, orderBy: { chainPosition: 'desc' } });
}
