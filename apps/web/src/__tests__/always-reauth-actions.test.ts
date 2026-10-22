/**
 * The policy screens show a row as "Always required" from ALWAYS_REAUTH_ACTIONS
 * (@digilog/shared). That set must be exactly what the API signs with
 * `enforceReauthAlways` — a missing entry leaves an always-on action looking
 * switchable (the operator unticks it and nothing changes), an extra one hides a
 * switch that does work.
 *
 * Read from the API source, every `await enforceReauthAlways(<first arg>, req…`
 * call site, whatever the first argument's form:
 *   - a string literal or an array of them  → every quoted action in it;
 *   - a ternary between literals             → both;
 *   - a variable (no quoted action at all)   → must be a site resolved below,
 *     otherwise the test fails and names it, so a new dynamic gate cannot slip by.
 */
import { describe, it, expect } from 'vitest';
import { resolve, relative } from 'node:path';
import { REAUTH_ACTIONS, ALWAYS_REAUTH_ACTIONS, isAlwaysReauth } from '@digilog/shared';
import { listFiles, readSource } from '@/__tests__/support/source-files';

const API_SRC = resolve(__dirname, '../../../api/src');

/** config/routes.ts: `enforceReauthAlways(actionKey ?? …)` for every `configEndpoint(key, schema, true…)`. */
function configRoutesActions(): string[] {
  const cfg = readSource(resolve(API_SRC, 'modules/config/routes.ts'));
  const map = Object.fromEntries(
    [...cfg.match(/CONFIG_KEY_TO_ACTION[^{]*\{([^}]*)\}/)![1].matchAll(/'([a-z-]+)':\s*'([A-Z_]+)'/g)].map((m) => [m[1], m[2]]),
  );
  return [...cfg.matchAll(/configEndpoint\('([a-z-]+)',\s*\w+,\s*true\b/g)].map((m) => {
    expect(map[m[1]], `config/routes.ts: '${m[1]}' is signed always but has no CONFIG_KEY_TO_ACTION entry`).toBeDefined();
    return map[m[1]];
  });
}
const DYNAMIC_SITES: Record<string, () => string[]> = { 'modules/config/routes.ts': configRoutesActions };
/**
 * Actions an always-on gate names only CONDITIONALLY. admin-requests/routes.ts
 * signs [APPROVE_ADMIN_REQUEST, UPDATE_USER] always only when the approval
 * changes a role; every other decision goes through the policy, so the
 * APPROVE_ADMIN_REQUEST row must stay switchable. (UPDATE_USER is always-on on
 * PUT /api/users/:id anyway.)
 */
const CONDITIONAL: Record<string, string[]> = { 'modules/admin-requests/routes.ts': ['APPROVE_ADMIN_REQUEST'] };

function apiAlwaysActions(): Set<string> {
  const found = new Set<string>();
  const unresolved: string[] = [];
  const files = listFiles(API_SRC, (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'), ['__tests__', 'e2e', 'scripts']);
  for (const f of files) {
    const rel = relative(API_SRC, f).replace(/\\/g, '/');
    for (const call of readSource(f).matchAll(/await enforceReauthAlways\(([\s\S]*?),\s*req\b/g)) {
      const quoted = [...call[1].matchAll(/'([A-Z][A-Z_]+)'/g)].map((m) => m[1])
        .filter((a) => !(CONDITIONAL[rel] ?? []).includes(a));
      if (quoted.length) quoted.forEach((a) => found.add(a));
      else if (DYNAMIC_SITES[rel]) DYNAMIC_SITES[rel]().forEach((a) => found.add(a));
      else unresolved.push(`${rel}: enforceReauthAlways(${call[1].trim()})`);
    }
  }
  expect(unresolved, 'a dynamic enforceReauthAlways call site this guard cannot resolve').toEqual([]);
  return found;
}

describe('ALWAYS_REAUTH_ACTIONS', () => {
  it('is exactly the set of actions the API signs with enforceReauthAlways', () => {
    expect([...ALWAYS_REAUTH_ACTIONS].sort()).toEqual([...apiAlwaysActions()].sort());
  });

  it('names only catalogued actions, so every one has a row on the policy screens', () => {
    expect([...ALWAYS_REAUTH_ACTIONS].filter((a) => !(a in REAUTH_ACTIONS))).toEqual([]);
  });

  it('carries the OD-01 actions (record-destroying, record-rewriting, rule-changing)', () => {
    for (const a of [
      'REDACT_AUDIT_RECORD', 'BULK_REDACT_AUDIT_RECORDS', 'UPDATE_AUDIT_RECORD', 'DELETE_AUDIT_RECORD', 'BULK_DELETE_AUDIT_RECORDS',
      'SUPER_ADMIN_DATA_EDIT', 'DELETE_USER', 'BULK_DELETE_USERS',
      'CREATE_ROLE', 'UPDATE_ROLE', 'DELETE_ROLE', 'UPDATE_ROLE_CONFIG', 'UPDATE_REAUTH_CONFIG',
    ]) expect(isAlwaysReauth(a), a).toBe(true);
    expect(isAlwaysReauth('DELETE_NOTIFICATION')).toBe(false); // operator: notification deletes stay policy-driven
  });

  it('carries the operator-approved OD-01 extras; admin-request decisions stay switchable', () => {
    for (const a of [
      'RESTORE_BACKUP', 'UPDATE_USER', 'UPDATE_USER_CONFIG', 'UPDATE_LDAP_CONFIG',
      'DELETE_ASSET', 'DELETE_FILTER', 'DELETE_HIERARCHY_NODE', 'UPDATE_FILTER_LIFECYCLE',
    ]) expect(isAlwaysReauth(a), a).toBe(true);
    expect(isAlwaysReauth('APPROVE_ADMIN_REQUEST')).toBe(false);
  });
});
