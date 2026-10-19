/**
 * Pure rules behind four tablet fixes (2026-10-19):
 *   OQ-05  which station a My Tasks "Perform" opens (task-first-stage.ts) —
 *          graphs below are the LIVE profiles read from the QA clone
 *          (filter_pipeline_stages / _connections), ids shortened.
 *   OQ-04  one allowlist rule for both tablet pages (use-tablet-access.ts)
 *   OQ-03a Stage Approvals needs the feature AND the permission
 *   OQ-02  interlock wording names the configured approver, never "QA"
 */
import { describe, it, expect } from 'vitest';
import { profileIdForTask, singleFirstStage, resolveTaskFirstStage } from '../task-first-stage';
import { tabletFeatureAllowed, canUseStageApprovals, tabletAccessCacheKey, pickTabletAccess } from '../use-tablet-access';
import { interlockBannerTitle, interlockBannerDetail, interlockRefusalLine, blockingInterlock } from '../stage-interlock-notice';

const STATIONS = new Set(['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT']);

// "CWH/RDU/01" — START → DRY_IN → DRY_OUT → WASH_IN → WASH_OUT → CHECKLIST → END
const RDU01 = {
  stages: [
    { id: 's', nodeType: 'START' }, { id: 'e', nodeType: 'END' },
    { id: 'di', nodeType: 'STAGE', stateKey: 'DRY_IN' }, { id: 'do', nodeType: 'STAGE', stateKey: 'DRY_OUT' },
    { id: 'wi', nodeType: 'STAGE', stateKey: 'WASH_IN' }, { id: 'wo', nodeType: 'STAGE', stateKey: 'WASH_OUT' },
    { id: 'c', nodeType: 'CHECKLIST' },
  ],
  connections: [
    { fromStageId: 's', toStageId: 'di' }, { fromStageId: 'di', toStageId: 'do' }, { fromStageId: 'do', toStageId: 'wi' },
    { fromStageId: 'wi', toStageId: 'wo' }, { fromStageId: 'wo', toStageId: 'c' }, { fromStageId: 'c', toStageId: 'e' },
  ],
};
// "CWH/RDU" — starts at WASH_IN
const RDU = {
  stages: [{ id: 's', nodeType: 'START' }, { id: 'wi', nodeType: 'STAGE', stateKey: 'WASH_IN' }, { id: 'e', nodeType: 'END' }],
  connections: [{ fromStageId: 's', toStageId: 'wi' }, { fromStageId: 'wi', toStageId: 'e' }],
};
// A START that leads through a checklist into Dry In (checklists are skipped by the walk).
const CHECKLIST_FIRST = {
  stages: [{ id: 's', nodeType: 'START' }, { id: 'c', nodeType: 'CHECKLIST' }, { id: 'di', nodeType: 'STAGE', stateKey: 'DRY_IN' }],
  connections: [{ fromStageId: 's', toStageId: 'c' }, { fromStageId: 'c', toStageId: 'di' }],
};
// START fans out to two stages — ambiguous.
const FORK = {
  stages: [{ id: 's', nodeType: 'START' }, { id: 'a', nodeType: 'STAGE', stateKey: 'WASH_IN' }, { id: 'b', nodeType: 'STAGE', stateKey: 'DRY_IN' }],
  connections: [{ fromStageId: 's', toStageId: 'a' }, { fromStageId: 's', toStageId: 'b' }],
};

const task = { ahuId: 'ahu-1', areaId: 'area-1', blockId: 'blk-1' };

describe('OQ-05 — first station for a task', () => {
  it('BY_AHU (the live mode): the AHU rule decides', () => {
    expect(profileIdForTask(task, { mode: 'BY_AHU', rules: [{ matchValue: 'ahu-1', profileId: 'rdu01' }] })).toBe('rdu01');
    expect(profileIdForTask(task, { mode: 'BY_AHU', rules: [{ matchValue: 'blk-1', profileId: 'x' }] })).toBeNull();
  });

  it('BY_BLOCK walks AHU → area → block, first match wins (server order)', () => {
    const rules = [{ matchValue: 'blk-1', profileId: 'block' }, { matchValue: 'area-1', profileId: 'area' }];
    expect(profileIdForTask(task, { mode: 'BY_BLOCK', rules })).toBe('area');
    expect(profileIdForTask({ ...task, areaId: null }, { mode: 'BY_BLOCK', rules })).toBe('block');
  });

  it('per-filter modes and an unmatched rule never guess (server would use its default)', () => {
    for (const mode of ['BY_ENTITY', 'BY_FILTER_SIZE', 'BY_FILTER_SET']) {
      expect(profileIdForTask(task, { mode, rules: [{ matchValue: 'ahu-1', profileId: 'p' }] })).toBeNull();
    }
    expect(profileIdForTask(task, null)).toBeNull();
    expect(profileIdForTask(task, { mode: 'BY_AHU', rules: [] })).toBeNull();
  });

  it('the live Dry-In-first profile opens DRY_IN, not WASH_IN', () => {
    expect(singleFirstStage(RDU01, STATIONS)).toBe('DRY_IN');
    expect(singleFirstStage(RDU, STATIONS)).toBe('WASH_IN');
    expect(singleFirstStage(CHECKLIST_FIRST, STATIONS)).toBe('DRY_IN');
  });

  it('ambiguous or missing graphs fall back to the picker', () => {
    expect(singleFirstStage(FORK, STATIONS)).toBeNull();
    expect(singleFirstStage(null, STATIONS)).toBeNull();
    expect(singleFirstStage({ stages: [] }, STATIONS)).toBeNull();
  });

  it('end to end: assignment + cached profile → DRY_IN; nothing cached → null', async () => {
    const assignment = { mode: 'BY_AHU', rules: [{ matchValue: 'ahu-1', profileId: 'rdu01' }] };
    await expect(resolveTaskFirstStage(task, STATIONS, { assignment, getProfile: async (id) => (id === 'rdu01' ? RDU01 : null) })).resolves.toBe('DRY_IN');
    await expect(resolveTaskFirstStage(task, STATIONS, { assignment, getProfile: async () => null })).resolves.toBeNull();
    await expect(resolveTaskFirstStage(task, STATIONS, { assignment: null, getProfile: async () => RDU01 })).resolves.toBeNull();
    await expect(resolveTaskFirstStage(task, STATIONS, { assignment, getProfile: async () => { throw new Error('offline'); } })).resolves.toBeNull();
  });
});

describe('OQ-04 — one allowlist rule', () => {
  it('no response / never configured → allowed (unchanged)', () => {
    expect(tabletFeatureAllowed(undefined, 'my_tasks')).toBe(true);
    expect(tabletFeatureAllowed({ configured: false, allowed: [] }, 'my_tasks')).toBe(true);
  });
  it('configured → only what is listed; an EMPTY list allows nothing (the operations page used to allow all)', () => {
    expect(tabletFeatureAllowed({ configured: true, allowed: ['login', 'my_tasks'] }, 'my_tasks')).toBe(true);
    expect(tabletFeatureAllowed({ configured: true, allowed: ['login'] }, 'my_tasks')).toBe(false);
    expect(tabletFeatureAllowed({ configured: true, allowed: [] }, 'filter_cleaning')).toBe(false);
  });
  it('with no live answer the cached list applies — whatever the online flag says', () => {
    const cached = { configured: true, allowed: ['login'] };
    expect(tabletFeatureAllowed(pickTabletAccess(undefined, cached), 'my_tasks')).toBe(false);
    expect(pickTabletAccess({ configured: true, allowed: ['login', 'my_tasks'] }, cached)?.allowed).toContain('my_tasks');
    expect(pickTabletAccess(undefined, undefined)).toBeUndefined();
  });
  it('the offline cache is per user', () => {
    expect(tabletAccessCacheKey('u1')).not.toBe(tabletAccessCacheKey('u2'));
  });
});

describe('OQ-03a — Stage Approvals needs feature AND permission', () => {
  const access = { configured: true, allowed: ['login', 'stage_approvals'] };
  it('OPERATOR with the feature but no STAGE_APPROVAL_* → hidden', () => {
    expect(canUseStageApprovals(access, { role: 'OPERATOR', permissions: ['FILTER_OPERATE'] })).toBe(false);
  });
  it('a role holding VIEW or DECIDE → shown', () => {
    expect(canUseStageApprovals(access, { role: 'SHIFTOFFICER', permissions: ['STAGE_APPROVAL_VIEW'] })).toBe(true);
    expect(canUseStageApprovals(access, { role: 'X', permissions: ['STAGE_APPROVAL_DECIDE'] })).toBe(true);
  });
  it('the permission alone is not enough when the feature is off; SUPER_ADMIN bypasses only the permission', () => {
    const off = { configured: true, allowed: ['login'] };
    expect(canUseStageApprovals(off, { role: 'X', permissions: ['STAGE_APPROVAL_VIEW'] })).toBe(false);
    expect(canUseStageApprovals(access, { role: 'SUPER_ADMIN', permissions: [] })).toBe(true);
  });
});

describe('OQ-02 — interlock wording', () => {
  const pending = { stageKey: 'WASH_OUT', status: 'PENDING', approverRole: 'SHIFTOFFICER' };
  it('names the configured approver role, never a hard-coded QA', () => {
    expect(interlockBannerDetail(pending)).toContain('SHIFTOFFICER');
    expect(interlockBannerTitle(pending)).not.toMatch(/QA/);
    expect(interlockRefusalLine('F-01', pending)).toBe('F-01: Wash Out is awaiting approval from SHIFTOFFICER before this filter can continue.');
  });
  it('rejected reads as rejected', () => {
    expect(interlockRefusalLine('F-01', { ...pending, status: 'REJECTED' })).toMatch(/rejected/);
  });
  it('only a blocking interlock counts', () => {
    expect(blockingInterlock({ interlock: { blocksLeaving: false } })).toBeNull();
    expect(blockingInterlock({})).toBeNull();
    expect(blockingInterlock({ interlock: { ...pending, blocksLeaving: true } })?.approverRole).toBe('SHIFTOFFICER');
  });
});
