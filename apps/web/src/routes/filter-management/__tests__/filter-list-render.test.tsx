import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, SA, role, allowConsoleError } from './fm-test-kit';
import { setupApi, renderFilters, openBlock, openFiltersTab, row, makeTree, F, ADMIN_ALL } from './filter-list-fixtures';

usePageTestLifecycle();

describe('Filters page — block grid', () => {
  it('summarises blocks, AHUs, active filters and RFID-tagged filters; asks for nothing unmocked', async () => {
    const api = setupApi();
    renderFilters(SA, api);
    expect(await screen.findByText('Block Alpha')).toBeInTheDocument();
    const stat = (label: string) => screen.getByText(label).parentElement!;
    // Active filters exclude the inactive PF-009 but include the lifecycle-RETIRED PF-006 row.
    expect(stat('Total Blocks')).toHaveTextContent('2');
    expect(stat('Total AHUs')).toHaveTextContent('2');
    expect(stat('Active Filters')).toHaveTextContent('7');
    expect(stat('With RFID')).toHaveTextContent('1');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Filter Management');
    expect(screen.getByText('7 filters across 2 blocks')).toBeInTheDocument();
    // per-block counts on the cards
    const alpha = screen.getByRole('button', { name: /Block Alpha/ });
    expect(alpha).toHaveTextContent('7');
    expect(alpha).toHaveTextContent('2AHUs');
    expect(screen.getByRole('button', { name: /Block Beta/ })).toHaveTextContent('0Filters0AHUs');
    await waitFor(() => expect(api.calls('GET', '/api/filters/reasons')).toHaveLength(1));
    expect(api.unmatched).toEqual([]);
  });

  it('shows "No blocks found" with a Create Block button for a creator, and a plain message otherwise', async () => {
    const api = setupApi({ tree: [] });
    const { unmount } = renderFilters(SA, api);
    expect(await screen.findByText('No blocks found')).toBeInTheDocument();
    expect(screen.getByText('Create your first block to get started.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create Block/ }));
    expect(screen.getByRole('heading', { name: 'Create Block' })).toBeInTheDocument();
    unmount();

    const api2 = setupApi({ tree: [] });
    renderFilters(role('OPERATOR', ['ASSET_READ']), api2);
    expect(await screen.findByText('No blocks available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create Block/ })).toBeNull();
  });

  it('renders the loading state before the tree arrives', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const api = setupApi();
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).includes('/api/hierarchy/tree')) await gate;
      return orig(input, init);
    }) as any;
    renderFilters(SA, api);
    expect(await screen.findByText('Loading blocks...')).toBeInTheDocument();
    release();
    expect(await screen.findByText('Block Alpha')).toBeInTheDocument();
  });

  it('keyboard Enter / Space on a block card opens it; Back returns to the grid', async () => {
    const api = setupApi();
    renderFilters(SA, api);
    const card = await screen.findByRole('button', { name: /Block Alpha/ });
    fireEvent.keyDown(card, { key: 'x' });
    expect(screen.queryByText('Hierarchy')).toBeNull();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(await screen.findByText('Hierarchy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Block Alpha');
    expect(screen.getByText('7 filter(s) in this block')).toBeInTheDocument();
    // Back arrow is the first button in the header
    const header = screen.getByRole('heading', { level: 1 }).closest('div')!.parentElement!.parentElement!;
    fireEvent.click(within(header).getAllByRole('button')[0]);
    expect(await screen.findByText('Total Blocks')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: /Block Beta/ }), { key: ' ' });
    expect(await screen.findByText('Hierarchy')).toBeInTheDocument();
  });

  it('a non-creator sees no "New Block" card; a creator gets the Create Block dialog from it', async () => {
    const api = setupApi();
    const { unmount } = renderFilters(role('OPERATOR', ['ASSET_READ']), api);
    await screen.findByText('Block Alpha');
    expect(screen.queryByText('New Block')).toBeNull();
    expect(screen.queryByTitle('Edit block name')).toBeNull();
    expect(screen.queryByTitle('Delete block')).toBeNull();
    unmount();

    renderFilters(role('ADMIN', ['FILTER_HIERARCHY_CREATE']), setupApi());
    fireEvent.click(await screen.findByText('New Block'));
    expect(screen.getByRole('heading', { name: 'Create Block' })).toBeInTheDocument();
  });

  it('a failed tree load is surfaced as a Load Error toast', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = setupApi({ extra: [{ path: '/api/hierarchy/tree', status: 500, body: { error: 'INTERNAL', message: 'Tree query failed' } }] });
    renderFilters(SA, api);
    expect(await screen.findByText('Tree query failed')).toBeInTheDocument();
    expect(screen.getByText('No blocks found')).toBeInTheDocument();
  });
});

describe('Filters page — Structure tab (hierarchy diagram)', () => {
  it('draws Block → Areas/AHUs → Filters with status labels and RFID; clicking a node scopes the Filters tab', async () => {
    const api = setupApi();
    renderFilters(SA, api);
    await openBlock();
    // diagram nodes (inactive area + inactive filter are not drawn)
    expect(screen.getByRole('button', { name: /Area North/ })).toBeInTheDocument();
    expect(screen.queryByText('Area Old')).toBeNull();
    expect(screen.queryByText('PF-009')).toBeNull();
    const pf1Node = screen.getByRole('button', { name: /PF-001/ });
    expect(pf1Node).toHaveTextContent('Wash In');
    expect(pf1Node).toHaveTextContent('E200AA');
    expect(pf1Node).toHaveTextContent('SET A');
    expect(screen.getByRole('button', { name: /HF-007/ })).toHaveTextContent('CUSTOM STATE');
    expect(screen.getByRole('button', { name: /PF-002/ })).toHaveTextContent('To Be Cleaned');

    // Area node → Filters tab scoped to the area: Area column hidden, chip shown
    fireEvent.click(screen.getByRole('button', { name: /Area North/ }));
    expect(await screen.findByText('AREA: Area North')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Area' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'AHU' })).toBeInTheDocument();
    expect(screen.queryByText('HF-007')).toBeNull();
    expect(screen.getByText('PF-001')).toBeInTheDocument();
  });

  it('AHU / filter / block node scopes: column visibility follows the scope; chip ✕ shows all', async () => {
    renderFilters(SA, setupApi());
    await openBlock();
    fireEvent.click(screen.getByRole('button', { name: /AHU-02/ }));
    expect(await screen.findByText('AHU: AHU-02')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'AHU' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Area' })).toBeNull();
    expect(screen.getByText('HF-007')).toBeInTheDocument();
    expect(screen.queryByText('PF-001')).toBeNull();
    fireEvent.click(screen.getByTitle('Show all'));
    expect(await screen.findByText('PF-001')).toBeInTheDocument();

    // back to Structure, click a filter node
    fireEvent.click(screen.getByRole('button', { name: 'Structure' }));
    fireEvent.click(await screen.findByRole('button', { name: /PF-002/ }));
    expect(await screen.findByText('FILTER: PF-002')).toBeInTheDocument();
    expect(screen.queryByText('PF-001')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Structure' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Block Alpha Block$/ }));
    expect(await screen.findByText('BLOCK: Block Alpha')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Area' })).toBeInTheDocument();
    expect(screen.getByText('PF-001')).toBeInTheDocument();
    expect(screen.getByText('HF-007')).toBeInTheDocument();
  });

  it('zoom controls clamp between 50% and 150%; Full screen falls back to CSS when the API is missing', async () => {
    renderFilters(SA, setupApi());
    await openBlock();
    const reset = screen.getByTitle('Reset zoom and center');
    expect(reset).toHaveTextContent('100%');
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByTitle('Zoom in'));
    expect(reset).toHaveTextContent('150%');
    expect(screen.getByTitle('Zoom in')).toBeDisabled();
    fireEvent.click(reset);
    expect(reset).toHaveTextContent('100%');
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByTitle('Zoom out'));
    expect(reset).toHaveTextContent('50%');
    expect(screen.getByTitle('Zoom out')).toBeDisabled();
    fireEvent.click(screen.getByTitle('Center view'));
  });

  it('Full screen: a refused Fullscreen API falls back to the CSS overlay; a granted one tracks fullscreenchange', async () => {
    const proto = HTMLElement.prototype as any;
    const docAny = document as any;
    proto.requestFullscreen = vi.fn().mockRejectedValueOnce(new Error('denied by permission policy'));
    try {
      renderFilters(SA, setupApi());
      await openBlock();
      fireEvent.click(screen.getByTitle('Full screen'));
      expect(await screen.findByTitle('Exit full screen (Esc)')).toBeInTheDocument();
      // second click: API now resolves; the browser then reports the element as fullscreen
      proto.requestFullscreen.mockResolvedValueOnce(undefined);
      fireEvent.click(screen.getByTitle('Exit full screen (Esc)'));
      await waitFor(() => expect(proto.requestFullscreen).toHaveBeenCalledTimes(2));
      const wrapper = screen.getByText('Hierarchy').closest('.relative.flex.flex-col') as HTMLElement;
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => wrapper });
      docAny.exitFullscreen = vi.fn().mockResolvedValue(undefined);
      fireEvent(document, new Event('fullscreenchange'));
      expect(await screen.findByTitle('Exit full screen (Esc)')).toBeInTheDocument();
      fireEvent.click(screen.getByTitle('Exit full screen (Esc)'));
      await waitFor(() => expect(docAny.exitFullscreen).toHaveBeenCalled());
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
      fireEvent(document, new Event('fullscreenchange'));
      expect(await screen.findByTitle('Full screen')).toBeInTheDocument();
    } finally {
      delete proto.requestFullscreen;
      delete docAny.exitFullscreen;
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    }
  });

  it('drag-to-pan moves the canvas scroll; tiny movements are ignored and buttons do not start a pan', async () => {
    renderFilters(SA, setupApi());
    await openBlock();
    const scroller = document.querySelector('[data-no-drag-pan]') as HTMLElement;
    fireEvent.mouseDown(scroller, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(scroller, { clientX: 102, clientY: 101 }); // under threshold
    expect(scroller.className).toContain('cursor-grab');
    expect(scroller.className).not.toContain('cursor-grabbing');
    fireEvent.mouseMove(scroller, { clientX: 60, clientY: 80 });
    expect(scroller.className).toContain('cursor-grabbing');
    // dragged 40px left / 20px up from a 0,0 scroll origin
    expect(scroller.scrollLeft).toBe(40);
    expect(scroller.scrollTop).toBe(20);
    fireEvent.mouseUp(scroller);
    expect(scroller.className).not.toContain('cursor-grabbing');
    // starting on a node button never pans
    fireEvent.mouseDown(screen.getByRole('button', { name: /Area North/ }), { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(scroller, { clientX: 300, clientY: 300 });
    expect(scroller.className).not.toContain('cursor-grabbing');
    fireEvent.mouseLeave(scroller);
  });
});

describe('Filters page — Filters tab table', () => {
  it('renders each column from the tree + identifiers, approval badges, NA and fallbacks', async () => {
    renderFilters(SA, setupApi());
    await openFiltersTab();
    const r1 = row('PF-001');
    expect(r1).toHaveTextContent('Area North');
    expect(within(r1).getByRole('link', { name: 'AHU-01' })).toHaveAttribute('href', '/ahus/h1');
    expect(r1).toHaveTextContent('Process');
    expect(r1).toHaveTextContent('Pre');
    expect(r1).toHaveTextContent('10 µm');
    expect(r1).toHaveTextContent('610x610');
    expect(r1).toHaveTextContent('Set A');
    expect(r1).toHaveTextContent('Wash In');
    expect(r1).toHaveTextContent('E200AA');
    expect(within(r1).getByTitle(/^Last cleaned:/)).toBeInTheDocument();

    const r2 = row('PF-002');
    expect(r2).toHaveTextContent('Set B');
    expect(r2).toHaveTextContent('NA');
    expect(r2).toHaveTextContent('To Be Cleaned');
    expect(r2).not.toHaveTextContent('QR-2'); // only RFID tags are shown

    const r7 = row('HF-007');
    expect(r7).toHaveTextContent('CUSTOM STATE');
    expect(within(r7).getAllByText('--').length).toBeGreaterThanOrEqual(3); // no area, no set, no rfid…

    expect(row('PF-003')).toHaveTextContent('Pending Review');
    expect(row('PF-004')).toHaveTextContent('Pending Approval');
    expect(row('PF-005')).toHaveTextContent('Rejected');
    expect(screen.queryByText('PF-009')).toBeNull();
  });

  it('search narrows across name / RFID / state; clear button and "No filters match" message', async () => {
    renderFilters(SA, setupApi());
    await openFiltersTab();
    const search = screen.getByPlaceholderText('Search filters…');
    fireEvent.change(search, { target: { value: 'e200aa' } });
    expect(screen.getByText('PF-001')).toBeInTheDocument();
    expect(screen.queryByText('PF-002')).toBeNull();
    fireEvent.change(search, { target: { value: 'custom state' } });
    expect(screen.getByText('HF-007')).toBeInTheDocument();
    expect(screen.queryByText('PF-001')).toBeNull();
    fireEvent.change(search, { target: { value: 'nothing-like-this' } });
    expect(screen.getByText('No filters match your search')).toBeInTheDocument();
    expect(screen.getByText('No filter matches “nothing-like-this” in this block.')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Clear search'));
    expect(await screen.findByText('PF-001')).toBeInTheDocument();
  });

  it('an empty block says "No filters in this block"', async () => {
    renderFilters(SA, setupApi());
    await openFiltersTab('Block Beta', '');
    expect(await screen.findByText('No filters in this block')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Filter' })).toBeNull();
  });

  it('paginates client-side: 12 filters → 10 per page, page 2 numbering continues', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...F.pf2, id: `m${i}`, name: `MF-${String(i + 1).padStart(2, '0')}` }));
    renderFilters(SA, setupApi({ tree: makeTree({ ahu1Filters: many, ahu2Filters: [] }) }));
    await openFiltersTab('Block Alpha', 'MF-01');
    expect(screen.queryByText('MF-11')).toBeNull();
    expect(screen.getByText(/Showing/).parentElement).toHaveTextContent('Showing 1–10 of 12');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('MF-11')).toBeInTheDocument();
    expect(row('MF-11').querySelectorAll('td')[1]).toHaveTextContent('11');
    // narrowing the list while on page 2 clamps back to page 1
    fireEvent.change(screen.getByPlaceholderText('Search filters…'), { target: { value: 'MF-0' } });
    expect(await screen.findByText('MF-01')).toBeInTheDocument();
  });

  it('a non-SA viewer without row permissions sees only the Details eye on approved rows', async () => {
    renderFilters(role('OPERATOR', ['ASSET_READ']), setupApi());
    await openFiltersTab();
    const r1 = row('PF-001');
    expect(within(r1).getByTitle('Filter Details')).toBeInTheDocument();
    for (const t of ['Edit Filter', 'Delete Filter', 'Update Status', 'Retire / Replace', 'RFID Tag']) {
      expect(within(r1).queryByTitle(t)).toBeNull();
    }
    expect(within(r1).queryByRole('checkbox')).toBeInTheDocument(); // approved rows are selectable
    // no workflow buttons on pending rows for a viewer without review/approve
    expect(within(row('PF-003')).queryByRole('button', { name: /Review/ })).toBeNull();
    expect(within(row('PF-003')).queryByRole('checkbox')).toBeNull();
    expect(within(row('PF-005')).queryByTitle('Correct this rejected filter')).toBeNull();
    expect(within(row('PF-005')).queryByRole('button', { name: /Resubmit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bulk Upload' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create Filter' })).toBeNull();
  });

  it('the Retire/Replace control title follows the role grant', async () => {
    const { unmount } = renderFilters(role('X', ['FILTER_RETIRE']), setupApi());
    await openFiltersTab();
    expect(within(row('PF-001')).getByTitle('Retire Filter')).toBeInTheDocument();
    unmount();
    renderFilters(role('X', ['FILTER_REPLACE']), setupApi());
    await openFiltersTab();
    expect(within(row('PF-001')).getByTitle('Replace Filter')).toBeInTheDocument();
  });

  it('ADMIN with all filter grants gets the full action cluster but no SA edit on a lifecycle-retired row', async () => {
    renderFilters(ADMIN_ALL, setupApi());
    await openFiltersTab();
    const r1 = row('PF-001');
    for (const t of ['Edit Filter', 'Delete Filter', 'Update Status', 'Retire / Replace', 'RFID Tag', 'Filter Details']) {
      expect(within(r1).getByTitle(t)).toBeInTheDocument();
    }
    const r6 = row('PF-006');
    expect(r6).toHaveTextContent('Retired');
    expect(within(r6).queryByTitle(/Edit Filter/)).toBeNull();
    expect(within(r6).queryByRole('checkbox')).toBeNull();
    // pending rows get their step and a checkbox for the step owner
    expect(within(row('PF-003')).getByRole('button', { name: 'Review' })).toBeInTheDocument();
    expect(within(row('PF-004')).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(row('PF-003')).getByRole('checkbox')).toBeInTheDocument();
    // toolbar: bulk workflow counts
    expect(screen.getByRole('button', { name: 'Review (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve (1)' })).toBeInTheDocument();
  });

  it('SUPER_ADMIN can edit a lifecycle-retired row (Super Admin edit)', async () => {
    const api = setupApi();
    renderFilters(SA, api);
    await openFiltersTab();
    await waitFor(() => expect(within(row('PF-006')).getByTitle('Edit Filter (Super Admin)')).toBeInTheDocument());
  });
});

describe('Filters page — configured page size (D6 class)', () => {
  it('pages by the first CONFIGURED rows-per-page option, not the pre-load fallback', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...F.pf2, id: `m${i}`, name: `MF-${String(i + 1).padStart(2, '0')}` }));
    renderFilters(SA, setupApi({ tree: makeTree({ ahu1Filters: many, ahu2Filters: [] }), base: { pagination: { limit: 25, options: [5, 25, 50] } } }));
    await openFiltersTab('Block Alpha', 'MF-01');
    await waitFor(() => expect(screen.getByText(/Showing/).parentElement).toHaveTextContent('Showing 1–5 of 12'));
    expect(screen.queryByText('MF-06')).toBeNull();
  });
});
