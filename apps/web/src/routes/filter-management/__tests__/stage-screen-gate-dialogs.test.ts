/**
 * QA-D002 (2026-10-19): the web stage screen (/filters/stage/:key) must render
 * the dialogs that resolve a pending submit — AHU set chooser, AHU remaining
 * filters, and the missed-PM question.
 *
 * They were mounted only in the landing-page return. The stage screen runs the
 * same submit handlers (handleReasonSubmit, handleChecklistSubmit), which await a
 * promise that only those dialogs resolve, so a 409 PM_PREVIOUS_TASK_PENDING or an
 * AHU gate left the submit spinning forever.
 *
 * Source-level on purpose (same reasoning as the mobile single-implementation
 * guard): the page is a ~2,300-line component that needs auth, SWR, IndexedDB and
 * the sync engine to mount.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '../filter-operations.tsx'), 'utf8');

/** Body of the `if (urlStageKey && activeStage) { return ( … ) }` branch. */
function stageScreenReturn(): string {
  const start = src.indexOf('if (urlStageKey && activeStage) {');
  expect(start).toBeGreaterThan(-1);
  const landing = src.indexOf('\n  return (', start);
  expect(landing).toBeGreaterThan(start);
  return src.slice(start, landing);
}

describe('filter operations — gate dialogs on BOTH screens (QA-D002)', () => {
  it('each gate dialog is defined exactly once, inside gateDialogs', () => {
    for (const tag of ['<AhuSetChooserDialog', '<RemainingFiltersDialog', '<PmPendingTasksDialog']) {
      expect(src.split(tag).length - 1).toBe(1);
    }
    const def = src.indexOf('const gateDialogs = (');
    expect(def).toBeGreaterThan(-1);
    const defEnd = src.indexOf('if (isLoading) {', def);
    const block = src.slice(def, defEnd);
    expect(block).toContain('<AhuSetChooserDialog');
    expect(block).toContain('<RemainingFiltersDialog');
    expect(block).toContain('<PmPendingTasksDialog');
  });

  it('the stage screen renders them', () => {
    expect(stageScreenReturn()).toContain('{gateDialogs}');
  });

  it('the landing page renders them', () => {
    const start = src.indexOf('if (urlStageKey && activeStage) {');
    const landing = src.slice(src.indexOf('\n  return (', start));
    expect(landing).toContain('{gateDialogs}');
  });
});
