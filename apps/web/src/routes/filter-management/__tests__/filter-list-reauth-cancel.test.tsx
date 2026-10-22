/**
 * Filters page — a dismissed password prompt is a choice, not a failure
 * (2026-10-22). Every gated write on this page used to fall back to the hook's
 * onError on cancel, so the operator got an "Error"/"… failed" dialog reading
 * "Cancelled — password confirmation was not completed." for closing a prompt.
 * Each case: the prompt opens, Cancel closes it, nothing is sent, no error is
 * shown, and the control that started it is usable again.
 *
 * The four sites with an older pinned test (RFID assign, bulk status, bulk
 * replace, hierarchy edit) are asserted in their own files.
 */
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, SA, role } from './fm-test-kit';
import {
  setupApi, renderFilters, openBlock, openFiltersTab, row, field, panel, card, cancelReauth, waitForReauthConfig, type SetupOpts,
} from './filter-list-fixtures';

usePageTestLifecycle();

const OPERATOR = role('SUPERVISOR', ['ASSET_READ', 'FILTER_RETIRE', 'FILTER_REPLACE', 'FILTER_STATUS_UPDATE']);
const RFID_ROLE = role('SUPERVISOR', ['ASSET_READ', 'FILTER_RFID_MANAGE']);
const EDITOR = role('SUPERVISOR', ['ASSET_READ', 'FILTER_CREATE', 'FILTER_EDIT', 'FILTER_DELETE']);
const UPLOADER = role('ADMIN', ['ASSET_READ', 'FILTER_BULK_UPLOAD']);

/** No error dialog, no "Cancelled" text, and no write reached the server. */
async function expectSilentCancel(api: ReturnType<typeof setupApi>) {
  await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
  expect(screen.queryByText(/Cancelled/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
  expect(api.requests.filter((r) => r.method !== 'GET')).toEqual([]);
}

async function gated(action: string, user: Parameters<typeof renderFilters>[0], extra: SetupOpts['extra'] = []) {
  const api = setupApi({ base: { reauthActions: [action] }, extra });
  renderFilters(user, api);
  await waitForReauthConfig(api);
  return api;
}

describe('Filters page — cancelling the password prompt is silent', () => {
  it('create Block (CREATE_ASSET): the dialog stays with its name and Create re-enabled', async () => {
    const api = await gated('CREATE_ASSET', SA);
    fireEvent.click(await screen.findByText('New Block'));
    const dlg = screen.getByRole('heading', { name: 'Create Block' }).closest('.rounded-2xl') as HTMLElement;
    fireEvent.change(within(dlg).getByPlaceholderText('Enter block name...'), { target: { value: 'Block Gamma' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create' }));
    await cancelReauth();
    await expectSilentCancel(api);
    expect(within(dlg).getByPlaceholderText('Enter block name...')).toHaveValue('Block Gamma');
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Create' })).toBeEnabled());
  });

  it('delete Block (DELETE_ASSET): the confirmation stays and Delete re-enables', async () => {
    const api = await gated('DELETE_ASSET', SA);
    await screen.findByText('Block Beta');
    fireEvent.click(screen.getAllByTitle('Delete block')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await cancelReauth();
    await expectSilentCancel(api);
    expect(screen.getByRole('heading', { name: 'Delete Block' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled());
  });

  it('single status update (UPDATE_FILTER_LIFECYCLE): the panel keeps its choice and Update re-enables', async () => {
    const api = await gated('UPDATE_FILTER_LIFECYCLE', OPERATOR, [{ path: '/api/filters/f1/stage-options', body: { hasProfile: false } }]);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Update Status'));
    const p = panel('Update Filter Status');
    fireEvent.change(field('New Status', p), { target: { value: 'WASH_OUT' } });
    fireEvent.change(field('Remarks', p), { target: { value: 'Moving on' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Update Status' }));
    await cancelReauth();
    await expectSilentCancel(api);
    const after = panel('Update Filter Status');
    expect(field('Remarks', after)).toHaveValue('Moving on');
    await waitFor(() => expect(within(after).getByRole('button', { name: 'Update Status' })).toBeEnabled());
  });

  it('RFID unassign (DELETE_ASSET_IDENTIFIER): the tag stays listed and Unassign re-enables', async () => {
    const api = await gated('DELETE_ASSET_IDENTIFIER', RFID_ROLE);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('RFID Tag'));
    fireEvent.click(within(panel('RFID Tag Management')).getByRole('button', { name: 'Unassign' }));
    await cancelReauth();
    await expectSilentCancel(api);
    await waitFor(() => expect(within(panel('RFID Tag Management')).getByRole('button', { name: 'Unassign' })).toBeEnabled());
    expect(panel('RFID Tag Management')).toHaveTextContent('E200AA');
  });

  it('single retire (RETIRE_FILTER, through retireOrReplaceFilter): the panel keeps its remarks and re-enables', async () => {
    const api = await gated('RETIRE_FILTER', OPERATOR);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Retire / Replace'));
    const p = panel('Retire / Replace Filter');
    fireEvent.change(within(p).getByPlaceholderText(/reason for retirement/), { target: { value: 'Media torn' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Retire Filter' }));
    await cancelReauth();
    await expectSilentCancel(api);
    const after = panel('Retire / Replace Filter');
    expect(within(after).getByPlaceholderText(/reason for retirement/)).toHaveValue('Media torn');
    await waitFor(() => expect(within(after).getByRole('button', { name: 'Retire Filter' })).toBeEnabled());
  });

  it('delete AHU from the diagram (DELETE_HIERARCHY_NODE): the confirmation stays and re-enables', async () => {
    const api = await gated('DELETE_HIERARCHY_NODE', SA);
    await openBlock();
    fireEvent.click(screen.getAllByTitle('Delete AHU')[0]);
    fireEvent.click(within(card('Delete AHU')).getByRole('button', { name: 'Delete AHU' }));
    await cancelReauth();
    await expectSilentCancel(api);
    await waitFor(() => expect(within(card('Delete AHU')).getByRole('button', { name: 'Delete AHU' })).toBeEnabled());
  });

  it('Create Filter (CREATE_FILTER): no inline error, the form is kept and Create re-enables', async () => {
    const api = await gated('CREATE_FILTER', EDITOR);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Create Filter' }));
    const dlg = card('Create Filter');
    fireEvent.change(field('AHU', dlg), { target: { value: 'h1' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., Pre-Filter-01'), { target: { value: 'PF-011' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create Filter' }));
    await cancelReauth();
    await expectSilentCancel(api);
    const after = card('Create Filter');
    expect(within(after).getByPlaceholderText('e.g., Pre-Filter-01')).toHaveValue('PF-011');
    await waitFor(() => expect(within(after).getByRole('button', { name: 'Create Filter' })).toBeEnabled());
  });

  it('Bulk Upload (BULK_UPLOAD_FILTERS): stays on the preview, no error row in a results panel', async () => {
    const api = await gated('BULK_UPLOAD_FILTERS', UPLOADER, [
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: { rows: [{ name: 'PF-020', ahu: 'AHU-01', filterSet: 'A' }], results: [], newAreas: [], newAhus: [] } },
    ]);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
    const d = card('Bulk Upload Filters');
    fireEvent.change(document.getElementById('bulk-upload-file-input') as HTMLInputElement, {
      target: { files: [new File(['PK'], 'filters.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })] },
    });
    fireEvent.click(await within(d).findByRole('button', { name: 'Upload 1 Filter' }));
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    // still on the preview: the Upload button is there; no results table was drawn
    expect(within(d).getByRole('button', { name: 'Upload 1 Filter' })).toBeEnabled();
    expect(d).not.toHaveTextContent('Created');
    // only the validate POST went out
    expect(api.requests.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual(['/api/assets/instances/bulk-upload-filters/validate']);
  });
});
