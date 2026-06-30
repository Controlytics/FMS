import { describe, it, expect } from 'vitest';
import {
  PERMISSION_TREE,
  deriveFeaturePrivileges,
  deriveFeatureToPermissionMap,
  deriveSidebarPrivilegeMap,
  resolveNodePermissions,
} from './permission-tree.js';
import { PERMISSIONS } from './permissions.js';
import { REAUTH_ACTIONS } from './reauth-actions.js';
import { FEATURE_PRIVILEGES, FEATURE_TO_PERMISSION_MAP } from './feature-privileges.js';
import { SIDEBAR_PRIVILEGE_MAP } from './sidebar-privilege-map.js';

describe('PERMISSION_TREE well-formedness', () => {
  const allNodes = PERMISSION_TREE.flatMap(g => g.nodes);

  it('has unique node ids', () => {
    const ids = allNodes.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every node id is dotted lowercase (page.action)', () => {
    for (const n of allNodes) {
      expect(n.id).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
    }
  });

  it('every permission referenced exists in PERMISSIONS', () => {
    const valid = new Set(Object.values(PERMISSIONS));
    for (const n of allNodes) {
      for (const p of n.permissions) {
        expect(valid.has(p as any), `${n.id} → ${p}`).toBe(true);
      }
    }
  });

  it('every reauthAction (when set) exists in REAUTH_ACTIONS', () => {
    const valid = new Set(Object.keys(REAUTH_ACTIONS));
    for (const n of allNodes) {
      if (n.reauthAction) {
        expect(valid.has(n.reauthAction), `${n.id} → ${n.reauthAction}`).toBe(true);
      }
    }
  });

  it('every node has a valid enforce tag', () => {
    for (const n of allNodes) {
      expect(['a', 'b', 'c']).toContain(n.enforce);
    }
  });
});

describe('deriveFeaturePrivileges parity (Task 1.2)', () => {
  it('reproduces FEATURE_PRIVILEGES exactly (same entries, same order)', () => {
    expect(deriveFeaturePrivileges()).toEqual(FEATURE_PRIVILEGES);
  });
});

describe('deriveFeatureToPermissionMap parity (Task 1.3)', () => {
  it('reproduces FEATURE_TO_PERMISSION_MAP exactly', () => {
    expect(deriveFeatureToPermissionMap()).toEqual(FEATURE_TO_PERMISSION_MAP);
  });
});

// Task 1.4 — BLOCKED (expected to FAIL).
// The SIDEBAR_PRIVILEGE_MAP oracle places the same FP id in multiple sections
// (e.g. assets.view in filter-list, filter-retirements, rfid-track-record,
// filter-replacements; filters.operate in filter-list AND filter-operations).
// The well-formedness constraint (unique node ids) prevents the tree from
// representing this many-to-many relationship, so the derivation cannot
// reproduce the oracle. The test is recorded here to document the gap.
describe('deriveSidebarPrivilegeMap parity (Task 1.4) — BLOCKED', () => {
  it('reproduces SIDEBAR_PRIVILEGE_MAP exactly [EXPECTED FAIL — structural contradiction]', () => {
    expect(deriveSidebarPrivilegeMap()).toEqual(SIDEBAR_PRIVILEGE_MAP);
  });
});

// Task 1.5 — resolveNodePermissions
// Note: the plan sample showed resolveNodePermissions('users.delete') → ['USER_DELETE']
// which contradicts FEATURE_TO_PERMISSION_MAP (oracle: ['USER_DELETE','USER_READ']).
// "The oracle always wins" — test uses the oracle-correct value.
describe('resolveNodePermissions (Task 1.5)', () => {
  it('returns the permissions array for a known FP node (oracle-correct)', () => {
    expect(resolveNodePermissions('users.delete')).toEqual(['USER_DELETE', 'USER_READ']);
  });

  it('returns [] for an unknown node id (default-deny)', () => {
    expect(resolveNodePermissions('totally.unknown')).toEqual([]);
  });

  it('returns [] for an enforced-only node with empty permissions', () => {
    // audit.redact has permissions: [] in the tree (enforces via reauth, no perm gate)
    expect(resolveNodePermissions('audit.redact')).toEqual([]);
  });
});
