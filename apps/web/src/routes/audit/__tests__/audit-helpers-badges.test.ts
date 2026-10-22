import { describe, it, expect } from 'vitest';
import { getDefaultTemplates } from '@digilog/shared';
import { formatActionLabel, friendlyTargetType, getAuditSummary, maskAuditValue, prettyFieldName } from '../audit-helpers';

/**
 * Badge labels and summary paths not reached by audit-helpers.test.ts: the
 * per-kind asset / identifier badge overrides, the "_SELF" template variants
 * (an operator editing their own account), and the target-type fallbacks.
 */

const T = getDefaultTemplates();

describe('formatActionLabel — badge overrides', () => {
  it('identifier rows name the identifier type, from after or (on delete) before', () => {
    expect(formatActionLabel('ASSET_IDENTIFIER_CREATED', { identifierType: 'RFID' })).toBe('RFID Added');
    expect(formatActionLabel('ASSET_IDENTIFIER_CREATED', {})).toBe('Identifier Added');
    expect(formatActionLabel('ASSET_IDENTIFIER_DELETED', undefined, { identifierType: 'QR' })).toBe('QR Removed');
    expect(formatActionLabel('ASSET_IDENTIFIER_DELETED', { identifierType: 'BARCODE' })).toBe('BARCODE Removed');
    expect(formatActionLabel('ASSET_IDENTIFIER_DELETED')).toBe('Identifier Removed');
  });

  it('asset lifecycle badges name the Block / Area / AHU / Filter kind, else "Record"', () => {
    expect(formatActionLabel('ASSET_UPDATED', { templateKind: 'AHU' })).toBe('AHU Updated');
    expect(formatActionLabel('ASSET_UPDATED', { kind: 'FILTER' })).toBe('Filter Updated');
    expect(formatActionLabel('ASSET_UPDATED', {})).toBe('Record Updated');
    expect(formatActionLabel('ASSET_STATUS_CHANGED', {}, { templateKind: 'BLOCK' })).toBe('Block Status Changed');
    expect(formatActionLabel('ASSET_STATUS_CHANGED', { kind: 'AREA' })).toBe('Area Status Changed');
    expect(formatActionLabel('ASSET_STATUS_CHANGED')).toBe('Record Status Changed');
    expect(formatActionLabel('ASSET_DELETED', {}, { templateKind: 'FILTER' })).toBe('Filter Deactivated');
    expect(formatActionLabel('ASSET_DELETED', { kind: 'AHU' })).toBe('AHU Deactivated');
    expect(formatActionLabel('ASSET_DELETED')).toBe('Record Deactivated');
    expect(formatActionLabel('ASSET_RELATIONSHIP_CREATED')).toBe('Placed Under Parent');
    expect(formatActionLabel('ASSET_RELATIONSHIP_DELETED')).toBe('Removed From Parent');
  });

  it('an unknown action is title-cased', () => {
    expect(formatActionLabel('PM_TASK_SKIPPED')).toBe('Pm Task Skipped');
  });
});

describe('getAuditSummary — self variants', () => {
  it('a user editing their own account reads as a self-update', () => {
    expect(getAuditSummary({ action: 'USER_UPDATED', userId: '101010', afterValue: { username: '101010' } }, T))
      .toBe('User "101010" updated their own account');
  });

  it('PROFILE_UPDATED and PASSWORD_CHANGED by the account holder use their _SELF templates', () => {
    const profile = getAuditSummary({ action: 'PROFILE_UPDATED', userId: 'op1', targetId: 'op1' }, T);
    const pwd = getAuditSummary({ action: 'PASSWORD_CHANGED', userId: 'op1', beforeValue: { username: 'op1' } }, T);
    expect(profile).toBe(T.PROFILE_UPDATED_SELF.replace('{actor}', 'op1'));
    expect(pwd).toBe(T.PASSWORD_CHANGED_SELF.replace('{actor}', 'op1'));
  });

  it('with no _SELF template configured, the ordinary template is used', () => {
    const { USER_UPDATED_SELF: _drop, ...noSelf } = T;
    expect(getAuditSummary({ action: 'USER_UPDATED', userId: '101010', afterValue: { username: '101010' } }, noSelf))
      .toBe('User "101010" updated by 101010');
  });

  it('a row with no actor is attributed to System', () => {
    expect(getAuditSummary({ action: 'NIGHTLY_TICK' }, T)).toBe('nightly tick by System');
  });
});

describe('friendlyTargetType + field helpers', () => {
  it('asset rows name their kind, falling back to the before side, then "Record"; missing type reads "-"', () => {
    expect(friendlyTargetType({ targetType: 'asset_instance', afterValue: { templateKind: 'AHU' } })).toBe('AHU');
    expect(friendlyTargetType({ targetType: 'asset_instance', beforeValue: { templateKind: 'BLOCK' } })).toBe('Block');
    expect(friendlyTargetType({ targetType: 'asset_instance' })).toBe('Record');
    expect(friendlyTargetType({ targetType: 'cleaning_profile' })).toBe('Cleaning Profile');
    expect(friendlyTargetType({})).toBe('-');
    expect(friendlyTargetType(null)).toBe('-');
  });

  it('prettyFieldName + maskAuditValue', () => {
    expect(prettyFieldName('userName')).toBe('User ID');
    expect(prettyFieldName('pm_schedule-entry')).toBe('Pm Schedule Entry');
    expect(maskAuditValue('apiKey', 'abc')).toBe('••••••');
    expect(maskAuditValue('count', 0)).toBe('0');
    expect(maskAuditValue('flag', undefined)).toBe('-');
  });
});
