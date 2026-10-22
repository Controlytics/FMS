/**
 * A-01 — advanceMustCarryChecklist: the ONE rule for "the advance into this stage
 * must carry its checklist in the same call" (server advance() refuses a bare
 * advance exactly then; the web batch asks the checklist first by it).
 */
import { describe, expect, it } from 'vitest';
import { advanceMustCarryChecklist } from '../transitions.js';

const final = { nextStages: [], leadsToEnd: true, pendingChecklistProfileIds: ['cl1'] };

describe('advanceMustCarryChecklist', () => {
  it('the last stage with an enabled checklist after it → yes', () => {
    expect(advanceMustCarryChecklist(final)).toBe(true);
    expect(advanceMustCarryChecklist({ ...final, interlockGated: false })).toBe(true);
  });

  it('a mid-pipeline stage (another stage follows) → no, a bare advance is allowed there', () => {
    expect(advanceMustCarryChecklist({ ...final, nextStages: ['STORAGE_OUT'] })).toBe(false);
    expect(advanceMustCarryChecklist({ ...final, leadsToEnd: false, nextStages: ['STORAGE_OUT'] })).toBe(false);
  });

  it('no checklist, or only a disabled one → no', () => {
    expect(advanceMustCarryChecklist({ ...final, pendingChecklistProfileIds: [] })).toBe(false);
    expect(advanceMustCarryChecklist(final, ['cl1'])).toBe(false);
    expect(advanceMustCarryChecklist({ ...final, pendingChecklistProfileIds: ['cl1', 'cl2'] }, ['cl1'])).toBe(true);
  });

  it('a QA-interlock final stage → no: the bare advance enters it and raises the approval', () => {
    expect(advanceMustCarryChecklist({ ...final, interlockGated: true })).toBe(false);
  });

  it('nothing known about the stage → no (the server decides)', () => {
    expect(advanceMustCarryChecklist(undefined)).toBe(false);
    expect(advanceMustCarryChecklist(null)).toBe(false);
    expect(advanceMustCarryChecklist({ leadsToEnd: true })).toBe(false);
  });
});
