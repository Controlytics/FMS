/**
 * lib/config-registry.ts — the self-registering config definitions.
 *
 * Uses probe definitions with keys this file owns (`cvl-probe-*`), never a real
 * def, and real Prisma for seedDefaults: the observable effect is the
 * system_config row it creates (and never overwrites). Only rows this file
 * created are deleted afterwards. Module isolation keeps the probes out of every
 * other file's registry.
 */
import { describe, it, expect, vi, beforeAll, afterAll, type MockInstance } from 'vitest';
import { prisma } from '../prisma.js';
import { configRegistry, type ModuleConfigDefinition } from '../config-registry.js';
import { randomUUID } from 'node:crypto';

const SFX = randomUUID().slice(0, 8);
const KEY_A = `cvl-probe-a-${SFX}`;
const KEY_B = `cvl-probe-b-${SFX}`;
const KEY_C = `cvl-probe-c-${SFX}`;

function def(over: Partial<ModuleConfigDefinition> & { moduleKey: string }): ModuleConfigDefinition {
  return {
    moduleName: `Probe ${over.moduleKey}`, description: 'coverage probe', icon: 'cog', category: 'cvl-probe',
    sortOrder: 1000, permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' }, requiresReauth: false,
    settings: [], ...over,
  };
}

let stdout: MockInstance<typeof process.stdout.write>;
beforeAll(() => { stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true); });
afterAll(async () => {
  stdout.mockRestore();
  await prisma.systemConfig.deleteMany({ where: { configKey: { in: [KEY_A, KEY_B, KEY_C] } } });
}, 60_000);

describe('configRegistry', () => {
  it('registers, looks up and sorts definitions by sortOrder', () => {
    const before = configRegistry.size;
    configRegistry.register(def({ moduleKey: KEY_B, sortOrder: 2000 }));
    configRegistry.register(def({
      moduleKey: KEY_A, sortOrder: 1500, requiredRole: 'ADMIN', reauthAction: 'UPDATE_CONFIG_PAGE',
      requiresReauth: true, hasCustomPage: true, customPagePath: '/config/cvl',
      settings: [
        { key: 'mode', type: 'select', label: 'Mode', default: 'auto', options: [{ value: 'auto', label: 'Auto' }] },
        { key: 'limit', type: 'number', label: 'Limit', default: 5 },
        { key: 'note', type: 'string', label: 'No default' },
      ],
    }));
    expect(configRegistry.size).toBe(before + 2);
    expect(configRegistry.has(KEY_A)).toBe(true);
    expect(configRegistry.get(KEY_A)?.moduleName).toBe(`Probe ${KEY_A}`);
    expect(configRegistry.get('cvl-never-registered')).toBeUndefined();
    const keys = configRegistry.getAll().map((d) => d.moduleKey);
    expect(keys.indexOf(KEY_A)).toBeLessThan(keys.indexOf(KEY_B));
  });

  it('warns and replaces on a duplicate key', () => {
    stdout.mockClear();
    const size = configRegistry.size;
    configRegistry.register(def({ moduleKey: KEY_B, sortOrder: 2000, description: 'replaced' }));
    expect(configRegistry.size).toBe(size);
    expect(configRegistry.get(KEY_B)?.description).toBe('replaced');
    const out = stdout.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain(`Overwriting config definition ${KEY_B}`);
  });

  it('builds a manifest per caller: SUPER_ADMIN sees all, others need the read permission and a matching role', () => {
    const forSa = configRegistry.getManifest('SUPER_ADMIN', []);
    expect(forSa.map((m) => m.moduleKey)).toEqual(expect.arrayContaining([KEY_A, KEY_B]));
    const a = forSa.find((m) => m.moduleKey === KEY_A)!;
    expect(a).toEqual({
      moduleKey: KEY_A, moduleName: `Probe ${KEY_A}`, description: 'coverage probe', icon: 'cog', category: 'cvl-probe',
      sortOrder: 1500, requiredRole: 'ADMIN', requiresReauth: true, reauthAction: 'UPDATE_CONFIG_PAGE',
      hasCustomPage: true, customPagePath: '/config/cvl', settings: expect.any(Array),
    });
    // Defaults filled for a def that leaves the optional fields out.
    expect(forSa.find((m) => m.moduleKey === KEY_B)).toMatchObject({ requiredRole: null, reauthAction: null, hasCustomPage: false, customPagePath: null });
    // Manifest entries never carry the zod schema or hooks.
    expect(Object.keys(a)).not.toContain('hooks');

    const adminKeys = configRegistry.getManifest('ADMIN', ['CONFIG_READ']).map((m) => m.moduleKey);
    expect(adminKeys).toEqual(expect.arrayContaining([KEY_A, KEY_B]));
    const opKeys = configRegistry.getManifest('OPERATOR', ['CONFIG_READ']).map((m) => m.moduleKey);
    expect(opKeys).toContain(KEY_B);
    expect(opKeys).not.toContain(KEY_A); // requiredRole ADMIN
    expect(configRegistry.getManifest('ADMIN', []).map((m) => m.moduleKey)).not.toContain(KEY_A); // no read permission
  });

  it('seedDefaults creates a missing row from the setting defaults and never overwrites an existing one', async () => {
    await prisma.systemConfig.deleteMany({ where: { configKey: { in: [KEY_A, KEY_B, KEY_C] } } });
    await prisma.systemConfig.create({ data: { configKey: KEY_B, configValue: { kept: true }, configType: 'cvl-probe' } });
    configRegistry.register(def({ moduleKey: KEY_C, sortOrder: 2500, settings: [{ key: 'flag', type: 'boolean', label: 'Flag', default: false }] }));

    // Only the probes are registered in this file's module instance, so this
    // can create nothing but the probe rows.
    const realKeys = configRegistry.getAll().map((d) => d.moduleKey).filter((k) => !k.startsWith('cvl-probe-'));
    expect(realKeys).toEqual([]);
    await configRegistry.seedDefaults();

    const rows = await prisma.systemConfig.findMany({ where: { configKey: { in: [KEY_A, KEY_B, KEY_C] } }, orderBy: { configKey: 'asc' } });
    const byKey = Object.fromEntries(rows.map((r) => [r.configKey, r]));
    expect(byKey[KEY_A]).toMatchObject({ configValue: { mode: 'auto', limit: 5 }, configType: 'cvl-probe', requiresReauth: true });
    expect(byKey[KEY_B].configValue).toEqual({ kept: true });
    expect(byKey[KEY_C]).toMatchObject({ configValue: { flag: false }, requiresReauth: false });
  });
});
