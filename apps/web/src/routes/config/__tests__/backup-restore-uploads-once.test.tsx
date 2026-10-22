import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * OD-01 (2026-10-22): RESTORE_BACKUP is signed always, for every role, and is
 * never in /my-actions. The page used to send the restore once unsigned, take
 * the 401 REAUTH_REQUIRED and send it again — uploading the whole backup file
 * twice. useReauth now asks UP FRONT for an always-on action, so the file goes
 * up exactly once, signed, and a cancelled prompt uploads nothing.
 */
vi.mock('swr', () => ({
  default: (key: string) => (key === '/api/config/action-reauth/my-actions'
    ? { data: { actions: [] } } // the policy lists nothing for this role
    : { data: undefined }),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { role: 'SUPER_ADMIN', permissions: [] } }) }));
vi.mock('@/hooks/use-datetime-format', () => ({ useDatetimeFormat: () => ({ formatDateTime: () => 'dt' }) }));
vi.mock('@/hooks/use-backup-format', () => ({ useBackupFormat: () => ({ defaultFormat: 'json', isLoading: false }) }));
vi.mock('@/lib/url-utils', () => ({ apiUrl: (p: string) => p }));

import { BackupRestorePage as BackupPage } from '../backup';

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
  headers: { get: () => null }, blob: async () => new Blob(['x']),
});
const VALIDATION = {
  valid: true, checksumValid: true, checksumSupported: true, totalRecords: 10, tableSummary: { users: 1 },
  metadata: { version: '1', timestamp: '2026-10-01T00:00:00Z', generatedBy: 'superadmin', tableCount: 1, checksum: 'x' },
  auditChain: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.setItem('access_token', 't');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

const restoreCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/backup/restore'));

async function openRestore() {
  fetchMock.mockResolvedValueOnce(json(200, VALIDATION)); // /api/backup/validate
  const { container } = render(<BackupPage />);
  const file = new File(['{}'], 'b.json', { type: 'application/json' });
  await act(async () => {
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  });
  fireEvent.click(await screen.findByRole('button', { name: /Restore Database from This Backup/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore Database' }));
}

describe('OD-01 — the restore asks for the password first and uploads once', () => {
  it('the prompt opens before anything is uploaded; signed, the file goes up exactly once with the password', async () => {
    await openRestore();
    const input = await screen.findByPlaceholderText('Enter your password');
    expect(restoreCalls()).toHaveLength(0);
    fetchMock.mockResolvedValueOnce(json(200, { success: true, message: 'Restored 10 records' }));
    fireEvent.change(input, { target: { value: 'pw-restore' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' })); });
    expect(await screen.findByText('Restore Successful')).toBeInTheDocument();
    expect(restoreCalls()).toHaveLength(1);
    expect((restoreCalls()[0][1] as RequestInit).headers).toMatchObject({ 'x-reauth-password': 'pw-restore' });
  });

  it('a cancelled prompt uploads nothing and reports nothing', async () => {
    await openRestore();
    await screen.findByPlaceholderText('Enter your password');
    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    await act(async () => { fireEvent.click(cancels[cancels.length - 1]); });
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(restoreCalls()).toHaveLength(0);
    expect(screen.queryByText('Restore Failed')).toBeNull();
  });
});
