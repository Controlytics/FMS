/**
 * PmPendingTasksDialog — "previous scheduled PM not carried out": one reason
 * per outstanding visit before a PM cleaning may start (coverage campaign
 * 2026-10-21). Pure props component; no network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PmPendingTasksDialog, type PendingPmTask } from '../pm-pending-tasks-dialog';
import { expectAllControlsNamed } from './support/a11y';

const fmt = (d: string) => `D(${d})`;
const task = (over: Partial<PendingPmTask> = {}): PendingPmTask => ({
  entryId: 'e1', ahuName: 'AHU-0A', plannedDate: '2026-03-10', windowStart: '2026-02-23', windowEnd: '2026-03-25', overdueDays: 12, ...over,
});

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

const confirmBtn = () => screen.getByRole('button', { name: 'Save reasons & start cleaning' });

describe('PmPendingTasksDialog', () => {
  it('states the AHU and how many visits were missed (singular)', () => {
    render(<PmPendingTasksDialog tasks={[task({ overdueDays: 1 })]} formatDate={fmt} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Previous scheduled PM not carried out' })).toBeInTheDocument();
    expect(screen.getByText(/AHU-0A has 1 earlier scheduled visit that was never done\./)).toBeInTheDocument();
    expect(screen.getByText('D(2026-03-10)')).toBeInTheDocument();
    expect(screen.getByText('1 day overdue')).toBeInTheDocument();
    expect(screen.getByText('window D(2026-02-23) – D(2026-03-25)')).toBeInTheDocument();
  });

  it('pluralises for several visits and gives each its own labelled reason box', () => {
    render(<PmPendingTasksDialog tasks={[task(), task({ entryId: 'e2', plannedDate: '2026-04-10', overdueDays: 3 })]} formatDate={fmt} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText(/has 2 earlier scheduled visits that were never done\./)).toBeInTheDocument();
    expect(screen.getByText('12 days overdue')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reason the D(2026-03-10) PM was not performed' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reason the D(2026-04-10) PM was not performed' })).toBeInTheDocument();
  });

  it('counts down the characters still required, then says where the reason is recorded', () => {
    render(<PmPendingTasksDialog tasks={[task()]} formatDate={fmt} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('5 more characters required')).toBeInTheDocument();
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: ' abcd ' } }); // whitespace does not count
    expect(screen.getByText('1 more character required')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'abcde' } });
    expect(screen.getByText('Recorded against this visit in the audit trail.')).toBeInTheDocument();
  });

  it('enables confirm only once EVERY visit has a long-enough reason, and sends trimmed reasons per entry', () => {
    const onConfirm = vi.fn();
    render(<PmPendingTasksDialog tasks={[task(), task({ entryId: 'e2', plannedDate: '2026-04-10' })]} formatDate={fmt} onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(confirmBtn()).toBeDisabled();
    expect(confirmBtn()).toHaveAttribute('title', 'Give a reason for every outstanding visit');
    const [a, b] = screen.getAllByRole('textbox');
    fireEvent.change(a, { target: { value: '  Plant shutdown  ' } });
    expect(confirmBtn()).toBeDisabled();
    fireEvent.change(b, { target: { value: 'Dryer broken' } });
    expect(confirmBtn()).toBeEnabled();
    expect(confirmBtn()).not.toHaveAttribute('title');
    fireEvent.click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledWith([
      { entryId: 'e1', reason: 'Plant shutdown' },
      { entryId: 'e2', reason: 'Dryer broken' },
    ]);
  });

  it('honours a custom minimum reason length', () => {
    render(<PmPendingTasksDialog tasks={[task()]} minReasonLength={2} formatDate={fmt} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('2 more characters required')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ok' } });
    expect(confirmBtn()).toBeEnabled();
  });

  it('busy: both buttons disabled and the confirm reads "Saving…"', () => {
    render(<PmPendingTasksDialog tasks={[task()]} busy formatDate={fmt} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    render(<PmPendingTasksDialog tasks={[task()]} formatDate={fmt} onCancel={onCancel} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clears typed reasons when a different set of visits arrives (a reason never moves to another AHU)', () => {
    const { rerender } = render(<PmPendingTasksDialog tasks={[task()]} formatDate={fmt} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Typed for AHU-0A' } });
    rerender(<PmPendingTasksDialog tasks={[task({ entryId: 'other', ahuName: 'AHU-1B' })]} formatDate={fmt} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(confirmBtn()).toBeDisabled();
  });

  it('keeps typed reasons on a re-render with the SAME visits (new array, same ids)', () => {
    const { rerender } = render(<PmPendingTasksDialog tasks={[task()]} formatDate={fmt} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Still here' } });
    rerender(<PmPendingTasksDialog tasks={[task()]} formatDate={fmt} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('Still here');
  });

  // A7: the missed-PM question is a modal dialog named by its heading.
  it('is a modal dialog named by its heading, with every control named', () => {
    const { container } = render(<PmPendingTasksDialog tasks={[task(), task({ entryId: 'e2', plannedDate: '2026-04-10' })]} formatDate={fmt} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Previous scheduled PM not carried out' })).toHaveAttribute('aria-modal', 'true');
    expectAllControlsNamed(container);
  });
});
