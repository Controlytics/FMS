/**
 * useRoleColors — role badge colours + display names come from the roles table.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { useRoleColors } from '../use-role-colors';

function Probe() {
  const { roleColors, roleLabels, rolesData } = useRoleColors();
  return (
    <div>
      <p data-testid="count">{rolesData?.length ?? 'none'}</p>
      <p data-testid="colors">{JSON.stringify(roleColors)}</p>
      <p data-testid="labels">{JSON.stringify(roleLabels)}</p>
    </div>
  );
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn'); error = vi.spyOn(console, 'error'); });
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe('useRoleColors', () => {
  it('maps each active role to "<color> text-white" and its display name', async () => {
    const api = mockApi([{ path: '/api/roles/active', body: [
      { name: 'QA', displayName: 'Quality Assurance', color: 'bg-emerald-600' },
      { name: 'SHIFTOFFICER', displayName: 'Shift Officer', color: 'bg-amber-600' },
    ] }]);
    renderPage(<Probe />, { api });
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    expect(JSON.parse(screen.getByTestId('colors').textContent!)).toEqual({
      QA: 'bg-emerald-600 text-white', SHIFTOFFICER: 'bg-amber-600 text-white',
    });
    expect(JSON.parse(screen.getByTestId('labels').textContent!)).toEqual({
      QA: 'Quality Assurance', SHIFTOFFICER: 'Shift Officer',
    });
  });

  it('returns empty maps until the roles load', () => {
    const api = mockApi();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // request still in flight
    renderPage(<Probe />, { api });
    expect(screen.getByTestId('count')).toHaveTextContent('none');
    expect(screen.getByTestId('colors')).toHaveTextContent('{}');
    expect(screen.getByTestId('labels')).toHaveTextContent('{}');
  });
});
