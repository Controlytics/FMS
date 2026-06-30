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

describe('deriveSidebarPrivilegeMap (Task 1.4)', () => {
  it('reproduces SIDEBAR_PRIVILEGE_MAP (per-section, privilegeIds as sets)', () => {
    const derived = deriveSidebarPrivilegeMap();
    const oracle = SIDEBAR_PRIVILEGE_MAP;
    expect(derived.map(s => s.sidebarId).sort())
      .toEqual(oracle.map(s => s.sidebarId).sort());
    for (const o of oracle) {
      const d = derived.find(s => s.sidebarId === o.sidebarId);
      expect(d, `missing section ${o.sidebarId}`).toBeTruthy();
      expect([...d!.privilegeIds].sort(), `privilegeIds ${o.sidebarId}`)
        .toEqual([...o.privilegeIds].sort());
    }
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
