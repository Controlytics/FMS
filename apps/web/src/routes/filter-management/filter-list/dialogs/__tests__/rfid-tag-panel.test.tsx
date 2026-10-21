import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { usePageTestLifecycle } from '../../../__tests__/fm-test-kit';
import { RfidTagPanel } from '../RfidTagPanel';

usePageTestLifecycle();

const FILTER = { id: 'f1', name: 'FLT-001' };
const RFID = { id: 'i1', identifierType: 'RFID', identifierValue: 'E2000017221101441890' };
const BARCODE = { id: 'i2', identifierType: 'BARCODE', identifierValue: 'BC-0001', label: 'Frame sticker' };
const QR = { id: 'i3', identifierType: 'QR', identifierValue: 'QR-77' };

function Harness({ tags = [] as any[], replaceConfirm = null as string | null, submitting = false, cb = {} as Record<string, any> }) {
  const [tagValue, setTagValue] = useState('');
  return <RfidTagPanel filter={FILTER} tags={tags} tagValue={tagValue} submitting={submitting} replaceConfirm={replaceConfirm}
    onTagValueChange={(v) => { setTagValue(v); cb.onTagValueChange?.(v); }}
    onClose={cb.onClose ?? vi.fn()} onAssign={cb.onAssign ?? vi.fn()} onConfirmReplace={cb.onConfirmReplace ?? vi.fn()}
    onCancelReplace={cb.onCancelReplace ?? vi.fn()} onUnassign={cb.onUnassign ?? vi.fn()} />;
}

describe('RfidTagPanel', () => {
  it('no tags: says so; Assign is disabled until a tag value is entered, then calls onAssign', () => {
    const onAssign = vi.fn(); const onTagValueChange = vi.fn();
    render(<Harness cb={{ onAssign, onTagValueChange }} />);
    expect(screen.getByRole('heading', { name: 'RFID Tag Management' })).toBeInTheDocument();
    expect(screen.getByText('FLT-001')).toBeInTheDocument();
    expect(screen.getByText('No tags assigned to this filter')).toBeInTheDocument();
    const input = screen.getByPlaceholderText('Scan RFID tag or type tag ID...');
    expect(input).toHaveAttribute('data-rfid', 'true');
    const assign = screen.getByRole('button', { name: 'Assign Tag' });
    expect(assign).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(assign).toBeDisabled();
    fireEvent.change(input, { target: { value: 'E200AAA' } });
    expect(onTagValueChange).toHaveBeenLastCalledWith('E200AAA');
    expect(assign).toBeEnabled();
    fireEvent.click(assign);
    expect(onAssign).toHaveBeenCalledTimes(1);
  });

  it('a held RFID tag and other identifiers are listed with their own remove actions', () => {
    const onUnassign = vi.fn();
    render(<Harness tags={[RFID, BARCODE, QR]} cb={{ onUnassign }} />);
    expect(screen.queryByText('No tags assigned to this filter')).toBeNull();
    expect(screen.getByText('E2000017221101441890')).toBeInTheDocument();
    expect(screen.getByText('RFID Tag')).toBeInTheDocument();
    expect(screen.getByText('BARCODE — Frame sticker')).toBeInTheDocument();
    expect(screen.getByText('QR')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unassign' }));
    const removes = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removes[0]);
    fireEvent.click(removes[1]);
    expect(onUnassign.mock.calls).toEqual([['i1'], ['i2'], ['i3']]);
    // the assign button now reads Replace Tag (the filter already holds one)
    fireEvent.change(screen.getByPlaceholderText('Scan RFID tag or type tag ID...'), { target: { value: 'E200NEW' } });
    expect(screen.getByRole('button', { name: 'Replace Tag' })).toBeEnabled();
  });

  it('replace confirmation names the held tag and the new one; Cancel / Replace reach their callbacks', () => {
    const onConfirmReplace = vi.fn(); const onCancelReplace = vi.fn(); const onAssign = vi.fn();
    render(<Harness tags={[RFID]} replaceConfirm="E200NEW" cb={{ onConfirmReplace, onCancelReplace, onAssign }} />);
    const card = screen.getByTestId('rfid-replace-confirm');
    expect(card).toHaveTextContent('FLT-001 already has tag E2000017221101441890. Replace it with E200NEW?');
    expect(card).toHaveTextContent('The old tag is released and both steps are recorded in the RFID Track Record.');
    // the plain assign button is replaced by the confirm card
    expect(screen.getAllByRole('button', { name: 'Replace Tag' })).toHaveLength(1);
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Replace Tag' }));
    expect(onCancelReplace).toHaveBeenCalledTimes(1);
    expect(onConfirmReplace).toHaveBeenCalledTimes(1);
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('while submitting: unassign and confirm controls are disabled and say what is happening', () => {
    const { unmount } = render(<Harness tags={[RFID, BARCODE]} replaceConfirm="E200NEW" submitting />);
    expect(screen.getByRole('button', { name: 'Unassign' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    const card = screen.getByTestId('rfid-replace-confirm');
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Replacing...' })).toBeDisabled();
    unmount();
    render(<Harness submitting />);
    expect(screen.getByRole('button', { name: 'Assigning...' })).toBeDisabled();
  });

  it('backdrop and the X close the panel', () => {
    const onClose = vi.fn();
    const { container } = render(<Harness cb={{ onClose }} />);
    fireEvent.click(container.firstChild as HTMLElement);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
