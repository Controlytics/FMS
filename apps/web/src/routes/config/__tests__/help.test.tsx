import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { HelpArticlesPage } from '../help';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

// Multi-request flows; generous under coverage + a busy machine.
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(() => { resetEnv(); vi.restoreAllMocks(); });

const ARTICLES = [
  { id: 'a1', key: 'audit-guide', title: 'Reading the audit trail', category: 'audit', sortOrder: 1, currentVersion: 3, updatedAt: '2026-10-05T09:15:00Z' },
  { id: 'a2', key: 'legacy note', title: 'Legacy note', category: 'retired-cat', sortOrder: 0, currentVersion: 1, updatedAt: '2026-10-06T09:15:00Z' },
];
const LONG = 'x'.repeat(320);
const VERSIONS = [
  { id: 'v3', helpArticleId: 'a1', version: 3, content: LONG, changedBy: 'superadmin', changeNotes: 'Clarified redaction', createdAt: '2026-10-05T09:15:00Z' },
  { id: 'v2', helpArticleId: 'a1', version: 2, content: 'short body', changedBy: 'qa.lead', changeNotes: null, createdAt: '2026-09-01T09:15:00Z' },
  { id: 'v1', helpArticleId: 'a1', version: 1, content: '', changedBy: 'qa.lead', changeNotes: null, createdAt: '2026-08-01T09:15:00Z' },
];

function setup(extra: MockRoute[] = [], opts: { articles?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...extra,
    { path: '/api/help', body: opts.articles ?? ARTICLES },
    { path: '/api/config/datetime/current', body: { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' } },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<HelpArticlesPage />, { user: SUPER_ADMIN, api });
  return api;
}

const row = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;
const dialogOf = (title: string) => screen.getByRole('heading', { name: title }).closest('div.relative') as HTMLElement;
const lastListQuery = (api: ReturnType<typeof mockApi>) => {
  const c = api.calls('GET', '/api/help');
  return c[c.length - 1].query;
};

describe('Help Articles — list, search, filter', () => {
  it('shows a loading state, then the articles with key, category, version and update time', async () => {
    const api = setup();
    expect(screen.getByText('Loading help articles...')).toBeInTheDocument();
    expect(await screen.findByText('Reading the audit trail')).toBeInTheDocument();
    const r = row('Reading the audit trail');
    expect(within(r).getByText('audit-guide')).toBeInTheDocument();
    expect(within(r).getByText('Audit')).toBeInTheDocument();
    expect(within(r).getByText('v3')).toBeInTheDocument();
    expect(within(r).getByText('2026-10-05 09:15')).toBeInTheDocument();
    // An unknown category shows its raw value.
    expect(within(row('Legacy note')).getByText('retired-cat')).toBeInTheDocument();
    expect(screen.getByText('Articles').nextSibling).toHaveTextContent('2');
    expect(api.calls('GET', '/api/help')[0].url).toBe('/api/help');
    expect(api.unmatched).toEqual([]);
  });

  it('empty library suggests creating the first article', async () => {
    setup([], { articles: [] });
    expect(await screen.findByText('No articles found')).toBeInTheDocument();
    expect(screen.getByText('Create your first help article using the button above')).toBeInTheDocument();
  });

  it('search is debounced into ?search=, category into ?category=, and Clear resets both', async () => {
    const api = setup([
      { path: /^\/api\/help\?search=nothing/, body: [] },
      { path: /^\/api\/help\?(search=audit&)?category=audit$/, body: [ARTICLES[0]] },
    ]);
    await screen.findByText('Reading the audit trail');
    fireEvent.change(screen.getByPlaceholderText('Search by title, key, or content...'), { target: { value: 'audit' } });
    await waitFor(() => expect(lastListQuery(api).get('search')).toBe('audit'), { timeout: 2000 });
    expect(await screen.findByText(/matching article/)).toHaveTextContent('Found 2 matching articles');
    const cat = screen.getAllByRole('combobox')[0];
    fireEvent.change(cat, { target: { value: 'audit' } });
    await waitFor(() => expect(lastListQuery(api).get('category')).toBe('audit'));
    expect(lastListQuery(api).get('search')).toBe('audit');
    expect(await screen.findByText(/matching article/)).toHaveTextContent('Found 1 matching article');
    expect(screen.queryByText('Legacy note')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
    await waitFor(() => expect(api.calls('GET', '/api/help').at(-1)!.url).toBe('/api/help'), { timeout: 2000 });
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
    expect(await screen.findByText('Legacy note')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search by title, key, or content...'), { target: { value: 'nothing' } });
    expect(await screen.findByText('Try adjusting your search or category filter', {}, { timeout: 2000 })).toBeInTheDocument();
  });
});

describe('Help Articles — create', () => {
  it('validates required fields, normalises the key, and POSTs the trimmed article', async () => {
    const api = setup([{ method: 'POST', path: '/api/help', status: 201, body: { id: 'a9' } }]);
    await screen.findByText('Reading the audit trail');
    fireEvent.click(screen.getByRole('button', { name: /New Article/ }));
    const dlg = dialogOf('Create Help Article');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create Article' }));
    expect(within(dlg).getByText('Key, Title, and Content are required.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/help')).toHaveLength(0);

    fireEvent.change(within(dlg).getByPlaceholderText('e.g. entity-overview, audit-guide'), { target: { value: 'PM Schedule Help' } });
    expect((within(dlg).getByPlaceholderText('e.g. entity-overview, audit-guide') as HTMLInputElement).value).toBe('pm-schedule-help');
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. Getting Started with Entities'), { target: { value: '  PM schedules  ' } });
    fireEvent.change(within(dlg).getByRole('combobox'), { target: { value: 'checklist' } });
    const sort = within(dlg).getByRole('spinbutton');
    fireEvent.change(sort, { target: { value: 'abc' } });
    expect((sort as HTMLInputElement).value).toBe('0');
    fireEvent.change(sort, { target: { value: '4' } });
    fireEvent.change(within(dlg).getByPlaceholderText(/Write article content here/), { target: { value: '# PM\nUpload a year in one file.' } });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Create Article' })); });
    await waitFor(() => expect(api.calls('POST', '/api/help')).toHaveLength(1));
    expect(api.calls('POST', '/api/help')[0].json).toEqual({
      key: 'pm-schedule-help', title: 'PM schedules', category: 'checklist', content: '# PM\nUpload a year in one file.', sortOrder: 4,
    });
    expect(await ackMessage('Article created')).toContain('"  PM schedules  " has been created successfully.');
    expect(screen.queryByRole('heading', { name: 'Create Help Article' })).toBeNull();
    expect(api.calls('GET', '/api/help').length).toBeGreaterThan(1);
  });

  it('a refused create keeps the dialog open with the server message', async () => {
    setup([{ method: 'POST', path: '/api/help', status: 409, body: { error: 'DUPLICATE_KEY', message: 'Key audit-guide already exists' } }]);
    await screen.findByText('Reading the audit trail');
    fireEvent.click(screen.getByRole('button', { name: /New Article/ }));
    const dlg = dialogOf('Create Help Article');
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. entity-overview, audit-guide'), { target: { value: 'audit-guide' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. Getting Started with Entities'), { target: { value: 'Dup' } });
    fireEvent.change(within(dlg).getByPlaceholderText(/Write article content here/), { target: { value: 'c' } });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Create Article' })); });
    expect(await within(dlg).findByText('Key audit-guide already exists')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Create Article' })).not.toBeDisabled();
  });

  it('create the server wants signed: prompt, retry with password; cancelling instead is silent', async () => {
    const api = setup([
      reauthRequired('POST', '/api/help'),
      reauthRequired('POST', '/api/help'),
      { method: 'POST', path: '/api/help', status: 201, body: { id: 'a9' } },
    ]);
    await screen.findByText('Reading the audit trail');
    fireEvent.click(screen.getByRole('button', { name: /New Article/ }));
    const dlg = dialogOf('Create Help Article');
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. entity-overview, audit-guide'), { target: { value: 'k' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. Getting Started with Entities'), { target: { value: 'T' } });
    fireEvent.change(within(dlg).getByPlaceholderText(/Write article content here/), { target: { value: 'c' } });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Create Article' })); });
    await cancelReauth();
    // 2026-10-21 (item 9): a dismissed prompt is not a failure, so the dialog
    // shows no error (it used to show the hook's "Cancelled — …" text).
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Create Article' })).not.toBeDisabled());
    expect(within(dlg).queryByText(/password confirmation was not completed/)).toBeNull();

    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Create Article' })); });
    await signReauth('pw-help');
    await waitFor(() => expect(api.calls('POST', '/api/help')).toHaveLength(3));
    const signed = api.calls('POST', '/api/help')[2];
    expect(signed.headers['x-reauth-password']).toBe('pw-help');
    expect(signed.json).toMatchObject({ key: 'k', title: 'T', _currentPassword: 'pw-help' });
    await ackMessage('Article created');
  });

  it('the dialog Cancel closes without sending', async () => {
    const api = setup();
    await screen.findByText('Reading the audit trail');
    fireEvent.click(screen.getByRole('button', { name: /New Article/ }));
    fireEvent.click(within(dialogOf('Create Help Article')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Create Help Article' })).toBeNull();
    expect(api.calls('POST', '/api/help')).toHaveLength(0);
  });
});

describe('Help Articles — edit', () => {
  it('loads the full content, keeps the key read-only, and PUTs title/category/sort/content', async () => {
    const api = setup([
      { path: '/api/help/audit-guide', body: { ...ARTICLES[0], content: 'Old body' } },
      { method: 'PUT', path: '/api/help/a1', body: { ok: true } },
    ]);
    await screen.findByText('Reading the audit trail');
    await act(async () => { fireEvent.click(within(row('Reading the audit trail')).getByTitle('Edit article')); });
    const dlg = dialogOf('Edit Article');
    expect(within(dlg).getByText('(read-only)')).toBeInTheDocument();
    const key = within(dlg).getByDisplayValue('audit-guide');
    expect(key).toBeDisabled();
    expect(await within(dlg).findByDisplayValue('Old body')).toBeInTheDocument();
    fireEvent.change(within(dlg).getByDisplayValue('Reading the audit trail'), { target: { value: 'Reading the trail' } });
    fireEvent.change(within(dlg).getByRole('combobox'), { target: { value: 'users' } });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' })); });
    await waitFor(() => expect(api.calls('PUT', '/api/help/a1')).toHaveLength(1));
    expect(api.calls('PUT', '/api/help/a1')[0].json).toEqual({ title: 'Reading the trail', category: 'users', sortOrder: 1, content: 'Old body' });
    expect(await ackMessage('Article updated')).toContain('"Reading the trail" has been updated successfully.');
    expect(screen.queryByRole('heading', { name: 'Edit Article' })).toBeNull();
  });

  it('empty content is left out of the PUT (keeps the stored content); a blank title is refused', async () => {
    const api = setup([
      { path: /^\/api\/help\/legacy%20note$/, body: { ...ARTICLES[1] } },
      { method: 'PUT', path: '/api/help/a2', body: { ok: true } },
    ]);
    await screen.findByText('Legacy note');
    await act(async () => { fireEvent.click(within(row('Legacy note')).getByTitle('Edit article')); });
    await waitFor(() => expect(api.calls('GET', /^\/api\/help\/legacy%20note$/)).toHaveLength(1));
    const dlg = dialogOf('Edit Article');
    const title = within(dlg).getByDisplayValue('Legacy note');
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    expect(within(dlg).getByText('Title is required.')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/help/a2')).toHaveLength(0);
    fireEvent.change(title, { target: { value: 'Legacy note v2' } });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' })); });
    await waitFor(() => expect(api.calls('PUT', '/api/help/a2')).toHaveLength(1));
    expect(api.calls('PUT', '/api/help/a2')[0].json).toEqual({ title: 'Legacy note v2', category: 'retired-cat', sortOrder: 0 });
    await ackMessage('Article updated');
  });

  it('a failed content load is shown in the dialog', async () => {
    setup([{ path: '/api/help/audit-guide', status: 404, body: { error: 'NOT_FOUND', message: 'Article not found' } }]);
    await screen.findByText('Reading the audit trail');
    await act(async () => { fireEvent.click(within(row('Reading the audit trail')).getByTitle('Edit article')); });
    expect(await within(dialogOf('Edit Article')).findByText('Could not load article content: Article not found')).toBeInTheDocument();
  });

  it('edit gated up front by UPDATE_HELP_ARTICLE signs the PUT; a refused update keeps the dialog', async () => {
    const api = setup([
      { path: '/api/help/audit-guide', body: { content: 'B' } },
      { method: 'PUT', path: '/api/help/a1', times: 1, status: 400, body: { error: 'VALIDATION', message: 'Title too long' } },
    ], { reauth: ['UPDATE_HELP_ARTICLE'] });
    await screen.findByText('Reading the audit trail');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(within(row('Reading the audit trail')).getByTitle('Edit article')); });
    const dlg = dialogOf('Edit Article');
    await within(dlg).findByDisplayValue('B');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' })); });
    expect(await screen.findByText(/requires identity verification/)).toBeInTheDocument();
    expect(api.calls('PUT', '/api/help/a1')).toHaveLength(0);
    await signReauth('pw-edit');
    await waitFor(() => expect(api.calls('PUT', '/api/help/a1')).toHaveLength(1));
    expect(api.calls('PUT', '/api/help/a1')[0].headers['x-reauth-password']).toBe('pw-edit');
    expect(await within(dlg).findByText('Title too long')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Edit Article' })).toBeNull();
  });
});

describe('Help Articles — delete', () => {
  it('confirms by title, sends DELETE, reports success', async () => {
    const api = setup([{ method: 'DELETE', path: '/api/help/a2', status: 204 }]);
    await screen.findByText('Legacy note');
    fireEvent.click(within(row('Legacy note')).getByTitle('Delete article'));
    const dlg = dialogOf('Delete Article');
    expect(within(dlg).getByText('"Legacy note"')).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Delete Article' })); });
    await waitFor(() => expect(api.calls('DELETE', '/api/help/a2')).toHaveLength(1));
    expect(await ackMessage('Article deleted')).toContain('"Legacy note" has been deleted.');
    expect(screen.queryByRole('heading', { name: 'Delete Article' })).toBeNull();
  });

  it('a refused delete is shown in the dialog; signature retry and Cancel work', async () => {
    const api = setup([
      { method: 'DELETE', path: '/api/help/a1', times: 1, status: 403, body: { error: 'FORBIDDEN', message: 'Super admin only' } },
      reauthRequired('DELETE', '/api/help/a1'),
      { method: 'DELETE', path: '/api/help/a1', status: 204 },
    ]);
    await screen.findByText('Reading the audit trail');
    fireEvent.click(within(row('Reading the audit trail')).getByTitle('Delete article'));
    const dlg = dialogOf('Delete Article');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Delete Article' })); });
    expect(await within(dlg).findByText('Super admin only')).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Delete Article' })); });
    await signReauth('pw-x');
    await waitFor(() => expect(api.calls('DELETE', '/api/help/a1')).toHaveLength(3));
    expect(api.calls('DELETE', '/api/help/a1')[2].json).toEqual({ _currentPassword: 'pw-x' });
    await ackMessage('Article deleted');

    fireEvent.click(within(row('Legacy note')).getByTitle('Delete article'));
    fireEvent.click(within(dialogOf('Delete Article')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Delete Article' })).toBeNull();
    expect(api.calls('DELETE', '/api/help/a2')).toHaveLength(0);
  });
});

describe('Help Articles — dialogs dismiss', () => {
  it('Escape closes create / edit / history; a backdrop click closes delete — nothing is sent', async () => {
    const api = setup([
      { path: '/api/help/audit-guide', body: { content: 'B' } },
      { path: '/api/help/a1/versions', body: [] },
    ]);
    await screen.findByText('Reading the audit trail');
    const esc = () => act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });

    fireEvent.click(screen.getByRole('button', { name: /New Article/ }));
    await esc();
    expect(screen.queryByRole('heading', { name: 'Create Help Article' })).toBeNull();

    await act(async () => { fireEvent.click(within(row('Reading the audit trail')).getByTitle('Edit article')); });
    await within(dialogOf('Edit Article')).findByDisplayValue('B');
    await esc();
    expect(screen.queryByRole('heading', { name: 'Edit Article' })).toBeNull();

    await act(async () => { fireEvent.click(within(row('Reading the audit trail')).getByTitle('Version history')); });
    await screen.findByText('No version history available.');
    await esc();
    expect(screen.queryByRole('heading', { name: 'Version History' })).toBeNull();

    fireEvent.click(within(row('Reading the audit trail')).getByTitle('Delete article'));
    const backdrop = dialogOf('Delete Article').previousElementSibling as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole('heading', { name: 'Delete Article' })).toBeNull();

    expect(api.calls('POST', /help/)).toHaveLength(0);
    expect(api.calls('PUT', /help/)).toHaveLength(0);
    expect(api.calls('DELETE', /help/)).toHaveLength(0);
  });
});

describe('Help Articles — version history', () => {
  it('lists versions newest first with notes, author, and a truncated preview', async () => {
    const api = setup([{ path: '/api/help/a1/versions', body: VERSIONS }]);
    await screen.findByText('Reading the audit trail');
    await act(async () => { fireEvent.click(within(row('Reading the audit trail')).getByTitle('View version history')); });
    const dlg = dialogOf('Version History');
    expect(within(dlg).getByText(/3 versions/)).toBeInTheDocument();
    expect(await within(dlg).findByText('Version 3')).toBeInTheDocument();
    expect(within(dlg).getAllByText('Latest')).toHaveLength(1);
    expect(within(dlg).getByText('Clarified redaction')).toBeInTheDocument();
    expect(within(dlg).getByText('superadmin')).toBeInTheDocument();
    expect(within(dlg).getByText('x'.repeat(300) + '…')).toBeInTheDocument();
    expect(within(dlg).getByText('short body')).toBeInTheDocument();
    // v1 has no content -> no preview block for it (two previews total).
    expect(within(dlg).getAllByText('Content preview')).toHaveLength(2);
    expect(api.calls('GET', '/api/help/a1/versions')).toHaveLength(1);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('heading', { name: 'Version History' })).toBeNull();
  });

  it('single-version article with no history, opened from the row action', async () => {
    setup([{ path: '/api/help/a2/versions', body: [] }]);
    await screen.findByText('Legacy note');
    await act(async () => { fireEvent.click(within(row('Legacy note')).getByTitle('Version history')); });
    const dlg = dialogOf('Version History');
    expect(within(dlg).getByText(/1 version$/)).toBeInTheDocument();
    expect(await within(dlg).findByText('No version history available.')).toBeInTheDocument();
  });

  it('a failed history load is reported', async () => {
    setup([{ path: '/api/help/a1/versions', status: 500, body: { error: 'INTERNAL', message: 'db down' } }]);
    await screen.findByText('Reading the audit trail');
    await act(async () => { fireEvent.click(within(row('Reading the audit trail')).getByTitle('Version history')); });
    expect(await ackMessage('Failed to load versions')).toContain('Could not retrieve version history.');
    expect(within(dialogOf('Version History')).getByText('No version history available.')).toBeInTheDocument();
  });
});
