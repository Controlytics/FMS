import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionRemarksDialog } from '../decision-remarks-dialog';

const setup = (busy = false) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<DecisionRemarksDialog title="Approve 2 Entries" confirmLabel="Approve" busy={busy} onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel, dlg: screen.getByRole('dialog', { name: 'Approve 2 Entries' }) };
};

describe('DecisionRemarksDialog (D03-13: a decision needs remarks)', () => {
  it('is a named modal dialog whose remarks box is named; confirm needs 3 characters and sends them trimmed', () => {
    const { onConfirm, dlg } = setup();
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    const box = screen.getByRole('textbox', { name: /Remarks/ });
    const confirm = screen.getByRole('button', { name: 'Approve' });
    expect(confirm).toBeDisabled();
    fireEvent.change(box, { target: { value: '  ab  ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(box, { target: { value: '  checked  ' } });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('checked');
  });

  it('Cancel and Escape close it', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('while busy, Escape does nothing and both buttons are disabled', () => {
    const { onCancel } = setup(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
});
