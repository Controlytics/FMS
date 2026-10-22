/**
 * Shared fixtures for the PM Schedules page tests that use the page harness
 * (coverage campaign 2026-10-21). NOT a test file.
 *
 * Dates sit on days 10-20 of the CURRENT month so they fall inside the list's
 * default "this month" range whatever day the suite runs on.
 */
import { expect } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { mockApi, type MockRoute, type MockRequest, type TestUser } from '@/test-utils/page-harness';
import { baseRoutes, role, SA, type BaseRouteOpts } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC } from '../../cleaning-cycles/__tests__/cycles-fixtures';

export const NOW = new Date();
export const Y = NOW.getFullYear();
export const M = NOW.getMonth() + 1;
export const MM = String(M).padStart(2, '0');
/** UTC 06:00 on day `d` of the current month (or another year/month). */
export const day = (d: number, y = Y, mm = MM) => `${y}-${mm}-${String(d).padStart(2, '0')}T06:00:00.000Z`;
/** The same day as the page renders it under the UTC / YYYY-MM-DD datetime config. */
export const shown = (d: number, y = Y, mm = MM) => `${y}-${mm}-${String(d).padStart(2, '0')}`;

export function entry(id: string, over: Record<string, any> = {}) {
  return {
    id, scheduleId: 's1', ahuId: 'ahu-1', ahuName: 'AHU-01', month: M,
    plannedDate: day(15), toleranceDays: 5, windowStart: day(10), windowEnd: day(20),
    approvalStatus: 'APPROVED', approvalRemarks: null, approvedByName: 'qa9', approvedAt: day(11),
    submittedByName: 'uploader', reviewedByName: null, pendingPlannedDate: null, pendingToleranceDays: null,
    ...over,
  };
}

export const WF_ON = { workflowEnabled: true, reviewRole: 'MANAGER', approvalRole: 'QA' };
export const WF_OFF = { workflowEnabled: false, reviewRole: '', approvalRole: '' };

export const VIEWER: TestUser = role('OPERATOR', ['PM_READ']);
export const REVIEWER: TestUser = { ...role('MANAGER', ['PM_READ', 'PM_REVIEW']), username: 'mgr1' };
export const APPROVER: TestUser = { ...role('QA', ['PM_READ', 'PM_APPROVE']), username: 'qa1' };
export const EDITOR: TestUser = {
  ...role('SUPERVISOR', ['PM_READ', 'PM_EDIT_ENTRY', 'PM_RESUBMIT', 'PM_UPLOAD', 'PM_DOWNLOAD_TEMPLATE', 'PM_CREATE']),
  username: 'sup1',
};
export { SA };

export interface PmRouteOpts extends BaseRouteOpts {
  entries?: any[];
  /** Export reads (page=…): defaults to `entries`. */
  exportPages?: (req: MockRequest) => any;
  wf?: any;
  settings?: any;
  counts?: any;
  instances?: any[];
  ahus?: any[];
  extra?: MockRoute[];
}

/** Every read the PM list makes, answered. `extra` routes win. */
export function pmApi(o: PmRouteOpts = {}) {
  const all = o.entries ?? [];
  return mockApi([
    ...(o.extra ?? []),
    { path: '/api/pm-schedules/settings', body: o.settings ?? { enabled: true } },
    { path: '/api/pm-schedules/workflow-config', body: o.wf ?? WF_ON },
    { path: '/api/pm-schedules/entries/pending-counts', body: o.counts ?? { pending: 0, rejected: 0 } },
    {
      path: '/api/pm-schedules/entries',
      body: (req: MockRequest) => {
        if (req.query.get('page')) {
          if (o.exportPages) return o.exportPages(req);
          return { data: all.filter((e) => e.plannedDate.startsWith(req.query.get('year')!)), total: all.length };
        }
        const status = req.query.get('approvalStatus');
        const year = req.query.get('year')!;
        return { data: all.filter((e) => e.plannedDate.startsWith(year) && (!status || e.approvalStatus === status)) };
      },
    },
    { path: '/api/assets/instances', body: { data: o.instances ?? [] } },
    { path: '/api/hierarchy/ahus', body: { data: o.ahus ?? [{ id: 'ahu-1', name: 'AHU-01' }, { id: 'ahu-2', name: 'AHU-02' }] } },
    { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: { ok: true } },
    DT_UTC,
    ...baseRoutes(o),
  ]);
}

/** Dismiss the app's acknowledgement modal after checking its title / text. */
export async function okDialog(title: string, message?: string | RegExp) {
  const h = await screen.findByRole('heading', { name: title });
  const dlg = h.closest('[role="dialog"]') as HTMLElement;
  if (message !== undefined) expect(dlg).toHaveTextContent(message);
  fireEvent.click(within(dlg).getByRole('button', { name: 'OK' }));
}

/** The table row holding `text` (a date, an AHU name …). */
export const rowWith = (text: string) => screen.getAllByText(text)[0].closest('tr') as HTMLElement;
