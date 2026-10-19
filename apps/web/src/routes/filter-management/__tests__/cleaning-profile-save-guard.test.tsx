import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * M87 — the cleaning-profile editor's Save guard did not hold. `save()` set
 * `saving` true, called `reauth.execute(...)` WITHOUT awaiting it, then set
 * `saving` false on the next line - and the callback's own `finally` cleared it
 * again after every attempt, including a wrong-password attempt that leaves the
 * dialog open. So Save re-enabled while the POST/PUT was in flight and while
 * the password dialog was up: a second click created a second profile or a
 * second version. Uses the REAL useReauth (only its my-actions SWR is mocked).
 */

const h = vi.hoisted(() => ({ actions: [] as string[] }));
const PROFILE = {
  id: 'p1', name: 'Std', flowMode: 'STRICT', alarmOnForwardSkip: true, alarmOnBackwardJump: true, alarmOnOutOfSequence: true,
  stages: [
    { id: 's0', stateKey: null, nodeType: 'START', configuration: {}, positionX: 0, positionY: 0, sortOrder: 0 },
    { id: 's1', stateKey: 'WASH_IN', nodeType: 'STAGE', configuration: {}, positionX: 100, positionY: 0, sortOrder: 1 },
    { id: 's2', stateKey: null, nodeType: 'END', configuration: {}, positionX: 200, positionY: 0, sortOrder: 2 },
  ],
  connections: [{ id: 'c1', fromStageId: 's0', toStageId: 's1' }, { id: 'c2', fromStageId: 's1', toStageId: 's2' }],
};
const CHECKLISTS = { data: [] };
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key === '/api/config/action-reauth/my-actions') return { data: { actions: h.actions } };
    if (key === '/api/filter-cleaning-profiles/p1') return { data: PROFILE };
    if (key?.startsWith('/api/checklist-profiles')) return { data: CHECKLISTS };
    return { data: undefined };
  },
  mutate: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'p1' }), useNavigate: () => vi.fn() }));
const put = vi.fn();
const putWithReauth = vi.fn();
vi.mock('../../../lib/api-client', () => ({ apiClient: { put: (...a: any[]) => put(...a), putWithReauth: (...a: any[]) => putWithReauth(...a) } }));

import { CleaningProfileEditorPage } from '../cleaning-profile-editor';

const saveBtn = () => screen.getByRole('button', { name: /^(Save|Saving\.\.\.)$/ });

beforeEach(() => { vi.clearAllMocks(); h.actions = []; });

describe('M87 — cleaning-profile Save guard', () => {
  it('stays disabled while the PUT is in flight, so a second click cannot save twice', async () => {
    let resolvePut: (v: unknown) => void = () => {};
    put.mockImplementation(() => new Promise((r) => { resolvePut = r; }));
    render(<CleaningProfileEditorPage />);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(saveBtn()).toBeDisabled();
    fireEvent.click(saveBtn());
    expect(put).toHaveBeenCalledTimes(1);
    await act(async () => { resolvePut({ id: 'p1' }); });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    expect(screen.getByText('Cleaning profile saved successfully')).toBeInTheDocument();
  });

  it('stays disabled while the password dialog is open, including after a wrong password', async () => {
    h.actions = ['UPDATE_CLEANING_PROFILE'];
    putWithReauth.mockRejectedValueOnce({ error: 'REAUTH_FAILED', message: 'Incorrect password. Please try again.' });
    render(<CleaningProfileEditorPage />);
    await act(async () => { fireEvent.click(saveBtn()); });
    const pw = await screen.findByPlaceholderText('Enter your password');
    expect(saveBtn()).toBeDisabled();

    fireEvent.change(pw, { target: { value: 'wrong' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' })); });
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    // A wrong password is the dialog's message, not a "save failed" toast.
    expect(screen.queryByText(/Failed to save profile/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
  });

  it('a server refusal re-enables Save and shows the error', async () => {
    put.mockRejectedValueOnce(Object.assign(new Error('Profile name already exists'), { status: 409 }));
    render(<CleaningProfileEditorPage />);
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    expect(screen.getByText('Profile name already exists')).toBeInTheDocument();
  });
});
