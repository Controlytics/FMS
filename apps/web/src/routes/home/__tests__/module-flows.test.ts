import { describe, it, expect } from 'vitest';
import { MODULE_FLOWS, CATEGORY_ORDER } from '../module-flows';
import { PERMISSIONS } from '@digilog/shared';

const ALL_PERMS = new Set(Object.values(PERMISSIONS));

describe('MODULE_FLOWS integrity', () => {
  it('has no duplicate module ids', () => {
    const ids = MODULE_FLOWS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every module has at least one step', () => {
    for (const m of MODULE_FLOWS) expect(m.steps.length).toBeGreaterThan(0);
  });

  it('every gate permission is a real PERMISSIONS constant', () => {
    for (const m of MODULE_FLOWS) {
      for (const s of m.steps) {
        for (const g of s.gate) expect(ALL_PERMS.has(g)).toBe(true);
        for (const g of s.branch?.gate ?? []) expect(ALL_PERMS.has(g)).toBe(true);
      }
    }
  });

  it('every module category is one of the known categories', () => {
    for (const m of MODULE_FLOWS) expect(CATEGORY_ORDER).toContain(m.category);
  });
});
