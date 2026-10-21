import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { usePageTestLifecycle } from '../../../__tests__/fm-test-kit';
import { DeleteBlockDialog } from '../DeleteBlockDialog';
import { DeleteFilterDialog } from '../DeleteFilterDialog';
import { HierarchyDeleteDialog } from '../HierarchyDeleteDialog';
import { HierarchyEditDialog } from '../HierarchyEditDialog';
import { BulkRetireReplacePanel } from '../BulkRetireReplacePanel';
import { RetireReplacePanel } from '../RetireReplacePanel';

usePageTestLifecycle();

describe('DeleteBlockDialog', () => {
  it('names the block, warns about children, and confirms / cancels', () => {
    const onCancel = vi.fn(); const onConfirm = vi.fn();
    render(<DeleteBlockDialog name="Block A" deleting={false} onCancel={onCancel} onConfirm={onConfirm} />);
    expect(screen.getByRole('heading', { name: 'Delete Block' })).toBeInTheDocument();
    expect(screen.getByText('Block A').tagName).toBe('STRONG');
    expect(screen.getByText(/All child areas, AHUs, and filters under this block will also be removed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a click on the backdrop cancels; a click inside the card does not', () => {
    const onCancel = vi.fn();
    const { container } = render(<DeleteBlockDialog name="Block A" deleting={false} onCancel={onCancel} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByText(/This action cannot be undone/));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('while deleting the confirm button is disabled and says so', () => {
    const onConfirm = vi.fn();
    render(<DeleteBlockDialog name="Block A" deleting onCancel={vi.fn()} onConfirm={onConfirm} />);
    const btn = screen.getByRole('button', { name: 'Deleting...' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('DeleteFilterDialog', () => {
  it('quotes the filter name; submit and cancel reach their callbacks', () => {
    const onClose = vi.fn(); const onSubmit = vi.fn();
    render(<DeleteFilterDialog name="FLT-001" submitting={false} onClose={onClose} onSubmit={onSubmit} />);
    expect(screen.getByText('"FLT-001"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submitting disables the delete button', () => {
    render(<DeleteFilterDialog name="FLT-001" submitting onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
  });
});

describe('HierarchyDeleteDialog', () => {
  it('titles itself by entity type and quotes the node name', () => {
    const onSubmit = vi.fn(); const onClose = vi.fn();
    render(<HierarchyDeleteDialog node={{ id: 'a1', name: 'AHU-01', entityType: 'AHU' }} submitting={false} onClose={onClose} onSubmit={onSubmit} />);
    expect(screen.getByRole('heading', { name: 'Delete AHU' })).toBeInTheDocument();
    expect(screen.getByText('"AHU-01"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete AHU' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submitting disables the delete button', () => {
    render(<HierarchyDeleteDialog node={{ id: 'ar', name: 'Area 1', entityType: 'Area' }} submitting onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
  });
});

describe('HierarchyEditDialog', () => {
  function Harness({ initial = 'Area 1', error = '', submitting = false, onSubmit = vi.fn(), onClose = vi.fn() }) {
    const [name, setName] = useState(initial);
    return <HierarchyEditDialog node={{ id: 'ar', name: 'Area 1', entityType: 'Area' }} name={name} error={error} submitting={submitting}
      onNameChange={setName} onClose={onClose} onSubmit={onSubmit} />;
  }

  it('renames: typing updates the field; Save calls onSubmit', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    expect(screen.getByRole('heading', { name: 'Edit Area' })).toBeInTheDocument();
    const input = screen.getByDisplayValue('Area 1');
    fireEvent.change(input, { target: { value: 'Area North' } });
    expect(screen.getByDisplayValue('Area North')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a blank (whitespace) name cannot be saved', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByDisplayValue('Area 1'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('shows the server error and the saving state', () => {
    render(<Harness error="Name already in use" submitting />);
    expect(screen.getByText('Name already in use')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('both the header X and Cancel close it', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]); // header X
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('BulkRetireReplacePanel', () => {
  const selected = [{ id: 'f1', name: 'FLT-001' }, { id: 'f2', name: 'FLT-002' }];
  function Harness({ action, submitting = false, onSubmit = vi.fn(), onClose = vi.fn() }: { action: 'retire' | 'replace'; submitting?: boolean; onSubmit?: () => void; onClose?: () => void }) {
    const [remarks, setRemarks] = useState('');
    return <BulkRetireReplacePanel action={action} selectedCount={2} selectedFilters={selected} remarks={remarks} submitting={submitting}
      onRemarksChange={setRemarks} onClose={onClose} onSubmit={onSubmit} />;
  }

  it('retire: lists the selected filters; remarks are required before submit', () => {
    const onSubmit = vi.fn();
    render(<Harness action="retire" onSubmit={onSubmit} />);
    expect(screen.getByRole('heading', { name: 'Bulk Retirement' })).toBeInTheDocument();
    expect(screen.getByText('FLT-001')).toBeInTheDocument();
    expect(screen.getByText('FLT-002')).toBeInTheDocument();
    expect(screen.getByText(/permanently retire/)).toHaveTextContent('This will permanently retire 2 filter(s).');
    const submit = screen.getByRole('button', { name: 'Retire 2 Filter(s)' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Enter reason for retirement...'), { target: { value: '  ' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Enter reason for retirement...'), { target: { value: 'End of life' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('replace: explains replacement creation and uses replace wording', () => {
    render(<Harness action="replace" />);
    expect(screen.getByRole('heading', { name: 'Bulk Replacement' })).toBeInTheDocument();
    expect(screen.getByText(/create replacement filters with incremented suffix numbers/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter reason for replacement...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace 2 Filter(s)' })).toBeDisabled();
  });

  it('submitting shows Processing; backdrop, X and Cancel all close', () => {
    const onClose = vi.fn();
    const { container } = render(<Harness action="retire" submitting onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled();
    fireEvent.click(container.firstChild as HTMLElement); // backdrop
    fireEvent.click(screen.getAllByRole('button')[0]); // X
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('RetireReplacePanel — interaction', () => {
  function Harness({ submitting = false, onSubmit = vi.fn(), onClose = vi.fn() }) {
    const [action, setAction] = useState<'retire' | 'replace'>('retire');
    const [remarks, setRemarks] = useState('');
    return <RetireReplacePanel filter={{ id: 'f1', name: 'FLT-001' }} action={action} remarks={remarks} submitting={submitting}
      onActionChange={setAction} onRemarksChange={setRemarks} onClose={onClose} onSubmit={onSubmit} />;
  }

  it('switching the action changes the explanation and the submit label; remarks gate submit', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    expect(screen.getByDisplayValue('FLT-001')).toHaveAttribute('readonly');
    expect(screen.getByText(/permanently retire the filter/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retire Filter' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'replace' } });
    expect(screen.getByText(/create a new replacement filter/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Replace Filter' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Enter reason for retirement/replacement...'), { target: { value: 'Damaged frame' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submitting shows Processing; backdrop, X and Cancel all close', () => {
    const onClose = vi.fn();
    const { container } = render(<Harness submitting onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled();
    fireEvent.click(container.firstChild as HTMLElement);
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
