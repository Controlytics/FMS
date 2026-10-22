/**
 * PM Schedules — defects found by the coverage campaign (2026-10-21), each
 * pinned failing-first:
 *  D-OPS-1  Start PM offered without PM_EXECUTE (server gate).
 *  D-OPS-2  per-row Review / Approve / Reject / Modify ignored the SoD rule the
 *           checkboxes already applied (server: SELF_APPROVAL_FORBIDDEN).
 *  D-OPS-4  clearing the date range asked for year=0 and emptied the table.
 *  D-OPS-5  a failed template download was invisible.
 *  D-OPS-8  a cancelled password prompt was reported as an error.
 *  D-OPS-11 template / Excel downloads did not resolve the API base like every
 *           other raw fetch (apiUrl).
 *  D6       the configured page size was ignored on a cold load.
 *  3d       controls with no accessible name.
 *  D03-04   the summary tiles and tab counts followed the selected tab, so on
 *           Approved an approver saw Pending 0 and no To Approve tab while an
 *           entry waited; the upload result said "Pending QA" whatever the
 *           workflow (2026-10-22).
 *  Upload   the drop zone was a clickable div: no keyboard path to the file
 *           chooser; and a second file dropped mid-upload started a second
 *           upload (2026-10-22).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, role, passReauth } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { PmScheduleListPage, pmImportedLabel } from '../index';
import { PmScheduleDetailPage } from '../detail';
import { pmApi, entry, day, shown, okDialog, rowWith, Y, MM, VIEWER, REVIEWER, APPROVER, EDITOR, SA, WF_ON, WF_OFF, type PmRouteOpts } from './pm-kit';
import { unnamedControls } from './a11y-kit';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

function openList(user: any, o: PmRouteOpts = {}) {
  const api = pmApi(o);
  renderPage(<PmScheduleListPage />, { user, api });
  return api;
}
const reauthReady = (api: ReturnType<typeof mockApi>) =>
  waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
// A review or an approval asks for remarks first (D03-13, 2026-10-22).
const REMARKS = 'dates checked';
const decisionDialog = () => screen.getByRole('dialog', { name: /^(Review|Approve) (Entry|\d+ Entries)$/ });
const decide = (remarks = REMARKS) => {
  const dlg = decisionDialog();
  fireEvent.change(within(dlg).getByLabelText(/Remarks/), { target: { value: remarks } });
  fireEvent.click(within(dlg).getByRole('button', { name: /^(Send for approval|Approve)$/ }));
};
const cancelPrompt = async () => {
  await screen.findByPlaceholderText('Enter your password');
  const box = screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement;
  fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
};
/** No acknowledgement modal (success or error) is on screen. */
const noMessageDialog = () => expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();

// ─── D-OPS-1 ────────────────────────────────────────────────────────────────
describe('D-OPS-1 — Start PM follows the server gate (PM_EXECUTE)', () => {
  const now = Date.now();
  const iso = (d: number) => new Date(now + d * 86_400_000).toISOString();
  const schedule = { version: 1, status: 'ACTIVE', entries: [{ id: 'e', month: 1, plannedDate: iso(0), toleranceDays: 2, windowStart: iso(-2), windowEnd: iso(2), execution: null }] };
  const openDetail = (user: any) => {
    const api = mockApi([{ path: '/api/pm-schedules/ahu-1', body: schedule }, DT_UTC, ...baseRoutes()]);
    renderPage(<PmScheduleDetailPage />, { user, api, route: '/pm-schedules/ahu-1', path: '/pm-schedules/:entityId' });
  };

  it('a PM_READ-only role is not offered Start PM', async () => {
    openDetail(role('MANAGER', ['PM_READ']));
    await screen.findByText('v1');
    expect(screen.queryByRole('button', { name: 'Start PM' })).toBeNull();
  });

  it('a PM_EXECUTE holder and a Super Admin are', async () => {
    openDetail(role('OPERATOR', ['PM_READ', 'PM_EXECUTE']));
    expect(await screen.findByRole('button', { name: 'Start PM' })).toBeEnabled();
  });

  it('Super Admin bypasses the gate', async () => {
    openDetail(SA);
    expect(await screen.findByRole('button', { name: 'Start PM' })).toBeEnabled();
  });
});

// ─── D-OPS-2 ────────────────────────────────────────────────────────────────
describe('D-OPS-2 — per-row actions use the same SoD rule as the checkboxes', () => {
  it('the reviewer gets no Review / Reject / Modify on an entry they submitted; other entries keep them', async () => {
    openList(REVIEWER, { entries: [
      entry('mine', { approvalStatus: 'PENDING_REVIEW', submittedByName: 'mgr1' }),
      entry('other', { approvalStatus: 'PENDING_REVIEW', plannedDate: day(12) }),
    ] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    const mine = rowWith(shown(15));
    expect(within(mine).queryByRole('button', { name: 'Review ✓' })).toBeNull();
    expect(within(mine).queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(within(mine).queryByRole('button', { name: 'Modify' })).toBeNull();
    expect(mine).toHaveTextContent('Submitted by you — another reviewer must review it');
    const other = rowWith(shown(12));
    expect(within(other).getByRole('button', { name: 'Review ✓' })).toBeInTheDocument();
    expect(within(other).getByRole('button', { name: 'Modify' })).toBeInTheDocument();
  });

  it('the approver gets no Approve / Reject on an entry they reviewed or submitted; other entries keep them', async () => {
    openList(APPROVER, { entries: [
      entry('rev', { approvalStatus: 'PENDING_APPROVAL', reviewedByName: 'qa1' }),
      entry('sub', { approvalStatus: 'PENDING_APPROVAL', submittedByName: 'qa1', plannedDate: day(13) }),
      entry('ok', { approvalStatus: 'PENDING_APPROVAL', reviewedByName: 'mgr1', plannedDate: day(12) }),
    ] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    for (const d of [15, 13]) {
      const r = rowWith(shown(d));
      expect(within(r).queryByRole('button', { name: 'Approve' })).toBeNull();
      expect(within(r).queryByRole('button', { name: 'Reject' })).toBeNull();
      expect(r).toHaveTextContent('You submitted or reviewed this — another approver must approve it');
    }
    expect(within(rowWith(shown(12))).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});

// ─── D-OPS-4 ────────────────────────────────────────────────────────────────
describe('D-OPS-4 — the date range can never ask for year 0 or hide everything', () => {
  const entryReads = (api: ReturnType<typeof mockApi>) => api.calls('GET', '/api/pm-schedules/entries').filter((r) => !r.query.get('page'));

  it('the range is not clearable as a whole', async () => {
    openList(VIEWER, { entries: [entry('e1')] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    expect(screen.queryByRole('button', { name: 'Clear date range' })).toBeNull();
  });

  it('emptying the To end keeps the From year and every entry from From onward', async () => {
    const api = openList(VIEWER, { entries: [entry('e1')] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    fireEvent.change(screen.getByLabelText('PM schedule to date'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByLabelText('PM schedule to date')).toHaveValue(''));
    await waitFor(() => {});
    expect(entryReads(api).map((r) => r.query.get('year'))).not.toContain('0');
    expect(screen.queryByText('No schedule entries found')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'AHU-01' })).toHaveLength(1);
  });

  it('emptying the From end reads the To year and keeps every entry up to To', async () => {
    const api = openList(VIEWER, { entries: [entry('e1')] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    fireEvent.change(screen.getByLabelText('PM schedule from date'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByLabelText('PM schedule from date')).toHaveValue(''));
    await waitFor(() => {});
    expect(entryReads(api).map((r) => r.query.get('year'))).not.toContain('0');
    expect(entryReads(api).at(-1)!.query.get('year')).toBe(String(Y));
    expect(screen.queryByText('No schedule entries found')).toBeNull();
  });

  it('emptying both ends falls back to the whole current year', async () => {
    const api = openList(VIEWER, { entries: [entry('e1'), entry('jan', { plannedDate: `${Y}-01-05T06:00:00.000Z`, month: 1 })] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    fireEvent.change(screen.getByLabelText('PM schedule from date'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('PM schedule to date'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByLabelText('PM schedule to date')).toHaveValue(''));
    await waitFor(() => {});
    expect(entryReads(api).map((r) => r.query.get('year'))).not.toContain('0');
    expect(entryReads(api).at(-1)!.query.get('year')).toBe(String(Y));
    // No bounds: January's visit shows too (unless this IS January, when both are in range anyway).
    expect(await screen.findByText(`${Y}-01-05`)).toBeInTheDocument();
  });
});

// ─── D-OPS-5 ────────────────────────────────────────────────────────────────
describe('D-OPS-5 — a failed template download is reported', () => {
  it('shows an error even with the upload dialog closed', async () => {
    const api = openList(EDITOR, { entries: [entry('e1')], extra: [{ path: '/api/pm-schedules/template.csv', status: 500, body: {} }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Template' }));
    await waitFor(() => expect(api.calls('GET', '/api/pm-schedules/template.csv')).toHaveLength(1));
    await okDialog('Template download failed', 'HTTP 500');
  });
});

// ─── D-OPS-8 ────────────────────────────────────────────────────────────────
describe('D-OPS-8 — cancelling the password prompt is silent', () => {
  it('PM list: cancelling an approval sends nothing, shows nothing, re-enables the button', async () => {
    const api = openList(APPROVER, { entries: [entry('a1', { approvalStatus: 'PENDING_APPROVAL' })], reauthActions: ['APPROVE_PM_SCHEDULE'] });
    await reauthReady(api);
    const approve = await screen.findByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    decide();
    await cancelPrompt();
    noMessageDialog();
    expect(approve).toBeEnabled();
    expect(api.calls('POST', /\/entries\/approve$/)).toHaveLength(0);
  });

  it('PM list: cancelling an edit keeps the row in edit mode with no message', async () => {
    const api = openList(EDITOR, { entries: [entry('e1')], reauthActions: ['EDIT_PM_SCHEDULE'] });
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await cancelPrompt();
    noMessageDialog();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('PM list: cancelling an upload leaves no error in the upload dialog', async () => {
    const api = openList(EDITOR, { entries: [entry('e1')], reauthActions: ['UPLOAD_PM_SCHEDULES'] });
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'pm.xlsx')] } });
    await cancelPrompt();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.getByText('Drag and drop or click to choose')).toBeInTheDocument();
  });

  it('PM list: cancelling a delete / create / reject leaves no message', async () => {
    const api = openList(SA, {
      entries: [entry('a1', { approvalStatus: 'PENDING_APPROVAL' })],
      reauthActions: ['DELETE_PM_SCHEDULE', 'CREATE_PM_SCHEDULE', 'REJECT_PM_SCHEDULE'],
    });
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete schedule for AHU-01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete schedule' }));
    await cancelPrompt();
    noMessageDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'New Schedule' }));
    const dlg = screen.getByRole('heading', { name: 'New PM Schedule' }).closest('.max-w-md') as HTMLElement;
    fireEvent.change(within(dlg).getByLabelText('AHU'), { target: { value: 'ahu-2' } });
    fireEvent.change(within(dlg).getByLabelText('Date'), { target: { value: `${Y}-${MM}-25` } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Add visit' }));
    await cancelPrompt();
    noMessageDialog();
    expect(within(dlg).getByRole('button', { name: 'Add visit' })).toBeEnabled();
    expect(api.calls('POST', '/api/pm-schedules/visits')).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: 'not now' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' }).at(-1)!);
    await cancelPrompt();
    noMessageDialog();
    expect(api.calls('POST', /entries\/reject$/)).toHaveLength(0);
  });

  it('PM detail: cancelling Start PM shows no banner and re-enables Start', async () => {
    const now = Date.now();
    const iso = (d: number) => new Date(now + d * 86_400_000).toISOString();
    const api = mockApi([
      { path: '/api/pm-schedules/ahu-1', body: { version: 1, status: 'ACTIVE', entries: [{ id: 'e', month: 1, plannedDate: iso(0), toleranceDays: 2, windowStart: iso(-2), windowEnd: iso(2), execution: null }] } },
      DT_UTC, ...baseRoutes({ reauthActions: ['START_PM_TASK'] }),
    ]);
    renderPage(<PmScheduleDetailPage />, { user: role('OPERATOR', ['PM_READ', 'PM_EXECUTE']), api, route: '/pm-schedules/ahu-1', path: '/pm-schedules/:entityId' });
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Start PM' }));
    await cancelPrompt();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss error' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start PM' })).toBeEnabled();
  });
});

// ─── D-OPS-11 ───────────────────────────────────────────────────────────────
describe('D-OPS-11 — raw downloads resolve the API base like every other raw fetch', () => {
  const rawUrls = () => (vi.mocked(fetch).mock.calls as any[]).map(([u]) => String(u));
  const anchorDownloads = () => (vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts as HTMLAnchorElement[]).map((a) => a.download);

  it('with a stored server address, the template and the Excel export go to that server', async () => {
    localStorage.setItem('digilog.serverUrl', 'https://srv.example:3000');
    openList(VIEWER, { entries: [entry('e1')], extra: [
      { path: '/api/pm-schedules/template.csv', body: 'h' },
      { path: '/api/pm-schedules/entries/export.xlsx', body: { x: 1 } },
    ] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    fireEvent.click(await screen.findByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    await waitFor(() => expect(anchorDownloads()).toContain(`pm-schedule-${Y}.xlsx`));
    expect(rawUrls()).toContain(`https://srv.example:3000/api/pm-schedules/entries/export.xlsx?year=${Y}`);
  });

  it('the template download goes to the stored server too', async () => {
    localStorage.setItem('digilog.serverUrl', 'https://srv.example:3000');
    openList(EDITOR, { entries: [entry('e1')], extra: [{ path: '/api/pm-schedules/template.csv', body: 'h' }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Template' }));
    await waitFor(() => expect(anchorDownloads()).toContain('pm-schedule-template.csv'));
    expect(rawUrls()).toContain('https://srv.example:3000/api/pm-schedules/template.csv');
  });
});

// ─── D6 ─────────────────────────────────────────────────────────────────────
describe('D6 — the configured page size applies on a cold load', () => {
  it('first configured option 25: the first page shows 25 rows, not the 10 of the loading fallback', async () => {
    const many = Array.from({ length: 30 }, (_, i) => entry(`m${i}`, { plannedDate: day(10 + (i % 10)) }));
    openList(VIEWER, { entries: many, pagination: { limit: 25, options: [25, 50, 100] } });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(26));
    expect(screen.getByRole('combobox', { name: /Rows/ })).toHaveValue('25');
    // The operator's own choice still wins.
    fireEvent.change(screen.getByRole('combobox', { name: /Rows/ }), { target: { value: '50' } });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(31));
  });
});

// ─── 3d ─────────────────────────────────────────────────────────────────────
describe('3d — every control on the PM pages has an accessible name', () => {
  it('PM list: table, inline edit, reject / create / delete / upload / past-date dialogs', async () => {
    openList(SA, {
      entries: [
        entry('rv', { approvalStatus: 'PENDING_REVIEW', plannedDate: day(12) }),
        entry('ap', { approvalStatus: 'PENDING_APPROVAL', plannedDate: day(13) }),
        entry('ok', { approvalStatus: 'APPROVED', plannedDate: day(14) }),
        entry('rj', { approvalStatus: 'REJECTED', plannedDate: day(16) }),
      ],
      instances: [{ id: 'f1', name: 'FLT-A', parentId: 'ahu-1' }],
    });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[0]);
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'New Schedule' }));
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete schedule for AHU-01' }));
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'Upload Schedule' }));
    expect(unnamedControls()).toEqual([]);
    const f = new File(['ahu_name,scheduled_date\nAHU-01,2020-01-05\n'], 'old.csv');
    if (typeof (f as any).text !== 'function') (f as any).text = async () => 'ahu_name,scheduled_date\nAHU-01,2020-01-05\n';
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [f] } });
    await screen.findByRole('heading', { name: 'Past Dates Detected' });
    expect(unnamedControls()).toEqual([]);
  });

  it('PM detail', async () => {
    const now = Date.now();
    const iso = (d: number) => new Date(now + d * 86_400_000).toISOString();
    const api = mockApi([{ path: '/api/pm-schedules/ahu-1', body: { version: 1, status: 'ACTIVE', entries: [{ id: 'e', month: 1, plannedDate: iso(0), toleranceDays: 2, windowStart: iso(-2), windowEnd: iso(2), execution: null }] } },
      { method: 'POST', path: '/api/pm-executions', status: 409, body: { error: 'X', message: 'busy' } }, DT_UTC, ...baseRoutes()]);
    renderPage(<PmScheduleDetailPage />, { user: SA, api, route: '/pm-schedules/ahu-1', path: '/pm-schedules/:entityId' });
    fireEvent.click(await screen.findByRole('button', { name: 'Start PM' }));
    await screen.findByText('busy');
    expect(unnamedControls()).toEqual([]);
  });
});

// ─── Upload drop zone ───────────────────────────────────────────────────────
describe('Upload drop zone — reachable from the keyboard; one upload at a time', () => {
  const OK_UPLOAD = {
    method: 'POST', path: '/api/pm-schedules/upload',
    body: { imported: 1, skipped: 0, details: { imported: [{ row: 2, ahuName: 'AHU-01', plannedDate: `${Y}-${MM}-12`, scheduleId: 's1', entryId: 'n1' }], skipped: [] } },
  };
  const openUpload = async (o: PmRouteOpts = {}) => {
    const api = openList(EDITOR, { entries: [entry('e1')], extra: [OK_UPLOAD], ...o });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    return api;
  };
  const uploads = (api: ReturnType<typeof mockApi>) => api.calls('POST', '/api/pm-schedules/upload');

  it('the zone is a real, focusable button, so Enter and Space open the file chooser', async () => {
    await openUpload();
    // The file input itself is display:none, so this button is the ONLY keyboard
    // path to the chooser. A native <button> gets Enter / Space activation and
    // the global :focus-visible ring from the platform (jsdom has no key
    // activation to simulate, so the element is the contract).
    const zone = screen.getByRole('button', { name: /Drag and drop or click to choose/ });
    expect(zone.tagName).toBe('BUTTON');
    expect(zone).toHaveAttribute('type', 'button');
    expect(zone.className).not.toMatch(/outline-none/);
    zone.focus();
    expect(zone).toHaveFocus();
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(zone);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.contexts[0]).toBe(document.querySelector('input[type="file"]'));
  });

  it('while a file is uploading, the zone opens no chooser and a second drop sends nothing', async () => {
    const api = await openUpload({ reauthActions: ['UPLOAD_PM_SCHEDULES'] });
    await reauthReady(api);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'first.xlsx')] } });
    await screen.findByPlaceholderText('Enter your password');
    const zone = screen.getByRole('button', { name: /Uploading/ });
    expect(zone).toHaveAttribute('aria-disabled', 'true');
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(zone);
    expect(pick).not.toHaveBeenCalled();
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['y'], 'second.xlsx')] } });
    await passReauth();
    await screen.findByText('Imported (pending review by MANAGER)');
    expect(uploads(api)).toHaveLength(1);
    expect((uploads(api)[0].form!.get('file') as File).name).toBe('first.xlsx');
  });
});

// ─── D03-04 ─────────────────────────────────────────────────────────────────
describe('D03-04 — the tiles and tab counts do not follow the selected tab', () => {
  const tiles = () => {
    const grid = screen.getByText('Total', { selector: 'p' }).closest('.grid') as HTMLElement;
    return Object.fromEntries(['Total', 'Approved', 'Pending', 'Rejected'].map((l) =>
      [l, within(grid).getByText(l, { selector: 'p' }).nextElementSibling!.textContent]));
  };
  const tab = (name: RegExp) => screen.queryByRole('button', { name });
  const ENTRIES = [
    entry('a1', { plannedDate: day(11) }),
    entry('a2', { plannedDate: day(12) }),
    entry('w1', { approvalStatus: 'PENDING_APPROVAL', plannedDate: day(13) }),
    entry('r1', { approvalStatus: 'REJECTED', plannedDate: day(14) }),
  ];

  it('on the Approved tab an approver still sees the waiting entry in the tiles and the To Approve tab', async () => {
    openList(APPROVER, { entries: ENTRIES });
    await screen.findByText(shown(13));
    expect(tiles()).toEqual({ Total: '4', Approved: '2', Pending: '1', Rejected: '1' });
    expect(tab(/^To Approve/)).toHaveTextContent('To Approve(1)');

    fireEvent.click(screen.getByRole('button', { name: /^Approved/ }));
    // The table narrows to the tab...
    await waitFor(() => expect(screen.queryByText(shown(13))).toBeNull());
    expect(screen.getByText(shown(11))).toBeInTheDocument();
    expect(screen.queryByText(shown(14))).toBeNull();
    // ...the counts do not.
    expect(tiles()).toEqual({ Total: '4', Approved: '2', Pending: '1', Rejected: '1' });
    expect(tab(/^To Approve/)).toHaveTextContent('To Approve(1)');
    expect(tab(/^All/)).toHaveTextContent('All(4)');
    expect(tab(/^Rejected/)).toHaveTextContent('Rejected(1)');

    // The tab is still there to go back to the waiting entry.
    fireEvent.click(tab(/^To Approve/)!);
    expect(await screen.findByText(shown(13))).toBeInTheDocument();
    expect(screen.queryByText(shown(11))).toBeNull();
    expect(tiles()).toEqual({ Total: '4', Approved: '2', Pending: '1', Rejected: '1' });
  });

  it('switching tabs is a view of the loaded entries, not a new server read', async () => {
    const api = openList(APPROVER, { entries: ENTRIES });
    await screen.findByText(shown(13));
    const reads = () => api.calls('GET', '/api/pm-schedules/entries').filter((r) => !r.query.get('page'));
    const before = reads().length;
    fireEvent.click(screen.getByRole('button', { name: /^Rejected/ }));
    await waitFor(() => expect(screen.queryByText(shown(11))).toBeNull());
    expect(reads()).toHaveLength(before);
    expect(reads().every((r) => !r.query.has('approvalStatus'))).toBe(true);
  });
});

describe('D03-04 — the upload result names the next step the configured workflow takes', () => {
  const OK_UPLOAD = {
    method: 'POST', path: '/api/pm-schedules/upload',
    body: { imported: 1, skipped: 0, details: { imported: [{ row: 2, ahuName: 'AHU-01', plannedDate: `${Y}-${MM}-12`, scheduleId: 's1', entryId: 'n1' }], skipped: [] } },
  };
  const upload = async (user: any, wf: any) => {
    openList(user, { wf, entries: [entry('e1')], extra: [OK_UPLOAD] });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'pm.xlsx')] } });
  };

  it('workflow on: pending review by the configured reviewer, never "Pending QA"', async () => {
    await upload(EDITOR, WF_ON);
    expect(await screen.findByText('Imported (pending review by MANAGER)')).toBeInTheDocument();
    expect(screen.queryByText(/Pending QA/)).toBeNull();
  });

  it('workflow off: a Super Admin upload is approved, anyone else waits for approval', async () => {
    await upload(SA, WF_OFF);
    expect(await screen.findByText('Imported (approved)')).toBeInTheDocument();
  });

  it('workflow off, not a Super Admin: pending approval', async () => {
    await upload(EDITOR, WF_OFF);
    expect(await screen.findByText('Imported (pending approval)')).toBeInTheDocument();
  });

  it('the label rule itself, including a workflow config that has not loaded', () => {
    expect(pmImportedLabel(undefined, false)).toBe('Imported');
    expect(pmImportedLabel({ workflowEnabled: true, reviewRole: '  ', approvalRole: 'QA' } as any, true)).toBe('Imported (pending review)');
    expect(pmImportedLabel(WF_ON as any, true)).toBe('Imported (pending review by MANAGER)');
  });
});
