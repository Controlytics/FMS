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

  // Anti-recurrence guard: gate: [] used to silently render as "any user" in
  // FlowChart even when the real backend gate was requireSuperAdmin /
  // requireRole / public / automatic / config-gated. Every step must now
  // resolve to one of the three real access signals — no silent catch-all.
  it('every step resolves an access signal: gate, gateRoles, or access', () => {
    for (const m of MODULE_FLOWS) {
      for (const s of m.steps) {
        const resolves = s.gate.length > 0 || (s.gateRoles?.length ?? 0) > 0 || s.access !== undefined;
        expect(resolves, `${m.id} → "${s.label}" has no gate, gateRoles, or access`).toBe(true);
      }
    }
  });

  it('every gateRoles entry is a known default role name', () => {
    const KNOWN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR', 'VIEWER']);
    for (const m of MODULE_FLOWS) {
      for (const s of m.steps) {
        for (const r of s.gateRoles ?? []) expect(KNOWN_ROLES.has(r)).toBe(true);
      }
    }
  });

  it('every access value is one of the four known enum values', () => {
    const KNOWN_ACCESS = new Set(['public', 'authenticated', 'automatic', 'configured']);
    for (const m of MODULE_FLOWS) {
      for (const s of m.steps) {
        if (s.access !== undefined) expect(KNOWN_ACCESS.has(s.access)).toBe(true);
      }
    }
  });
});
