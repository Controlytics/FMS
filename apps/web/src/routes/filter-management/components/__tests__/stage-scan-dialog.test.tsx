import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { mockApi, renderPage, type MockApi } from '@/test-utils/page-harness';
import { usePageTestLifecycle } from '../../__tests__/fm-test-kit';
import { installFakeIndexedDB, openAppDb, cacheRow } from '../../hooks/__tests__/fake-indexeddb';
import { StageScanDialog } from '../stage-scan-dialog';

usePageTestLifecycle();

const WASH = { key: 'WASH_IN', label: 'Wash In', icon: '💧', color: 'from-cyan-500 to-cyan-600', border: 'x', needsBlock: true };
const DRY = { ...WASH, key: 'DRY_IN', label: 'Dry In' };
const INSTANCES = [
  { id: 'ahu1', name: 'AHU-1' },
  { id: 'f1', name: 'FLT-001', parentId: 'ahu1' },
  { id: 'f2', name: 'FLT-ORPHAN' },
  { id: 'f3', name: 'FLT-LOST', parentId: 'gone' },
];

type Props = Partial<React.ComponentProps<typeof StageScanDialog>>;
function setup(props: Props = {}, api: MockApi = mockApi()) {
  const spies = {
    onScanValueChange: vi.fn(), onRemarksChange: vi.fn(), onClearError: vi.fn(), onBlockSelect: vi.fn(),
    onChangeBlock: vi.fn(), onAddToQueue: vi.fn(), onRemoveFromQueue: vi.fn(), onSubmitBatch: vi.fn(), onClose: vi.fn(),
  };
  function Host() {
    const [scanValue, setScanValue] = useState(props.scanValue ?? '');
    const [stage, setStage] = useState<any>(props.activeStage === undefined ? WASH : props.activeStage);
    return (
      <>
        <button onClick={() => setStage(stage ? null : WASH)}>toggle-stage</button>
        <StageScanDialog
          activeStage={stage} step="scan" blocks={[]} selectedBlock={null} remarks="" error="" loading={false} queue={[]} addingToQueue={false}
          instances={INSTANCES}
          {...spies}
          {...props}
          scanValue={scanValue}
          onScanValueChange={(v) => { spies.onScanValueChange(v); setScanValue(v); }}
        />
      </>
    );
  }
  const view = renderPage(<Host />, { api });
  return { ...spies, ...view };
}

const scanInput = () => screen.getByPlaceholderText('Scan tag or type filter name');
const scan = (v: string) => fireEvent.change(scanInput(), { target: { value: v } });
/** The value printed beside a label in the looked-up filter card ("Filter" / "AHU"). */
const info = async (label: 'Filter' | 'AHU') => (await screen.findByText(label, { selector: 'span' })).nextElementSibling?.textContent;

describe('StageScanDialog — block step', () => {
  it('renders nothing without an active stage', () => {
    setup({ activeStage: null });
    expect(screen.queryByText('Wash In')).toBeNull();
  });

  it('lists blocks (with grade) and reports the chosen block; Cancel closes', () => {
    const blocks = [{ id: 'b1', name: 'Block A', attributes: { grade: 'Grade C' } }, { id: 'b2', name: 'Block B' }];
    const s = setup({ step: 'block', blocks });
    expect(screen.getByText('Step 1: Select Block')).toBeInTheDocument();
    expect(screen.getByText('Grade C')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Block B/ }));
    expect(s.onBlockSelect).toHaveBeenCalledWith(blocks[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(s.onClose).toHaveBeenCalled();
  });

  it('says "No blocks found" when there are none', () => {
    setup({ step: 'block', blocks: [] });
    expect(screen.getByText('No blocks found')).toBeInTheDocument();
  });
});

describe('StageScanDialog — scanning', () => {
  it('shows the selected block with a Change link; without one asks to scan', () => {
    const s = setup({ selectedBlock: { id: 'b1', name: 'Block A' } });
    expect(screen.getByText('Block: Block A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(s.onChangeBlock).toHaveBeenCalled();
  });

  it('a reader burst is normalised (upper-case, doubled EPC collapsed), looked up online, then added on Continue', async () => {
    const api = mockApi([{ path: '/api/assets/identifiers/lookup/E200ABCD', body: { asset: { name: 'FLT-001', parent: { name: 'AHU-1' } } } }]);
    const s = setup({}, api);
    expect(screen.getByText('Scan filter to proceed')).toBeInTheDocument();
    scan('e200abcde200abcd');
    expect(s.onClearError).toHaveBeenCalled();
    expect(await screen.findByText('E200ABCD')).toBeInTheDocument();
    expect(screen.getByText('Tag Detected')).toBeInTheDocument();
    expect(await screen.findByText('FLT-001')).toBeInTheDocument();
    expect(screen.getByText('AHU-1')).toBeInTheDocument();
    // remarks + manual add are hidden while a tag is held
    expect(screen.queryByPlaceholderText('Remarks (optional)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Add to Queue/ }));
    expect(s.onAddToQueue).toHaveBeenCalledWith('E200ABCD');
    expect(s.onScanValueChange).toHaveBeenLastCalledWith('');
    expect(scanInput()).toHaveValue('');
  });

  it('a tripled burst collapses to one EPC; an asset with no name/parent shows placeholders', async () => {
    const api = mockApi([{ path: '/api/assets/identifiers/lookup/ABC123', body: { asset: {} } }]);
    setup({}, api);
    scan('abc123abc123abc123');
    expect(await screen.findByText('ABC123')).toBeInTheDocument();
    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('fewer than 3 characters is not treated as a tag', async () => {
    setup();
    scan('ab');
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(screen.queryByText('Tag Detected')).toBeNull();
  });

  it('server lookup miss → falls back to the cached identifier map (any case) with the AHU from cached instances', async () => {
    const idb = installFakeIndexedDB();
    await openAppDb();
    idb.seed('cache', [cacheRow('identifier-map', { e300: { filterId: 'f1', filterName: 'FLT-001 (cached)' } })]);
    const api = mockApi([{ path: '/api/assets/identifiers/lookup/E300', status: 404, body: { error: 'NOT_FOUND', message: 'No asset' } }]);
    setup({}, api);
    scan('e300');
    expect(await screen.findByText('FLT-001 (cached)')).toBeInTheDocument();
    expect(screen.getByText('AHU-1')).toBeInTheDocument();
  });

  it('cached identifier for a filter without a cached parent shows "—" for the AHU', async () => {
    const idb = installFakeIndexedDB();
    await openAppDb();
    idb.seed('cache', [cacheRow('identifier-map', { E301: { filterId: 'f3', filterName: 'FLT-LOST' }, E302: { filterId: 'f2', filterName: 'FLT-ORPHAN' } })]);
    const api = mockApi([{ path: /\/api\/assets\/identifiers\/lookup\//, body: {} }]);
    setup({}, api);
    scan('E301');
    expect(await screen.findByText('FLT-LOST')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    scan('E302');
    expect(await screen.findByText('FLT-ORPHAN')).toBeInTheDocument();
  });

  it('no server answer and no cache entry → matches a cached instance by NAME (case-insensitive)', async () => {
    const idb = installFakeIndexedDB();
    await openAppDb();
    idb.seed('cache', [cacheRow('identifier-map', { OTHER: { filterId: 'x', filterName: 'x' } })]);
    const api = mockApi([{ path: /\/api\/assets\/identifiers\/lookup\//, status: 404, body: { error: 'NOT_FOUND' } }]);
    setup({}, api);
    scan('flt-001');
    expect(await info('Filter')).toBe('FLT-001');
    expect(await info('AHU')).toBe('AHU-1');
  });

  it('name match on an instance without/with a missing parent shows "—"', async () => {
    const api = mockApi([{ path: /\/api\/assets\/identifiers\/lookup\//, status: 404, body: { error: 'NOT_FOUND' } }]);
    setup({}, api); // no IndexedDB at all → cache read throws, still falls through to the name match
    scan('flt-orphan');
    expect(await info('Filter')).toBe('FLT-ORPHAN');
    expect(await info('AHU')).toBe('—');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    scan('flt-lost');
    expect(await info('Filter')).toBe('FLT-LOST');
    expect(await info('AHU')).toBe('—');
  });

  it('nothing found anywhere: says so, still allows Continue; Remove clears the tag', async () => {
    const api = mockApi([{ path: /\/api\/assets\/identifiers\/lookup\//, status: 404, body: { error: 'NOT_FOUND' } }]);
    const s = setup({}, api);
    scan('UNKNOWN-TAG');
    expect(await screen.findByText(/No filter found for this tag/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('Tag Detected')).toBeNull();
    expect(scanInput()).toHaveValue('');
    expect(s.onScanValueChange).toHaveBeenLastCalledWith('');
  });

  it('closing the stage clears a held tag', async () => {
    const api = mockApi([{ path: /\/api\/assets\/identifiers\/lookup\//, status: 404, body: { error: 'NOT_FOUND' } }]);
    setup({}, api);
    scan('TAG-123');
    await screen.findByText('Tag Detected');
    fireEvent.click(screen.getByRole('button', { name: 'toggle-stage' }));
    expect(screen.queryByText('Wash In')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'toggle-stage' }));
    expect(screen.queryByText('Tag Detected')).toBeNull();
  });

  it('manual add sends the trimmed value; disabled when blank or while adding', () => {
    const s = setup({ scanValue: '  FLT-7 ' });
    fireEvent.click(screen.getByRole('button', { name: /Add to Queue/ }));
    expect(s.onAddToQueue).toHaveBeenCalledWith('FLT-7');
    expect(screen.getByRole('button', { name: /Add to Queue/ })).toBeDisabled();
  });

  it('remarks, error and the adding spinner are rendered from props', () => {
    const s = setup({ error: 'Filter not found', addingToQueue: true, scanValue: 'x' });
    fireEvent.change(screen.getByPlaceholderText('Remarks (optional)'), { target: { value: 'dusty' } });
    expect(s.onRemarksChange).toHaveBeenCalledWith('dusty');
    expect(screen.getByText('Filter not found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add to Queue/ })).toBeNull();
  });
});

describe('StageScanDialog — queue', () => {
  const queue = [{ filterId: 'f1', filterName: 'FLT-001', tagId: 'T1' }, { filterId: 'f2', filterName: 'FLT-002', tagId: 'T2' }];

  it('lists the queue, removes an item, and submits all', () => {
    const s = setup({ queue });
    expect(screen.getByText('Queue (2)')).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
    expect(s.onRemoveFromQueue).toHaveBeenCalledWith('f2');
    fireEvent.click(screen.getByRole('button', { name: 'Submit All (2)' }));
    expect(s.onSubmitBatch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(s.onClose).toHaveBeenCalled();
  });

  it('Submit is disabled with an empty queue and while submitting', () => {
    setup({ queue: [] });
    expect(screen.getByRole('button', { name: 'Submit All (0)' })).toBeDisabled();
  });

  it('loading replaces the Submit label and disables it', () => {
    setup({ queue, loading: true });
    expect(screen.queryByRole('button', { name: /Submit All/ })).toBeNull();
  });

  it('Dry In multi-select: per-row + select-all ticks, one dryer duration for the selection', () => {
    const onToggleSelect = vi.fn();
    const onSelectAll = vi.fn();
    const onDryerDurationChange = vi.fn();
    setup({ activeStage: DRY, queue, selectedIds: new Set(['f1']), onToggleSelect, onSelectAll, dryerDuration: 45, onDryerDurationChange });
    expect(screen.getByText(/Queue \(2\) · 1 selected/)).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[0].checked).toBe(false); // select-all: not every row ticked
    fireEvent.click(boxes[0]);
    expect(onSelectAll).toHaveBeenCalledWith(true);
    fireEvent.click(boxes[2]);
    expect(onToggleSelect).toHaveBeenCalledWith('f2');
    const dur = screen.getByRole('combobox') as HTMLSelectElement;
    expect(dur.value).toBe('45');
    expect([...dur.options].map((o) => o.textContent)).toEqual(['5 min', '10 min', '15 min', '30 min', '45 min', '1h', '1h 30m', '2h', '3h', '4h']);
    fireEvent.change(dur, { target: { value: '90' } });
    expect(onDryerDurationChange).toHaveBeenCalledWith(90);
    expect(screen.getByRole('button', { name: 'Submit Selected (1)' })).toBeEnabled();
  });

  it('multi-select with nothing ticked disables Submit', () => {
    setup({ queue, selectedIds: new Set(), onToggleSelect: vi.fn(), onSelectAll: vi.fn() });
    expect(screen.getByRole('button', { name: 'Submit Selected (0)' })).toBeDisabled();
  });

  it('multi-select with every row ticked shows select-all checked', () => {
    setup({ queue, selectedIds: new Set(['f1', 'f2']), onToggleSelect: vi.fn(), onSelectAll: vi.fn() });
    expect((screen.getByTitle('Select all') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Submit Selected (2)' })).toBeEnabled();
  });

  it('dryer duration control is only offered on Dry In', () => {
    setup({ queue, onDryerDurationChange: vi.fn() });
    expect(screen.queryByText('Dryer duration for selected')).toBeNull();
  });
});

describe('StageScanDialog — layout', () => {
  it('modal: a backdrop click closes, a click on the card does not', () => {
    const s = setup();
    fireEvent.click(screen.getByText('Wash In'));
    expect(s.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Wash In').closest('.fixed')!);
    expect(s.onClose).toHaveBeenCalledTimes(1);
  });

  it('full page: no backdrop, so clicking the wrapper does not close', () => {
    const s = setup({ fullPage: true });
    const wrapper = screen.getByText('Wash In').closest('.w-full')!;
    fireEvent.click(wrapper.parentElement!);
    expect(s.onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
  });
});

describe('StageScanDialog — timing', () => {
  it('waits for the burst to finish (300 ms quiet) before treating input as a tag', async () => {
    const api = mockApi([{ path: /\/api\/assets\/identifiers\/lookup\//, status: 404, body: { error: 'NOT_FOUND' } }]);
    setup({}, api);
    scan('E2');
    scan('E200');
    scan('E200FF');
    await waitFor(() => expect(screen.getByText('E200FF')).toBeInTheDocument());
    // one lookup for the final value only
    expect(api.calls('GET', /lookup/).map((r) => r.path)).toEqual(['/api/assets/identifiers/lookup/E200FF']);
  });
});

describe('StageScanDialog — in-flight states', () => {
  it('shows "Looking up filter..." while the lookup is in flight, and a busy Add while the parent is adding', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const api = mockApi([{ path: /\/api\/assets\/identifiers\/lookup\//, body: { asset: { name: 'FLT-001', parent: { name: 'AHU-1' } } } }]);
    const harnessFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (...a: any[]) => { await gate; return (harnessFetch as any)(...a); }));
    function Host() {
      const [v, setV] = useState('');
      const [adding, setAdding] = useState(false);
      return (
        <>
          <button onClick={() => setAdding(true)}>start-adding</button>
          <StageScanDialog activeStage={WASH} step="scan" blocks={[]} selectedBlock={null} scanValue={v} remarks="" error="" loading={false} queue={[]}
            addingToQueue={adding} onScanValueChange={setV} onRemarksChange={vi.fn()} onClearError={vi.fn()} onBlockSelect={vi.fn()} onChangeBlock={vi.fn()}
            onAddToQueue={vi.fn()} onRemoveFromQueue={vi.fn()} onSubmitBatch={vi.fn()} onClose={vi.fn()} />
        </>
      );
    }
    renderPage(<Host />, { api });
    scan('E400');
    expect(await screen.findByText('Looking up filter...')).toBeInTheDocument();
    expect(screen.queryByText(/No filter found/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'start-adding' }));
    const buttons = screen.getAllByRole('button');
    const addBtn = buttons[buttons.length - 3]; // [... Remove, Add(busy), Close, Submit]
    expect(addBtn).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Add to Queue/ })).toBeNull();
    await act(async () => { release(); await gate; });
    expect(await screen.findByText('AHU-1')).toBeInTheDocument();
    expect(screen.queryByText('Looking up filter...')).toBeNull();
  });
});
