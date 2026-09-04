import { describe, it, expect } from 'vitest';

/**
 * 🔴 The dynamic config PUT persisted the reauth password in PLAINTEXT.
 *
 * `api-client.withReauth()` injects `_currentPassword` into the body so
 * `enforceReauth()` can verify it. `enforceReauth` deletes the field once it has
 * used it — but it only RUNS for defs with `requiresReauth: true`. Config values
 * are free-form JSON written verbatim, so for every def with
 * `requiresReauth: false` the password landed in `system_config.config_value`:
 * readable by any CONFIG_READ holder, returned by the route's own GET, and
 * captured in every backup.
 *
 * Found live on 2026-09-04 in `report-settings` (pre-existing) and reproduced on
 * `filter-approval`. Both rows were cleaned.
 *
 * `configService.updateConfig` has stripped these since 2026-05-25; the DYNAMIC
 * route never went through it. This locks the same rule on the second path.
 *
 * The filter mirrors dynamic-routes.ts exactly: drop every key starting with
 * `_`, keep everything else untouched.
 */
const stripTransportFields = (raw: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
};

describe('dynamic config PUT — transport fields are never persisted', () => {
  it('drops the reauth password', () => {
    const body = {
      workflowEnabled: true, uploadRole: 'SUPERVISOR',
      _currentPassword: 'Admin@123',
    };
    const stored = stripTransportFields(body);
    expect(stored).toEqual({ workflowEnabled: true, uploadRole: 'SUPERVISOR' });
    expect(JSON.stringify(stored)).not.toContain('Admin@123');
  });

  it('drops ANY underscore-prefixed key, not just the password', () => {
    // The rule is about transport fields as a class. A future client that adds
    // `_signatureMeaning` or `_clientOpId` must not silently start persisting it.
    const stored = stripTransportFields({ a: 1, _currentPassword: 'x', _clientOpId: 'y', _anything: 'z' });
    expect(Object.keys(stored)).toEqual(['a']);
  });

  it('leaves a legitimate value that merely CONTAINS an underscore alone', () => {
    // Only the leading underscore marks a transport field; `snake_case` keys and
    // values with underscores are ordinary config.
    const stored = stripTransportFields({ upload_role: 'SUPERVISOR', role: 'SHIFT_OFFICER' });
    expect(stored).toEqual({ upload_role: 'SUPERVISOR', role: 'SHIFT_OFFICER' });
  });

  it('an empty or absent body is not an error', () => {
    expect(stripTransportFields({})).toEqual({});
    expect(stripTransportFields(undefined as any)).toEqual({});
  });

  it('a config that is ONLY transport fields stores nothing, rather than the password', () => {
    expect(stripTransportFields({ _currentPassword: 'Admin@123' })).toEqual({});
  });
});
