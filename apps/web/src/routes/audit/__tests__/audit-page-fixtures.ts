/**
 * Shared fixtures for the Audit Trail page tests (harness-based). Lives under
 * __tests__/ so coverage never counts it as application code.
 */
import { expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { getDefaultTemplates } from '@digilog/shared';
import type { MockRoute, MockApi } from '@/test-utils/page-harness';
import { reauthActions, commonConfigRoutes } from '@/routes/users/__tests__/support/page-findings';

export const VIEWER = { role: 'QA', permissions: ['AUDIT_READ'] };
export const EXPORTER = { role: 'QA', permissions: ['AUDIT_READ', 'AUDIT_EXPORT'] };
export const DELETER = { role: 'ADMIN', permissions: ['AUDIT_READ', 'AUDIT_DELETE'] };
export const SA = { role: 'SUPER_ADMIN', permissions: [] as string[] };

export const REC = (over: Record<string, any> = {}) => ({
  id: 'a1', timestamp: '2026-10-20T08:30:00.000Z', action: 'USER_UPDATED',
  userId: '101010', userRole: 'ADMIN', targetType: 'user', targetId: 'u-9', ipAddress: '10.0.0.5',
  checksum: 'abc123', beforeValue: { username: '101020', email: 'old@x.io' } as any, afterValue: { username: '101020', email: 'new@x.io' } as any,
  ...over,
});

export const ROWS = [
  REC(),
  REC({ id: 'a2', action: 'LOGIN_FAILED', userId: 'intruder', beforeValue: null, afterValue: null }),
  REC({ id: 'a3', action: 'PM_SCHEDULE_APPROVED', userId: 'qa1', afterValue: { ahuNames: ['AHU-1', 'AHU-2'] }, beforeValue: null }),
  REC({ id: 'a4', action: 'FILTER_CREATED', redactedAt: '2026-10-19T00:00:00Z', redactedByName: 'sa', redactionReason: 'PII entered by mistake', beforeValue: null, afterValue: null }),
  REC({ id: 'a5', action: 'AUDIT_RECORD_UPDATED', userId: 'sa', beforeValue: null, afterValue: { ahuName: 'AHU-7' } }),
];

export const page = (data: any[], over: Record<string, unknown> = {}) => ({ data, total: data.length, totalPages: 1, ...over });

export interface AuditRouteOpts { list?: unknown; reauth?: string[]; extra?: MockRoute[]; exportMax?: number; pageCfg?: { limit: number; options: number[] } }

/** Every feed the page (and its shared hooks/components) reads. */
export function auditRoutes(o: AuditRouteOpts = {}): MockRoute[] {
  const common = commonConfigRoutes();
  if (o.pageCfg) common[1] = { path: '/api/config/pagination/current', body: { count: 3, ...o.pageCfg } };
  return [
    ...(o.extra ?? []),
    ...common,
    reauthActions(o.reauth ?? []),
    { path: '/api/config/audit-templates/current', body: getDefaultTemplates() },
    { path: '/api/roles/active', body: [{ name: 'ADMIN', displayName: 'Administrator', color: 'bg-blue-600' }] },
    { path: '/api/config/export-limit/current', body: { maxRecords: o.exportMax ?? 1000 } },
    { path: '/api/config/report-labels/current', body: {} },
    { path: '/api/config/report-page-titles/current', body: {} },
    { path: '/api/config/branding', body: { companyName: 'Acme Pharma' } },
    { path: '/api/config/export-options/current', body: {} },
    { path: '/api/users', body: { data: [{ id: 'u1', username: '101010', fullName: 'Asha Rao' }, { id: 'u2', username: 'qa1', fullName: 'Quality One' }] } },
    { path: '/api/audit', body: o.list ?? page(ROWS) },
  ];
}

/** The page's own list reads (the exporter pages with limit=200). */
export const listCalls = (api: MockApi) => api.calls('GET', '/api/audit').filter((r) => r.query.get('limit') !== '200');
export const lastList = (api: MockApi) => { const c = listCalls(api); return c[c.length - 1]; };
export const myActionsLoaded = (api: MockApi) => waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
export const rowOf = (text: string | RegExp) => screen.getByText(text).closest('tr') as HTMLElement;

/** Error / success notices are blocking message dialogs shown one at a time; acknowledge the current one. */
export async function ack(title: string) {
  await screen.findByText(title);
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByText(title)).toBeNull());
}

/** Type the redact / delete reason into the open confirm dialog (it replaced window.prompt 2026-10-24). */
export function giveReason(text: string) {
  fireEvent.change(screen.getByLabelText(/Reason for this change/), { target: { value: text } });
}

/** Answer the open re-auth dialog with a password. */
export async function signWith(password: string) {
  fireEvent.change(await screen.findByPlaceholderText('Enter your password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
}
