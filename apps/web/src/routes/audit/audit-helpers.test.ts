import { describe, it, expect } from 'vitest';
import { getAuditSummary, formatActionLabel, friendlyTargetType, diffAuditValues, maskAuditValue, prettyFieldName } from './audit-helpers';
import { getDefaultTemplates } from '@digilog/shared';

const T = getDefaultTemplates();

// 2026-07-08: audit rows for Block/Area/AHU/Filter must name the specific kind
// and describe hierarchy links understandably — no "entity"/"asset" jargon.
describe('audit-helpers — Block/Area/AHU/Filter rendering', () => {
  it('names the kind on create (Filter), not "entity"', () => {
    const row = { action: 'ASSET_CREATED', userId: 'EMP-004', targetType: 'asset_instance', afterValue: { name: 'MF3', templateKind: 'FILTER' } };
    expect(getAuditSummary(row, T)).toBe('New Filter "MF3" created by EMP-004');
    expect(formatActionLabel(row.action, row.afterValue)).toBe('Filter Created');
  });

  it('folds the parent into the single create row (created under parent)', () => {
    const row = { action: 'ASSET_CREATED', userId: 'EMP-004', targetType: 'asset_instance',
      afterValue: { name: 'L8', templateKind: 'AHU', parentName: 'B1', parentKind: 'BLOCK' } };
    expect(getAuditSummary(row, T)).toBe('New AHU "L8" created under Block "B1" by EMP-004');
  });

  it('omits the parent clause when there is no parent', () => {
    const row = { action: 'ASSET_CREATED', userId: 'EMP-004', targetType: 'asset_instance', afterValue: { name: 'B1', templateKind: 'BLOCK' } };
    expect(getAuditSummary(row, T)).toBe('New Block "B1" created by EMP-004');
  });

  it('names Block / AHU too', () => {
    const block = { action: 'ASSET_CREATED', userId: 'EMP-004', targetType: 'asset_instance', afterValue: { name: 'B1', templateKind: 'BLOCK' } };
    expect(getAuditSummary(block, T)).toBe('New Block "B1" created by EMP-004');
    const ahu = { action: 'ASSET_CREATED', userId: 'EMP-004', targetType: 'asset_instance', afterValue: { name: 'L8', templateKind: 'AHU' } };
    expect(getAuditSummary(ahu, T)).toBe('New AHU "L8" created by EMP-004');
  });

  it('renders a hierarchy link as "child placed under parent" with kinds', () => {
    const row = { action: 'ASSET_RELATIONSHIP_CREATED', userId: 'EMP-004', targetType: 'asset_relationship',
      afterValue: { sourceName: 'L8', sourceKind: 'AHU', name: 'MF3', targetKind: 'FILTER' } };
    expect(getAuditSummary(row, T)).toBe('Filter "MF3" placed under AHU "L8" by EMP-004');
    expect(formatActionLabel(row.action, row.afterValue)).toBe('Placed Under Parent');
  });

  it('typed filter rows carrying `kind` (not templateKind) still resolve to Filter', () => {
    const row = { action: 'ASSET_CREATED', userId: 'EMP-004', targetType: 'asset_instance', afterValue: { name: 'MF3', kind: 'FILTER' } };
    expect(getAuditSummary(row, T)).toBe('New Filter "MF3" created by EMP-004');
  });

  it('falls back gracefully for old rows without a kind — no entity/asset words', () => {
    const row = { action: 'ASSET_CREATED', userId: 'EMP-004', targetType: 'asset_instance', afterValue: { name: 'MF3' } };
    const s = getAuditSummary(row, T);
    expect(s).toBe('New record "MF3" created by EMP-004');
    expect(s).not.toMatch(/entity|asset/i);
  });

  it('friendlyTargetType avoids internal "asset" words', () => {
    expect(friendlyTargetType({ targetType: 'asset_instance', afterValue: { templateKind: 'BLOCK' } })).toBe('Block');
    expect(friendlyTargetType({ targetType: 'asset_instance', afterValue: {} })).toBe('Record');
    expect(friendlyTargetType({ targetType: 'asset_relationship' })).toBe('Hierarchy Link');
  });
});
describe('audit-helpers — before/after diff', () => {
  it('returns only the fields that changed, old → new', () => {
    expect(diffAuditValues({ name: 'A', filterSize: '10' }, { name: 'A', filterSize: '12' }))
      .toEqual([{ field: 'Filter Size', from: '10', to: '12' }]);
  });

  it('returns empty when nothing changed', () => {
    expect(diffAuditValues({ name: 'A' }, { name: 'A' })).toEqual([]);
  });

  it('masks sensitive values', () => {
    expect(diffAuditValues({ password: 'old' }, { password: 'new' }))
      .toEqual([{ field: 'Password', from: '••••••', to: '••••••' }]);
  });

  it('skips id / uuid-valued keys', () => {
    const before = { userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'A' };
    const after = { userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'B' };
    expect(diffAuditValues(before, after)).toEqual([{ field: 'Name', from: 'A', to: 'B' }]);
  });

  it('maskAuditValue handles null and objects', () => {
    expect(maskAuditValue('name', null)).toBe('-');
    expect(maskAuditValue('meta', { a: 1 })).toBe('{"a":1}');
    expect(prettyFieldName('current_lifecycle_state')).toBe('Current Lifecycle State');
  });

  it('skips camelCase *Id keys even when the value is not a UUID', () => {
    // filterId is a non-UUID (numeric) id — must be skipped by key name, not just value.
    expect(diffAuditValues({ filterId: 5, name: 'A' }, { filterId: 6, name: 'A' })).toEqual([]);
    expect(diffAuditValues({ blockId: 'X1', name: 'A' }, { blockId: 'X2', name: 'B' }))
      .toEqual([{ field: 'Name', from: 'A', to: 'B' }]);
  });

  it('flattens object-valued fields one level (attributes → per-field)', () => {
    expect(diffAuditValues({ attributes: { micronSize: '3', filterSize: '10' } },
                           { attributes: { micronSize: '5', filterSize: '10' } }))
      .toEqual([{ field: 'Micron Size', from: '3', to: '5' }]);
  });
});
