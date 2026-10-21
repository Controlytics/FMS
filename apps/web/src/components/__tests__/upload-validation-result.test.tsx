import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { UploadValidationResult } from '../upload-validation-result';
import { ManualEntryBadge } from '../manual-entry-badge';

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
  vi.restoreAllMocks();
});

describe('UploadValidationResult', () => {
  it('a clean upload: total rows, imported count, zero errors and the all-clear line', () => {
    render(<UploadValidationResult importedCount={12} errors={[]} />);
    expect(screen.getByText('Validation result — processed 12 rows')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Imported')).toBeInTheDocument();
    expect(screen.getByText('0')).toHaveClass('text-slate-400');
    expect(screen.getByText(/All rows passed validation/)).toBeInTheDocument();
    expect(screen.queryByText(/Rows with errors/)).toBeNull();
  });

  it('singular "row" for exactly one processed row; a custom imported label', () => {
    render(<UploadValidationResult importedCount={1} errors={[]} importedLabel="Scheduled" />);
    expect(screen.getByText('Validation result — processed 1 row')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('lists every rejected row with its column, value and reason, and counts them in the total', () => {
    const { container } = render(
      <UploadValidationResult
        importedCount={3}
        errors={[
          { row: 4, reason: 'AHU not found', column: 'AHU', value: 'AHU-9Z' },
          { row: 7, reason: 'Date is in the past' },
          { row: 7, reason: 'Duplicate visit', column: 'Date' },
        ]}
      />,
    );
    expect(screen.getByText('Validation result — processed 6 rows')).toBeInTheDocument();
    const errCount = screen.getByText('Errors (not imported)').previousElementSibling!;
    expect(errCount).toHaveTextContent('3');
    expect(errCount).toHaveClass('text-rose-700');
    expect(screen.getByText('Rows with errors — fix and re-upload')).toBeInTheDocument();
    // Each error line = a "!" marker + the message span.
    const lines = [...container.querySelectorAll('.bg-rose-50.border-rose-100')].map((el) => el.querySelector('span.text-slate-700')!.textContent?.replace(/\s+/g, ' ').trim());
    expect(lines).toEqual([
      'Row 4 · column AHU · value “AHU-9Z” — AHU not found',
      'Row 7 — Date is in the past',
      'Row 7 · column Date — Duplicate visit',
    ]);
    expect(screen.queryByText(/All rows passed validation/)).toBeNull();
  });
});

describe('ManualEntryBadge', () => {
  it('renders nothing unless the record is manual', () => {
    const { container, rerender } = render(<ManualEntryBadge />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ManualEntryBadge manual={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ManualEntryBadge manual={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a manual record shows the pill with an explanatory tooltip and the caller class', () => {
    render(<ManualEntryBadge manual className="ml-2" />);
    const pill = screen.getByText('Manual entry');
    expect(pill).toHaveAttribute('title', 'Inserted manually via Filter Data Management — not a system-captured record');
    expect(pill).toHaveClass('bg-amber-50', 'ml-2');
  });
});
