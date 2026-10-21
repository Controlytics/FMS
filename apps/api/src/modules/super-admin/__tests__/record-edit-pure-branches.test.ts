import { describe, it, expect } from 'vitest';
import { planRfidEventEdit, decideLiveTag, payloadOf, type RfidEventRow } from '../rfid-event-edit.js';
import { sanitizeSnapshot } from '../manual-change.js';

/**
 * Branches of the pure SUPER_ADMIN record-edit helpers that the e2e suite
 * cannot reach without contriving database states (2026-10-21 coverage pass).
 */

const assignRow = (value: string, assetId: string | null): RfidEventRow => ({
  id: 'row', action: 'ASSET_IDENTIFIER_CREATED', timestamp: new Date('2026-09-01T00:00:00Z'),
  userId: 'u', userName: 'op', reason: null, beforeValue: null,
  afterValue: { identifierType: 'RFID', identifierValue: value, assetId },
});

describe('payloadOf', () => {
  it('treats a non-object payload side as empty', () => {
    expect(payloadOf({ action: 'ASSET_IDENTIFIER_CREATED', beforeValue: null, afterValue: 'corrupt' })).toEqual({});
    expect(payloadOf({ action: 'ASSET_IDENTIFIER_DELETED', beforeValue: null, afterValue: { deleted: true } })).toEqual({});
  });
});

describe('decideLiveTag — remaining branches', () => {
  it('names "The target filter" when the target filter name is unknown', () => {
    const plan = planRfidEventEdit(assignRow('CA1', 'f1'), { filterId: 'f2' });
    expect(() => decideLiveTag(plan, {
      latestForNew: true, latestForOld: true, existingByOld: { id: 'i1', assetId: 'f1' }, existingByNew: { id: 'i1', assetId: 'f1' },
      targetOtherTag: { id: 'i9', identifierValue: 'ZZ9' }, targetFilterName: null,
    })).toThrow('The target filter already has tag ZZ9 - remove it first.');
  });

  it('a renamed Removed row clears BOTH the old and the new live number when this row owns both', () => {
    const removeRow: RfidEventRow = {
      id: 'r', action: 'ASSET_IDENTIFIER_DELETED', timestamp: new Date(), userId: null, userName: null, reason: null,
      beforeValue: { identifierValue: 'OLD1', assetId: 'f1' }, afterValue: { deleted: true },
    };
    const plan = planRfidEventEdit(removeRow, { rfidNumber: 'NEW1' });
    const out = decideLiveTag(plan, {
      latestForNew: true, latestForOld: true,
      existingByNew: { id: 'iNew', assetId: 'f1' }, existingByOld: { id: 'iOld', assetId: 'f1' }, targetOtherTag: null,
    });
    expect(out).toEqual({ kind: 'delete', identifierIds: ['iNew', 'iOld'], note: 'Live tag removed to match the edited record.' });

    // Same live row on both sides is only deleted once.
    const same = decideLiveTag(plan, {
      latestForNew: true, latestForOld: true,
      existingByNew: { id: 'iSame', assetId: 'f1' }, existingByOld: { id: 'iSame', assetId: 'f1' }, targetOtherTag: null,
    });
    expect(same).toMatchObject({ kind: 'delete', identifierIds: ['iSame'] });

    // Old number already re-used by a later event: only the new number is cleared.
    const laterOld = decideLiveTag(plan, {
      latestForNew: true, latestForOld: false,
      existingByNew: { id: 'iNew', assetId: 'f1' }, existingByOld: { id: 'iOld', assetId: 'f1' }, targetOtherTag: null,
    });
    expect(laterOld).toMatchObject({ kind: 'delete', identifierIds: ['iNew'] });
  });
});

describe('planRfidEventEdit — the corrected number is stored in canonical form (A-11)', () => {
  // lib/rfid-canonical.ts is the one rule every RFID write follows since 10-19:
  // trimmed, upper-case, a doubled / tripled EPC read collapsed to one.
  it('upper-cases and trims', () => {
    const plan = planRfidEventEdit(assignRow('CA1', 'f1'), { rfidNumber: '  e2801160abc  ' });
    expect(plan.newValue).toBe('E2801160ABC');
    expect((plan.data.afterValue as any).identifierValue).toBe('E2801160ABC');
  });
  it('collapses a doubled and a tripled read', () => {
    expect(planRfidEventEdit(assignRow('CA1', 'f1'), { rfidNumber: 'e2801160e2801160' }).newValue).toBe('E2801160');
    expect(planRfidEventEdit(assignRow('CA1', 'f1'), { rfidNumber: 'ABC123ABC123ABC123' }).newValue).toBe('ABC123');
  });
  it('a Removed row keeps the canonical value on its payload side', () => {
    const removeRow = { ...assignRow('CA1', 'f1'), action: 'ASSET_IDENTIFIER_DELETED', beforeValue: { identifierValue: 'CA1', assetId: 'f1' }, afterValue: { deleted: true } };
    expect((planRfidEventEdit(removeRow, { rfidNumber: 'ca2' }).data.beforeValue as any).identifierValue).toBe('CA2');
  });
});

describe('sanitizeSnapshot', () => {
  it('turns BigInt into a string and Dates into ISO strings so any row can be audited', () => {
    const out = sanitizeSnapshot({ chainPosition: 12345678901234567890n, at: new Date('2026-01-01T00:00:00Z'), nested: { n: 1n } });
    expect(out).toEqual({ chainPosition: '12345678901234567890', at: '2026-01-01T00:00:00.000Z', nested: { n: '1' } });
  });
});
