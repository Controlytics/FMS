/**
 * The tablet's Stage Approvals tab must BE the web page, not a copy of it.
 *
 * 2026-10-01: the /m wrapper carried its own card-based copy (single decisions
 * only — no select-all, no bulk approve / reject). It drifted from the web page
 * and the operator reported "in tab application stage approvals are different".
 * The tab now renders `StageApprovalsPage`; this guard keeps a second
 * implementation from growing back inside the wrapper.
 *
 * Source-level on purpose: the wrapper is a ~3,300-line component that needs
 * auth, SWR, IndexedDB and the sync engine to mount.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wrapper = readFileSync(resolve(__dirname, '../mobile-wrapper.tsx'), 'utf8');
const page = readFileSync(resolve(__dirname, '../../stage-approvals/index.tsx'), 'utf8');

describe('tablet Stage Approvals = the web page', () => {
  it('the wrapper renders the web StageApprovalsPage', () => {
    expect(wrapper).toMatch(/import \{ StageApprovalsPage \} from '\.\.\/stage-approvals'/);
    expect(wrapper).toMatch(/<StageApprovalsPage\b/);
  });

  it('the wrapper makes no stage-approval request of its own', () => {
    expect(wrapper).not.toMatch(/\/api\/stage-approvals/);
  });

  it('the wrapper hands the page its Android back-button hook', () => {
    expect(wrapper).toMatch(/overlayBackRef=\{stageApprovalsBack\}/);
    expect(page).toMatch(/overlayBackRef\.current = \(\) =>/);
  });

  it('the page keeps bulk approve / reject — the part the tablet copy lacked', () => {
    expect(page).toMatch(/\/api\/stage-approvals\/bulk-decide/);
    expect(page).toMatch(/Approve Selected/);
  });
});
