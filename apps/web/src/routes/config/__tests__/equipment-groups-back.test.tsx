import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * OQ-14 — Equipment Groups is a SIDEBAR item (gate EG_VIEW / ASSET_READ), but its
 * back arrow always navigated to /config, which needs CONFIG_READ. A Supervisor
 * or Operator who opened it from the sidebar was sent to "Access denied".
 */

const auth = vi.hoisted(() => ({ user: { role: 'OPERATOR', permissions: ['EG_VIEW'] as string[] } }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('swr', () => ({ default: () => ({ data: undefined, isLoading: false, mutate: vi.fn() }), mutate: vi.fn() }));
vi.mock('@/hooks/use-can', () => ({ useCan: () => () => false }));
vi.mock('@/hooks/use-reauth', () => ({
  useReauth: () => ({ execute: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), setPassword: vi.fn(), isOpen: false, password: '', error: '', isVerifying: false }),
}));
vi.mock('@/components/reauth-dialog', () => ({ ReauthDialog: () => null }));
vi.mock('@/components/ui/pagination', () => ({ Pagination: () => null }));
vi.mock('../../../lib/api-client', () => ({ apiClient: {}, api: {} }));

import { EquipmentGroupsConfigPage } from '../equipment-groups';

const back = () => screen.getByRole('button', { name: /^Back/ });

beforeEach(() => { vi.clearAllMocks(); window.history.replaceState({ idx: 0 }, ''); });

describe('OQ-14 — Equipment Groups back arrow', () => {
  it('a role without CONFIG_READ goes back in history, not to /config', () => {
    auth.user = { role: 'OPERATOR', permissions: ['EG_VIEW'] };
    window.history.replaceState({ idx: 3 }, '');
    render(<EquipmentGroupsConfigPage />);
    fireEvent.click(back());
    expect(navigate).toHaveBeenCalledWith(-1);
    expect(navigate).not.toHaveBeenCalledWith('/config');
  });

  it('with no in-app history to return to, falls back to the dashboard', () => {
    auth.user = { role: 'OPERATOR', permissions: ['EG_VIEW'] };
    render(<EquipmentGroupsConfigPage />);
    fireEvent.click(back());
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('CONFIG_READ holders and SUPER_ADMIN still return to /config', () => {
    auth.user = { role: 'ADMIN', permissions: ['EG_VIEW', 'CONFIG_READ'] };
    const { unmount } = render(<EquipmentGroupsConfigPage />);
    fireEvent.click(back());
    expect(navigate).toHaveBeenLastCalledWith('/config');
    unmount();
    auth.user = { role: 'SUPER_ADMIN', permissions: [] };
    render(<EquipmentGroupsConfigPage />);
    fireEvent.click(back());
    expect(navigate).toHaveBeenLastCalledWith('/config');
  });
});
