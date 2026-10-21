import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * block-change.service branches the real-database suite
 * (e2e/block-change-requests.test.ts) cannot reach without rewriting the shared
 * `block-change-approval.mode` (start-cycle reads it) or breaking the
 * notification store: the three cross-block modes, list defaults, and the rule
 * that a failed notification never undoes or fails the request / decision.
 */

const { mockPrisma, notify } = vi.hoisted(() => {
  const m: any = {
    systemConfig: { findUnique: vi.fn() },
    blockChangeRequest: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  m.$transaction = vi.fn(async (fn: (tx: any) => unknown) => fn(m));
  return { mockPrisma: m, notify: vi.fn() };
});
vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn().mockResolvedValue('audit-id') }));
vi.mock('../../notifications/notification.service.js', () => ({ createNotification: (...a: unknown[]) => notify(...a) }));

import { blockChangeService } from '../block-change.service.js';
import { auditLog } from '../../../lib/audit.js';

const ctx: any = { userId: 'approver', userSub: 'sub-approver', userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1' };
const cfg = (configValue: unknown) => mockPrisma.systemConfig.findUnique.mockResolvedValue(configValue === undefined ? null : { configValue });

beforeEach(() => {
  vi.clearAllMocks();
  notify.mockReset();
});

describe('getMode', () => {
  it.each([
    [{ mode: 'NONE' }, 'NONE'],
    [{ mode: 'APPROVAL' }, 'APPROVAL'],
    [{ mode: 'CONFIRM' }, 'CONFIRM'],
    [{ mode: 'SOMETHING_ELSE' }, 'CONFIRM'],
    [{}, 'CONFIRM'],
    [undefined, 'CONFIRM'],
  ])('config %j -> %s', async (value, expected) => {
    cfg(value);
    expect(await blockChangeService.getMode()).toBe(expected);
  });
});

describe('getAutoExpireHours', () => {
  it('accepts a numeric string and rejects negatives', async () => {
    cfg({ autoExpireHours: '12' });
    expect(await blockChangeService.getAutoExpireHours()).toBe(12);
    cfg({ autoExpireHours: -5 });
    expect(await blockChangeService.getAutoExpireHours()).toBe(0);
  });
});

describe('a failed notification never fails the write', () => {
  const data = { filterId: 'f', filterName: 'F', fromBlockId: 'b1', fromBlockName: 'B1', toBlockId: 'b2', toBlockName: 'B2' };

  it('create(): the request and its audit row stand when notifying approvers throws', async () => {
    mockPrisma.blockChangeRequest.findFirst.mockResolvedValue(null);
    mockPrisma.blockChangeRequest.create.mockResolvedValue({ id: 'req-1', ...data, status: 'PENDING' });
    cfg({ approvalRole: 'QA' });
    notify.mockRejectedValue(new Error('notification store down'));
    const r = await blockChangeService.create(ctx, data);
    expect(r).toMatchObject({ id: 'req-1', status: 'PENDING' });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'BLOCK_CHANGE_REQUESTED', targetId: 'req-1' }), mockPrisma);
    expect(notify).toHaveBeenCalledTimes(1); // threw on the first, never reached SUPER_ADMIN
  });

  it('process(): the decision and its audit row stand when notifying the requester throws', async () => {
    mockPrisma.blockChangeRequest.findUnique
      .mockResolvedValueOnce({ id: 'req-2', status: 'PENDING', requestedBy: 'someone-else', requestedByName: 'op', filterName: 'F', toBlockName: 'B2' })
      .mockResolvedValueOnce({ id: 'req-2', status: 'REJECTED' });
    mockPrisma.blockChangeRequest.updateMany.mockResolvedValue({ count: 1 });
    notify.mockRejectedValue(new Error('notification store down'));
    const r = await blockChangeService.process(ctx, 'req-2', 'reject', 'no');
    expect(r).toMatchObject({ status: 'REJECTED' });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'BLOCK_CHANGE_REJECTED', afterValue: { status: 'REJECTED', comment: 'no' } }));
  });
});

describe('list defaults', () => {
  it('page 1, 20 per page, no filters when called with nothing', async () => {
    mockPrisma.blockChangeRequest.findMany.mockResolvedValue([]);
    mockPrisma.blockChangeRequest.count.mockResolvedValue(41);
    const r = await blockChangeService.list(ctx, {});
    expect(r).toEqual({ data: [], total: 41, page: 1, limit: 20, totalPages: 3 });
    expect(mockPrisma.blockChangeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, skip: 0, take: 20 }));
  });
});
