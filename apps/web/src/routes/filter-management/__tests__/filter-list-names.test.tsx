/**
 * D03-01/02/03 (functional test, 2026-10-22). Operator rule: no unlabelled UI.
 * - D03-01: a visible label not bound to its control (Create Filter fields, the
 *   bulk Reject reason);
 * - D03-02: icon-only buttons and checkboxes with no accessible name (block-view
 *   back arrow, table checkboxes, Create Filter close X, the bulk dialog's per-row
 *   details button, the RFID panel close X);
 * - D03-03: the Create Filter modal and the RFID panel were not exposed as dialogs,
 *   and Escape did not close the RFID panel.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within, render } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { usePageTestLifecycle, SA } from './fm-test-kit';
import { setupApi, renderFilters, openFiltersTab } from './filter-list-fixtures';
import { RfidTagPanel } from '../filter-list/dialogs/RfidTagPanel';
import { FilterBulkApprovalDialog } from '../filter-list/dialogs/FilterBulkApprovalDialog';

usePageTestLifecycle();

describe('Filters page — every control is named', () => {
  it('block view: the back arrow and the table checkboxes', async () => {
    renderFilters(SA, setupApi());
    await openFiltersTab();
    expect(screen.getByRole('button', { name: 'Back to all blocks' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all filters' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select PF-001' })).toBeInTheDocument();
  });

  it('Create Filter is a named modal dialog whose fields are named by their labels', async () => {
    renderFilters(SA, setupApi());
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Create Filter' }));
    const dlg = screen.getByRole('dialog', { name: 'Create Filter' });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    for (const name of [/^AHU \*$/, /^AHU Type$/, /^Filter Type$/, /^Micron Size/]) {
      expect(within(dlg).getByRole('combobox', { name })).toBeInTheDocument();
    }
    expect(within(dlg).getByRole('textbox', { name: /^Filter Name/ })).toBeInTheDocument();
    expect(within(dlg).getByRole('textbox', { name: 'Filter Dimensions' })).toBeInTheDocument();
    expect(within(dlg).getByLabelText('Last Cleaning Date')).toHaveAttribute('type', 'date');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Create Filter' })).toBeNull();
  });
});

describe('RFID tag panel', () => {
  const props = () => ({
    filter: { id: 'f1', name: 'PF-001' } as any, tags: [], tagValue: '', submitting: false, replaceConfirm: null,
    onTagValueChange: vi.fn(), onClose: vi.fn(), onAssign: vi.fn(), onConfirmReplace: vi.fn(), onCancelReplace: vi.fn(), onUnassign: vi.fn(),
  });

  it('is a named modal dialog with a named close button and tag field; Escape closes it', () => {
    const p = props();
    render(<RfidTagPanel {...p} />);
    const dlg = screen.getByRole('dialog', { name: 'RFID Tag Management' });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(within(dlg).getByRole('textbox', { name: 'New RFID tag ID' })).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});

describe('Review / Approve Pending Filters dialog', () => {
  it('the per-row details button and the Reject reason are named', async () => {
    const api = mockApi([{ path: '/api/assets/instances/pending-approval', body: { data: [] } }]);
    renderPage(
      <FilterBulkApprovalDialog
        filters={[{ id: 'f1', name: 'PF-001' } as any]} mode="review" canReject submitting={false}
        formatDateTime={(v) => String(v)} onClose={vi.fn()} onViewDetails={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />,
      { user: SA, api },
    );
    expect(await screen.findByRole('button', { name: 'Details of PF-001' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reject selected/ }));
    expect(screen.getByRole('textbox', { name: /Rejection reason/ })).toBeInTheDocument();
  });
});
