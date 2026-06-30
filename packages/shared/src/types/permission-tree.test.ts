import { describe, it, expect } from 'vitest';
import { PERMISSION_TREE, deriveFeaturePrivileges, deriveFeatureToPermissionMap } from './permission-tree.js';
import { PERMISSIONS } from './permissions.js';
import { REAUTH_ACTIONS } from './reauth-actions.js';
import { FEATURE_PRIVILEGES, FEATURE_TO_PERMISSION_MAP } from './feature-privileges.js';

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
