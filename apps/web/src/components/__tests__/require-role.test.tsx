/**
 * <RequireRole> — route guard by role or permission, with the real useAuth
 * (signed-in user served by the page harness at /api/auth/me).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { mockApi, renderPage, type MockApi } from '@/test-utils/page-harness';
import { RequireRole } from '../require-role';

const page = <p>secret page</p>;
// "Denied" is also what renders while /me is still loading, so a denial is only
// meaningful AFTER the signed-in user has arrived.
async function deniedAfterLoad(api: MockApi) {
  await waitFor(() => expect(api.calls('GET', '/api/auth/me')).toHaveLength(1));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
  expect(screen.queryByText('secret page')).toBeNull();
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn'); error = vi.spyOn(console, 'error'); });
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('RequireRole', () => {
  it('denies when nobody is signed in', async () => {
    renderPage(<RequireRole permissions={['AUDIT_READ']}>{page}</RequireRole>, { api: mockApi() });
    expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
    expect(screen.getByText("You don't have permission to access this page.")).toBeInTheDocument();
    expect(screen.queryByText('secret page')).toBeNull();
  });

  it('SUPER_ADMIN passes every guard, even an empty one', async () => {
    renderPage(<RequireRole roles={[]}>{page}</RequireRole>, { user: { role: 'SUPER_ADMIN', permissions: [] }, api: mockApi() });
    expect(await screen.findByText('secret page')).toBeInTheDocument();
  });

  it('a listed role passes', async () => {
    renderPage(<RequireRole roles={['ADMIN', 'QA']}>{page}</RequireRole>, { user: { role: 'QA', permissions: [] }, api: mockApi() });
    expect(await screen.findByText('secret page')).toBeInTheDocument();
  });

  it('an unlisted role with no permission guard is denied', async () => {
    const api = mockApi();
    renderPage(<RequireRole roles={['ADMIN']}>{page}</RequireRole>, { user: { role: 'OPERATOR', permissions: ['AUDIT_READ'] }, api });
    await deniedAfterLoad(api);
  });

  it('holding ANY of the listed permissions passes', async () => {
    renderPage(<RequireRole permissions={['AUDIT_READ', 'AUDIT_EXPORT']}>{page}</RequireRole>, { user: { role: 'QA', permissions: ['AUDIT_EXPORT'] }, api: mockApi() });
    expect(await screen.findByText('secret page')).toBeInTheDocument();
  });

  it('holding none of the listed permissions is denied', async () => {
    const api = mockApi();
    renderPage(<RequireRole permissions={['AUDIT_READ']}>{page}</RequireRole>, { user: { role: 'QA', permissions: ['ASSET_VIEW'] }, api });
    await deniedAfterLoad(api);
  });

  it('a role OR a permission is enough when both are given', async () => {
    renderPage(<RequireRole roles={['ADMIN']} permissions={['PM_READ']}>{page}</RequireRole>, { user: { role: 'OPERATOR', permissions: ['PM_READ'] }, api: mockApi() });
    expect(await screen.findByText('secret page')).toBeInTheDocument();
  });

  it('a user record without a permissions array is denied by a permission guard', async () => {
    const api = mockApi();
    renderPage(<RequireRole permissions={['PM_READ']}>{page}</RequireRole>, { user: { role: 'OPERATOR', permissions: undefined }, api });
    await deniedAfterLoad(api);
  });
});
