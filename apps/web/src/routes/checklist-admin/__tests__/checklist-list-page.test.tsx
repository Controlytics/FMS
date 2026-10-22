/**
 * Checklist Profiles list (/checklists) through the page harness — real SWR,
 * apiClient, useAuth, useCan, useReauth; only fetch is stubbed. Coverage
 * campaign 2026-10-21.
 *
 * Rules exercised:
 *  - Create / Delete / Active toggle are gated on CHECKLIST_CREATE /
 *    CHECKLIST_DELETE / CHECKLIST_EDIT (the toggle's real backend gate);
 *  - each write goes through re-auth (CREATE / UPDATE / DELETE_CHECKLIST_PROFILE);
 *  - delete asks for confirmation first;
 *  - a disable the server refuses (CHECKLIST_IN_USE) is shown to the operator.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, clearGlobalSwrCache, type MockRoute, type MockRequest } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, reauthOnce, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { LocationProbe } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { ChecklistProfileListPage } from '../list';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

const KEY = '/api/checklist-profiles';
const P = (id: string, over: Record<string, any> = {}) => ({ id, name: `Checklist ${id}`, description: null, isActive: true, questionCount: 2, ...over });
const PROFILES = [
  P('a', { name: 'Pre-wash checks', description: 'Before Wash In', questionCount: 3 }),
  P('b', { name: 'Dryer checks', isActive: false, questionCount: 1 }),
  P('c', { name: 'Storage checks', questionCount: 0 }),
];
const ALL_PERMS = role('QA', ['CHECKLIST_READ', 'CHECKLIST_CREATE', 'CHECKLIST_EDIT', 'CHECKLIST_DELETE']);
const READ_ONLY = role('OPERATOR', ['CHECKLIST_READ']);

function open(user: any = ALL_PERMS, profiles: any[] = PROFILES, extra: MockRoute[] = [], reauthActions: string[] = [], globalCache = false) {
  const api = mockApi([...extra, { path: KEY, body: { data: profiles } }, ...baseRoutes({ reauthActions })]);
  renderPage(<><ChecklistProfileListPage /><LocationProbe /></>, { user, api, route: '/checklists', globalCache });
  return api;
}
const stat = (label: string) => screen.getByText(label, { selector: 'div.text-xs' }).previousSibling as HTMLElement;
const cardOf = (name: string) => screen.getByRole('heading', { name }).closest('.cursor-pointer') as HTMLElement;
const createDlg = () => screen.getByRole('heading', { name: 'Create Checklist' }).closest('.max-w-md') as HTMLElement;
const okDialog = async (title: string, message?: string | RegExp) => {
  const dlg = (await screen.findByRole('heading', { name: title })).closest('[role="dialog"]') as HTMLElement;
  if (message !== undefined) expect(dlg).toHaveTextContent(message);
  fireEvent.click(within(dlg).getByRole('button', { name: 'OK' }));
};
/** The Active toggle, named by the action it performs (3d). */
const toggleOf = (name: string) => within(cardOf(name)).queryByRole('button', { name: new RegExp(`^(Activate|Deactivate) ${name}$`) }) as HTMLButtonElement;
const reauthReady = (api: ReturnType<typeof mockApi>) =>
  waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));

describe('Checklist list — what is shown', () => {
  it('cards, stats, filters and search; reads only the list (every row)', async () => {
    const api = open(READ_ONLY);
    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(await screen.findByRole('heading', { name: 'Pre-wash checks' })).toBeInTheDocument();
    expect(api.calls('GET', KEY)[0].query.get('limit')).toBe('1000000');
    expect(stat('Total Checklists')).toHaveTextContent('3');
    expect(stat('Active')).toHaveTextContent('2');
    expect(stat('Inactive')).toHaveTextContent('1');
    expect(stat('Total Questions')).toHaveTextContent('4');
    expect(cardOf('Pre-wash checks')).toHaveTextContent('Before Wash In');
    expect(cardOf('Pre-wash checks')).toHaveTextContent('3 questions');
    expect(cardOf('Dryer checks')).toHaveTextContent('1 question');
    expect(cardOf('Dryer checks')).toHaveTextContent('Inactive');
    // Read-only: no create, delete or toggle.
    expect(screen.queryByRole('button', { name: 'Create Checklist' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(toggleOf('Pre-wash checks')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Active \(2\)/ }));
    expect(screen.queryByRole('heading', { name: 'Dryer checks' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Inactive \(1\)/ }));
    expect(screen.getByRole('heading', { name: 'Dryer checks' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pre-wash checks' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^All \(3\)/ }));
    fireEvent.change(screen.getByPlaceholderText('Search checklists...'), { target: { value: 'STORAGE' } });
    expect(screen.getByRole('heading', { name: 'Storage checks' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pre-wash checks' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search checklists...'), { target: { value: 'nothing like it' } });
    expect(screen.getByText('No checklists match your search')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('the search box takes the theme focus ring and drops it on blur', async () => {
    open(READ_ONLY);
    const box = await screen.findByPlaceholderText('Search checklists...');
    fireEvent.focus(box);
    expect(box.style.borderColor).toBe('var(--theme-primary)');
    fireEvent.blur(box);
    expect(box.style.borderColor).toBe('');
  });

  it('no checklists at all invites creating the first', async () => {
    open(READ_ONLY, []);
    expect(await screen.findByText('No checklists yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first checklist to get started')).toBeInTheDocument();
  });

  it('a failed load is an error in the page (with Retry) as well as a Load Error toast', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(READ_ONLY, [], [{ path: KEY, status: 500, body: { error: 'X', message: 'list exploded' } }]);
    expect(await screen.findByRole('alert')).toHaveTextContent('list exploded');
    expect(screen.getByText('Load Error')).toBeInTheDocument();
    expect(screen.queryByText('No checklists yet')).toBeNull(); // D-OPS-6
  });

  it('a card opens its checklist', async () => {
    open(READ_ONLY);
    fireEvent.click(await screen.findByRole('heading', { name: 'Dryer checks' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/checklists/b');
  });

  it('more than one page of checklists pages; the stats keep counting all of them', async () => {
    const many = Array.from({ length: 30 }, (_, i) => P(`m${String(i).padStart(2, '0')}`, { name: `List ${String(i).padStart(2, '0')}` }));
    // A list opens on the FIRST configured page-size option (usePageSize): 25 here.
    open(READ_ONLY, many, [{ path: '/api/config/pagination/current', body: { limit: 100, count: 3, options: [25, 50, 100] } }]);
    expect(await screen.findByRole('heading', { name: 'List 24' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'List 25' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('heading', { name: 'List 29' })).toBeInTheDocument();
    expect(stat('Total Checklists')).toHaveTextContent('30');
    // A filter change returns to page 1.
    fireEvent.change(screen.getByPlaceholderText('Search checklists...'), { target: { value: 'List' } });
    expect(await screen.findByRole('heading', { name: 'List 00' })).toBeInTheDocument();
  });
});

describe('Checklist list — create', () => {
  it('creates with name + description, then opens the new checklist', async () => {
    await clearGlobalSwrCache();
    const api = open(ALL_PERMS, PROFILES, [{ method: 'POST', path: KEY, status: 201, body: (req: MockRequest) => ({ id: 'new1', ...req.json }) }], [], true);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Checklist' }));
    const dlg = createDlg();
    const submit = within(dlg).getAllByRole('button', { name: 'Create Checklist' }).at(-1)!;
    expect(submit).toBeDisabled();
    const name = within(dlg).getByPlaceholderText('e.g. HEPA Pre-Wash Checklist');
    fireEvent.focus(name); fireEvent.blur(name);
    fireEvent.change(name, { target: { value: 'Post-dry checks' } });
    const desc = within(dlg).getByPlaceholderText('Brief description of this checklist...');
    fireEvent.focus(desc);
    expect(desc.style.borderColor).toBe('var(--theme-primary)');
    fireEvent.blur(desc);
    fireEvent.change(desc, { target: { value: 'After Dry Out' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/checklists/new1'));
    expect(api.calls('POST', KEY)[0].json).toEqual({ name: 'Post-dry checks', description: 'After Dry Out' });
    expect(screen.queryByRole('heading', { name: 'Create Checklist' })).toBeNull();
    // The list is re-read (global mutate on the list key).
    await waitFor(() => expect(api.calls('GET', KEY).length).toBeGreaterThan(1));
  });

  it('Enter in the name submits; a blank description is not sent; a refusal is shown', async () => {
    const api = open(ALL_PERMS, PROFILES, [{ method: 'POST', path: KEY, status: 409, body: { error: 'DUPLICATE', message: 'Name already used' } }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Checklist' }));
    const name = within(createDlg()).getByPlaceholderText('e.g. HEPA Pre-Wash Checklist');
    fireEvent.keyDown(name, { key: 'Enter' }); // empty name: nothing happens
    expect(api.calls('POST', KEY)).toHaveLength(0);
    fireEvent.change(name, { target: { value: 'Pre-wash checks' } });
    fireEvent.keyDown(name, { key: 'a' });
    fireEvent.keyDown(name, { key: 'Enter' });
    await okDialog('Name already used');
    expect(api.calls('POST', KEY)[0].json).toEqual({ name: 'Pre-wash checks' });
    expect(screen.getByTestId('location')).toHaveTextContent('/checklists');
    expect(screen.getByRole('heading', { name: 'Create Checklist' })).toBeInTheDocument();
  });

  it('a refusal without a message says the create failed; a list row without a question count counts as 0', async () => {
    open(ALL_PERMS, [P('a', { name: 'No count', questionCount: undefined }), P('b', { name: 'Two', questionCount: 2 })],
      [{ method: 'POST', path: KEY, status: 400, body: { message: '' } }]);
    await screen.findByRole('heading', { name: 'No count' });
    expect(stat('Total Questions')).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('button', { name: 'Create Checklist' }));
    fireEvent.change(within(createDlg()).getByPlaceholderText('e.g. HEPA Pre-Wash Checklist'), { target: { value: 'X' } });
    fireEvent.click(within(createDlg()).getAllByRole('button', { name: 'Create Checklist' }).at(-1)!);
    await okDialog('Failed to create checklist');
  });

  it('with CREATE_CHECKLIST_PROFILE on the create is signed', async () => {
    const api = open(ALL_PERMS, PROFILES, [{ method: 'POST', path: KEY, status: 201, body: { id: 'n2' } }], ['CREATE_CHECKLIST_PROFILE']);
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Checklist' }));
    fireEvent.change(within(createDlg()).getByPlaceholderText('e.g. HEPA Pre-Wash Checklist'), { target: { value: 'Signed one' } });
    fireEvent.click(within(createDlg()).getAllByRole('button', { name: 'Create Checklist' }).at(-1)!);
    await passReauth();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/checklists/n2'));
    expectSigned(api.calls('POST', KEY)[0]);
  });

  it('Cancel and the backdrop close the dialog; a click inside does not', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Create Checklist' }));
    fireEvent.click(within(createDlg()).getByText('Add a new checklist profile template'));
    expect(screen.getByRole('heading', { name: 'Create Checklist' })).toBeInTheDocument();
    fireEvent.click(within(createDlg()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Create Checklist' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create Checklist' }));
    fireEvent.click(createDlg().parentElement as HTMLElement);
    expect(screen.queryByRole('heading', { name: 'Create Checklist' })).toBeNull();
  });
});

describe('Checklist list — activate / deactivate', () => {
  it('the toggle flips isActive without opening the card; the list re-reads', async () => {
    await clearGlobalSwrCache();
    const api = open(ALL_PERMS, PROFILES, [{ method: 'PUT', path: `${KEY}/a`, body: { ok: true } }, { method: 'PUT', path: `${KEY}/b`, body: { ok: true } }], [], true);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(toggleOf('Pre-wash checks'));
    await waitFor(() => expect(api.calls('PUT', `${KEY}/a`)).toHaveLength(1));
    expect(api.calls('PUT', `${KEY}/a`)[0].json).toEqual({ isActive: false });
    fireEvent.click(toggleOf('Dryer checks'));
    await waitFor(() => expect(api.calls('PUT', `${KEY}/b`)[0]?.json).toEqual({ isActive: true }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/checklists$/);
    await waitFor(() => expect(api.calls('GET', KEY).length).toBeGreaterThan(1));
  });

  it('disabling a checklist a cleaning profile uses is refused, and the refusal is shown', async () => {
    open(ALL_PERMS, PROFILES, [{ method: 'PUT', path: `${KEY}/a`, status: 409, body: { error: 'CHECKLIST_IN_USE', message: 'Used by cleaning profile DRY STORAGE' } }]);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(toggleOf('Pre-wash checks'));
    await okDialog('Used by cleaning profile DRY STORAGE');
  });

  it('with UPDATE_CHECKLIST_PROFILE on the toggle is signed', async () => {
    const api = open(ALL_PERMS, PROFILES, [{ method: 'PUT', path: `${KEY}/a`, body: { ok: true } }], ['UPDATE_CHECKLIST_PROFILE']);
    await reauthReady(api);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(toggleOf('Pre-wash checks'));
    await passReauth();
    await waitFor(() => expect(api.calls('PUT', `${KEY}/a`)).toHaveLength(1));
    expectSigned(api.calls('PUT', `${KEY}/a`)[0]);
  });

  it('only CHECKLIST_EDIT shows the toggle (CHECKLIST_TOGGLE alone does not)', async () => {
    open(role('X', ['CHECKLIST_READ', 'CHECKLIST_TOGGLE']));
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    expect(toggleOf('Pre-wash checks')).toBeNull();
  });
});

describe('Checklist list — delete', () => {
  it('asks first; a declined confirm sends nothing; a confirmed one DELETEs and re-reads', async () => {
    await clearGlobalSwrCache();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const api = open(SA, PROFILES, [{ method: 'DELETE', path: `${KEY}/c`, status: 204 }], [], true);
    const del = await screen.findByRole('button', { name: 'Delete Storage checks' });
    fireEvent.click(del);
    expect(confirm).toHaveBeenCalledWith('Delete "Storage checks"? This cannot be undone.');
    expect(api.calls('DELETE', `${KEY}/c`)).toHaveLength(0);
    fireEvent.click(del);
    await waitFor(() => expect(api.calls('DELETE', `${KEY}/c`)).toHaveLength(1));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/checklists$/);
    await waitFor(() => expect(api.calls('GET', KEY).length).toBeGreaterThan(1));
  });

  it('a refused delete is shown; with the row on, the delete is signed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = open(ALL_PERMS, PROFILES, [
      { method: 'DELETE', path: `${KEY}/a`, status: 409, times: 1, body: { error: 'IN_USE', message: 'Checklist is in use' } },
      { method: 'DELETE', path: `${KEY}/a`, status: 204 },
    ], ['DELETE_CHECKLIST_PROFILE']);
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Pre-wash checks' }));
    await passReauth();
    await okDialog('Checklist is in use');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Pre-wash checks' }));
    await passReauth();
    await waitFor(() => expect(api.calls('DELETE', `${KEY}/a`)).toHaveLength(2));
    expectSigned(api.calls('DELETE', `${KEY}/a`)[1]);
  });

  it('a server that demands re-auth the config did not (stale) gets the prompt; the signed retry deletes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = open(ALL_PERMS, PROFILES, [reauthOnce('DELETE', `${KEY}/a`), { method: 'DELETE', path: `${KEY}/a`, status: 204 }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Pre-wash checks' }));
    expect(await screen.findByPlaceholderText('Enter your password')).toBeInTheDocument();
    await passReauth();
    await waitFor(() => expect(api.calls('DELETE', `${KEY}/a`)).toHaveLength(2));
    expectSigned(api.calls('DELETE', `${KEY}/a`)[1]);
  });
});
