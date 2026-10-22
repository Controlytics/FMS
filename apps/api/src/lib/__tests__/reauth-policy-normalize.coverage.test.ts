/**
 * The stored action-reauth policy as the gate reads it (lib/reauth-check.ts):
 * legacy-shape conversion (BR-086: convert, never disable), the health signal
 * the deployment check shows, and the "known actions only" view the Action
 * Re-auth page edits. The shared `action-reauth` row gates every suite's
 * writes, so the row is supplied at the module's prisma read instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ value: undefined as unknown, findUnique: vi.fn() }));
vi.mock('../prisma.js', () => ({ prisma: { systemConfig: { findUnique: db.findUnique } } }));

import { getActionReauthConfig, getReauthHealth, getEditableActionReauthConfig, invalidateReauthCache, isReauthRequired } from '../reauth-check.js';

beforeEach(() => {
  db.findUnique.mockReset().mockImplementation(async () => (db.value === undefined ? null : { configValue: db.value }));
  invalidateReauthCache();
});

const stdout = () => vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

describe('action-reauth policy normalization', () => {
  it('converts the legacy nested shape and ENFORCES it, merging duplicate actions and skipping malformed entries', async () => {
    const out = stdout();
    db.value = {
      actions: [
        { action: 'DELETE_USER', roles: ['ADMIN'] },
        { action: 'DELETE_USER', roles: ['ADMIN', 'QA'] },
        { action: 'UPDATE_CONFIG_PAGE', roles: ['ADMIN'] },
        { action: 'BAD_ROLES', roles: ['ADMIN', 7] },
        { action: 42, roles: ['ADMIN'] },
        { action: 'NO_ROLES' },
        null,
      ],
    };
    expect(await getActionReauthConfig()).toEqual({ DELETE_USER: ['ADMIN', 'QA'], UPDATE_CONFIG_PAGE: ['ADMIN'] });
    expect(await isReauthRequired('DELETE_USER', 'QA')).toBe(true);
    expect(await getReauthHealth()).toEqual({ actionsConfigured: 2, legacyShape: true, effectivelyDisabled: false });
    const warned = out.mock.calls.map((c) => String(c[0])).join('');
    out.mockRestore();
    expect(warned).toContain('legacy nested shape');

    // The warning is logged once per process, not on every read.
    const again = stdout();
    invalidateReauthCache();
    await getActionReauthConfig();
    const second = again.mock.calls.map((c) => String(c[0])).join('');
    again.mockRestore();
    expect(second).not.toContain('legacy nested shape');
  });

  it('keeps only string-array values from the flat shape', async () => {
    db.value = { A: ['ADMIN'], B: 'ADMIN', C: ['ADMIN', 1], D: [], actions: [] };
    expect(await getActionReauthConfig()).toEqual({ A: ['ADMIN'], D: [], actions: [] });
    expect(await getReauthHealth()).toEqual({ actionsConfigured: 1, legacyShape: false, effectivelyDisabled: false });
  });

  it('a missing, null or non-object row is an empty policy, reported as effectively disabled', async () => {
    for (const v of [undefined, null, 'on', 7]) {
      db.value = v;
      invalidateReauthCache();
      expect(await getActionReauthConfig()).toEqual({});
      expect(await getReauthHealth()).toEqual({ actionsConfigured: 0, legacyShape: false, effectivelyDisabled: true });
    }
  });

  it('the editable view hides actions the code no longer knows', async () => {
    db.value = { DELETE_USER: ['ADMIN'], GENERATE_REPORT: ['ADMIN'], SIGN_REPORT: ['QA'] };
    expect(await getEditableActionReauthConfig(new Set(['DELETE_USER', 'UNUSED']))).toEqual({ DELETE_USER: ['ADMIN'] });
  });
});
