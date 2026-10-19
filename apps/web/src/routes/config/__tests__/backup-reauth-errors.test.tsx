import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * M74 — Backup & Restore used raw fetch and threw away the server's structured
 * error code, so the REAL re-auth hook (used unmocked here) could not branch:
 *   - Export threw `new Error(detail)`: a wrong password (REAUTH_FAILED) closed
 *     the dialog with an error banner instead of re-prompting "Incorrect password".
 *   - Restore never threw on `!response.ok`: the hook counted a refused restore
 *     as SUCCESS, so a wrong password showed "Restore Failed" and no retry.
 * Also the busy flags were reset synchronously after `reauth.execute`, which
 * returns as soon as the dialog opens - so the buttons re-enabled mid-prompt.
 */

vi.mock('swr', () => ({
  default: (key: string) => (key === '/api/config/action-reauth/my-actions'
    ? { data: { actions: ['EXPORT_BACKUP', 'RESTORE_BACKUP'] } }
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

async function enterPassword(pw: string) {
  const input = await screen.findByPlaceholderText('Enter your password');
  fireEvent.change(input, { target: { value: pw } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' })); });
}

describe('M74 — backup export', () => {
  it('a wrong password keeps the dialog open with "Incorrect password", then the retry succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: 'REAUTH_FAILED', message: 'Incorrect password. Please try again.' }))
      .mockResolvedValueOnce(json(200, {}));
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    render(<BackupPage />);
    const exportBtn = screen.getByRole('button', { name: /Download .* Backup/ });
    fireEvent.click(exportBtn);
    await enterPassword('wrong');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
    // Still busy while the prompt is open.
    expect(screen.getByRole('button', { name: /Generating Backup/ })).toBeDisabled();

    await enterPassword('right');
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /Download .* Backup/ })).not.toBeDisabled();
  });

  it('the export button stays busy while the password dialog is open and frees on cancel', async () => {
    render(<BackupPage />);
    fireEvent.click(screen.getByRole('button', { name: /Download .* Backup/ }));
    await screen.findByPlaceholderText('Enter your password');
    expect(screen.getByRole('button', { name: /Generating Backup/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Download .* Backup/ })).not.toBeDisabled());
  });
});

describe('M74 — backup restore', () => {
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

  it('a wrong password re-prompts instead of reporting "Restore Failed"', async () => {
    await openRestore();
    fetchMock.mockResolvedValueOnce(json(401, { error: 'REAUTH_FAILED', message: 'Incorrect password. Please try again.' }));
    await enterPassword('wrong');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('Restore Failed')).toBeNull();
    expect(screen.queryByText('Restore Successful')).toBeNull();
  });

  it('a refused restore is reported as failed with the server message', async () => {
    await openRestore();
    fetchMock.mockResolvedValueOnce(json(500, { error: 'RESTORE_FAILED', message: 'pg_restore exited with code 1' }));
    await enterPassword('right');
    expect(await screen.findByText('Restore Failed')).toBeInTheDocument();
    expect(screen.getByText('pg_restore exited with code 1')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter your password')).toBeNull();
  });

  it('a successful restore is reported as successful', async () => {
    await openRestore();
    fetchMock.mockResolvedValueOnce(json(200, { success: true, message: 'Restored 10 records' }));
    await enterPassword('right');
    expect(await screen.findByText('Restore Successful')).toBeInTheDocument();
  });
});
