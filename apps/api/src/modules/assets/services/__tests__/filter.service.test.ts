import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterService } from '../filter.service.js';
import { prisma } from '../../../../lib/prisma.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    ahu: { findUnique: vi.fn() },
    filter: { findFirst: vi.fn(), create: vi.fn() },
    filterDetails: { create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn({
      filter: { create: vi.fn(async ({ data }: any) => ({ id: 'f1', ...data })) },
      filterDetails: { create: vi.fn() },
    })),
  },
}));
vi.mock('../filter-fields.service.js', () => ({
  validateAndBuildFilterAttributes: vi.fn(async (i: any) => ({ attributes: i.ahuType ? { ahuType: 'Process' } : {}, errors: [] })),
}));
vi.mock('../identifier.service.js', () => ({ identifierService: { create: vi.fn() } }));
vi.mock('../../../../lib/audit.js', () => ({ auditLog: vi.fn() }));

const ctx = { userId: 'superadmin', userRole: 'SUPER_ADMIN' } as any;
beforeEach(() => {
  vi.clearAllMocks();
  (prisma.ahu.findUnique as any).mockResolvedValue({ id: 'ahu1' });
  (prisma.filter.findFirst as any).mockResolvedValue(null);
});

describe('filterService.create', () => {
  it('rejects when the AHU does not exist (no asset hierarchy validation)', async () => {
    (prisma.ahu.findUnique as any).mockResolvedValue(null);
    await expect(filterService.create({ name: 'F', ahuId: 'nope' }, ctx)).rejects.toThrow(/AHU/);
  });

  it('rejects a duplicate filter name', async () => {
    (prisma.filter.findFirst as any).mockResolvedValue({ id: 'x' });
    await expect(filterService.create({ name: 'Dup', ahuId: 'ahu1' }, ctx)).rejects.toThrow(/exists/);
  });

  it('creates the typed filter with ahuId + attributes and returns it', async () => {
    const out = await filterService.create({ name: 'F', ahuId: 'ahu1', filterSet: 'A', ahuType: 'process' }, ctx);
    expect(out.id).toBe('f1');
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
