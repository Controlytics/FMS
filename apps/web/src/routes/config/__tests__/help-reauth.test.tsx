import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { HelpArticlesPage } from '../help';
import { SUPER_ADMIN, commonRoutes, resetEnv, cancelReauth } from './config-test-helpers';

/**
 * 2026-10-21 fixes on the Help Articles page:
 *  - item 9: dismissing the password prompt for create / edit / delete showed
 *    "Cancelled — password confirmation was not completed." as the dialog's
 *    error (no `onCancel` was passed, so the hook fell back to `onError`);
 *  - item 10: the one prompt signs three different actions but never said which.
 */
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(() => { resetEnv(); vi.restoreAllMocks(); });

const ARTICLES = [
  { id: 'a1', key: 'audit-guide', title: 'Reading the audit trail', category: 'audit', sortOrder: 1, currentVersion: 3, updatedAt: '2026-10-05T09:15:00Z' },
];

function setup(reauth: string[], extra: MockRoute[] = []) {
  const api = mockApi([
    ...extra,
    { path: '/api/help', body: ARTICLES },
    { path: '/api/help/audit-guide', body: { content: 'Body text' } },
    { path: '/api/config/datetime/current', body: { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' } },
    ...commonRoutes({ reauth }),
  ]);
  renderPage(<HelpArticlesPage />, { user: SUPER_ADMIN, api });
  return api;
}

const row = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;
const dialogOf = (title: string) => screen.getByRole('heading', { name: title }).closest('div.relative') as HTMLElement;
const noCancelMessage = () => expect(screen.queryByText(/Cancelled|password confirmation was not completed/)).toBeNull();

async function ready(api: ReturnType<typeof mockApi>) {
  await screen.findByText('Reading the audit trail');
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
}

describe('Help Articles — the prompt names what is signed; cancel is not a failure', () => {
  it('create: prompt says "Create Help Article"; cancel sends nothing, shows no error, Create stays usable', async () => {
    const api = setup(['CREATE_HELP_ARTICLE']);
    await ready(api);
    fireEvent.click(screen.getByRole('button', { name: /New Article/ }));
    const dlg = dialogOf('Create Help Article');
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. entity-overview, audit-guide'), { target: { value: 'k' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. Getting Started with Entities'), { target: { value: 'T' } });
    fireEvent.change(within(dlg).getByPlaceholderText(/Write article content here/), { target: { value: 'c' } });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Create Article' })); });
    expect(await screen.findByText(/Performing "Create Help Article" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Create Article' })).not.toBeDisabled());
    noCancelMessage();
    expect(api.calls('POST', '/api/help')).toHaveLength(0);
  });

  it('edit: prompt says "Update Help Article"; cancel sends nothing, shows no error, Save stays usable', async () => {
    const api = setup(['UPDATE_HELP_ARTICLE']);
    await ready(api);
    await act(async () => { fireEvent.click(within(row('Reading the audit trail')).getByTitle('Edit article')); });
    const dlg = dialogOf('Edit Article');
    await within(dlg).findByDisplayValue('Body text');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' })); });
    expect(await screen.findByText(/Performing "Update Help Article" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Save Changes' })).not.toBeDisabled());
    noCancelMessage();
    expect(api.calls('PUT', '/api/help/a1')).toHaveLength(0);
  });

  it('delete: prompt says "Delete Help Article"; cancel sends nothing, shows no error, Delete stays usable', async () => {
    const api = setup(['DELETE_HELP_ARTICLE']);
    await ready(api);
    fireEvent.click(within(row('Reading the audit trail')).getByTitle('Delete article'));
    const dlg = dialogOf('Delete Article');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Delete Article' })); });
    expect(await screen.findByText(/Performing "Delete Help Article" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Delete Article' })).not.toBeDisabled());
    noCancelMessage();
    expect(api.calls('DELETE', '/api/help/a1')).toHaveLength(0);
  });
});
