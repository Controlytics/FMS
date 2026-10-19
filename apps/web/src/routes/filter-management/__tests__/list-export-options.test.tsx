import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EXPORT_SURFACES } from '@/lib/export-surfaces';

/**
 * OQ-16 — the Retirement List and Replacement List rendered their own Export
 * Excel / Download Report buttons gated only by can('…_list.export'), and had no
 * surface in lib/export-surfaces.ts. So the role-wise Export Options matrix
 * ("PDF only", "None") could not reach them: a "PDF only" role still got Excel.
 * They now render through ExportMenu with surfaces 'retirement-list' and
 * 'replacement-list'; the useExportOptions hook is the REAL one here, fed by the
 * mocked `/api/config/export-options/current` response.
 */

const h = vi.hoisted(() => ({ current: {} as Record<string, string>, can: true }));
const RETIRED = [{ id: 'r1', name: 'FLT-1', filterSet: 'SET_A', retiredAt: '2026-10-01T00:00:00Z', retiredBy: 'qa', remarks: 'torn' }];
const REPLACED = [{ id: 'p1', oldFilterName: 'FLT-1', newFilterName: 'FLT-1A', replacedAt: '2026-10-01T00:00:00Z', performedBy: 'op', remarks: 'r' }];
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key === '/api/config/export-options/current') return { data: h.current };
    if (key === '/api/filters/retirements') return { data: RETIRED, isLoading: false };
    if (key === '/api/filters/replacements') return { data: REPLACED, isLoading: false };
    return { data: undefined, isLoading: false };
  },
  mutate: vi.fn(),
}));
vi.mock('@/hooks/use-can', () => ({ useCan: () => () => h.can }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { role: 'QA', permissions: [] } }) }));
vi.mock('@/hooks/use-datetime-format', () => ({ useDatetimeFormat: () => ({ formatDate: () => 'd', formatDateTime: () => 'dt' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }) }));
vi.mock('@/hooks/use-reauth', () => ({ useReauth: () => ({ executeWithResult: vi.fn() }) }));
vi.mock('@/hooks/use-export-limit', () => ({ useExportLimit: () => ({ maxRecords: 100000, tooLargeMessage: () => '' }) }));
vi.mock('@/components/reauth-prompt', () => ({ ReauthPrompt: () => null }));
vi.mock('@/components/ui/pagination', () => ({ Pagination: () => null }));
vi.mock('@/components/super-admin-record-edit', () => ({
  SuperAdminRecordEditDialog: () => null, SuperAdminEditButton: () => null, useIsSuperAdmin: () => false, userOptions: () => [],
}));
vi.mock('@/components/block-ahu-filter', () => ({
  BlockAhuFilter: () => null,
  useBlockAhuScope: () => ({ scopeLabel: '', isActive: false, matches: () => true }),
}));
vi.mock('../replacement-schedule', () => ({ ReplacementSchedulePage: () => null }));
vi.mock('@/lib/api-client', () => ({ api: {} }));

import { RetirementListPage } from '../retirement-list';
import { ReplacementListPage } from '../replacement-list';

beforeEach(() => { h.current = {}; h.can = true; });

describe('OQ-16 — Retirement / Replacement list exports honour Export Options', () => {
  it('both lists are registered export surfaces (so the admin matrix shows them)', () => {
    const keys = EXPORT_SURFACES.map((s) => s.key);
    expect(keys).toContain('retirement-list');
    expect(keys).toContain('replacement-list');
  });

  it.each([
    ['Retirement List', 'retirement-list', () => <RetirementListPage />],
    ['Replacement List', 'replacement-list', () => <ReplacementListPage />],
  ])('%s: "PDF only" offers PDF and no Excel', (_n, key, page) => {
    h.current = { [key]: 'PDF' };
    render(page());
    expect(screen.getByRole('button', { name: /Export as PDF/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excel/ })).toBeNull();
  });

  it.each([
    ['Retirement List', 'retirement-list', () => <RetirementListPage />],
    ['Replacement List', 'replacement-list', () => <ReplacementListPage />],
  ])('%s: "None" hides every export control', (_n, key, page) => {
    h.current = { [key]: 'NONE' };
    render(page());
    expect(screen.queryByRole('button', { name: /Export|Excel|PDF|Download Report/ })).toBeNull();
  });

  it('the page-level can() check still gates the export', () => {
    h.can = false;
    render(<RetirementListPage />);
    expect(screen.queryByRole('button', { name: /Export|Excel|PDF|Download Report/ })).toBeNull();
  });
});
