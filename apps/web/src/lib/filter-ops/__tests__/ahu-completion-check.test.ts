import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression tests for the AHU-completion error-handling fix (2026-07-09 QA).
 *
 * Previously both helpers swallowed every error to a "proceed" default, so a
 * transient 500/timeout on the completion-status endpoint silently defeated the
 * INTERLOCK gate (empty ahus read as "all siblings done"). The helpers now
 * distinguish a real failure (`failed: true`) from a legitimate empty result,
 * and log instead of swallowing silently.
 */

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import {
  checkAhuCompletionBatch,
  checkAhuHasBothSets,
  isTerminalChecklist,
  isCompletingAdvance,
  isTerminalTargetWithChecklist,
} from '../ahu-completion-check';
import { apiClient } from '@/lib/api-client';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('checkAhuCompletionBatch', () => {
  it('returns failed:false with the AHUs on success', async () => {
    (apiClient.post as any).mockResolvedValue({ ahus: [{ ahuId: 'a', ahuName: 'AHU-1', allAtFinal: false, filters: [] }] });
    const r = await checkAhuCompletionBatch('INTERLOCK', ['f1'], true);
    expect(r.failed).toBe(false);
    expect(r.ahus).toHaveLength(1);
  });

  it('returns failed:true (not a silent empty) and logs when the call errors', async () => {
    (apiClient.post as any).mockRejectedValue(new Error('500'));
    const r = await checkAhuCompletionBatch('INTERLOCK', ['f1'], true);
    expect(r.failed).toBe(true);
    expect(r.ahus).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it('short-circuits NONE and INTERLOCK-offline as a legitimate (non-failed) no-op', async () => {
    expect(await checkAhuCompletionBatch('NONE', ['f1'], true)).toEqual({ ahus: [], failed: false });
    expect(await checkAhuCompletionBatch('INTERLOCK', ['f1'], false)).toEqual({ ahus: [], failed: false });
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

/**
 * 2026-08-10 regression: the AHU popup was wired ONLY to the terminal-checklist
 * open, so pipelines ending `… → STORAGE_OUT → END` (no checklist) never fired
 * it — the reported "popup didn't come at Storage Out". `isCompletingAdvance`
 * covers that path. The critical property is that the two predicates are
 * MUTUALLY EXCLUSIVE for the same stage, so a checklist-terminated pipeline
 * still warns exactly once (at checklist-open) and never twice.
 */
describe('isCompletingAdvance / isTerminalChecklist — disjoint coverage', () => {
  // `… → STORAGE_OUT → END`: the advance itself completes the cycle.
  const noChecklist = {
    STORAGE_IN: { nextStages: ['STORAGE_OUT'], leadsToEnd: false, pendingChecklistProfileIds: [] },
    STORAGE_OUT: { nextStages: [], leadsToEnd: true, pendingChecklistProfileIds: [] },
  };
  // `… → STORAGE_OUT → CHECKLIST → END`: the checklist submit completes it.
  const withChecklist = {
    STORAGE_IN: { nextStages: ['STORAGE_OUT'], leadsToEnd: false, pendingChecklistProfileIds: [] },
    STORAGE_OUT: { nextStages: [], leadsToEnd: true, pendingChecklistProfileIds: ['cp-1'] },
  };

  it('fires on an advance INTO a checklist-less final stage (the reported bug)', () => {
    expect(isCompletingAdvance('STORAGE_OUT', noChecklist)).toBe(true);
  });

  it('does NOT fire on an advance into a final stage that has a checklist', () => {
    // Would be a double-popup: the checklist path already warns at open.
    expect(isCompletingAdvance('STORAGE_OUT', withChecklist)).toBe(false);
    expect(isTerminalChecklist('STORAGE_OUT', withChecklist)).toBe(true);
  });

  it('does NOT fire on an intermediate stage', () => {
    expect(isCompletingAdvance('STORAGE_IN', noChecklist)).toBe(false);
    expect(isTerminalChecklist('STORAGE_IN', noChecklist)).toBe(false);
  });

  it('does NOT fire on a branching stage that reaches END but has further stages', () => {
    const branching = {
      DRY_OUT: { nextStages: ['STORAGE_IN'], leadsToEnd: true, pendingChecklistProfileIds: [] },
    };
    expect(isCompletingAdvance('DRY_OUT', branching)).toBe(false);
  });

  it('is conservative when the stage or lookup is missing', () => {
    expect(isCompletingAdvance('STORAGE_OUT', null)).toBe(false);
    expect(isCompletingAdvance(undefined, noChecklist)).toBe(false);
    expect(isCompletingAdvance('NOT_A_STAGE', noChecklist)).toBe(false);
  });

  /**
   * The DIALOG-FIRST regression (2026-07-16 → fixed 2026-08-10).
   *
   * The 2026-07-16 refactor parks the advance and opens the terminal checklist
   * BEFORE anything is written, so at gate time the filter is still at
   * STORAGE_IN. `isTerminalChecklist('STORAGE_IN', …)` is false — which is why
   * the AHU popup silently stopped appearing at Storage Out on every pipeline
   * ending `… → STORAGE_OUT → CHECKLIST → END` (CWH / L1 / FD / "Require" in
   * this deployment). `isTerminalTargetWithChecklist` tests the TARGET instead.
   */
  describe('isTerminalTargetWithChecklist', () => {
    it('fires on an advance INTO a final stage that HAS a checklist (the regression)', () => {
      expect(isTerminalTargetWithChecklist('STORAGE_OUT', withChecklist)).toBe(true);
      // Proof of the regression itself: the old current-state predicate cannot
      // see it, because pre-advance the filter is still at STORAGE_IN.
      expect(isTerminalChecklist('STORAGE_IN', withChecklist)).toBe(false);
    });

    it('is the exact complement of isCompletingAdvance — never both, per stage', () => {
      for (const lookup of [noChecklist, withChecklist]) {
        for (const stage of ['STORAGE_IN', 'STORAGE_OUT']) {
          const a = isCompletingAdvance(stage, lookup);
          const b = isTerminalTargetWithChecklist(stage, lookup);
          expect(a && b).toBe(false);
        }
      }
      // …and between them they cover the final stage in both pipeline shapes.
      expect(isCompletingAdvance('STORAGE_OUT', noChecklist)).toBe(true);
      expect(isTerminalTargetWithChecklist('STORAGE_OUT', withChecklist)).toBe(true);
    });

    it('does NOT fire on an intermediate stage or a branching final stage', () => {
      expect(isTerminalTargetWithChecklist('STORAGE_IN', withChecklist)).toBe(false);
      const branching = {
        DRY_OUT: { nextStages: ['STORAGE_IN'], leadsToEnd: true, pendingChecklistProfileIds: ['cp-1'] },
      };
      expect(isTerminalTargetWithChecklist('DRY_OUT', branching)).toBe(false);
    });

    it('is conservative when the stage or lookup is missing', () => {
      expect(isTerminalTargetWithChecklist('STORAGE_OUT', null)).toBe(false);
      expect(isTerminalTargetWithChecklist(undefined, withChecklist)).toBe(false);
      expect(isTerminalTargetWithChecklist('NOT_A_STAGE', withChecklist)).toBe(false);
    });
  });
});

describe('checkAhuHasBothSets', () => {
  it('returns true when the AHU spans both sets', async () => {
    (apiClient.post as any).mockResolvedValue({ hasBothSets: true });
    expect(await checkAhuHasBothSets('POPUP', ['f1'], true)).toBe(true);
  });

  it('fails safe to false (→ ALL) and logs on error', async () => {
    (apiClient.post as any).mockRejectedValue(new Error('boom'));
    expect(await checkAhuHasBothSets('POPUP', ['f1'], true)).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});
