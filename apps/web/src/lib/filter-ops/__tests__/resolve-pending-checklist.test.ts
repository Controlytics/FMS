import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression tests for resolvePendingChecklistDialog — the single choke point
 * both the desktop (filter-operations.tsx) and tablet (mobile-operations.tsx)
 * pages use to build the checklist-dialog payload.
 *
 * Bug (tablet APK, 2026-07-09): a stale-shaped cached `pendingChecklist` row
 * (from an older app build) reached the checklist dialog WITHOUT a `questions`
 * key. The dialog renders `cl.questions.map(...)`, so the missing array threw
 * "Cannot read properties of undefined (reading 'map')" and the RouteErrorBoundary
 * blanked the whole page — AFTER the stage advance had already committed
 * server-side. The resolver must guarantee every returned row carries a
 * `questions` array so no downstream render can crash.
 */

vi.mock('@/lib/action-tape', () => ({
  getCurrentActions: vi.fn(),
  hasActionKind: (actions: any[], kind: string) => actions.some((a) => a.type === kind),
}));
vi.mock('@/lib/offline-cache', () => ({
  dialogChecklistsFromActions: vi.fn(),
  getCachedPendingChecklists: vi.fn(),
  resolvePendingChecklistForStage: vi.fn(),
}));
vi.mock('@/lib/offline-store', () => ({
  cacheData: vi.fn(),
  getCachedData: vi.fn(),
  OFFLINE_TTL_MS: 1000,
}));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }));

import { resolvePendingChecklistDialog, resolveChecklistForTargetStage } from '../resolve-pending-checklist';
import { getCurrentActions } from '@/lib/action-tape';
import { dialogChecklistsFromActions, getCachedPendingChecklists, resolvePendingChecklistForStage } from '@/lib/offline-cache';
import { getCachedData } from '@/lib/offline-store';

const SUBMIT_ACTION = { type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: X', params: {} } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolvePendingChecklistDialog — questions invariant', () => {
  it('normalizes a cache-fallback row that is missing `questions` to an empty array (no crash)', async () => {
    // Tape has a SUBMIT_CHECKLIST but with EMPTY inline questions → forces the
    // cache fallback (rows.every(questions empty)).
    (getCurrentActions as any).mockResolvedValue([SUBMIT_ACTION]);
    (dialogChecklistsFromActions as any).mockReturnValue([
      { pipelineNodeId: 'n', checklistProfileId: 'p', checklistProfileName: 'P', questions: [] },
    ]);
    // Stale-shaped cache row — no `questions` key at all (the crash trigger).
    (getCachedPendingChecklists as any).mockResolvedValue([
      { pipelineNodeId: 'stale', checklistProfileId: 'p', checklistProfileName: 'P' },
    ]);

    const rows = await resolvePendingChecklistDialog('filter-1');
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(1);
    // The invariant: questions is always an array, never undefined.
    expect(Array.isArray(rows![0].questions)).toBe(true);
    expect(rows![0].questions).toEqual([]);
  });

  it('preserves real questions from the server tape', async () => {
    const q = { id: 'q1', question: 'Temp OK?', questionType: 'YES_NO', required: true, section: '', description: '', options: [], sortOrder: 0 };
    (getCurrentActions as any).mockResolvedValue([SUBMIT_ACTION]);
    (dialogChecklistsFromActions as any).mockReturnValue([
      { pipelineNodeId: 'n', checklistProfileId: 'p', checklistProfileName: 'P', questions: [q] },
    ]);

    const rows = await resolvePendingChecklistDialog('filter-1', [SUBMIT_ACTION]);
    expect(rows).toHaveLength(1);
    expect(rows![0].questions).toEqual([q]);
    // Cache fallback must NOT run when the tape already carries questions.
    expect(getCachedPendingChecklists).not.toHaveBeenCalled();
  });

  it('returns null when the tape has no SUBMIT_CHECKLIST action', async () => {
    (getCurrentActions as any).mockResolvedValue([{ type: 'ADVANCE_TO_STAGE', label: 'x', params: {} }]);
    const rows = await resolvePendingChecklistDialog('filter-1');
    expect(rows).toBeNull();
  });
});

/**
 * Dialog-first vs the QA stage interlock (2026-10-08). Profile
 * WASH_OUT -> CHECKLIST -> END with the stage interlock on: answering the
 * checklist up front sent "enter Wash Out + complete the cycle" in one write,
 * which needs the approval that entering Wash Out only just requested — refused
 * STAGE_APPROVAL_PENDING every time. Online, such a stage is entered on its own.
 */
describe('resolveChecklistForTargetStage — interlock-gated terminal stage', () => {
  const checklist = { pipelineNodeId: 'n', checklistProfileId: 'p', checklistProfileName: 'Final', questions: [] };
  const withLookup = (entry: Record<string, unknown>) =>
    (getCachedData as any).mockResolvedValue({ stageLookup: { WASH_OUT: entry } });

  beforeEach(() => {
    (resolvePendingChecklistForStage as any).mockResolvedValue({ checklists: [checklist], expectedIds: ['p'] });
  });

  it('online: a gated stage whose checklist completes the cycle is NOT answered up front', async () => {
    withLookup({ interlockGated: true, leadsToEnd: true, nextStages: [] });
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', true)).toEqual([]);
    expect(resolvePendingChecklistForStage).not.toHaveBeenCalled();
  });

  it('offline: unchanged — offline work is never gated, so the checklist is asked first', async () => {
    withLookup({ interlockGated: true, leadsToEnd: true, nextStages: [] });
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', false)).toHaveLength(1);
  });

  it('a gated stage whose checklist is followed by more stages is still answered up front', async () => {
    withLookup({ interlockGated: true, leadsToEnd: false, nextStages: ['DRY_IN'] });
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', true)).toHaveLength(1);
  });

  it('interlock off: unchanged', async () => {
    withLookup({ interlockGated: false, leadsToEnd: true, nextStages: [] });
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', true)).toHaveLength(1);
  });
});
