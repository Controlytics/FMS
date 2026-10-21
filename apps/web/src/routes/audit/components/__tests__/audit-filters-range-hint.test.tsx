import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuditFilters } from '../audit-filters';

/**
 * 2026-10-21 (found during UI Phase 2): an inverted From/To range on the Audit
 * Trail was refused — the edit is rejected, never "fixed" — but the hint the
 * inputs point to (aria-describedby="audit-range-hint") was never rendered, so
 * the operator saw nothing happen. The hint must appear and the refused value
 * must not reach the page state.
 */
function setup(fromDateTime: string, toDateTime: string) {
  const props = {
    search: '', setSearch: vi.fn(),
    fromDateTime, setFromDateTime: vi.fn(),
    toDateTime, setToDateTime: vi.fn(),
    setPage: vi.fn(),
    formatDateTimeDisplay: (v: string) => v,
    hasFilters: false, clearFilters: vi.fn(),
  };
  const view = render(<AuditFilters {...props} />);
  const [fromInput, toInput] = view.container.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
  return { props, fromInput, toInput };
}

describe('Audit Trail date range hint', () => {
  it('shows the hint (role=alert, the id the inputs reference) when From is set after To', () => {
    const { props, fromInput } = setup('', '2026-10-01T10:00');
    fireEvent.change(fromInput, { target: { value: '2026-10-05T10:00' } });

    const hint = screen.getByRole('alert');
    expect(hint.id).toBe('audit-range-hint');
    expect(hint.textContent?.trim().length).toBeGreaterThan(0);
    expect(fromInput.getAttribute('aria-describedby')).toBe('audit-range-hint');
    expect(props.setFromDateTime).not.toHaveBeenCalled();
    expect(props.setPage).not.toHaveBeenCalled();
  });

  it('shows the hint when To is set before From', () => {
    const { props, toInput } = setup('2026-10-05T10:00', '');
    fireEvent.change(toInput, { target: { value: '2026-10-01T10:00' } });
    expect(screen.getByRole('alert').id).toBe('audit-range-hint');
    expect(props.setToDateTime).not.toHaveBeenCalled();
  });

  it('a valid edit shows no hint and is applied', () => {
    const { props, toInput } = setup('2026-10-01T10:00', '');
    fireEvent.change(toInput, { target: { value: '2026-10-05T10:00' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(props.setToDateTime).toHaveBeenCalledWith('2026-10-05T10:00');
    expect(props.setPage).toHaveBeenCalledWith(1);
  });
});
