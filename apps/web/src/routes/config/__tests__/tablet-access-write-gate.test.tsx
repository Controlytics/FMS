import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * C-02 — /config/tablet-access admits CONFIG_READ (main.tsx), but the PUT needs
 * CONFIG_UPDATE + the UPDATE_TABLET_ACCESS signature. The page never computed a
 * write permission, so a read-only role got live toggles and a Save button that
 * asked for a password and then answered 403.
 */

const auth = vi.hoisted(() => ({ user: { role: 'ADMIN', permissions: ['CONFIG_READ'] as string[] } }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));
const CONFIG = { OPERATOR: ['login', 'filter_cleaning'] };
const ROLES = [{ name: 'OPERATOR', displayName: 'Operator' }];
vi.mock('swr', () => ({
  default: (key: string) => (key === '/api/config/tablet-access' ? { data: CONFIG, isLoading: false }
    : key === '/api/roles/active' ? { data: ROLES } : { data: undefined }),
  mutate: vi.fn(),
}));
const execute = vi.fn();
vi.mock('@/hooks/use-reauth', () => ({
  useReauth: () => ({ execute, cancel: vi.fn(), confirm: vi.fn(), setPassword: vi.fn(), isOpen: false, password: '', error: '', isVerifying: false }),
}));
vi.mock('@/components/reauth-dialog', () => ({ ReauthDialog: () => null }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }) }));
vi.mock('../../../lib/api-client', () => ({ apiClient: {} }));

import { TabletAccessConfigPage } from '../tablet-access';

beforeEach(() => { vi.clearAllMocks(); });

describe('C-02 — Tablet Access write gate', () => {
  it('CONFIG_READ only: every toggle and Save are disabled, with a read-only note', () => {
    auth.user = { role: 'ADMIN', permissions: ['CONFIG_READ'] };
    render(<TabletAccessConfigPage />);
    expect(screen.getByRole('note')).toHaveTextContent(/Read-only/);
    const login = screen.getByRole('button', { name: 'Login for Operator' });
    expect(login).toBeDisabled();
    expect(screen.getByRole('button', { name: 'All features for Operator' })).toBeDisabled();
    fireEvent.click(login);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('CONFIG_UPDATE: toggles work and Save goes through the signed path', () => {
    auth.user = { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] };
    render(<TabletAccessConfigPage />);
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filter Status for Operator' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(execute).toHaveBeenCalledWith('UPDATE_TABLET_ACCESS', expect.any(Function), expect.any(Object));
  });

  it('SUPER_ADMIN can write without holding CONFIG_UPDATE explicitly', () => {
    auth.user = { role: 'SUPER_ADMIN', permissions: [] };
    render(<TabletAccessConfigPage />);
    expect(screen.getByRole('button', { name: 'Login for Operator' })).not.toBeDisabled();
  });
});
