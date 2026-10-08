import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// The panel signs its submit through the re-auth hook; nothing is submitted here.
vi.mock('@/hooks/use-reauth', () => ({ useReauth: () => ({}) }));
vi.mock('@/components/reauth-prompt', () => ({ ReauthPrompt: () => null }));

import { DryingFiltersPanel } from '../drying-filters-panel';

/**
 * Dry In temperature with ONE ready filter (2026-10-08, operator): the row is
 * ticked automatically, so the temperature box and Submit work without a
 * selection step. With two or more ready, nothing is pre-ticked — the operator
 * still chooses which ones to submit.
 *
 * Rendered OFFLINE from cached state: a cycle whose dryer started an hour ago on
 * a 10-minute duration (past half time = ready) with a Dry In temperature
 * instrument on its equipment group.
 */
const group = {
  id: 'g1', name: 'Test',
  instruments: [{ id: 'i1', description: 'Dryer Temperature', stageKey: 'DRY_IN', uom: '°C', operatingMin: 0, operatingMax: 100, leastCount: 1 }],
};
const cachedState = {
  currentCycle: { id: 'c1', dryerStartedAt: new Date(Date.now() - 60 * 60_000).toISOString(), dryerDurationMinutes: 10, dryerReadingsSubmitted: false },
  equipmentGroup: group,
};
const getCache = vi.fn(async (key: string) => (key.startsWith('filter-state-') ? cachedState : null)) as any;

function renderPanel(filters: Array<{ id: string; name: string }>) {
  return render(
    <DryingFiltersPanel
      filters={filters} online={false}
      executeOrQueue={vi.fn() as any} getCache={getCache} cacheData={vi.fn()}
      onSuccess={vi.fn()} onError={vi.fn()} variant="mobile"
    />,
  );
}

describe('DryingFiltersPanel — selection', () => {
  it('one ready filter is ticked automatically and Submit is enabled', async () => {
    renderPanel([{ id: 'f1', name: 'CWH/RDU/21-00' }]);
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeTruthy());
    expect((screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTitle('Select for submission') as HTMLInputElement).checked).toBe(true);
  });

  it('two ready filters: nothing is pre-ticked, the operator chooses', async () => {
    renderPanel([{ id: 'f1', name: 'CWH/RDU/21-00' }, { id: 'f2', name: 'CWH/RDU/22-00' }]);
    await waitFor(() => expect(screen.getByText('0 of 2 ready filter(s) selected')).toBeTruthy());
    expect((screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
