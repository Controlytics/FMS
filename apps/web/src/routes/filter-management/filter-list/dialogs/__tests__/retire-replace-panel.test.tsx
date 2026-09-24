import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RetireReplacePanel } from '../RetireReplacePanel';

// Roles & Access has separate "Retire Filter" and "Replace Filter" toggles.
// The single-row panel must offer only what the role holds (2026-09-24).
const base = {
  filter: { id: 'f1', name: 'CWH/F1/AHU-0A/SA/01/01' },
  remarks: '',
  submitting: false,
  onActionChange: () => {},
  onRemarksChange: () => {},
  onClose: () => {},
  onSubmit: () => {},
};

describe('RetireReplacePanel — role-scoped actions', () => {
  it('both granted: the Action dropdown offers Retirement and Replacement', () => {
    render(<RetireReplacePanel {...base} action="retire" canRetire canReplace />);
    expect(screen.getByRole('heading', { name: 'Retire / Replace Filter' })).toBeInTheDocument();
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Retirement' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Replacement' })).toBeInTheDocument();
  });

  it('retire only: no dropdown, the action is fixed to Retirement', () => {
    render(<RetireReplacePanel {...base} action="retire" canRetire canReplace={false} />);
    expect(screen.getByRole('heading', { name: 'Retire Filter' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByDisplayValue('Retirement')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Replacement')).toBeNull();
  });

  it('replace only: no dropdown, the action is fixed to Replacement', () => {
    render(<RetireReplacePanel {...base} action="replace" canRetire={false} canReplace />);
    expect(screen.getByRole('heading', { name: 'Replace Filter' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByDisplayValue('Replacement')).toBeInTheDocument();
  });

  it('older callers that pass neither flag still get both choices', () => {
    render(<RetireReplacePanel {...base} action="retire" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
