import { describe, it, expect } from 'vitest';
import { deriveRolesForGate, DEFAULT_ROLE_PERMISSIONS, ROLE_META } from '../role-gates';
// Cross-workspace drift guard: the embedded map MUST match the real seed source.
import { defaultRoles } from '../../../../../api/prisma/default-roles';

describe('deriveRolesForGate', () => {
  it('returns roles that hold the gate, in hierarchy order', () => {
    // FILTER_OPERATE is held by all 5 operational roles (not VIEWER).
    expect(deriveRolesForGate(['FILTER_OPERATE'])).toEqual([
      'SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR',
    ]);
  });

  it('FILTER_BYPASS is admin-only', () => {
    expect(deriveRolesForGate(['FILTER_BYPASS'])).toEqual(['SUPER_ADMIN', 'ADMIN']);
  });

  it('STAGE_APPROVAL_DECIDE includes supervisor', () => {
    expect(deriveRolesForGate(['STAGE_APPROVAL_DECIDE'])).toEqual([
      'SUPER_ADMIN', 'ADMIN', 'SUPERVISOR',
    ]);
  });

  it('unions across multiple gate permissions without duplicates', () => {
    const r = deriveRolesForGate(['FILTER_BYPASS', 'FILTER_OPERATE']);
    expect(r).toEqual(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR']);
  });

  it('empty gate → empty list', () => {
    expect(deriveRolesForGate([])).toEqual([]);
  });
});

describe('DEFAULT_ROLE_PERMISSIONS drift guard', () => {
  it('matches apps/api/prisma/default-roles.ts exactly', () => {
    for (const role of defaultRoles) {
      expect(new Set(DEFAULT_ROLE_PERMISSIONS[role.name])).toEqual(new Set(role.permissions));
    }
    expect(Object.keys(DEFAULT_ROLE_PERMISSIONS).sort()).toEqual(
      defaultRoles.map((r) => r.name).sort(),
    );
  });
});

describe('ROLE_META', () => {
  it('lists all six roles in hierarchy order', () => {
    expect(ROLE_META.map((m) => m.name)).toEqual([
      'SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR', 'VIEWER',
    ]);
  });
});
