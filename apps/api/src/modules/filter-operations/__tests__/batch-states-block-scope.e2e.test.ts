/**
 * D03-06 (2026-10-22): /batch-states scoped to one block.
 *
 * The desktop Filter Operations page primed its offline cache by GETting
 * /current-state for EVERY active filter, one after another, on mount and after
 * every sync drain (121 requests in 10 s; ~4 min for 3,044 filters, per open
 * page). It now primes only what it can act on — the selected block's filters —
 * through the batch endpoint, so the endpoint takes an optional `blockId`: the
 * filters whose AHU sits in that block, directly or under one of its areas (the
 * client's own rule, lib/ahu-block-map). Without it the answer is unchanged
 * (every active filter — the tablet's offline sync evicts by that full list).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FilterOperationsService } from '../filter-operations.service.js';
import { FoFixture } from './support/fo-fixtures.js';

const fx = new FoFixture('BBS');
const service = new FilterOperationsService();
let ctx: any;
let blockA = '';
const ids: Record<string, string> = {};

beforeAll(async () => {
  const role = await fx.role('OP', ['ASSET_READ', 'FILTER_OPERATE']);
  const opId = (await fx.user('op', role)).id;
  ctx = { userId: 'bbs_op', userSub: opId, userRole: role, ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: 'bbs', isOfflineReplay: true };
  const profile = await fx.pipeline({ name: 'Scope', stages: ['WASH_IN', 'WASH_OUT'] }, opId);
  blockA = await fx.node('BLOCK', 'Block A');
  const areaA = await fx.node('AREA', 'Area A', blockA);
  const ahuInArea = await fx.node('AHU', 'AHU-A1', areaA);
  const ahuOnBlock = await fx.node('AHU', 'AHU-A2', blockA);
  const blockB = await fx.node('BLOCK', 'Block B');
  const ahuB = await fx.node('AHU', 'AHU-B1', blockB);
  ids.inArea = await fx.filter('in-area', ahuInArea, profile.filterProfileId);
  ids.onBlock = await fx.filter('on-block', ahuOnBlock, profile.filterProfileId);
  ids.otherBlock = await fx.filter('other-block', ahuB, profile.filterProfileId);
});

afterAll(async () => { await fx.cleanup(); });

describe('GET /api/filters/batch-states — blockId', () => {
  it('scoped to a block: exactly that block\'s filters (AHU under an area or directly under the block)', async () => {
    const res = await service.getBatchStates(ctx, undefined, blockA);
    expect(Object.keys(res.states).sort()).toEqual([ids.inArea, ids.onBlock].sort());
    expect(res.states[ids.inArea]).toMatchObject({ currentState: null });
  });

  it('without a block: every active filter, as before', async () => {
    const res = await service.getBatchStates(ctx);
    expect(Object.keys(res.states)).toEqual(expect.arrayContaining([ids.inArea, ids.onBlock, ids.otherBlock]));
  });
});
