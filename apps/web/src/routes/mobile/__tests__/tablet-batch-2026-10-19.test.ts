/**
 * Wiring guard for the 2026-10-19 tablet batch (OQ-02, OQ-03a, OQ-04, OQ-05,
 * OQ-06, OQ-13, C-04, C-07, M53).
 *
 * Source-level on purpose, like stage-approvals-single-implementation.test.ts
 * and cycle-start-refusal.test.ts: mobile-wrapper.tsx (~3,500 lines) and
 * mobile-operations.tsx (~4,700 lines) need auth, SWR, IndexedDB, the sync
 * engine and the RFID bridge to mount. The RULES each fix relies on are pure
 * and tested by behaviour in tablet-rules.test.ts, task-card-and-ack.test.tsx,
 * offline-sync-eviction.test.ts and mobile-login-session-conflict.test.tsx;
 * this file proves the two pages actually CALL them, and that the old
 * hard-coded copies are gone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (f: string) => readFileSync(resolve(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
const wrapper = read('../mobile-wrapper.tsx');
const ops = read('../mobile-operations.tsx');

function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  expect(a, `missing: ${from}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b < 0 ? undefined : b);
}

describe('OQ-02 — interlock reaches the LIVE queue submit', () => {
  it('handleSubmitQueue sets the banner and names the approver for a held filter', () => {
    const queue = slice(ops, 'const handleSubmitQueue = async', 'const handleSubmit = async');
    expect(queue).toMatch(/noteInterlock\(held\)/);
    expect(queue).toMatch(/interlockRefusalLine\(item\.filterName, held, roleLabels\)/);
    expect(queue).toMatch(/INTERLOCK_REFUSAL_CODES\.has\(r\.error\?\.code/);
    expect(queue).toMatch(/setInterlock\(null\)/);
  });
  it('the banner no longer hard-codes QA', () => {
    expect(ops).not.toMatch(/awaiting QA approval/);
    expect(ops).toMatch(/interlockBannerTitle\(interlock\)/);
  });
});

describe('OQ-03a / OQ-04 — one allowlist rule, permission-gated Stage Approvals', () => {
  it('both pages use the shared hook', () => {
    expect(wrapper).toMatch(/useTabletAccess\(user, online\)/);
    expect(ops).toMatch(/useTabletAccess\(user, online\)/);
  });
  it('the "empty list = everything allowed" rule is gone from the operations page', () => {
    expect(ops).not.toMatch(/allowedFeatures\.length === 0 \|\| allowedFeatures\.includes/);
  });
  it('the Stage Approvals tab and its view need feature AND permission', () => {
    expect(wrapper).toMatch(/\{canStageApprovals && \(\s*<button onClick=\{\(\) => setView\('stage-approvals'\)\}/);
    expect(wrapper).not.toMatch(/\{hasFeature\('stage_approvals'\) && \(/);
    expect(wrapper).toMatch(/view === 'stage-approvals' && !canStageApprovals\) setView\('home'\)/);
  });
});

describe('OQ-05 / OQ-06 / OQ-13 — My Tasks Perform on the tablet', () => {
  const perform = () => slice(wrapper, 'const performTask = async', 'useAndroidBackButton(');
  it('Perform resolves the profile\'s first stage instead of always opening Wash In', () => {
    expect(perform()).toMatch(/resolveTaskFirstStage\(task, stationKeys/);
    expect(perform()).not.toMatch(/openStage\('WASH_IN'\)/);
    expect(wrapper).toMatch(/initialBlockId=\{selectedBlockId \?\? undefined\}/);
  });
  it('an overdue, unacknowledged task asks for the password first (online)', () => {
    expect(perform()).toMatch(/if \(online && needsOverdueAck\(task\)\) \{ setAckTask\(task\); return; \}/);
    expect(wrapper).toMatch(/<OverdueAckDialog/);
  });
  it('every Perform button goes through onPerform, and written-off tasks get none', () => {
    expect(wrapper).not.toMatch(/onClick=\{\(\) => performTask\(task\)\}/);
    expect(wrapper.match(/onClick=\{\(\) => onPerform\(task\)\}/g)?.length).toBe(2);
    expect(wrapper.match(/isTaskTerminal\(task\.overallStatus\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('C-04 — a SIGNATURE question has an input on the tablet', () => {
  it('the "not available" placeholder is gone; SIGNATURE takes the typed answer like web', () => {
    expect(ops).not.toMatch(/Signature capture not available on tablet/);
    expect(ops).not.toMatch(/q\.questionType === 'SIGNATURE' \?/);
  });
});

describe('C-07 / M53 — one scan rule, one identifier map', () => {
  it('the three tablet RFID write/select paths normalise the scan', () => {
    expect(wrapper).toMatch(/const tagValue = normalizeRfidScan\(rfidScan\.value\)/);
    expect(wrapper).toMatch(/const raw = normalizeRfidScan\(replaceScan\.value\)/);
    expect(wrapper).toMatch(/const raw = normalizeRfidScan\(replTaskScan\.value\)/);
  });
  it('neither page carries its own identifier-map builder', () => {
    expect(wrapper).not.toMatch(/function buildIdentifierMap/);
    expect(ops).not.toMatch(/function buildIdentifierMap/);
    expect(ops).toMatch(/buildIdentifierMap\(identifiersData as any\[\], keep\)/);
  });
});
