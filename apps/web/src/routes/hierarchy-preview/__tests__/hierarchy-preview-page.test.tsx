/**
 * Hierarchy Preview (/hierarchy-preview, dev-only) through the page harness.
 * Coverage campaign 2026-10-21.
 *
 * The page renders GET /api/hierarchy/tree: Block -> Area -> AHU -> Filter,
 * plus AHUs parented directly by a block, with counts across all levels.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { unnamedControls } from '../../pm-schedules/__tests__/a11y-kit';
import { HierarchyPreviewPage } from '../index';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

const filter = (id: string, status: string, lifecycle: string | null = null) => ({ id, name: `FLT-${id}`, status, currentLifecycleState: lifecycle });
const TREE = [
  {
    id: 'b1', name: 'Block A', status: 'ACTIVE',
    areas: [
      { id: 'a1', name: 'Area 1', status: 'ACTIVE', ahus: [
        { id: 'h1', name: 'AHU-1', status: 'MAINTENANCE', filters: [filter('f1', 'ACTIVE', 'WASH_IN'), filter('f2', 'Retired'), filter('f3', 'PENDING')] },
        { id: 'h2', name: 'AHU-2', status: 'FAULT', filters: [filter('f4', 'ERROR'), filter('f5', 'INACTIVE'), filter('f6', 'Odd'), filter('f7', '')] },
      ] },
      { id: 'a2', name: 'Area 2', status: 'INACTIVE', ahus: [] },
    ],
    ahus: [{ id: 'h3', name: 'AHU-Direct', status: 'ACTIVE', filters: [] }],
  },
  { id: 'b2', name: 'Block B', status: 'ACTIVE', areas: [], ahus: [] },
  // A sparse node from an older server: missing arrays default to empty.
  { id: 'b3', name: 'Block C', status: 'ACTIVE', areas: [{ id: 'a3', name: 'Area 3', status: 'ACTIVE' }], ahus: [{ id: 'h4', name: 'AHU-Lone', status: 'ACTIVE' }] },
];

function open(tree: MockRoute) {
  const api = mockApi([tree, ...baseRoutes()]);
  renderPage(<HierarchyPreviewPage />, { user: SA, api, route: '/hierarchy-preview' });
  return api;
}
/** The counts line, separators normalised (the dots carry margin, not spaces). */
const countsLine = () => ((document.querySelector('div.mt-4.text-sm') as HTMLElement).textContent ?? '').replace(/\s*·\s*/g, ' · ');
const summaryOf = (name: string) => screen.getByText(name).closest('summary') as HTMLElement;
const badgeOf = (filterName: string) => (screen.getByText(filterName).closest('li') as HTMLElement).querySelectorAll('span')[1] as HTMLElement;

describe('Hierarchy Preview', () => {
  it('renders the whole tree with counts at every level, direct AHUs included', async () => {
    const api = open({ path: '/api/hierarchy/tree', body: TREE });
    expect(screen.getByText('Loading hierarchy…')).toBeInTheDocument();
    expect(await screen.findByText('Block A')).toBeInTheDocument();
    expect(countsLine()).toBe('3 blocks · 3 areas · 4 AHUs · 7 filters');
    expect(summaryOf('Block A')).toHaveTextContent('(2 areas, 1 direct AHU)');
    expect(summaryOf('Block B')).toHaveTextContent('(0 areas)');
    expect(within(summaryOf('Block B').parentElement as HTMLElement).getByText('No areas or AHUs')).toBeInTheDocument();
    expect(summaryOf('Block C')).toHaveTextContent('(1 area, 1 direct AHU)');
    expect(summaryOf('Area 1')).toHaveTextContent('(2 AHUs)');
    expect(within(summaryOf('Area 2').parentElement as HTMLElement).getByText('No AHUs')).toBeInTheDocument();
    expect(summaryOf('Area 3')).toHaveTextContent('(0 AHUs)');
    expect(summaryOf('AHU-1')).toHaveTextContent('(3 filters)');
    expect(within(summaryOf('AHU-Direct').parentElement as HTMLElement).getByText('No filters')).toBeInTheDocument();
    expect(summaryOf('AHU-Lone')).toHaveTextContent('(0 filters)');
    // A filter row: name, status, lifecycle, id.
    const f1 = screen.getByText('FLT-f1').closest('li') as HTMLElement;
    expect(within(f1).getByText('WASH_IN')).toBeInTheDocument();
    expect(within(f1).getByText('f1')).toBeInTheDocument();
    expect(within(screen.getByText('FLT-f2').closest('li') as HTMLElement).queryByText('WASH_IN')).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('singular counts read naturally; a missing status shows UNKNOWN', async () => {
    open({ path: '/api/hierarchy/tree', body: [{
      id: 'b1', name: 'Only Block', status: null,
      areas: [{ id: 'a1', name: 'Only Area', status: 'ACTIVE', ahus: [{ id: 'h1', name: 'Only AHU', status: 'ACTIVE', filters: [filter('f1', 'ACTIVE')] }] }],
      ahus: [{ id: 'h2', name: 'Direct AHU', status: 'ACTIVE', filters: [] }],
    }] });
    await screen.findByText('Only Block');
    expect(countsLine()).toBe('1 block · 1 area · 2 AHUs · 1 filter');
    expect(summaryOf('Only Block')).toHaveTextContent('(1 area, 1 direct AHU)');
    expect(within(summaryOf('Only Block')).getByText('UNKNOWN')).toBeInTheDocument();
    expect(summaryOf('Only Area')).toHaveTextContent('(1 AHU)');
    expect(summaryOf('Only AHU')).toHaveTextContent('(1 filter)');
  });

  it('a block with only direct AHUs reads plural where it should', async () => {
    open({ path: '/api/hierarchy/tree', body: [{ id: 'b1', name: 'B', status: 'ACTIVE', areas: [], ahus: [
      { id: 'h1', name: 'H1', status: 'ACTIVE', filters: [] }, { id: 'h2', name: 'H2', status: 'ACTIVE', filters: [] },
    ] }] });
    await screen.findByText('H1');
    expect(countsLine()).toBe('1 block · 0 areas · 2 AHUs · 0 filters');
    expect(summaryOf('B')).toHaveTextContent('(0 areas, 2 direct AHUs)');
  });

  it('exactly one AHU reads singular in the counts', async () => {
    open({ path: '/api/hierarchy/tree', body: [{ id: 'b1', name: 'B', status: 'ACTIVE', areas: [], ahus: [{ id: 'h1', name: 'H1', status: 'ACTIVE', filters: [] }] }] });
    await screen.findByText('H1');
    expect(countsLine()).toBe('1 block · 0 areas · 1 AHU · 0 filters');
  });

  it('status badges are coloured by state, case-insensitively, with a neutral fallback', async () => {
    open({ path: '/api/hierarchy/tree', body: { blocks: TREE } });
    await screen.findByText('FLT-f1');
    expect(badgeOf('FLT-f1')).toHaveClass('bg-emerald-50');
    expect(badgeOf('FLT-f2')).toHaveClass('bg-slate-100'); // "Retired"
    expect(badgeOf('FLT-f3')).toHaveClass('bg-amber-50');
    expect(badgeOf('FLT-f4')).toHaveClass('bg-red-50');
    expect(badgeOf('FLT-f5')).toHaveClass('text-slate-600');
    expect(badgeOf('FLT-f6')).toHaveClass('text-slate-700'); // unknown value
    expect(badgeOf('FLT-f7')).toHaveTextContent('UNKNOWN'); // empty status
    expect(within(summaryOf('AHU-1')).getByText('MAINTENANCE')).toHaveClass('bg-amber-50');
    expect(within(summaryOf('AHU-2')).getByText('FAULT')).toHaveClass('bg-red-50');
  });

  it('3d: every control on the page has an accessible name', async () => {
    open({ path: '/api/hierarchy/tree', body: TREE });
    await screen.findByText('Block A');
    expect(unnamedControls()).toEqual([]);
  });

  it('Refresh re-reads the tree', async () => {
    const api = open({ path: '/api/hierarchy/tree', body: TREE });
    await screen.findByText('Block A');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.calls('GET', '/api/hierarchy/tree')).toHaveLength(2));
  });

  it('an empty hierarchy says what to create first', async () => {
    open({ path: '/api/hierarchy/tree', body: { blocks: [] } });
    expect(await screen.findByText('No blocks found. Create blocks/areas/AHUs/filters first.')).toBeInTheDocument();
    expect(countsLine()).toBe('0 blocks · 0 areas · 0 AHUs · 0 filters');
  });

  it('a server answer with no blocks key reads as empty', async () => {
    open({ path: '/api/hierarchy/tree', body: {} });
    expect(await screen.findByText('No blocks found. Create blocks/areas/AHUs/filters first.')).toBeInTheDocument();
  });

  it('a failed read explains itself and suggests the endpoint may be missing', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open({ path: '/api/hierarchy/tree', status: 500, body: { error: 'X', message: 'tree exploded' } });
    expect(await screen.findByText('Failed to load hierarchy')).toBeInTheDocument();
    expect(screen.getAllByText('tree exploded').length).toBeGreaterThan(0);
    expect(screen.getByText(/may not be\s+available yet in this build/)).toBeInTheDocument();
    expect(screen.queryByText(/No blocks found/)).toBeNull();
  });
});
