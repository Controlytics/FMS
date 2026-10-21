import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { usePageTestLifecycle } from '../../__tests__/fm-test-kit';
import { AhuSetChooserDialog } from '../ahu-set-chooser-dialog';
import { DryerDurationDialog } from '../dryer-duration-dialog';
import { BlockChangeRequestDialog } from '../block-change-request-dialog';
import { RemainingFiltersDialog, type AhuCard } from '../remaining-filters-dialog';

usePageTestLifecycle();

describe('AhuSetChooserDialog', () => {
  it('offers Set A, Set B and All Filters and reports the chosen set', () => {
    const onChoose = vi.fn();
    render(<AhuSetChooserDialog onChoose={onChoose} onCancel={vi.fn()} />);
    expect(screen.getByText('Which set are you completing?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Set A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Set B/ }));
    fireEvent.click(screen.getByRole('button', { name: /All Filters/ }));
    expect(onChoose.mock.calls).toEqual([['SET_A'], ['SET_B'], ['ALL']]);
  });

  it('Cancel calls onCancel without choosing', () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(<AhuSetChooserDialog onChoose={onChoose} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('DryerDurationDialog', () => {
  const base = { filterName: 'FLT-9', onClose: vi.fn(), onSubmit: vi.fn() };

  it('renders nothing when closed', () => {
    const { container } = render(<DryerDurationDialog {...base} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('defaults to 30 min, formats the options, and submits the picked minutes', () => {
    const onSubmit = vi.fn();
    render(<DryerDurationDialog {...base} open onSubmit={onSubmit} />);
    expect(screen.getByText('Set Dryer Duration')).toBeInTheDocument();
    expect(screen.getByText('FLT-9')).toBeInTheDocument();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('30');
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toEqual(['5 min', '10 min', '15 min', '30 min', '45 min', '1h', '1h 30m', '2h', '3h', '4h']);
    fireEvent.click(screen.getByRole('button', { name: 'Start Dryer' }));
    expect(onSubmit).toHaveBeenLastCalledWith(30);
    fireEvent.change(select, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Dryer' }));
    expect(onSubmit).toHaveBeenLastCalledWith(90);
  });

  it('shows the server error and disables every control while starting', () => {
    const onClose = vi.fn();
    render(<DryerDurationDialog {...base} open loading error="Dryer already running" onClose={onClose} />);
    expect(screen.getByText('Dryer already running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('Cancel closes', () => {
    const onClose = vi.fn();
    render(<DryerDurationDialog {...base} open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BlockChangeRequestDialog', () => {
  const dialog = { filterId: 'f1', filterName: 'FLT-1', homeBlockId: 'b1', homeBlockName: 'Block A', requestedBlockId: 'b2', requestedBlockName: 'Block B' };

  it('renders nothing without a dialog', () => {
    const { container } = render(<BlockChangeRequestDialog dialog={null} reason="" onReasonChange={vi.fn()} submitting={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('CONFIRM mode (default): self-confirm, no reason box, Continue enabled', () => {
    const onSubmit = vi.fn();
    render(<BlockChangeRequestDialog dialog={dialog} reason="" onReasonChange={vi.fn()} submitting={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByText('Cleaning in a different block')).toBeInTheDocument();
    expect(screen.getByText(/Continue with cleaning\?/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with cleaning' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('APPROVAL mode: a reason is mandatory before "Request approval" is enabled', () => {
    const onReasonChange = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(<BlockChangeRequestDialog mode="APPROVAL" dialog={dialog} reason="   " onReasonChange={onReasonChange} submitting={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByText('Block change approval needed')).toBeInTheDocument();
    const summary = screen.getByText('Filter:').parentElement!.parentElement!;
    expect(summary).toHaveTextContent('FLT-1');
    expect(summary).toHaveTextContent('Belongs to: Block A');
    expect(summary).toHaveTextContent('Cleaning in: Block B');
    expect(screen.getByRole('button', { name: 'Request approval' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Why does this filter need/), { target: { value: 'Home block washer down' } });
    expect(onReasonChange).toHaveBeenCalledWith('Home block washer down');
    rerender(<BlockChangeRequestDialog mode="APPROVAL" dialog={dialog} reason="Home block washer down" onReasonChange={onReasonChange} submitting={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request approval' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('APPROVAL mode while submitting: button reads Submitting… and is disabled; Cancel still works', () => {
    const onCancel = vi.fn();
    render(<BlockChangeRequestDialog mode="APPROVAL" dialog={dialog} reason="ok reason" onReasonChange={vi.fn()} submitting onSubmit={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('CONFIRM mode while submitting disables Continue', () => {
    render(<BlockChangeRequestDialog dialog={dialog} reason="" onReasonChange={vi.fn()} submitting onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Continue with cleaning' })).toBeDisabled();
  });
});

describe('RemainingFiltersDialog', () => {
  const ahuPending: AhuCard = {
    ahuName: 'AHU-1', allAtFinal: false,
    filters: [
      { id: 'f1', name: 'F-1', stage: 'CLEANING_CYCLE_COMPLETED', done: true },
      { id: 'f2', name: 'F-2', stage: 'STORAGE_IN', done: true },
      { id: 'f3', name: 'F-3', stage: 'WASH_IN', done: false },
      { id: 'f4', name: 'F-4', stage: 'Not started', done: false },
      { id: 'f5', name: 'F-5', stage: '', done: false },
    ],
  };
  const ahuReady: AhuCard = { ahuName: '', allAtFinal: true, filters: [{ id: 'g1', name: 'G-1', stage: 'STORAGE_OUT', done: true }] };

  it('POPUP, single AHU: roster with real stage labels, "this filter" tag, completed count, Continue anyway', () => {
    const onContinue = vi.fn();
    const onCancel = vi.fn();
    render(<RemainingFiltersDialog mode="POPUP" ahus={[ahuPending]} currentFilterIds={['f3']} onContinue={onContinue} onCancel={onCancel} />);
    expect(screen.getByRole('heading', { name: 'Remaining Filters' })).toBeInTheDocument();
    expect(screen.getByText('Other filters in this AHU are still in progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next AHU' })).toBeNull();
    expect(screen.getByText('AHU: AHU-1')).toBeInTheDocument();
    expect(screen.getByText('Blocking')).toBeInTheDocument();
    // Only the actually finished cycle counts as completed.
    expect(screen.getByText('1/5 completed')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'F-1Completed', 'F-2Storage In', 'F-3this filterWash In', 'F-4Not started', 'F-5Not started',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('INTERLOCK with a ready AHU: carousel moves both ways and offers "Complete ready filters"', () => {
    const onContinue = vi.fn();
    render(<RemainingFiltersDialog mode="INTERLOCK" ahus={[ahuPending, ahuReady]} currentFilterIds={[]} onContinue={onContinue} onCancel={vi.fn()} error="2 filters still blocking" />);
    expect(screen.getByRole('heading', { name: '2 AHUs still in progress' })).toBeInTheDocument();
    expect(screen.getByText('AHU interlock — cleaning completion blocked')).toBeInTheDocument();
    expect(screen.getByText('2 filters still blocking')).toBeInTheDocument();
    expect(screen.getByText('AHU 1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next AHU' }));
    expect(screen.getByText('AHU 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('AHU: —')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText('Storage Out')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next AHU' }));
    expect(screen.getByText('AHU 1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous AHU' }));
    expect(screen.getByText('AHU 2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete ready filters' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('INTERLOCK with every AHU pending is a hard block: only Close', () => {
    const onCancel = vi.fn();
    render(<RemainingFiltersDialog mode="INTERLOCK" ahus={[ahuPending]} currentFilterIds={['f1']} onCancel={onCancel} />);
    expect(screen.queryByRole('button', { name: 'Complete ready filters' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue anyway' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('an AHU with no filters shows 0/0 and no roster; an empty AHU list renders no card', () => {
    const { rerender } = render(<RemainingFiltersDialog mode="POPUP" ahus={[{ ahuName: 'AHU-X', allAtFinal: true, filters: [] }]} currentFilterIds={[]} onCancel={vi.fn()} />);
    expect(screen.getByText('0/0 completed')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    rerender(<RemainingFiltersDialog mode="POPUP" ahus={[]} currentFilterIds={[]} onCancel={vi.fn()} />);
    expect(screen.queryByText(/completed$/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Remaining Filters' })).toBeInTheDocument();
  });
});

describe('RemainingFiltersDialog — POPUP carousel', () => {
  it('POPUP with several AHUs uses the amber marker for the current card', () => {
    const a: AhuCard = { ahuName: 'AHU-A', allAtFinal: false, filters: [] };
    const b: AhuCard = { ahuName: 'AHU-B', allAtFinal: true, filters: [] };
    render(<RemainingFiltersDialog mode="POPUP" ahus={[a, b]} currentFilterIds={[]} onContinue={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '2 AHUs still in progress' })).toBeInTheDocument();
    const dots = screen.getByText('AHU 1 of 2').nextElementSibling!.children;
    expect(dots[0].className).toContain('bg-amber-500');
    expect(dots[1].className).toContain('bg-emerald-300');
    fireEvent.click(screen.getByRole('button', { name: 'Next AHU' }));
    const dots2 = screen.getByText('AHU 2 of 2').nextElementSibling!.children;
    expect(dots2[0].className).toContain('bg-slate-300');
    expect(dots2[1].className).toContain('bg-amber-500');
    expect(screen.getByRole('button', { name: 'Continue anyway' })).toBeInTheDocument();
  });
});
