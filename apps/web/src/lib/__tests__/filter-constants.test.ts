/**
 * The stage tables are separate exports per design system (desktop / tablet /
 * profile editor) — their keys, order and Block requirement must never drift
 * apart, or one page offers a stage the others do not.
 */
import { describe, it, expect } from 'vitest';
import {
  CLEANING_STAGES_OPS, CLEANING_STAGES_MOBILE, CLEANING_STAGES_EDITOR,
  STATUS_STAGE_OPTIONS, LIFECYCLE_CYCLE_COMPLETED, FILTER_STATE_COLORS,
} from '../filter-constants';

const SIX = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'];

describe('filter-constants', () => {
  it('desktop, tablet and editor list the same six stages in pipeline order', () => {
    expect(CLEANING_STAGES_OPS.map((s) => s.key)).toEqual(SIX);
    expect(CLEANING_STAGES_MOBILE.map((s) => s.key)).toEqual(SIX);
    expect(CLEANING_STAGES_EDITOR.map((s) => s.key)).toEqual(SIX);
  });

  it('labels agree across all three tables', () => {
    const ops = CLEANING_STAGES_OPS.map((s) => s.label);
    expect(CLEANING_STAGES_MOBILE.map((s) => s.label)).toEqual(ops);
    expect(CLEANING_STAGES_EDITOR.map((s) => s.name)).toEqual(ops);
  });

  it('only Wash In and Dry In ask for the cleaning Block, on desktop and tablet alike', () => {
    const needs = (t: { key: string; needsBlock: boolean }[]) => t.filter((s) => s.needsBlock).map((s) => s.key);
    expect(needs(CLEANING_STAGES_OPS)).toEqual(['WASH_IN', 'DRY_IN']);
    expect(needs(CLEANING_STAGES_MOBILE)).toEqual(['WASH_IN', 'DRY_IN']);
  });

  it('the tablet Status dropdown is All + Completed + every stage, with no Retired option', () => {
    expect(LIFECYCLE_CYCLE_COMPLETED).toBe('CLEANING_CYCLE_COMPLETED');
    expect(STATUS_STAGE_OPTIONS).toEqual([
      { value: 'all', label: 'All' },
      { value: 'CLEANING_CYCLE_COMPLETED', label: 'Completed' },
      ...CLEANING_STAGES_MOBILE.map((s) => ({ value: s.key, label: s.label })),
    ]);
    expect(STATUS_STAGE_OPTIONS.some((o) => /retired/i.test(o.label))).toBe(false);
  });

  it('every stage and the completed state have a status colour', () => {
    for (const k of [...SIX, LIFECYCLE_CYCLE_COMPLETED, 'RETIRED']) expect(FILTER_STATE_COLORS[k]).toMatch(/^bg-[a-z]+-\d{3}$/);
  });
});
