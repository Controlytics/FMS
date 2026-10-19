import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * M66 — the Edit User page rendered "Loading user data..." for as long as
 * `/api/users/:id` had no data, so a failed fetch (deleted user, 403, server
 * down) left an endless spinner. 403/404 raise no toast (swr-config.ts), so the
 * operator had no signal at all and no way back.
 */

const userSwr: { data: any; error: any } = { data: undefined, error: undefined };
const reload = vi.fn();
vi.mock('swr', () => ({
  default: (key: string | null) => (key && key.startsWith('/api/users/')
    ? { ...userSwr, mutate: reload }
    : { data: undefined, error: undefined, mutate: vi.fn() }),
}));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: 'u-1' }),
  Link: ({ children }: any) => <a>{children}</a>,
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { role: 'SUPER_ADMIN', permissions: [] } }) }));
vi.mock('@/hooks/use-reauth', () => ({
  useReauth: () => ({ execute: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), setPassword: vi.fn(), isOpen: false, password: '', error: '', isVerifying: false }),
}));
vi.mock('@/components/reauth-dialog', () => ({ ReauthDialog: () => null }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }) }));
vi.mock('@/hooks/use-field-labels', () => ({ useFieldLabels: () => ({ userLabels: new Proxy({}, { get: () => 'Label' }) }) }));
vi.mock('@/hooks/use-datetime-format', () => ({ useDatetimeFormat: () => ({ formatDate: () => '', formatTime: () => '' }) }));
vi.mock('@/lib/api-client', () => ({ apiClient: {} }));

import { EditUserPage } from '../edit';

beforeEach(() => { vi.clearAllMocks(); userSwr.data = undefined; userSwr.error = undefined; });

describe('M66 — Edit User load failure', () => {
  it('shows an error card with Back to Users instead of an endless spinner', () => {
    userSwr.error = Object.assign(new Error('Internal error'), { status: 500 });
    render(<EditUserPage />);
    expect(screen.queryByText('Loading user data...')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this user');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Users' }));
    expect(navigate).toHaveBeenCalledWith('/users');
  });

  it('names a missing user and offers no pointless Retry', () => {
    userSwr.error = Object.assign(new Error('User not found'), { status: 404 });
    render(<EditUserPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('User not found');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to Users' })).toBeInTheDocument();
  });

  it('still shows the spinner while the first load is in flight', () => {
    render(<EditUserPage />);
    expect(screen.getByText('Loading user data...')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
