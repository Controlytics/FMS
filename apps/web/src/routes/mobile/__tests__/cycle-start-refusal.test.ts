/**
 * A REFUSED cycle start on the tablet must be shown, and must stay a cycle start.
 *
 * 2026-10-01 (operator: "why no active cycle was coming, and unable to submit").
 * Wash In on a block with an equipment group goes reason → Equipment Readings →
 * Submit. When the server refused the start (409 — overdue replacement, an
 * earlier PM not carried out, …) the readings-dialog path:
 *   1. had no `onError` on `reauth.execute`, which does not re-throw — so the
 *      server's reason was never displayed;
 *   2. cleared `pendingCyclePayload` on the next line regardless — so the dialog,
 *      still open, forgot it was starting a cycle;
 *   3. sent a bare `/advance` on every further Submit → "No active cleaning cycle".
 * Seen in the API log as: start-cycle 409, advance 400, advance 400.
 *
 * Source-level on purpose: the page is a ~4,500-line component that needs auth,
 * SWR, IndexedDB and the sync engine to mount. The behaviour itself was driven
 * in a browser with the server's answers faked (see CHANGELOG).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '../mobile-operations.tsx'), 'utf8').replace(/\r\n/g, '\n');

describe('tablet cycle start — refusal handling', () => {
  it('the readings-dialog start goes through the shared missed-PM helper', () => {
    expect(src).toMatch(/startWithPmGate\(equipFiltId,/);
  });

  it('the reason-dialog start uses the same helper (one implementation)', () => {
    expect(src).toMatch(/startWithPmGate\(reasonDialog\.filterId, runStart\)/);
    // the question is asked in exactly one place besides the batch retry
    expect(src.match(/PM_PREVIOUS_TASK_PENDING/g)?.length).toBeLessThanOrEqual(6);
  });

  it('the start payload is never cleared straight after reauth.execute returns', () => {
    // The old shape: `});` closing the execute call, then an unconditional clear.
    expect(src).not.toMatch(/\}\);\n\s+setPendingCyclePayload\(null\);\n\s+\/\/ If reauth dialog was cancelled or failed/);
  });

  it('a refused start in the readings dialog reports the server reason', () => {
    const start = src.indexOf('startWithPmGate(equipFiltId,');
    const block = src.slice(start, start + 4000);
    expect(block).toMatch(/onError: \(e: any\) => \{\n\s+startFailed = true;/);
    expect(block).toMatch(/setError\(`\$\{equipFiltName\}: \$\{e\?\.message/);
    expect(block).toMatch(/if \(startFailed \|\| startCancelled \|\| typeof executed !== 'boolean'\)/);
  });

  it('a batch start refused for a missed PM asks the question and retries', () => {
    expect(src.match(/retryBulkStartsForMissedPm\(ops, firstOut, startAction\)/g)?.length).toBe(2);
  });

  it('a filter with no cycle is told its first stage before anything is started', () => {
    expect(src).toMatch(/const firstStages = firstStagesFromGraph\(state\.pipelineGraph\);/);
  });
});
