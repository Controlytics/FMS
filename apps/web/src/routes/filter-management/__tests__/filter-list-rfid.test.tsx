import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, role, passReauth, expectSigned, reauthOnce } from './fm-test-kit';
import { setupApi, renderFilters, openFiltersTab, row, panel, cancelReauth, waitForReauthConfig } from './filter-list-fixtures';

usePageTestLifecycle();

const RFID_ROLE = role('SUPERVISOR', ['ASSET_READ', 'FILTER_RFID_MANAGE']);
const tagInput = () => screen.getByPlaceholderText('Scan RFID tag or type tag ID...');

describe('Filters page — RFID tag panel', () => {
  it('assigns a normalised tag (doubled, lower-case scan collapses) to a filter with no RFID', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/identifiers', status: 201, body: { id: 'id9' } }] });
    renderFilters(RFID_ROLE, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-002')).getByTitle('RFID Tag'));
    const p = panel('RFID Tag Management');
    expect(p).toHaveTextContent('PF-002');
    // a non-RFID identifier is listed with its type + label and a Remove button
    expect(p).toHaveTextContent('QR-2');
    expect(p).toHaveTextContent('QR — door');
    expect(within(p).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    const assign = within(p).getByRole('button', { name: 'Assign Tag' });
    expect(assign).toBeDisabled();
    fireEvent.change(tagInput(), { target: { value: ' e200cce200cc ' } });
    fireEvent.click(assign);
    expect(await screen.findByText('Tag "E200CC" assigned to PF-002')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/identifiers')[0].json).toEqual({ assetId: 'f2', identifierType: 'RFID', identifierValue: 'E200CC', isPrimary: true });
    expect((tagInput() as HTMLInputElement).value).toBe('');
  });

  it('re-entering the held tag is refused locally ("Already assigned"), with no request', async () => {
    const api = setupApi();
    renderFilters(RFID_ROLE, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('RFID Tag'));
    const p = panel('RFID Tag Management');
    expect(within(p).getByText('E200AA')).toBeInTheDocument();
    fireEvent.change(tagInput(), { target: { value: 'e200aa' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Replace Tag' }));
    expect(await screen.findByText('Already assigned')).toBeInTheDocument();
    expect(screen.getByText('Tag "E200AA" is already assigned to PF-001')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/identifiers')).toHaveLength(0);
  });

  it('a different tag on a tagged filter asks to replace; Cancel clears; confirm sends replaceExisting', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/identifiers', status: 201, body: {} }] });
    renderFilters(RFID_ROLE, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('RFID Tag'));
    const p = panel('RFID Tag Management');
    fireEvent.change(tagInput(), { target: { value: 'e200dd' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Replace Tag' }));
    const confirm = await screen.findByTestId('rfid-replace-confirm');
    expect(confirm).toHaveTextContent('PF-001 already has tag E200AA. Replace it with E200DD?');
    // editing the value withdraws the pending confirmation
    fireEvent.change(tagInput(), { target: { value: 'e200dd1' } });
    expect(screen.queryByTestId('rfid-replace-confirm')).toBeNull();
    fireEvent.change(tagInput(), { target: { value: 'e200dd' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Replace Tag' }));
    fireEvent.click(within(await screen.findByTestId('rfid-replace-confirm')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('rfid-replace-confirm')).toBeNull();
    expect((tagInput() as HTMLInputElement).value).toBe('');
    expect(api.calls('POST', '/api/assets/identifiers')).toHaveLength(0);

    fireEvent.change(tagInput(), { target: { value: 'e200dd' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Replace Tag' }));
    fireEvent.click(within(await screen.findByTestId('rfid-replace-confirm')).getByRole('button', { name: 'Replace Tag' }));
    expect(await screen.findByText('Tag "E200AA" replaced by "E200DD" on PF-001')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/identifiers')[0].json).toEqual({
      assetId: 'f1', identifierType: 'RFID', identifierValue: 'E200DD', isPrimary: true, replaceExisting: true,
    });
  });

  it('a refused assign (tag held by another filter) toasts the reason and unlocks the panel', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/identifiers', status: 409, body: { error: 'IDENTIFIER_IN_USE', message: 'Tag E200EE is assigned to PF-777' } }] });
    renderFilters(RFID_ROLE, api);
    await openFiltersTab();
    fireEvent.click(within(row('HF-007')).getByTitle('RFID Tag'));
    const p = panel('RFID Tag Management');
    expect(p).toHaveTextContent('No tags assigned to this filter');
    fireEvent.change(tagInput(), { target: { value: 'E200EE' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Assign Tag' }));
    expect(await screen.findByText('Tag E200EE is assigned to PF-777')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(within(panel('RFID Tag Management')).getByRole('button', { name: 'Assign Tag' })).toBeEnabled();
    expect((tagInput() as HTMLInputElement).value).toBe('E200EE');
  });

  it('unassign: DELETE /api/assets/identifiers/:id; failure toasts; signed under re-auth', async () => {
    const api = setupApi({ extra: [
      { method: 'DELETE', path: '/api/assets/identifiers/id1', status: 500, times: 1, body: { error: 'X', message: 'DB unavailable' } },
      reauthOnce('DELETE', '/api/assets/identifiers/id1'),
      { method: 'DELETE', path: '/api/assets/identifiers/id1', status: 204 },
    ] });
    renderFilters(RFID_ROLE, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('RFID Tag'));
    fireEvent.click(within(panel('RFID Tag Management')).getByRole('button', { name: 'Unassign' }));
    expect(await screen.findByText('DB unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(within(panel('RFID Tag Management')).getByRole('button', { name: 'Unassign' }));
    await passReauth();
    expect(await screen.findByText('Tag unassigned from filter')).toBeInTheDocument();
    const dels = api.calls('DELETE', '/api/assets/identifiers/id1');
    expect(dels).toHaveLength(3);
    expectSigned(dels[2]);
  });

  it('a cancelled assign prompt silently unlocks the panel; the panel closes from its backdrop', async () => {
    const api = setupApi({ base: { reauthActions: ['CREATE_ASSET_IDENTIFIER'] } });
    renderFilters(RFID_ROLE, api);
    await waitForReauthConfig(api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-002')).getByTitle('RFID Tag'));
    fireEvent.change(tagInput(), { target: { value: 'E200FF' } });
    fireEvent.click(within(panel('RFID Tag Management')).getByRole('button', { name: 'Assign Tag' }));
    await cancelReauth();
    await waitFor(() => expect(within(panel('RFID Tag Management')).getByRole('button', { name: 'Assign Tag' })).toBeEnabled());
    expect(api.calls('POST', '/api/assets/identifiers')).toHaveLength(0);
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    const backdrop = panel('RFID Tag Management').previousElementSibling as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole('heading', { name: 'RFID Tag Management' })).toBeNull();
  });
});
