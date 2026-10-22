/**
 * Block -> AHU scope filter shared by the Replacement and Retirement lists.
 * Rendered through the page harness: real SWR fetcher + apiClient, only `fetch` stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderPage, mockApi, type MockApi } from '@/test-utils/page-harness';
import { BlockAhuFilter, useBlockAhuScope, type ScopedRow } from '../block-ahu-filter';
import { expectAllControlsNamed } from './support/a11y';

const ROWS: (ScopedRow & { name: string })[] = [
  { name: 'F-1', blockId: 'b-cwh', ahuId: 'h-0a' },
  { name: 'F-2', blockId: 'b-cwh', ahuId: 'h-0b' },
  { name: 'F-3', blockId: 'b-osd', ahuId: 'h-10' },
];

function Harness({ onChange }: { onChange?: () => void }) {
  const scope = useBlockAhuScope();
  const visible = ROWS.filter(scope.matches).map((r) => r.name);
  return (
    <div>
      <BlockAhuFilter scope={scope} onChange={onChange} />
      <p data-testid="rows">{visible.join(',')}</p>
      <p data-testid="label">{scope.scopeLabel}</p>
      <p data-testid="active">{String(scope.isActive)}</p>
      <button onClick={scope.reset}>Clear scope</button>
    </div>
  );
}

let api: MockApi;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
  api = mockApi([
    // Deliberately unsorted, with a numeric-aware name pair (AHU-10 after AHU-0B).
    { path: '/api/hierarchy/blocks', body: { data: [{ id: 'b-osd', name: 'OSD' }, { id: 'b-cwh', name: 'CWH' }] } },
    { path: '/api/hierarchy/ahus', body: { data: [
      { id: 'h-10', name: 'AHU-10', blockId: 'b-osd' },
      { id: 'h-0b', name: 'AHU-0B', areaId: 'ar-1' },       // resolved through its Area
      { id: 'h-0a', name: 'AHU-0A', blockId: 'b-cwh' },
    ] } },
    { path: '/api/hierarchy/areas', body: { data: [{ id: 'ar-1', name: 'Area 1', blockId: 'b-cwh' }] } },
  ]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const options = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);

async function ready() {
  renderPage(<Harness />, { user: { role: 'QA' }, api });
  const [block, ahu] = screen.getAllByRole('combobox');
  await waitFor(() => expect(options(block)).toEqual(['All blocks', 'CWH', 'OSD']));
  await waitFor(() => expect(options(ahu)).toEqual(['All AHUs', 'AHU-0A', 'AHU-0B', 'AHU-10']));
  return { block, ahu };
}

describe('BlockAhuFilter / useBlockAhuScope', () => {
  it('loads blocks and AHUs, sorted by name, and starts unscoped (every row shown)', async () => {
    await ready();
    expect(screen.getByTestId('rows')).toHaveTextContent('F-1,F-2,F-3');
    expect(screen.getByTestId('label')).toHaveTextContent('');
    expect(screen.getByTestId('active')).toHaveTextContent('false');
    for (const p of ['/api/hierarchy/blocks', '/api/hierarchy/ahus', '/api/hierarchy/areas']) expect(api.calls('GET', p)).toHaveLength(1);
    expect(api.unmatched).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('choosing a Block narrows the rows and the AHU list — including an AHU that hangs off an Area', async () => {
    const { block, ahu } = await ready();
    fireEvent.change(block, { target: { value: 'b-cwh' } });
    expect(screen.getByTestId('rows')).toHaveTextContent('F-1,F-2');
    expect(options(ahu)).toEqual(['All AHUs in block', 'AHU-0A', 'AHU-0B']);
    expect(screen.getByTestId('label')).toHaveTextContent('Block CWH');
    expect(screen.getByTestId('active')).toHaveTextContent('true');
  });

  it('an AHU selection wins over the Block, and the label shows both', async () => {
    const { block, ahu } = await ready();
    fireEvent.change(block, { target: { value: 'b-cwh' } });
    fireEvent.change(ahu, { target: { value: 'h-0b' } });
    expect(screen.getByTestId('rows')).toHaveTextContent(/^F-2$/);
    expect(screen.getByTestId('label')).toHaveTextContent('Block CWH › AHU-0B');
  });

  it('an AHU alone (no Block) scopes to that AHU', async () => {
    const { ahu } = await ready();
    fireEvent.change(ahu, { target: { value: 'h-10' } });
    expect(screen.getByTestId('rows')).toHaveTextContent(/^F-3$/);
    expect(screen.getByTestId('label')).toHaveTextContent(/^AHU-10$/);
  });

  it('changing the Block clears the AHU (a stale AHU would empty the table for no visible reason)', async () => {
    const { block, ahu } = await ready();
    fireEvent.change(ahu, { target: { value: 'h-10' } });
    fireEvent.change(block, { target: { value: 'b-cwh' } });
    expect((ahu as HTMLSelectElement).value).toBe('');
    expect(screen.getByTestId('rows')).toHaveTextContent('F-1,F-2');
  });

  it('reset() clears both dropdowns', async () => {
    const { block, ahu } = await ready();
    fireEvent.change(block, { target: { value: 'b-osd' } });
    fireEvent.change(ahu, { target: { value: 'h-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear scope' }));
    expect((block as HTMLSelectElement).value).toBe('');
    expect((ahu as HTMLSelectElement).value).toBe('');
    expect(screen.getByTestId('active')).toHaveTextContent('false');
  });

  it('calls onChange after either dropdown changes (pages reset pagination there)', async () => {
    const onChange = vi.fn();
    renderPage(<Harness onChange={onChange} />, { user: { role: 'QA' }, api });
    const [block, ahu] = screen.getAllByRole('combobox');
    await waitFor(() => expect(options(block)).toHaveLength(3));
    fireEvent.change(block, { target: { value: 'b-cwh' } });
    fireEvent.change(ahu, { target: { value: 'h-0a' } });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('with the hierarchy unavailable the dropdowns hold only their "All" option', async () => {
    vi.unstubAllGlobals();
    consoleError.mockImplementation(() => {});
    api = mockApi([
      { path: '/api/hierarchy/blocks', status: 500, body: { error: 'X', message: 'down' } },
      { path: '/api/hierarchy/ahus', status: 500, body: { error: 'X', message: 'down' } },
      { path: '/api/hierarchy/areas', status: 500, body: { error: 'X', message: 'down' } },
    ]);
    renderPage(<Harness />, { user: { role: 'QA' }, api });
    const [block, ahu] = screen.getAllByRole('combobox');
    await waitFor(() => expect(api.calls('GET', '/api/hierarchy/areas')).toHaveLength(1));
    expect(options(block)).toEqual(['All blocks']);
    expect(options(ahu)).toEqual(['All AHUs']);
    expect(screen.getByTestId('rows')).toHaveTextContent('F-1,F-2,F-3');
  });

  // WSH-A11Y-1: each visible caption names its dropdown.
  it('the Block and AHU captions name their dropdowns, and every control has a name', async () => {
    const { block, ahu } = await ready();
    expect(screen.getByRole('combobox', { name: 'Block' })).toBe(block);
    expect(screen.getByRole('combobox', { name: 'AHU' })).toBe(ahu);
    expectAllControlsNamed(document.body);
  });
});
