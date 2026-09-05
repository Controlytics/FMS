import { describe, it, expect } from 'vitest';
import { planRfidEventEdit, decideLiveTag, payloadOf, type RfidEventRow } from '../rfid-event-edit.js';

const assignRow: RfidEventRow = {
  id: 'row-1', action: 'ASSET_IDENTIFIER_CREATED', timestamp: new Date('2026-09-01T10:00:00Z'),
  userId: 'u1', userName: 'op1', reason: null,
  beforeValue: null,
  afterValue: { id: 'ident-1', assetId: 'f1', identifierType: 'RFID', identifierValue: 'CA0001', isPrimary: true, filterName: 'F-1' },
};
const removeRow: RfidEventRow = {
  id: 'row-2', action: 'ASSET_IDENTIFIER_DELETED', timestamp: new Date('2026-09-02T10:00:00Z'),
  userId: 'u1', userName: 'op1', reason: 'damaged',
  beforeValue: { assetId: 'f1', identifierType: 'RFID', identifierValue: 'CA0001', filterName: 'F-1' },
  afterValue: { deleted: true },
};

describe('planRfidEventEdit', () => {
  it('reads the payload from afterValue on an Assigned row and beforeValue on a Removed row', () => {
    expect(payloadOf(assignRow).identifierValue).toBe('CA0001');
    expect(payloadOf(removeRow).identifierValue).toBe('CA0001');
  });

  it('keeps every stored key and overwrites only what changed', () => {
    const plan = planRfidEventEdit(assignRow, { rfidNumber: ' CA0002 ', filterId: 'f2', filterName: 'F-2', remarks: 'typo' });
    expect(plan.data.action).toBe('ASSET_IDENTIFIER_CREATED');
    expect(plan.data.afterValue).toMatchObject({ id: 'ident-1', isPrimary: true, identifierValue: 'CA0002', assetId: 'f2', filterName: 'F-2' });
    expect(plan.data.beforeValue).toBeNull();
    expect(plan.data.reason).toBe('typo');
    expect(plan.data.userName).toBe('op1'); // untouched
    expect(plan).toMatchObject({ oldValue: 'CA0001', newValue: 'CA0002', oldAssetId: 'f1', newAssetId: 'f2' });
  });

  it('flipping Assigned -> Removed moves the payload to beforeValue and marks afterValue deleted', () => {
    const plan = planRfidEventEdit(assignRow, { event: 'REMOVE' });
    expect(plan.data.action).toBe('ASSET_IDENTIFIER_DELETED');
    expect(plan.data.beforeValue).toMatchObject({ identifierValue: 'CA0001', assetId: 'f1' });
    expect(plan.data.afterValue).toEqual({ deleted: true });
  });

  it('flipping Removed -> Assigned moves the payload to afterValue', () => {
    const plan = planRfidEventEdit(removeRow, { event: 'ASSIGN' });
    expect(plan.data.action).toBe('ASSET_IDENTIFIER_CREATED');
    expect(plan.data.afterValue).toMatchObject({ identifierValue: 'CA0001', assetId: 'f1' });
    expect(plan.data.beforeValue).toBeNull();
  });

  it('an empty remarks clears the reason; an omitted one keeps it', () => {
    expect(planRfidEventEdit(removeRow, { remarks: '' }).data.reason).toBeNull();
    expect(planRfidEventEdit(removeRow, {}).data.reason).toBe('damaged');
  });

  it('a blank rfidNumber falls back to the stored value', () => {
    expect(planRfidEventEdit(assignRow, { rfidNumber: '   ' }).newValue).toBe('CA0001');
  });
});

describe('decideLiveTag', () => {
  const base = { latestForNew: true, latestForOld: true, existingByOld: null, existingByNew: null, targetOtherTag: null };

  it('never touches the live tag when a later event describes the tag', () => {
    const plan = planRfidEventEdit(assignRow, { rfidNumber: 'CA0002' });
    const r = decideLiveTag(plan, { ...base, latestForNew: false, existingByNew: { id: 'x', assetId: 'f9' } });
    expect(r.kind).toBe('none');
  });

  it('renames the live row when the latest Assigned row gets a new number', () => {
    const plan = planRfidEventEdit(assignRow, { rfidNumber: 'CA0002' });
    const r = decideLiveTag(plan, { ...base, existingByOld: { id: 'ident-1', assetId: 'f1' } });
    expect(r).toMatchObject({ kind: 'update', identifierId: 'ident-1', identifierValue: 'CA0002', assetId: 'f1' });
  });

  it('moves the live row to the new filter when only the filter changes', () => {
    const plan = planRfidEventEdit(assignRow, { filterId: 'f2' });
    // Same number: the route passes the same live row as existingByOld and existingByNew.
    const r = decideLiveTag(plan, { ...base, existingByOld: { id: 'ident-1', assetId: 'f1' }, existingByNew: { id: 'ident-1', assetId: 'f1' } });
    expect(r).toMatchObject({ kind: 'update', identifierId: 'ident-1', assetId: 'f2' });
  });

  it('creates the live row when the latest event is Assigned but no live row exists', () => {
    const plan = planRfidEventEdit(removeRow, { event: 'ASSIGN' });
    expect(decideLiveTag(plan, base)).toMatchObject({ kind: 'create', identifierValue: 'CA0001', assetId: 'f1' });
  });

  it('refuses when the number is live on another filter', () => {
    const plan = planRfidEventEdit(assignRow, { rfidNumber: 'CA0002' });
    expect(() => decideLiveTag(plan, { ...base, existingByNew: { id: 'z', assetId: 'other' } })).toThrow(/live on another filter/);
  });

  it('refuses when the target filter already carries a different tag', () => {
    const plan = planRfidEventEdit(assignRow, { filterId: 'f2' });
    expect(() => decideLiveTag(plan, { ...base, targetOtherTag: { id: 't', identifierValue: 'CA0099' }, targetFilterName: 'F-2' })).toThrow(/already has tag CA0099/);
  });

  it('deletes the live row when the latest event becomes Removed', () => {
    const plan = planRfidEventEdit(assignRow, { event: 'REMOVE' });
    const r = decideLiveTag(plan, { ...base, existingByNew: { id: 'ident-1', assetId: 'f1' } });
    expect(r).toMatchObject({ kind: 'delete', identifierIds: ['ident-1'] });
  });

  it('a Removed edit with no live row is a no-op', () => {
    const plan = planRfidEventEdit(removeRow, { remarks: 'x' });
    expect(decideLiveTag(plan, base).kind).toBe('none');
  });
});
