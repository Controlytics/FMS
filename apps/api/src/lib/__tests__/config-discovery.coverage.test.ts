/**
 * lib/config-discovery.ts — boot-time registration of every config def, default
 * seeding, the one-time `filter-pm-schedule` -> `pm-schedule-settings` merge and
 * the dead-key cleanup.
 *
 * The real defs are imported and registered. The system_config table is
 * replaced by an in-memory map at the module's prisma boundary: the merge
 * branch needs `pm-schedule-settings` WITHOUT its `enabled` key, and removing
 * that from the shared row would switch PM features off for every concurrent
 * suite. What is asserted is the write each step issues (create / upsert /
 * delete / deleteMany) and the registry contents.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, type MockInstance } from 'vitest';

const db = vi.hoisted(() => {
  const rows = new Map<string, { configKey: string; configValue: unknown }>();
  return {
    rows,
    deadRemoved: 0,
    findUnique: vi.fn(async ({ where }: { where: { configKey: string } }) => rows.get(where.configKey) ?? null),
    create: vi.fn(async ({ data }: { data: { configKey: string; configValue: unknown } }) => { rows.set(data.configKey, data); return data; }),
    upsert: vi.fn(async (args: any) => { const v = rows.has(args.where.configKey) ? args.update : args.create; rows.set(args.where.configKey, { configKey: args.where.configKey, ...v }); return v; }),
    delete: vi.fn(async ({ where }: { where: { configKey: string } }) => { rows.delete(where.configKey); return {}; }),
    deleteMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
  };
});
vi.mock('../prisma.js', () => ({
  prisma: { systemConfig: { findUnique: db.findUnique, create: db.create, upsert: db.upsert, delete: db.delete, deleteMany: db.deleteMany } },
}));

const DEAD_KEYS = ['offline-sync', 'rfid-scanner', 'role-privileges', 'sidebar-config', 'uns', 'retention'];

let stdout: MockInstance<typeof process.stdout.write>;
const printed = () => stdout.mock.calls.map((c) => String(c[0])).join('');

async function discover() {
  vi.resetModules();
  const { discoverAndRegisterConfigs } = await import('../config-discovery.js');
  const { configRegistry } = await import('../config-registry.js');
  await discoverAndRegisterConfigs();
  return configRegistry;
}

/** Make every def's row "exist" so seeding writes nothing. */
async function seedAllRowsPresent() {
  const reg = await discover();
  for (const d of reg.getAll()) db.rows.set(d.moduleKey, { configKey: d.moduleKey, configValue: d.moduleKey === 'pm-schedule-settings' ? { enabled: true } : {} });
  return reg;
}

// The first import transforms all 38 defs and their dependency trees.
beforeAll(async () => {
  const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try { await discover(); } finally { quiet.mockRestore(); }
}, 120_000);

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  db.rows.clear();
  for (const fn of [db.findUnique, db.create, db.upsert, db.delete]) fn.mockClear();
  db.deleteMany.mockReset().mockResolvedValue({ count: 0 });
});
afterAll(() => { stdout.mockRestore(); });

describe('discoverAndRegisterConfigs', () => {
  it('registers every config def and seeds a default row for each missing key', async () => {
    const reg = await discover();
    const keys = reg.getAll().map((d) => d.moduleKey);
    expect(reg.size).toBe(38);
    expect(keys).toEqual(expect.arrayContaining([
      'password-policy', 'login-security', 'session', 'action-reauth', 'filter-approval', 'ahu-completion-process', 'export-limit', 'backup-format',
    ]));
    // Removed defs stay removed.
    expect(keys).not.toContain('uns');
    expect(keys).not.toContain('retention');
    // Empty table: one create per def, typed with the def's category.
    expect(db.create).toHaveBeenCalledTimes(38);
    const pagination = db.create.mock.calls.map((c) => c[0].data).find((d) => d.configKey === 'pagination') as any;
    expect(pagination.configType).toBe(reg.get('pagination')!.category);
    expect(printed()).toContain('38 config modules registered');
  });

  it('writes nothing when every row exists, and asks to delete exactly the dead keys', async () => {
    await seedAllRowsPresent();
    db.create.mockClear(); db.upsert.mockClear(); db.delete.mockClear(); db.deleteMany.mockClear();
    stdout.mockClear();
    await discover();
    expect(db.create).not.toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { configKey: { in: DEAD_KEYS } } });
    expect(printed()).not.toContain('dead config row');
  });

  it('logs how many dead rows it removed', async () => {
    await seedAllRowsPresent();
    db.deleteMany.mockResolvedValue({ count: 2 });
    stdout.mockClear();
    await discover();
    expect(printed()).toContain('Removed 2 dead config row(s)');
  });

  it('merges a legacy filter-pm-schedule flag into pm-schedule-settings when that has none, then drops the legacy row', async () => {
    await seedAllRowsPresent();
    db.rows.set('pm-schedule-settings', { configKey: 'pm-schedule-settings', configValue: { defaultToleranceDays: 7 } });
    db.rows.set('filter-pm-schedule', { configKey: 'filter-pm-schedule', configValue: { enabled: true } });
    db.upsert.mockClear(); stdout.mockClear();
    await discover();
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { configKey: 'pm-schedule-settings' },
      update: { configValue: { defaultToleranceDays: 7, enabled: true } },
    }));
    expect(db.rows.get('pm-schedule-settings')!.configValue).toEqual({ defaultToleranceDays: 7, enabled: true });
    expect(db.rows.has('filter-pm-schedule')).toBe(false);
    expect(printed()).toContain('Merged filter-pm-schedule into pm-schedule-settings');
  });

  it('never overrides an explicit pm-schedule-settings flag, but still drops the legacy row', async () => {
    await seedAllRowsPresent();
    db.rows.set('pm-schedule-settings', { configKey: 'pm-schedule-settings', configValue: { enabled: false } });
    db.rows.set('filter-pm-schedule', { configKey: 'filter-pm-schedule', configValue: { enabled: true } });
    db.upsert.mockClear();
    await discover();
    expect(db.upsert).not.toHaveBeenCalled();
    expect(db.rows.get('pm-schedule-settings')!.configValue).toEqual({ enabled: false });
    expect(db.rows.has('filter-pm-schedule')).toBe(false);
  });

  it('creates pm-schedule-settings from a legacy row with no value (flag off)', async () => {
    db.rows.set('filter-pm-schedule', { configKey: 'filter-pm-schedule', configValue: null });
    // Seeding runs first and creates pm-schedule-settings from its def; remove
    // that so the merge sees no row at all.
    db.create.mockImplementation(async ({ data }: any) => { if (data.configKey !== 'pm-schedule-settings') db.rows.set(data.configKey, data); return data; });
    await discover();
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { configKey: 'pm-schedule-settings' },
      create: { configKey: 'pm-schedule-settings', configValue: { enabled: false }, configType: 'filter' },
    }));
    expect(db.rows.has('filter-pm-schedule')).toBe(false);
    db.create.mockImplementation(async ({ data }: any) => { db.rows.set(data.configKey, data); return data; });
  });
});
