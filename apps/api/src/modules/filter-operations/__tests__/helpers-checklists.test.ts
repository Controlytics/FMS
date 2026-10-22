/**
 * The checklist helpers the cycle writes share (coverage suite, 2026-10-21):
 * the graph walk, the disabled-checklist naming on events, and question
 * resolution through pinned versions — against real checklist rows in
 * digilog_test_db (created and removed here), no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { LocalContext } from '@digilog/shared';
import { prisma } from '../../../lib/prisma.js';
import {
  prettyStageLabel, collectChecklistsAfterStage, describeSkippedChecklists, resolveChecklistQuestions, loadDisabledChecklistProfileIds,
} from '../helpers.js';
import { FoFixture } from './support/fo-fixtures.js';

const fx = new FoFixture('FOH');
let ON = ''; let OFF = ''; let OFFNAME = ''; let PINNED = '';

beforeAll(async () => {
  ON = (await fx.checklist('ON', [{ question: 'on?' }])).id;
  const off = await fx.checklist('OFF', [{ question: 'off?' }], false);
  OFF = off.id;
  OFFNAME = (await prisma.checklistProfile.findUnique({ where: { id: OFF } }))!.name;
  PINNED = (await fx.checklist('PIN', [{ question: 'live' }])).id;
  // A version row written by an old release: no name, no questions array.
  await prisma.checklistProfileVersion.create({ data: { profileId: PINNED, versionNumber: 7, snapshot: { questions: 'not-an-array' } } });
}, 60_000);

afterAll(async () => { await fx.cleanup(); }, 60_000);

const node = (id: string, nodeType: string, extra: Record<string, unknown> = {}) => ({ id, nodeType, stateKey: null, configuration: {}, sortOrder: 0, ...extra });

describe('prettyStageLabel', () => {
  it('labels a missing stage generically', () => {
    expect(prettyStageLabel(null)).toBe('this stage');
    expect(prettyStageLabel(undefined)).toBe('this stage');
    expect(prettyStageLabel('DRY_OUT')).toBe('Dry Out');
  });
});

describe('collectChecklistsAfterStage', () => {
  it('collects consecutive checklists, stops at the next stage, survives a loop and a dangling edge', () => {
    const s1 = node('s1', 'STAGE', { stateKey: 'S1' });
    const c1 = node('c1', 'CHECKLIST');
    const c2 = node('c2', 'CHECKLIST');
    const s2 = node('s2', 'STAGE', { stateKey: 'S2' });
    const edges = [
      { fromStageId: 's1', toStageId: 'c1' },
      { fromStageId: 'c1', toStageId: 'c2' },
      { fromStageId: 'c2', toStageId: 'c1' }, // loop back
      { fromStageId: 'c2', toStageId: 'gone' }, // node no longer exists
      { fromStageId: 'c2', toStageId: 's2' },
    ];
    // Terminates on the loop and finds both checklists. (It returns c1 TWICE on a
    // checklist-to-checklist loop — reported as a finding, not asserted here.)
    expect(new Set(collectChecklistsAfterStage(s1, [s1, c1, c2, s2], edges).map((n) => n.id))).toEqual(new Set(['c1', 'c2']));
    expect(collectChecklistsAfterStage(s1, [s1, c1, c2, s2], edges.filter((e) => e.toStageId !== 'c1' || e.fromStageId === 's1')).map((n) => n.id)).toEqual(['c1', 'c2']);
    expect(collectChecklistsAfterStage(s2, [s1, c1, c2, s2], edges)).toEqual([]);
  });
});

describe('describeSkippedChecklists / loadDisabledChecklistProfileIds', () => {
  const ctxWith = (disabled: string[]): LocalContext => ({
    profile: {
      nodes: [
        node('a', 'STAGE', { stateKey: 'A' }),
        node('ka', 'CHECKLIST', { configuration: { checklistProfileId: OFF } }),
        node('kb', 'CHECKLIST', { configuration: { checklistProfileId: ON } }),
        node('kc', 'CHECKLIST', { configuration: { checklistProfileId: UNKNOWN } }),
        node('b', 'STAGE', { stateKey: 'B' }),
      ],
      edges: [{ fromStageId: 'a', toStageId: 'ka' }, { fromStageId: 'ka', toStageId: 'kb' }, { fromStageId: 'kb', toStageId: 'kc' }, { fromStageId: 'kc', toStageId: 'b' }],
    },
    disabledChecklistProfileIds: disabled,
  } as unknown as LocalContext);
  const UNKNOWN = randomUUID();

  it('names each disabled checklist after the stages it follows (unknown ids by a placeholder)', async () => {
    const out = await describeSkippedChecklists(ctxWith([OFF, UNKNOWN]), ['A', 'A', 'NOT_A_STAGE']);
    expect(out).toEqual([
      { checklistProfileId: OFF, afterStage: 'A', checklistProfileName: OFFNAME, reason: 'DISABLED' },
      { checklistProfileId: UNKNOWN, afterStage: 'A', checklistProfileName: '(unknown checklist)', reason: 'DISABLED' },
    ]);
  });

  it('nothing disabled, no stages, or no disabled checklist after them → nothing to name', async () => {
    expect(await describeSkippedChecklists(ctxWith([]), ['A'])).toEqual([]);
    expect(await describeSkippedChecklists(ctxWith([OFF]), [])).toEqual([]);
    expect(await describeSkippedChecklists(ctxWith([OFF]), ['B'])).toEqual([]);
  });

  it('reads which referenced checklists are switched off right now', async () => {
    const stages = [
      { nodeType: 'CHECKLIST', configuration: { checklistProfileId: OFF } },
      { nodeType: 'CHECKLIST', configuration: { checklistProfileId: ON } },
      { nodeType: 'CHECKLIST', configuration: {} },
      { nodeType: 'STAGE', configuration: null },
    ];
    expect(await loadDisabledChecklistProfileIds(stages)).toEqual([OFF]);
    expect(await loadDisabledChecklistProfileIds([{ nodeType: 'STAGE', configuration: {} }])).toEqual([]);
  });
});

describe('resolveChecklistQuestions', () => {
  it('a pinned version with no name and no question list resolves to an unnamed, empty checklist', async () => {
    const out = await resolveChecklistQuestions([node('k', 'CHECKLIST', { configuration: { checklistProfileId: PINNED } })], { [PINNED]: 7 });
    expect(out).toEqual([{ pipelineNodeId: 'k', checklistProfileId: PINNED, checklistProfileName: '(unnamed)', profileVersion: 7, questions: [] }]);
  });

  it('a node whose checklist exists nowhere is left out; no checklist nodes → nothing', async () => {
    const out = await resolveChecklistQuestions([
      node('k1', 'CHECKLIST', { configuration: { checklistProfileId: randomUUID() } }),
      node('k2', 'CHECKLIST', { configuration: { checklistProfileId: ON } }),
    ], { [ON]: 99 /* pin with no version row → live */ });
    expect(out.map((c) => [c.pipelineNodeId, c.checklistProfileId, c.questions.length])).toEqual([['k2', ON, 1]]);
    expect(out[0].questions[0]).toMatchObject({ question: 'on?', section: null, description: null, options: [], validation: {} });
    expect(await resolveChecklistQuestions([node('k3', 'CHECKLIST')])).toEqual([]);
  });
});
