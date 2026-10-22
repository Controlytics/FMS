import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { DateRangeFilter } from '../date-range-filter';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';

/**
 * The rendered From/To control. The ordering rule itself is covered in
 * date-range-filter.test.ts; this file covers the contract the call sites rely
 * on: ONE callback per user action, an inverted edit is REJECTED (never
 * auto-corrected), the hint, the clear button, and the native min/max.
 */

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  cleanup();
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(props: Partial<React.ComponentProps<typeof DateRangeFilter>> = {}) {
  const onFromChange = vi.fn();
  const onToChange = vi.fn();
  const utils = render(
    <DateRangeFilter from="" to="" onFromChange={onFromChange} onToChange={onToChange} {...props} />,
  );
  return { ...utils, onFromChange, onToChange };
}

/** Controlled host, so the inputs keep the value the parent accepted. */
function Host(props: { initialFrom?: string; initialTo?: string; onFrom?: (v: string) => void; onTo?: (v: string) => void } & Partial<React.ComponentProps<typeof DateRangeFilter>>) {
  const { initialFrom = '', initialTo = '', onFrom, onTo, ...rest } = props;
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  return (
    <DateRangeFilter
      {...rest}
      from={from}
      to={to}
      onFromChange={(v) => { onFrom?.(v); setFrom(v); }}
      onToChange={(v) => { onTo?.(v); setTo(v); }}
    />
  );
}

describe('DateRangeFilter', () => {
  it('renders two named date inputs with the native bounds tied to each other', () => {
    setup({ from: '2026-01-01', to: '2026-01-31' });
    // type="date" has no implicit ARIA role in jsdom, so query by accessible name.
    const from = screen.getByLabelText('From date') as HTMLInputElement;
    const to = screen.getByLabelText('To date') as HTMLInputElement;
    expect(from.type).toBe('date');
    expect(from.value).toBe('2026-01-01');
    expect(from).toHaveAttribute('max', '2026-01-31');
    expect(to).toHaveAttribute('min', '2026-01-01');
  });

  it('omits the native bound when the other end is open', () => {
    setup();
    expect(screen.getByLabelText('From date')).not.toHaveAttribute('max');
    expect(screen.getByLabelText('To date')).not.toHaveAttribute('min');
  });

  it('a valid From edit calls ONLY onFromChange', () => {
    const { onFromChange, onToChange } = setup({ to: '2026-01-31' });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-01-10' } });
    expect(onFromChange).toHaveBeenCalledWith('2026-01-10');
    expect(onToChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a valid To edit calls ONLY onToChange; a same-day range is allowed', () => {
    const { onFromChange, onToChange } = setup({ from: '2026-01-10' });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-01-10' } });
    expect(onToChange).toHaveBeenCalledWith('2026-01-10');
    expect(onFromChange).not.toHaveBeenCalled();
  });

  it('REJECTS a From after the To: no callback, an alert hint wired to both inputs', () => {
    const { onFromChange, onToChange } = setup({ from: '2026-01-01', to: '2026-01-31' });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-02-05' } });
    expect(onFromChange).not.toHaveBeenCalled();
    expect(onToChange).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(`Start date can't be after the end — change the "To" value first.`);
    expect(screen.getByLabelText('From date')).toHaveAttribute('aria-describedby', alert.id);
    expect(screen.getByLabelText('To date')).toHaveAttribute('aria-describedby', alert.id);
  });

  it('REJECTS a To before the From', () => {
    const { onToChange } = setup({ from: '2026-01-15', to: '' });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-01-01' } });
    expect(onToChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(`End date can't be before the start`);
  });

  it('says "date and time" for datetime-local ranges', () => {
    setup({ type: 'datetime-local', from: '2026-01-15T08:00', to: '2026-01-15T17:00' });
    const to = screen.getByLabelText('To date') as HTMLInputElement;
    expect(to.type).toBe('datetime-local');
    fireEvent.change(to, { target: { value: '2026-01-15T07:00' } });
    expect(screen.getByRole('alert')).toHaveTextContent(`End date and time can't be before the start`);
  });

  it('a later valid edit clears the hint immediately', () => {
    render(<Host initialFrom="2026-01-10" initialTo="2026-01-20" />);
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-01-01' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-01-25' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('To date')).not.toHaveAttribute('aria-describedby');
    expect((screen.getByLabelText('To date') as HTMLInputElement).value).toBe('2026-01-25');
  });

  it('the hint disappears on its own after 4 seconds', () => {
    vi.useFakeTimers();
    setup({ from: '2026-01-10', to: '2026-01-20' });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-02-01' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3999); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('unmounting with a hint showing cancels its timer (no late state update)', () => {
    vi.useFakeTimers();
    const { unmount } = setup({ from: '2026-01-10', to: '2026-01-20' });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-02-01' } });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the clear button empties BOTH ends in one action and clears the hint', () => {
    const onFrom = vi.fn();
    const onTo = vi.fn();
    render(<Host initialFrom="2026-01-10" initialTo="2026-01-20" onFrom={onFrom} onTo={onTo} />);
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-03-01' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear date range' }));
    expect(onFrom).toHaveBeenCalledWith('');
    expect(onTo).toHaveBeenCalledWith('');
    expect(screen.queryByRole('alert')).toBeNull();
    // Nothing left to clear -> the button goes away.
    expect(screen.queryByRole('button', { name: 'Clear date range' })).toBeNull();
  });

  it('shows the clear button only when there is something to clear and it is allowed', () => {
    const { rerender } = setup();
    expect(screen.queryByRole('button', { name: 'Clear date range' })).toBeNull();
    const noop = () => {};
    rerender(<DateRangeFilter from="" to="2026-01-01" onFromChange={noop} onToChange={noop} />);
    expect(screen.getByRole('button', { name: 'Clear date range' })).toBeInTheDocument();
    rerender(<DateRangeFilter from="2026-01-01" to="" onFromChange={noop} onToChange={noop} clearable={false} />);
    expect(screen.queryByRole('button', { name: 'Clear date range' })).toBeNull();
    rerender(<DateRangeFilter from="2026-01-01" to="" onFromChange={noop} onToChange={noop} disabled />);
    expect(screen.queryByRole('button', { name: 'Clear date range' })).toBeNull();
  });

  it('disabled is forwarded to both inputs (the tablet offline guard)', () => {
    setup({ disabled: true });
    expect(screen.getByLabelText('From date')).toBeDisabled();
    expect(screen.getByLabelText('To date')).toBeDisabled();
  });

  it('renders the caption, custom accessible names and the size styling', () => {
    const noop = () => {};
    const { rerender } = render(
      <DateRangeFilter from="" to="" onFromChange={noop} onToChange={noop} label="Period" size="sm"
        fromAriaLabel="Planned from" toAriaLabel="Planned to" className="ml-2" />,
    );
    expect(screen.getByText('Period')).toBeInTheDocument();
    expect(screen.getByLabelText('Planned from')).toHaveClass('h-8');
    expect(screen.getByLabelText('Planned to')).toHaveClass('h-8');
    expect(screen.getByText('Period').parentElement).toHaveClass('ml-2');
    rerender(<DateRangeFilter from="" to="" onFromChange={noop} onToChange={noop} size="lg" />);
    expect(screen.getByLabelText('From date')).toHaveClass('h-11');
    expect(screen.queryByText('Period')).toBeNull();
    rerender(<DateRangeFilter from="" to="" onFromChange={noop} onToChange={noop} />);
    expect(screen.getByLabelText('From date')).toHaveClass('h-9');
  });

  // A11Y-UI-3: the visible caption names the pair as a group; each input keeps its own name.
  it('the caption names the From/To pair as a group, and every control has a name', () => {
    const { container } = setup({ label: 'Period', from: '2026-10-01', to: '2026-10-05' });
    const group = screen.getByRole('group', { name: 'Period' });
    expect(group).toContainElement(screen.getByLabelText('From date'));
    expect(group).toContainElement(screen.getByLabelText('To date'));
    expectAllControlsNamed(container);
  });

  it('without a caption there is no unnamed group', () => {
    setup();
    expect(screen.queryByRole('group')).toBeNull();
  });
});
