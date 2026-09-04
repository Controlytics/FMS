import { describe, it, expect } from 'vitest';
import { classifyLegacyKeyOrderRow } from '../audit-verify.js';
import { computeChainedChecksum } from '../hash-chain.js';

/**
 * Two REAL rows from the dev audit_trail (2026-09-04 investigation). Their
 * stored checksums only reproduce with the after_value keys in the order the
 * code wrote them ({ username, fullName }); JSONB hands them back as
 * { fullName, username }. The verifier must call that what it is - a pre-cut-over
 * V1 key-order artefact - and not tampering.
 */
const GENESIS = {
  timestamp: '2026-05-15T08:06:58.436Z', checksumVersion: null, previousChecksum: null,
  userId: 'superadmin', action: 'LOGIN_SUCCESS', targetType: 'user', targetId: 'f8e5e6e9-db1b-4f87-99f4-dec13cb1cccb',
  afterValue: { fullName: 'System Administrator', username: 'superadmin' },   // JSONB order
  checksum: '3de48543aaa6fbbf2cba1c0649afab1c1b89138efabeb5db87f1ae29148d5c0d',
};

describe('classifyLegacyKeyOrderRow', () => {
  it('PROVES a real genesis row by restoring the insertion order', () => {
    expect(classifyLegacyKeyOrderRow(GENESIS)).toBe('PROVEN');
  });

  it('PROVES a chained row written the same way', () => {
    const prev = 'a'.repeat(64);
    const written = { timestamp: '2026-05-17T04:35:54.159Z', userId: 'OPP48EPF', action: 'LOGIN_SUCCESS', targetType: 'user', targetId: 'f48ba77f-c0a6-4051-9f62-aa0d23daa04e', afterValue: { username: 'OPP48EPF', fullName: 'Phase 4 OPERATOR User' } };
    const checksum = computeChainedChecksum(written, prev);
    expect(classifyLegacyKeyOrderRow({ ...written, afterValue: { fullName: 'Phase 4 OPERATOR User', username: 'OPP48EPF' }, checksumVersion: null, previousChecksum: prev, checksum })).toBe('PROVEN');
  });

  it('is null (= real mismatch) for a row written AFTER the cut-over', () => {
    expect(classifyLegacyKeyOrderRow({ ...GENESIS, timestamp: '2026-06-01T00:00:00.000Z' })).toBeNull();
  });

  it('is null for a keyed (v3) row, whatever its date', () => {
    expect(classifyLegacyKeyOrderRow({ ...GENESIS, checksumVersion: 3 })).toBeNull();
  });

  it('is null when the payload has fewer than two keys (nothing JSONB could re-order)', () => {
    expect(classifyLegacyKeyOrderRow({ ...GENESIS, afterValue: { username: 'superadmin' } })).toBeNull();
  });

  it('is null when a small payload matches under NO key order (a real edit stays tampering)', () => {
    expect(classifyLegacyKeyOrderRow({ ...GENESIS, afterValue: { fullName: 'Someone Else', username: 'superadmin' } })).toBeNull();
  });

  it('UNVERIFIABLE when the payload is too large to prove by permutation', () => {
    const big: Record<string, string> = {}; for (let i = 0; i < 9; i++) big['k' + i] = 'v' + i;
    expect(classifyLegacyKeyOrderRow({ ...GENESIS, afterValue: big })).toBe('UNVERIFIABLE');
  });
});
