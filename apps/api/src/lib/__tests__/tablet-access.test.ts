import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../prisma.js', () => ({ prisma: { systemConfig: { findUnique } } }));

import { resolveTabletAccess, tabletLoginAllowed } from '../tablet-access.js';

const LIVE = {
  QA: [], MAINTENANCE: [],
  OPERATOR: ['login', 'filter_cleaning', 'logout'],
};

describe('resolveTabletAccess', () => {
  beforeEach(() => findUnique.mockReset());

  it('SUPER_ADMIN gets everything without reading the config', async () => {
    const a = await resolveTabletAccess('SUPER_ADMIN');
    expect(a.allowed).toContain('login');
    expect(a.configured).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
    expect(tabletLoginAllowed(a)).toBe(true);
  });

  it('a role with its own entry gets exactly that entry', async () => {
    findUnique.mockResolvedValue({ configValue: LIVE });
    const a = await resolveTabletAccess('OPERATOR');
    expect(a).toEqual({ allowed: LIVE.OPERATOR, configured: true });
    expect(tabletLoginAllowed(a)).toBe(true);
  });

  it('a role configured with no features may not log in', async () => {
    findUnique.mockResolvedValue({ configValue: LIVE });
    expect(tabletLoginAllowed(await resolveTabletAccess('QA'))).toBe(false);
  });

  it('a role missing from a configured allowlist is denied (ADMIN / MANAGER today)', async () => {
    findUnique.mockResolvedValue({ configValue: LIVE });
    const a = await resolveTabletAccess('ADMIN');
    expect(a).toEqual({ allowed: [], configured: true });
    expect(tabletLoginAllowed(a)).toBe(false);
  });

  it.each([[null], [{ configValue: {} }]])('no config at all = legacy default-allow (%j)', async (row) => {
    findUnique.mockResolvedValue(row);
    const a = await resolveTabletAccess('ADMIN');
    expect(a).toEqual({ allowed: [], configured: false });
    expect(tabletLoginAllowed(a)).toBe(true);
  });
});
