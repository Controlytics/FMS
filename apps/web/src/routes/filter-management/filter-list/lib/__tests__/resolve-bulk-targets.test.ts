import { describe, expect, it } from 'vitest';
import { resolveBulkTargets } from '../resolve-bulk-targets';

// Regression guard for M86: bulk retire/replace/status acted on the RAW selection
// Set while the confirm dialog only listed the search-narrowed filters, so a
// destructive action could hit filters the operator could not see.
describe('resolveBulkTargets', () => {
  const ahu1 = { id: 'f1', name: 'AHU-1/00' };
  const ahu2 = { id: 'f2', name: 'AHU-2/00' };

  it('returns only the selected filters that are currently visible', () => {
    const selected = new Set(['f1', 'f2']);
    expect(resolveBulkTargets(selected, [ahu1, ahu2])).toEqual([ahu1, ahu2]);
  });

  // The core of the bug: select under one search term, then retype another.
  it('EXCLUDES a selected filter that the search box has hidden', () => {
    // Operator searched "AHU-1", selected it, then retyped "AHU-2".
    const selected = new Set(['f1', 'f2']);
    const visibleAfterRetypingSearch = [ahu2];

    const targets = resolveBulkTargets(selected, visibleAfterRetypingSearch);

    expect(targets).toEqual([ahu2]);
    expect(targets.map(f => f.id)).not.toContain('f1');
  });

  it('returns nothing when every selected filter is hidden', () => {
    expect(resolveBulkTargets(new Set(['f1']), [ahu2])).toEqual([]);
  });

  it('ignores visible filters that were never selected', () => {
    expect(resolveBulkTargets(new Set(['f1']), [ahu1, ahu2])).toEqual([ahu1]);
  });

  it('returns nothing for an empty selection', () => {
    expect(resolveBulkTargets(new Set<string>(), [ahu1, ahu2])).toEqual([]);
  });

  // The dialog list, the dialog count and the action all read this one value,
  // so what the operator is told is exactly what gets acted on.
  it('yields a count that matches the acted-on list', () => {
    const targets = resolveBulkTargets(new Set(['f1', 'f2']), [ahu1]);
    expect(targets.length).toBe(1);
    expect(targets).toEqual([ahu1]);
  });
});
