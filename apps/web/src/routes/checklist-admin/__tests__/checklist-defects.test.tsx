/**
 * Checklist Profiles (list + detail) — defects found by the coverage campaign
 * (2026-10-21), each pinned failing-first:
 *  D-OPS-3  question reorder skipped re-auth (server: UPDATE_CHECKLIST_PROFILE).
 *  D-OPS-6  a failed load read "No checklists yet" / a "Checklist" page with
 *           "No questions yet" and Add Question offered.
 *  D-OPS-7  a stale re-auth config put an error next to the password prompt.
 *  D-OPS-12 one click deleted a question, no confirmation.
 *  3d       controls with no accessible name.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, reauthOnce, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { LocationProbe } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { unnamedControls } from '../../pm-schedules/__tests__/a11y-kit';
import { ChecklistProfileListPage } from '../list';
import { ChecklistProfileDetailPage } from '../detail';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

const LIST = '/api/checklist-profiles';
const KEY = '/api/checklist-profiles/cl1';
const Q = [
  { id: 'q1', question: 'Frame intact?', questionType: 'YES_NO', required: true, section: 'Pre-checks' },
  { id: 'q2', question: 'Water temperature', questionType: 'NUMERIC', validation: { min: 20, max: 40, unit: 'degC' } },
  { id: 'q3', question: 'Damage type', questionType: 'DROPDOWN', options: ['None', 'Torn'] },
];
const PROFILE = { id: 'cl1', name: 'Pre-wash checks', description: 'Before Wash In', isActive: true, questions: Q };
const EDITOR = role('QA', ['CHECKLIST_READ', 'CHECKLIST_CREATE', 'CHECKLIST_EDIT', 'CHECKLIST_DELETE', 'VERSION_HISTORY_VIEW']);

function openList(routes: MockRoute[], reauthActions: string[] = [], user: any = EDITOR) {
  const api = mockApi([...routes, ...baseRoutes({ reauthActions })]);
  renderPage(<><ChecklistProfileListPage /><LocationProbe /></>, { user, api, route: '/checklists' });
  return api;
}
function openDetail(routes: MockRoute[], reauthActions: string[] = [], user: any = EDITOR) {
  const api = mockApi([...routes, ...baseRoutes({ reauthActions })]);
  renderPage(<><Routes><Route path="/checklists/:id" element={<ChecklistProfileDetailPage />} /></Routes><LocationProbe /></>,
    { user, api, route: '/checklists/cl1' });
  return api;
}
const reauthReady = (api: ReturnType<typeof mockApi>) =>
  waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
const qCard = (text: string) => screen.getByText(text).closest('.group') as HTMLElement;
const modal = () => screen.getByRole('heading', { name: /^(Add|Edit) Question$/ }).closest('.max-w-lg') as HTMLElement;
const noErrorShown = () => {
  expect(screen.queryByText('Re-authentication required')).toBeNull();
  expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
};
const cancelPrompt = async () => {
  await screen.findByPlaceholderText('Enter your password');
  const box = screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement;
  fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
};

// ─── D-OPS-3 ────────────────────────────────────────────────────────────────
describe('D-OPS-3 — reordering questions is signed like every other checklist write', () => {
  it('with UPDATE_CHECKLIST_PROFILE on, the arrows ask for the password and the reorder is signed', async () => {
    const api = openDetail([{ method: 'PUT', path: `${KEY}/reorder`, body: { ok: true } }, { path: KEY, body: PROFILE }], ['UPDATE_CHECKLIST_PROFILE']);
    await reauthReady(api);
    await screen.findByText('Frame intact?');
    fireEvent.click(screen.getByRole('button', { name: 'Move question 1 down' }));
    await passReauth();
    await waitFor(() => expect(api.calls('PUT', `${KEY}/reorder`)).toHaveLength(1));
    const [put] = api.calls('PUT', `${KEY}/reorder`);
    expectSigned(put);
    expect(put.json.questionIds).toEqual(['q2', 'q1', 'q3']);
  });

  it('a stale config: the server demands re-auth and the prompt opens (no error banner)', async () => {
    const api = openDetail([reauthOnce('PUT', `${KEY}/reorder`), { method: 'PUT', path: `${KEY}/reorder`, body: { ok: true } }, { path: KEY, body: PROFILE }]);
    await screen.findByText('Frame intact?');
    fireEvent.click(screen.getByRole('button', { name: 'Move question 3 up' }));
    expect(await screen.findByPlaceholderText('Enter your password')).toBeInTheDocument();
    noErrorShown();
    await passReauth();
    await waitFor(() => expect(api.calls('PUT', `${KEY}/reorder`)).toHaveLength(2));
    expectSigned(api.calls('PUT', `${KEY}/reorder`)[1]);
  });

  it('cancelling the reorder prompt is silent and sends nothing signed', async () => {
    const api = openDetail([{ path: KEY, body: PROFILE }], ['UPDATE_CHECKLIST_PROFILE']);
    await reauthReady(api);
    await screen.findByText('Frame intact?');
    fireEvent.click(screen.getByRole('button', { name: 'Move question 1 down' }));
    await cancelPrompt();
    noErrorShown();
    expect(api.calls('PUT', `${KEY}/reorder`)).toHaveLength(0);
  });
});

// ─── D-OPS-6 ────────────────────────────────────────────────────────────────
describe('D-OPS-6 — a failed load is an error with Retry, never the empty state', () => {
  it('list: a 500 shows an error with Retry, not "No checklists yet"; Retry re-reads', async () => {
    allowConsoleError(/\[SWR Error\]/);
    openList([
      { path: LIST, status: 500, times: 1, body: { error: 'X', message: 'list exploded' } },
      { path: LIST, body: { data: [{ id: 'cl1', name: 'Pre-wash checks', isActive: true, questionCount: 3 }] } },
    ]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the checklists');
    expect(alert).toHaveTextContent('list exploded');
    expect(screen.queryByText('No checklists yet')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Pre-wash checks' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('list: a 403 says so, with no Retry', async () => {
    allowConsoleError(/\[SWR Error\]/);
    openList([{ path: LIST, status: 403, body: { error: 'FORBIDDEN', message: 'Missing CHECKLIST_READ' } }]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission to view checklists');
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('detail: a 500 shows an error with Retry and a way back — no generic title, no Add Question', async () => {
    allowConsoleError(/\[SWR Error\]/);
    openDetail([
      { path: KEY, status: 500, times: 1, body: { error: 'X', message: 'detail exploded' } },
      { path: KEY, body: PROFILE },
    ]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load this checklist');
    expect(alert).toHaveTextContent('detail exploded');
    expect(screen.queryByRole('heading', { name: 'Checklist' })).toBeNull();
    expect(screen.queryByText('No questions yet')).toBeNull();
    expect(screen.queryByRole('button', { name: /Add Question/ })).toBeNull();
    expect(within(alert).getByRole('link', { name: 'Back to Checklists' })).toHaveAttribute('href', '/checklists');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Pre-wash checks' })).toBeInTheDocument();
  });

  it('detail: a 404 / 403 has no Retry for a 403 and names the problem', async () => {
    allowConsoleError(/\[SWR Error\]/);
    openDetail([{ path: KEY, status: 403, body: { error: 'FORBIDDEN', message: 'Missing CHECKLIST_READ' } }]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission to view this checklist');
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('detail: a failure with no message still explains itself', async () => {
    allowConsoleError(/\[SWR Error\]/);
    openDetail([{ path: KEY, status: 502, body: { message: '' } }]);
    expect(await screen.findByRole('alert')).toHaveTextContent('The server did not answer.');
  });
});

// ─── D-OPS-7 ────────────────────────────────────────────────────────────────
describe('D-OPS-7 — a stale re-auth config opens the prompt with no error beside it', () => {
  it('list: create / toggle / delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = openList([
      reauthOnce('POST', LIST), { method: 'POST', path: LIST, status: 201, body: { id: 'n1' } },
      reauthOnce('PUT', `${LIST}/cl1`), { method: 'PUT', path: `${LIST}/cl1`, body: { ok: true } },
      reauthOnce('DELETE', `${LIST}/cl1`), { method: 'DELETE', path: `${LIST}/cl1`, status: 204 },
      { path: LIST, body: { data: [{ id: 'cl1', name: 'Pre-wash checks', isActive: true, questionCount: 3 }] } },
    ]);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Pre-wash checks' }));
    expect(await screen.findByPlaceholderText('Enter your password')).toBeInTheDocument();
    noErrorShown();
    await passReauth();
    await waitFor(() => expect(api.calls('PUT', `${LIST}/cl1`)).toHaveLength(2));
    expectSigned(api.calls('PUT', `${LIST}/cl1`)[1]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Pre-wash checks' }));
    expect(await screen.findByPlaceholderText('Enter your password')).toBeInTheDocument();
    noErrorShown();
    await passReauth();
    await waitFor(() => expect(api.calls('DELETE', `${LIST}/cl1`)).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Create Checklist' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Post-dry checks' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Checklist' }).at(-1)!);
    expect(await screen.findByPlaceholderText('Enter your password')).toBeInTheDocument();
    noErrorShown();
    await passReauth();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/checklists/n1'));
  });

  it('list: a real refusal is still reported; a cancel is silent', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    openList([
      { method: 'PUT', path: `${LIST}/cl1`, status: 409, body: { error: 'CHECKLIST_IN_USE', message: 'Used by DRY STORAGE' } },
      { path: LIST, body: { data: [{ id: 'cl1', name: 'Pre-wash checks', isActive: true, questionCount: 3 }] } },
    ], ['DELETE_CHECKLIST_PROFILE']);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Pre-wash checks' }));
    const dlg = (await screen.findByRole('heading', { name: 'Used by DRY STORAGE' })).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dlg).getByRole('button', { name: 'OK' }));
    // Cancelling the delete prompt shows nothing.
    await waitFor(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Delete Pre-wash checks' }));
    await cancelPrompt();
    noErrorShown();
  });

  it('detail: add question and delete question', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = openDetail([
      reauthOnce('POST', `${KEY}/questions`), { method: 'POST', path: `${KEY}/questions`, status: 201, body: { id: 'q9' } },
      reauthOnce('DELETE', `${KEY}/questions/q1`), { method: 'DELETE', path: `${KEY}/questions/q1`, status: 204 },
      { path: KEY, body: PROFILE },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Question' }));
    fireEvent.change(within(modal()).getByLabelText(/^Question/), { target: { value: 'New one?' } });
    fireEvent.click(within(modal()).getByRole('button', { name: 'Add Question' }));
    expect(await screen.findByPlaceholderText('Enter your password')).toBeInTheDocument();
    noErrorShown();
    await passReauth();
    await waitFor(() => expect(api.calls('POST', `${KEY}/questions`)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Question' })).toBeNull());

    fireEvent.click(within(qCard('Frame intact?')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByPlaceholderText('Enter your password')).toBeInTheDocument();
    noErrorShown();
    await passReauth();
    await waitFor(() => expect(api.calls('DELETE', `${KEY}/questions/q1`)).toHaveLength(2));
  });

  it('detail: cancelling the question-save prompt is silent and leaves the modal open', async () => {
    const api = openDetail([{ path: KEY, body: PROFILE }], ['CREATE_CHECKLIST_PROFILE']);
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Question' }));
    fireEvent.change(within(modal()).getByLabelText(/^Question/), { target: { value: 'New one?' } });
    fireEvent.click(within(modal()).getByRole('button', { name: 'Add Question' }));
    await cancelPrompt();
    noErrorShown();
    expect(within(modal()).getByRole('button', { name: 'Add Question' })).toBeEnabled();
  });
});

// ─── D-OPS-12 ───────────────────────────────────────────────────────────────
describe('D-OPS-12 — deleting a question asks first', () => {
  it('a declined confirmation deletes nothing; an accepted one deletes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const api = openDetail([{ method: 'DELETE', path: `${KEY}/questions/q2`, status: 204 }, { path: KEY, body: PROFILE }]);
    await screen.findByText('Water temperature');
    fireEvent.click(within(qCard('Water temperature')).getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalledWith('Delete question "Water temperature"? This cannot be undone.');
    expect(api.calls('DELETE', `${KEY}/questions/q2`)).toHaveLength(0);
    fireEvent.click(within(qCard('Water temperature')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.calls('DELETE', `${KEY}/questions/q2`)).toHaveLength(1));
  });

  it('with re-auth on, the confirmation comes first; declining never opens the password prompt', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const api = openDetail([{ path: KEY, body: PROFILE }], ['DELETE_CHECKLIST_PROFILE']);
    await reauthReady(api);
    await screen.findByText('Water temperature');
    fireEvent.click(within(qCard('Water temperature')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {});
    expect(screen.queryByPlaceholderText('Enter your password')).toBeNull();
    expect(api.calls('DELETE', /questions/)).toHaveLength(0);
  });
});

// ─── Page size ──────────────────────────────────────────────────────────────
describe('the checklist list starts on the CONFIGURED page size (usePageSize, 2026-10-22)', () => {
  it('Config → Pagination 10: the first page shows 10 cards, not the old hard-coded 25', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, name: `List ${String(i).padStart(2, '0')}`, isActive: true, questionCount: 1 }));
    const api = mockApi([{ path: LIST, body: { data: many } }, ...baseRoutes({ pagination: { limit: 10, options: [10, 25, 50] } })]);
    renderPage(<ChecklistProfileListPage />, { user: EDITOR, api, route: '/checklists' });
    await screen.findByRole('heading', { name: 'List 00' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'List 10' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'List 09' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Rows/ })).toHaveValue('10');
  });
});

// ─── 3d ─────────────────────────────────────────────────────────────────────
describe('3d — every control on the checklist pages has an accessible name', () => {
  it('list + create dialog', async () => {
    openList([{ path: LIST, body: { data: [{ id: 'cl1', name: 'Pre-wash checks', isActive: true, questionCount: 3 }, { id: 'cl2', name: 'Dryer checks', isActive: false, questionCount: 1 }] } }], [], SA);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    expect(screen.getByRole('button', { name: 'Activate Dryer checks' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search checklists')).toBeInTheDocument();
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Create Checklist' }));
    expect(unnamedControls()).toEqual([]);
  });

  it('detail, profile edit, question modal (options / numeric / calculated), error banner', async () => {
    openDetail([
      { method: 'PUT', path: `${KEY}/reorder`, status: 500, body: { error: 'X', message: 'reorder failed' } },
      { path: KEY, body: PROFILE },
    ], [], SA);
    await screen.findByText('Frame intact?');
    expect(screen.getByRole('button', { name: 'Back to checklists' })).toBeInTheDocument();
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Move question 2 down' }));
    await screen.findByText('reorder failed');
    expect(screen.getByRole('button', { name: 'Dismiss error' })).toBeInTheDocument();
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile metadata' }));
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(qCard('Damage type')).getByRole('button', { name: 'Edit' }));
    expect(within(modal()).getByRole('button', { name: 'Remove option None' })).toBeInTheDocument();
    expect(unnamedControls()).toEqual([]);
    fireEvent.change(within(modal()).getByLabelText('Type'), { target: { value: 'NUMERIC' } });
    expect(within(modal()).getByLabelText('Min')).toBeInTheDocument();
    expect(unnamedControls()).toEqual([]);
    fireEvent.change(within(modal()).getByLabelText('Type'), { target: { value: 'CALCULATED' } });
    expect(within(modal()).getByLabelText('Expression')).toBeInTheDocument();
    expect(unnamedControls()).toEqual([]);
  });
});
