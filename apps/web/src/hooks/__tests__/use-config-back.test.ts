/**
 * OQ-14 follow-up (QA 2026-10-19): the back arrow on config sub-pages that
 * roles without CONFIG_READ can open must not send them to /config (Access
 * denied). Used by AHU Filter Set Config (PM_READ / ASSET_VIEW) and Roles &
 * Access (ROLE_MANAGE); Equipment Groups has the same rule inline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let auth: any = { user: null };
const navigate = vi.fn();
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import { useConfigBack } from '../use-config-back';

describe('useConfigBack', () => {
  beforeEach(() => { navigate.mockClear(); window.history.replaceState({ idx: 0 }, ''); });

  it('CONFIG_READ holders go to /config', () => {
    auth = { user: { role: 'ADMIN', permissions: ['CONFIG_READ'] } };
    useConfigBack()();
    expect(navigate).toHaveBeenCalledWith('/config');
  });

  it('SUPER_ADMIN goes to /config', () => {
    auth = { user: { role: 'SUPER_ADMIN', permissions: [] } };
    useConfigBack()();
    expect(navigate).toHaveBeenCalledWith('/config');
  });

  it('others go back in history, or to the dashboard on a fresh tab', () => {
    auth = { user: { role: 'SUPERVISOR', permissions: ['PM_READ'] } };
    useConfigBack()();
    expect(navigate).toHaveBeenCalledWith('/');
    window.history.replaceState({ idx: 3 }, '');
    useConfigBack()();
    expect(navigate).toHaveBeenLastCalledWith(-1);
  });

  it('AHU Filter Set Config and Roles & Access use it instead of a fixed /config', () => {
    for (const f of ['ahu-filter-set-config.tsx', 'role-access.tsx']) {
      const src = readFileSync(resolve(__dirname, '../../routes/config', f), 'utf8');
      expect(src, f).toMatch(/useConfigBack\(\)/);
      expect(src, f).not.toMatch(/navigate\('\/config'\)|<Link to="\/config"/);
    }
  });
});
