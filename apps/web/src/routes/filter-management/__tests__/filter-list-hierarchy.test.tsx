import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, SA, role, passReauth, expectSigned, reauthOnce } from './fm-test-kit';
import { setupApi, renderFilters, openBlock, field, waitForReauthConfig, cancelReauth, card, switchUser } from './filter-list-fixtures';

usePageTestLifecycle();

const createDialog = (title: string) => screen.getByRole('heading', { name: title }).closest('.rounded-2xl') as HTMLElement;

describe('Filters page — create Block / Area / AHU', () => {
  it('creates a Block: POST /api/assets/instances with the BLOCK template, trimmed name, no parent', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances', status: 201, body: { id: 'b9' } }] });
    renderFilters(SA, api);
    fireEvent.click(await screen.findByText('New Block'));
    const dlg = createDialog('Create Block');
    const create = within(dlg).getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    fireEvent.change(within(dlg).getByPlaceholderText('Enter block name...'), { target: { value: '  Block Gamma  ' } });
    fireEvent.click(create);
    expect(await screen.findByText('BLOCK "Block Gamma" created')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances')[0].json).toEqual({ name: 'Block Gamma', templateId: 't-block', status: 'Active', attributes: {} });
    expect(screen.queryByRole('heading', { name: 'Create Block' })).toBeNull();
    // NOTE: the page revalidates with the module-level `mutate` from 'swr'; the harness
    // isolates the SWR cache (provider: new Map), so that refetch is not observable here.
  });

  it('creates an Area under the block from the diagram; Cancel closes without a request', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances', status: 201, body: {} }] });
    renderFilters(SA, api);
    await openBlock();
    fireEvent.click(screen.getByTitle('Add Area'));
    let dlg = createDialog('Create Area');
    expect(dlg).toHaveTextContent('Under Block Alpha');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Create Area' })).toBeNull();

    fireEvent.click(screen.getByTitle('Add Area'));
    dlg = createDialog('Create Area');
    fireEvent.change(within(dlg).getByPlaceholderText('Enter area name...'), { target: { value: 'Area South' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('AREA "Area South" created')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances')[0].json).toEqual({ name: 'Area South', templateId: 't-area', status: 'Active', attributes: {}, parentId: 'b1' });
  });

  it('AHU template attributes: a missing required field is refused client-side; numbers are converted; blanks dropped', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances', status: 201, body: {} }] });
    renderFilters(SA, api);
    await openBlock();
    // "Add AHU" exists on the block AND on the area node; the area one is second
    fireEvent.click(screen.getAllByTitle('Add AHU')[1]);
    const dlg = createDialog('Create AHU');
    expect(dlg).toHaveTextContent('Under Area North');
    expect(within(dlg).getByText(/air Flow/)).toHaveTextContent('(CFM)');
    fireEvent.change(within(dlg).getByPlaceholderText('Enter ahu name...'), { target: { value: 'AHU-03' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Missing required field(s)')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    fireEvent.change(within(dlg).getByPlaceholderText('airFlow'), { target: { value: '1200' } });
    fireEvent.change(field(/room Class/, dlg), { target: { value: 'ISO 7' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('AHU "AHU-03" created')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances')[0].json).toEqual({
      name: 'AHU-03', templateId: 't-ahu', status: 'Active', parentId: 'ar1',
      attributes: { airFlow: 1200, roomClass: 'ISO 7' },
    });
  });

  it('a refused create keeps the dialog open and shows the server message', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances', status: 409, body: { error: 'DUPLICATE_NAME', message: 'A block named "Block Alpha" already exists' } }] });
    renderFilters(SA, api);
    fireEvent.click(await screen.findByText('New Block'));
    const dlg = createDialog('Create Block');
    fireEvent.change(within(dlg).getByPlaceholderText('Enter block name...'), { target: { value: 'Block Alpha' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('A block named "Block Alpha" already exists')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create Block' })).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('create under re-auth (server demands it): prompt, then the retried POST is signed', async () => {
    const api = setupApi({ extra: [reauthOnce('POST', '/api/assets/instances'), { method: 'POST', path: '/api/assets/instances', status: 201, body: {} }] });
    renderFilters(SA, api);
    fireEvent.click(await screen.findByText('New Block'));
    fireEvent.change(screen.getByPlaceholderText('Enter block name...'), { target: { value: 'Block Delta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/requires identity verification/)).toBeInTheDocument();
    await passReauth();
    expect(await screen.findByText('BLOCK "Block Delta" created')).toBeInTheDocument();
    const posts = api.calls('POST', '/api/assets/instances');
    expect(posts).toHaveLength(2);
    expect(posts[0].headers['x-reauth-password']).toBeUndefined();
    expectSigned(posts[1]);
  });
});

describe('Filters page — edit / delete hierarchy nodes', () => {
  it('renames a block from its card: PUT /api/assets/instances/:id {name}', async () => {
    const api = setupApi({ extra: [{ method: 'PUT', path: '/api/assets/instances/b1', body: {} }] });
    renderFilters(SA, api);
    await screen.findByText('Block Alpha');
    fireEvent.click(screen.getAllByTitle('Edit block name')[0]);
    expect(screen.getByRole('heading', { name: 'Edit BLOCK' })).toBeInTheDocument();
    // opening the editor did not open the block
    expect(screen.queryByText('Hierarchy')).toBeNull();
    const input = screen.getByDisplayValue('Block Alpha');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    fireEvent.change(input, { target: { value: ' Block A1 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    // the toast names what was SAVED: the trimmed name, as sent
    expect(await screen.findByText('"Block A1" saved')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/assets/instances/b1')[0].json).toEqual({ name: 'Block A1' });
    expect(screen.queryByRole('heading', { name: 'Edit BLOCK' })).toBeNull();
  });

  it('edit Area from the diagram: a server refusal shows inline and keeps the dialog', async () => {
    const api = setupApi({ extra: [{ method: 'PUT', path: '/api/assets/instances/ar1', status: 409, body: { error: 'DUPLICATE', message: 'Area name already in use' } }] });
    renderFilters(SA, api);
    await openBlock();
    fireEvent.click(screen.getByTitle('Edit Area'));
    const dlg = screen.getByRole('heading', { name: 'Edit Area' }).closest('.rounded-2xl') as HTMLElement;
    fireEvent.change(within(dlg).getByDisplayValue('Area North'), { target: { value: 'Area Main' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    expect(await within(dlg).findByText('Area name already in use')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Save Changes' })).toBeEnabled();
    // close via the header ✕ and the footer Cancel
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Edit Area' })).toBeNull();
  });

  it('edit AHU under re-auth required up front (my-actions): signed PUT', async () => {
    const api = setupApi({ base: { reauthActions: ['EDIT_HIERARCHY_NODE'] }, extra: [{ method: 'PUT', path: '/api/assets/instances/h2', body: {} }] });
    renderFilters(SA, api);
    await waitForReauthConfig(api);
    await openBlock();
    fireEvent.click(screen.getAllByTitle('Edit AHU')[1]);
    fireEvent.change(screen.getByDisplayValue('AHU-02'), { target: { value: 'AHU-2B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText(/Edit Hierarchy|requires identity verification/)).toBeInTheDocument();
    await passReauth();
    expect(await screen.findByText('"AHU-2B" saved')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/assets/instances/h2')).toHaveLength(1);
    expectSigned(api.calls('PUT', '/api/assets/instances/h2')[0]);
  });

  it('a wrong password keeps the prompt open with "Incorrect password"', async () => {
    const api = setupApi({
      base: { reauthActions: ['EDIT_HIERARCHY_NODE'] },
      extra: [{ method: 'PUT', path: '/api/assets/instances/h2', status: 401, body: { error: 'REAUTH_FAILED', message: 'Invalid password' } }],
    });
    renderFilters(SA, api);
    await waitForReauthConfig(api);
    await openBlock();
    fireEvent.click(screen.getAllByTitle('Edit AHU')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await passReauth('wrong');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
  });

  it('cancelling the edit prompt is silent and leaves Save usable, not "Saving..."', async () => {
    const api = setupApi({ base: { reauthActions: ['EDIT_HIERARCHY_NODE'] } });
    renderFilters(SA, api);
    await waitForReauthConfig(api);
    await openBlock();
    fireEvent.click(screen.getByTitle('Edit Area'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await cancelReauth();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled());
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(api.calls('PUT', '/api/assets/instances/ar1')).toHaveLength(0);
  });

  it('deletes an AHU node from the diagram: DELETE /api/assets/instances/:id; failure toasts and keeps the dialog', async () => {
    const api = setupApi({ extra: [
      { method: 'DELETE', path: '/api/assets/instances/h1', status: 409, times: 1, body: { error: 'HAS_CHILDREN', message: 'AHU still has filters' } },
      { method: 'DELETE', path: '/api/assets/instances/h1', status: 204 },
    ] });
    renderFilters(SA, api);
    await openBlock();
    fireEvent.click(screen.getAllByTitle('Delete AHU')[0]);
    expect(screen.getByRole('heading', { name: 'Delete AHU' })).toBeInTheDocument();
    expect(screen.getByText(/Permanently delete/)).toHaveTextContent('"AHU-01"');
    fireEvent.click(within(card('Delete AHU')).getByRole('button', { name: 'Delete AHU' }));
    expect(await screen.findByText('AHU still has filters')).toBeInTheDocument();
    expect(screen.getByText('Delete failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByRole('heading', { name: 'Delete AHU' })).toBeInTheDocument();
    fireEvent.click(within(card('Delete AHU')).getByRole('button', { name: 'Delete AHU' }));
    expect(await screen.findByText('AHU "AHU-01" removed')).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/assets/instances/h1')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Delete AHU' })).toBeNull();
  });

  it('delete Area: Cancel closes; confirm sends DELETE', async () => {
    const api = setupApi({ extra: [{ method: 'DELETE', path: '/api/assets/instances/ar1', status: 204 }] });
    renderFilters(SA, api);
    await openBlock();
    fireEvent.click(screen.getByTitle('Delete Area'));
    fireEvent.click(within(card('Delete Area')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Delete Area' })).toBeNull();
    fireEvent.click(screen.getByTitle('Delete Area'));
    fireEvent.click(within(card('Delete Area')).getByRole('button', { name: 'Delete Area' }));
    expect(await screen.findByText('Area "Area North" removed')).toBeInTheDocument();
  });

  it('deletes a block from its card (confirmation names it); backdrop click cancels', async () => {
    const api = setupApi({ extra: [{ method: 'DELETE', path: '/api/assets/instances/b2', status: 204 }] });
    renderFilters(SA, api);
    await screen.findByText('Block Beta');
    fireEvent.click(screen.getAllByTitle('Delete block')[1]);
    expect(screen.getByText(/Are you sure you want to delete/)).toHaveTextContent('Block Beta');
    // backdrop = the dialog's outer overlay
    fireEvent.click(screen.getByRole('heading', { name: 'Delete Block' }).closest('.fixed') as HTMLElement);
    expect(screen.queryByRole('heading', { name: 'Delete Block' })).toBeNull();
    fireEvent.click(screen.getAllByTitle('Delete block')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Block "Block Beta" deleted')).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/assets/instances/b2')).toHaveLength(1);
  });

  it('a refused block delete shows the reason and re-enables Delete', async () => {
    const api = setupApi({ extra: [{ method: 'DELETE', path: '/api/assets/instances/b1', status: 409, body: { error: 'HAS_HISTORY', message: 'Block has cleaning history' } }] });
    renderFilters(SA, api);
    await screen.findByText('Block Alpha');
    fireEvent.click(screen.getAllByTitle('Delete block')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Block has cleaning history')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('hierarchy controls follow FILTER_HIERARCHY_CREATE / _EDIT / _DELETE', async () => {
    const { unmount } = renderFilters(role('X', ['FILTER_HIERARCHY_EDIT']), setupApi());
    await openBlock();
    expect(screen.getByTitle('Edit Area')).toBeInTheDocument();
    expect(screen.queryByTitle('Delete Area')).toBeNull();
    expect(screen.queryByTitle('Add Area')).toBeNull();
    expect(screen.queryByTitle('Add AHU')).toBeNull();
    switchUser(unmount);
    renderFilters(role('X', ['FILTER_HIERARCHY_DELETE']), setupApi());
    expect(await screen.findAllByTitle('Delete block')).toHaveLength(2);
    expect(screen.queryByTitle('Edit block name')).toBeNull();
    await openBlock();
    expect(screen.getAllByTitle('Delete AHU')).toHaveLength(2);
    expect(screen.queryByTitle('Edit AHU')).toBeNull();
  });
});
