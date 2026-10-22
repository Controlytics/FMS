/**
 * Checklist Profile detail (/checklists/:id) through the page harness.
 * Coverage campaign 2026-10-21.
 *
 * Rules exercised:
 *  - Edit / Add / reorder need CHECKLIST_EDIT, question delete CHECKLIST_DELETE,
 *    the Version History link VERSION_HISTORY_VIEW (Super Admin bypasses all);
 *  - each question write goes through re-auth (the same CREATE / UPDATE /
 *    DELETE_CHECKLIST_PROFILE rows the server enforces);
 *  - options exist only for Dropdown / Multi Select (switching away clears
 *    them); Min / Max / Unit only for Numeric; Expression only for Calculated.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { mockApi, renderPage, clearGlobalSwrCache, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { LocationProbe } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { ChecklistProfileDetailPage } from '../detail';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

const KEY = '/api/checklist-profiles/cl1';
const Q = [
  { id: 'q1', question: 'Is the filter frame intact?', questionType: 'YES_NO', required: true, section: 'Pre-checks', description: 'Look at all four corners', options: null, validation: null },
  { id: 'q2', question: 'Water temperature', questionType: 'NUMERIC', required: false, section: '', description: null, options: [], validation: { min: 20, max: 40, unit: 'degC' } },
  { id: 'q3', question: 'Damage type', questionType: 'DROPDOWN', required: true, section: 'Pre-checks', options: ['None', 'Torn'], validation: {} },
  { id: 'q4', question: 'Legacy question', questionType: 'WEIRD_TYPE', required: false, section: null },
];
const PROFILE = { id: 'cl1', name: 'Pre-wash checks', description: 'Before Wash In', isActive: true, questions: Q };
const EDITOR = role('QA', ['CHECKLIST_READ', 'CHECKLIST_EDIT', 'CHECKLIST_DELETE', 'VERSION_HISTORY_VIEW']);
const READER = role('OPERATOR', ['CHECKLIST_READ']);

function open(user: any = EDITOR, profile: any = PROFILE, extra: MockRoute[] = [], reauthActions: string[] = [], globalCache = false) {
  const api = mockApi([...extra, { path: KEY, body: profile }, ...baseRoutes({ reauthActions })]);
  // The page sits on its real pattern inside a catch-all, so the location probe
  // survives a navigation away from it.
  renderPage(<><Routes><Route path="/checklists/:id" element={<ChecklistProfileDetailPage />} /></Routes><LocationProbe /></>,
    { user, api, route: '/checklists/cl1', globalCache });
  return api;
}
const qCard = (text: string) => screen.getByText(text).closest('.group') as HTMLElement;
const modal = () => screen.getByRole('heading', { name: /^(Add|Edit) Question$/ }).closest('.max-w-lg') as HTMLElement;
const reauthReady = (api: ReturnType<typeof mockApi>) =>
  waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
/** The reorder arrows of a question card, by their accessible names (3d). */
const upOf = (text: string) => within(qCard(text)).getByRole('button', { name: /^Move question \d+ up$/ }) as HTMLButtonElement;
const downOf = (text: string) => within(qCard(text)).getByRole('button', { name: /^Move question \d+ down$/ }) as HTMLButtonElement;

describe('Checklist detail — what is shown', () => {
  it('header, stats and every question with its type, required flag, section, options and help text', async () => {
    const api = open(READER);
    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(await screen.findByRole('heading', { name: 'Pre-wash checks' })).toBeInTheDocument();
    expect(screen.getByText('Before Wash In')).toBeInTheDocument();
    expect(screen.getByText('Questions', { selector: 'div' }).previousSibling).toHaveTextContent('4');
    expect(screen.getByText('Required', { selector: 'div.text-xs' }).previousSibling).toHaveTextContent('2');
    // Sections: "Pre-checks" + "General" for the ones without.
    expect(screen.getByText('Sections').previousSibling).toHaveTextContent('2');
    const q1 = qCard('Is the filter frame intact?');
    expect(q1).toHaveTextContent('Yes / No');
    expect(q1).toHaveTextContent('Required');
    expect(q1).toHaveTextContent('Pre-checks');
    expect(q1).toHaveTextContent('Look at all four corners');
    expect(qCard('Water temperature')).toHaveTextContent('Numeric');
    expect(qCard('Damage type')).toHaveTextContent('2 options');
    // An unknown type shows its raw value rather than nothing.
    expect(qCard('Legacy question')).toHaveTextContent('WEIRD_TYPE');
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    // A reader gets no edit affordances and no Version History link.
    expect(screen.queryByRole('button', { name: 'Edit profile metadata' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add Question/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Version History/ })).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('back goes to the list; Version History deep-links to this checklist', async () => {
    open(EDITOR);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(screen.getByRole('button', { name: /Version History/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/version-history?entity=checklist-profile&id=cl1');
  });

  it('the back arrow returns to /checklists', async () => {
    open(READER);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to checklists' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/checklists$/);
  });

  it('an inactive checklist with no questions invites adding the first one', async () => {
    open(EDITOR, { id: 'cl1', name: 'Empty one', isActive: false, questions: [] });
    expect(await screen.findByText('No questions yet')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add First Question' }));
    expect(screen.getByRole('heading', { name: 'Add Question' })).toBeInTheDocument();
  });

  it('a failed load is an error in the page (with Retry) as well as a Load Error toast', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(READER, PROFILE, [{ path: KEY, status: 500, body: { error: 'X', message: 'detail exploded' } }]);
    expect(await screen.findByRole('alert')).toHaveTextContent('detail exploded');
    expect(screen.queryByText('No questions yet')).toBeNull(); // D-OPS-6
  });
});

describe('Checklist detail — edit the profile', () => {
  it('pencil opens name / description / active; Save PUTs them trimmed (blank description = null)', async () => {
    await clearGlobalSwrCache();
    const api = open(EDITOR, PROFILE, [{ method: 'PUT', path: KEY, body: { ok: true } }], [], true);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile metadata' }));
    const name = screen.getByPlaceholderText('Profile name');
    expect(name).toHaveValue('Pre-wash checks');
    expect(screen.getByPlaceholderText('Description (optional)')).toHaveValue('Before Wash In');
    const active = screen.getByRole('checkbox', { name: /Active \(available for use in cleaning profiles\)/ });
    expect(active).toBeChecked();
    fireEvent.change(name, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(name, { target: { value: '  Pre-wash v2 ' } });
    fireEvent.change(screen.getByPlaceholderText('Description (optional)'), { target: { value: '   ' } });
    fireEvent.click(active);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Profile name')).toBeNull());
    expect(api.calls('PUT', KEY)[0].json).toEqual({ name: 'Pre-wash v2', description: null, isActive: false });
    await waitFor(() => expect(api.calls('GET', KEY).length).toBeGreaterThan(1));
  });

  it('a refused save shows the reason in a dismissible banner; Cancel leaves edit mode', async () => {
    open(EDITOR, PROFILE, [{ method: 'PUT', path: KEY, status: 409, body: { error: 'CHECKLIST_IN_USE', message: 'In use by DRY STORAGE' } }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile metadata' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('In use by DRY STORAGE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByText('In use by DRY STORAGE')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Pre-wash checks' })).toBeInTheDocument();
  });

  it('a profile with no description / inactive opens with those values; the save is signed when the row is on', async () => {
    const api = open(SA, { ...PROFILE, description: null, isActive: false }, [{ method: 'PUT', path: KEY, body: { ok: true } }], ['UPDATE_CHECKLIST_PROFILE']);
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile metadata' }));
    expect(screen.getByPlaceholderText('Description (optional)')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: /Active/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await passReauth();
    await waitFor(() => expect(api.calls('PUT', KEY)).toHaveLength(1));
    expectSigned(api.calls('PUT', KEY)[0]);
  });
});

describe('Checklist detail — questions', () => {
  it('adds a Dropdown question with options (Enter or Add; × removes); the POST carries the whole form', async () => {
    await clearGlobalSwrCache();
    const api = open(EDITOR, PROFILE, [{ method: 'POST', path: `${KEY}/questions`, status: 201, body: { id: 'q9' } }], [], true);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Question' }));
    const m = modal();
    const save = within(m).getByRole('button', { name: 'Add Question' });
    expect(save).toBeDisabled();
    const text = within(m).getByPlaceholderText('Enter your question...');
    fireEvent.focus(text); fireEvent.blur(text);
    fireEvent.change(text, { target: { value: 'Which gasket?' } });
    const type = within(m).getByRole('combobox');
    fireEvent.focus(type); fireEvent.blur(type);
    fireEvent.change(type, { target: { value: 'DROPDOWN' } });
    const sec = within(m).getByPlaceholderText('e.g. Pre-checks');
    fireEvent.focus(sec); fireEvent.blur(sec);
    fireEvent.change(sec, { target: { value: 'Seals' } });
    const help = within(m).getByPlaceholderText('Additional guidance for this question');
    fireEvent.focus(help); fireEvent.blur(help);
    fireEvent.change(help, { target: { value: 'Pick one' } });
    fireEvent.click(within(m).getByRole('checkbox', { name: 'Required question' }));
    const opt = within(m).getByPlaceholderText('Add option...');
    fireEvent.click(within(m).getByRole('button', { name: 'Add' })); // empty: ignored
    fireEvent.change(opt, { target: { value: 'Silicone' } });
    fireEvent.keyDown(opt, { key: 'Enter' });
    fireEvent.change(opt, { target: { value: ' EPDM ' } });
    fireEvent.click(within(m).getByRole('button', { name: 'Add' }));
    fireEvent.change(opt, { target: { value: 'Viton' } });
    fireEvent.keyDown(opt, { key: 'Tab' }); // not Enter: nothing added
    fireEvent.click(within(m).getByRole('button', { name: 'Add' }));
    expect(within(m).getByText('Silicone')).toBeInTheDocument();
    fireEvent.click(within(m).getByRole('button', { name: 'Remove option Viton' }));
    expect(within(m).queryByText('Viton')).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Question' })).toBeNull());
    expect(api.calls('POST', `${KEY}/questions`)[0].json).toEqual({
      question: 'Which gasket?', questionType: 'DROPDOWN', required: true, section: 'Seals', description: 'Pick one',
      options: ['Silicone', 'EPDM'], validation: {},
    });
    await waitFor(() => expect(api.calls('GET', KEY).length).toBeGreaterThan(1));
  });

  it('Numeric shows Min / Max / Unit, Calculated shows Expression; leaving an options type clears the options', async () => {
    const api = open(EDITOR, PROFILE, [{ method: 'POST', path: `${KEY}/questions`, status: 201, body: { id: 'q9' } }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Question' }));
    const m = modal();
    fireEvent.change(within(m).getByPlaceholderText('Enter your question...'), { target: { value: 'Air pressure' } });
    const type = within(m).getByRole('combobox');
    fireEvent.change(type, { target: { value: 'MULTI_SELECT' } });
    fireEvent.change(within(m).getByPlaceholderText('Add option...'), { target: { value: 'A' } });
    fireEvent.click(within(m).getByRole('button', { name: 'Add' }));
    fireEvent.change(type, { target: { value: 'NUMERIC' } });
    expect(within(m).queryByPlaceholderText('Add option...')).toBeNull();
    const [min, max] = Array.from(m.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    fireEvent.change(min, { target: { value: '2' } });
    fireEvent.change(max, { target: { value: '8' } });
    fireEvent.change(max, { target: { value: '' } });
    fireEvent.change(min, { target: { value: '' } });
    fireEvent.change(min, { target: { value: '1' } });
    fireEvent.change(max, { target: { value: '6' } });
    fireEvent.change(within(m).getByPlaceholderText('e.g. degC'), { target: { value: 'bar' } });
    expect(within(m).queryByPlaceholderText('e.g. q_1 + q_2')).toBeNull();
    fireEvent.click(within(m).getByRole('button', { name: 'Add Question' }));
    await waitFor(() => expect(api.calls('POST', `${KEY}/questions`)).toHaveLength(1));
    expect(api.calls('POST', `${KEY}/questions`)[0].json).toMatchObject({ questionType: 'NUMERIC', options: [], validation: { min: 1, max: 6, unit: 'bar' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Add Question' }));
    const m2 = modal();
    fireEvent.change(within(m2).getByPlaceholderText('Enter your question...'), { target: { value: 'Delta' } });
    fireEvent.change(within(m2).getByRole('combobox'), { target: { value: 'CALCULATED' } });
    fireEvent.change(within(m2).getByPlaceholderText('e.g. q_1 + q_2'), { target: { value: 'q_1 - q_2' } });
    fireEvent.click(within(m2).getByRole('button', { name: 'Add Question' }));
    await waitFor(() => expect(api.calls('POST', `${KEY}/questions`)).toHaveLength(2));
    expect(api.calls('POST', `${KEY}/questions`)[1].json).toMatchObject({ questionType: 'CALCULATED', validation: { expression: 'q_1 - q_2' } });
  });

  it('Edit opens the question prefilled and PUTs the update; a refused save stays open with the reason', async () => {
    const api = open(EDITOR, PROFILE, [
      { method: 'PUT', path: `${KEY}/questions/q2`, status: 400, times: 1, body: { error: 'BAD', message: 'Min must be below Max' } },
      { method: 'PUT', path: `${KEY}/questions/q2`, body: { ok: true } },
    ]);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(within(qCard('Water temperature')).getByRole('button', { name: 'Edit' }));
    const m = modal();
    expect(within(m).getByRole('heading', { name: 'Edit Question' })).toBeInTheDocument();
    expect(within(m).getByPlaceholderText('Enter your question...')).toHaveValue('Water temperature');
    expect(within(m).getByPlaceholderText('e.g. degC')).toHaveValue('degC');
    const [min] = Array.from(m.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    expect(min).toHaveValue(20);
    fireEvent.change(min, { target: { value: '25' } });
    fireEvent.click(within(m).getByRole('button', { name: 'Update Question' }));
    expect(await screen.findByText('Min must be below Max')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit Question' })).toBeInTheDocument();
    fireEvent.click(within(modal()).getByRole('button', { name: 'Update Question' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Question' })).toBeNull());
    expect(api.calls('PUT', `${KEY}/questions/q2`)[1].json).toMatchObject({ question: 'Water temperature', questionType: 'NUMERIC', validation: { min: 25, max: 40, unit: 'degC' } });
    // The banner from the refusal is cleared by the successful save.
    expect(screen.queryByText('Min must be below Max')).toBeNull();
  });

  it('a question with no options / validation / section opens with empty fields', async () => {
    open(EDITOR);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(within(qCard('Legacy question')).getByRole('button', { name: 'Edit' }));
    const m = modal();
    expect(within(m).getByPlaceholderText('e.g. Pre-checks')).toHaveValue('');
    expect(within(m).getByPlaceholderText('Additional guidance for this question')).toHaveValue('');
    // Cancel and the backdrop both close the modal.
    fireEvent.click(within(m).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Edit Question' })).toBeNull();
    fireEvent.click(within(qCard('Damage type')).getByRole('button', { name: 'Edit' }));
    expect(within(modal()).getByText('None')).toBeInTheDocument(); // options carried in
    fireEvent.click(within(modal()).getByRole('heading', { name: 'Edit Question' }));
    expect(screen.getByRole('heading', { name: 'Edit Question' })).toBeInTheDocument();
    fireEvent.click(modal().parentElement as HTMLElement);
    expect(screen.queryByRole('heading', { name: 'Edit Question' })).toBeNull();
  });

  it('with re-auth off, Delete asks first, then removes the question unsigned and the checklist re-reads', async () => {
    await clearGlobalSwrCache();
    const api = open(EDITOR, PROFILE, [{ method: 'DELETE', path: `${KEY}/questions/q2`, status: 204 }], [], true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(within(qCard('Water temperature')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.calls('DELETE', `${KEY}/questions/q2`)).toHaveLength(1));
    expect(api.calls('DELETE', `${KEY}/questions/q2`)[0].headers['x-reauth-password']).toBeUndefined();
    expect(confirm).toHaveBeenCalledWith('Delete question "Water temperature"? This cannot be undone.');
    expect(screen.queryByPlaceholderText('Enter your password')).toBeNull();
    await waitFor(() => expect(api.calls('GET', KEY).length).toBeGreaterThan(1));
  });

  it('Delete (once confirmed) removes a question; a refused delete is shown; with the row on it is signed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = open(EDITOR, PROFILE, [
      { method: 'DELETE', path: `${KEY}/questions/q4`, status: 409, times: 1, body: { error: 'IN_USE', message: 'Answered in 12 cycles' } },
      { method: 'DELETE', path: `${KEY}/questions/q4`, status: 204 },
    ], ['DELETE_CHECKLIST_PROFILE']);
    await reauthReady(api);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    fireEvent.click(within(qCard('Legacy question')).getByRole('button', { name: 'Delete' }));
    await passReauth();
    expect(await screen.findByText('Answered in 12 cycles')).toBeInTheDocument();
    fireEvent.click(within(qCard('Legacy question')).getByRole('button', { name: 'Delete' }));
    await passReauth();
    await waitFor(() => expect(api.calls('DELETE', `${KEY}/questions/q4`)).toHaveLength(2));
    expectSigned(api.calls('DELETE', `${KEY}/questions/q4`)[1]);
    await waitFor(() => expect(screen.queryByText('Answered in 12 cycles')).toBeNull());
  });

  it('a question add / edit with the row on is signed', async () => {
    const api = open(EDITOR, PROFILE, [{ method: 'POST', path: `${KEY}/questions`, status: 201, body: { id: 'q9' } }, { method: 'PUT', path: `${KEY}/questions/q1`, body: { ok: true } }],
      ['CREATE_CHECKLIST_PROFILE', 'UPDATE_CHECKLIST_PROFILE']);
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Question' }));
    fireEvent.change(within(modal()).getByPlaceholderText('Enter your question...'), { target: { value: 'Signed?' } });
    fireEvent.click(within(modal()).getByRole('button', { name: 'Add Question' }));
    await passReauth();
    await waitFor(() => expect(api.calls('POST', `${KEY}/questions`)).toHaveLength(1));
    expectSigned(api.calls('POST', `${KEY}/questions`)[0]);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Question' })).toBeNull());
    fireEvent.click(within(qCard('Is the filter frame intact?')).getByRole('button', { name: 'Edit' }));
    fireEvent.click(within(modal()).getByRole('button', { name: 'Update Question' }));
    await passReauth();
    await waitFor(() => expect(api.calls('PUT', `${KEY}/questions/q1`)).toHaveLength(1));
    expectSigned(api.calls('PUT', `${KEY}/questions/q1`)[0]);
  });
});

describe('Checklist detail — refusals without a message', () => {
  it('question save / delete / profile save each fall back to a plain explanation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    open(EDITOR, { id: 'cl1', questions: [Q[0]] }, [
      { method: 'POST', path: `${KEY}/questions`, status: 400, body: { message: '' } },
      { method: 'DELETE', path: `${KEY}/questions/q1`, status: 409, body: { message: '' } },
      { method: 'PUT', path: KEY, status: 400, body: {} },
    ]);
    // A profile with no name / active flag: the title falls back, the edit form defaults to active.
    expect(await screen.findByRole('heading', { name: 'Checklist' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile metadata' }));
    expect(screen.getByPlaceholderText('Profile name')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: /Active/ })).toBeChecked();
    fireEvent.change(screen.getByPlaceholderText('Profile name'), { target: { value: 'Named' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Request failed: 400')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Question' }));
    fireEvent.change(within(modal()).getByPlaceholderText('Enter your question...'), { target: { value: 'Q' } });
    fireEvent.click(within(modal()).getByRole('button', { name: 'Add Question' }));
    expect(await screen.findByText('Failed to save question')).toBeInTheDocument();
    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(qCard('Is the filter frame intact?')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Failed to delete question')).toBeInTheDocument();
  });
});

describe('Checklist detail — reorder', () => {
  it('the arrows swap neighbours and PUT the new order; the ends are disabled; a refusal is shown', async () => {
    const api = open(EDITOR, PROFILE, [
      { method: 'PUT', path: `${KEY}/reorder`, body: { ok: true }, times: 2 },
      { method: 'PUT', path: `${KEY}/reorder`, status: 500, body: { message: '' } },
    ]);
    await screen.findByRole('heading', { name: 'Pre-wash checks' });
    expect(upOf('Is the filter frame intact?')).toBeDisabled();
    expect(downOf('Legacy question')).toBeDisabled();
    fireEvent.click(downOf('Is the filter frame intact?'));
    await waitFor(() => expect(api.calls('PUT', `${KEY}/reorder`)).toHaveLength(1));
    expect(api.calls('PUT', `${KEY}/reorder`)[0].json).toEqual({ questionIds: ['q2', 'q1', 'q3', 'q4'] });
    fireEvent.click(upOf('Legacy question'));
    await waitFor(() => expect(api.calls('PUT', `${KEY}/reorder`)).toHaveLength(2));
    expect(api.calls('PUT', `${KEY}/reorder`)[1].json).toEqual({ questionIds: ['q1', 'q2', 'q4', 'q3'] });
    fireEvent.click(downOf('Water temperature'));
    // A refusal with an empty message falls back to a generic one.
    expect(await screen.findByText('Failed to reorder')).toBeInTheDocument();
  });
});
