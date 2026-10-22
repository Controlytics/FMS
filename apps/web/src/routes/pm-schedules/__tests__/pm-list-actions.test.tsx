/**
 * PM Schedules list — New Schedule, Delete schedule, Upload, Template and
 * Export, through the page harness. Coverage campaign 2026-10-21.
 *
 * Business rules exercised:
 *  - New Schedule ADDS one visit (POST /visits) and never touches an existing
 *    one (D-OPS-10, operator decision 2026-10-22);
 *  - `.xls` uploads are refused (`.csv` / `.xlsx` only) — the server's message
 *    reaches the operator;
 *  - an upload widens the date range to show what it imported;
 *  - every export is signed + logged BEFORE the file is produced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { renderPage, type MockRequest } from '@/test-utils/page-harness';
import { usePageTestLifecycle, passReauth, expectSigned, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { fakeReport } from '../../cleaning-cycles/__tests__/cycles-fixtures';

let report = fakeReport();
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => report) }));
import { createReport } from '@/lib/pdf-report';
import { PmScheduleListPage } from '../index';
import { pmApi, entry, day, shown, okDialog, Y, M, MM, WF_OFF, EDITOR, SA, VIEWER, type PmRouteOpts } from './pm-kit';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => { report = fakeReport(); vi.mocked(createReport).mockClear(); });

function open(user: any, o: PmRouteOpts = {}) {
  const api = pmApi(o);
  renderPage(<PmScheduleListPage />, { user, api });
  return api;
}
const reauthReady = (api: ReturnType<typeof pmApi>) =>
  waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
const entryYears = (api: ReturnType<typeof pmApi>) =>
  api.calls('GET', '/api/pm-schedules/entries').filter((r) => !r.query.get('page')).map((r) => r.query.get('year'));
const anchorDownloads = () => (vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts as HTMLAnchorElement[]).map((a) => a.download);

// ─── New Schedule ────────────────────────────────────────────────────────────
const createDlg = () => screen.getByRole('heading', { name: 'New PM Schedule' }).closest('.max-w-md') as HTMLElement;
function fillCreate(ahuId: string, date: string, tol?: string) {
  const dlg = createDlg();
  fireEvent.change(within(dlg).getByLabelText('AHU'), { target: { value: ahuId } });
  fireEvent.change(within(dlg).getByLabelText('Date'), { target: { value: date } });
  if (tol !== undefined) fireEvent.change(within(dlg).getByLabelText('Tolerance days'), { target: { value: tol } });
}

describe('PM list — New Schedule adds ONE visit (D-OPS-10)', () => {
  /** The server's answer to POST /visits, echoing the approval state it gave the visit. */
  const visitRoute = (approvalStatus = 'APPROVED', extra: Record<string, unknown> = {}) => ({
    method: 'POST', path: '/api/pm-schedules/visits', status: 201,
    body: (req: MockRequest) => ({ scheduleId: 's9', scheduleCreated: false, qnn: 'QN-1', entry: { id: 'n1', ...req.json, approvalStatus }, ...extra }),
  });
  const visits = (api: ReturnType<typeof pmApi>) => api.calls('POST', '/api/pm-schedules/visits');

  it('posts the AHU, date and tolerance to /visits and names the date and status in the toast', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], wf: WF_OFF, extra: [visitRoute('PENDING')] });
    fireEvent.click(await screen.findByRole('button', { name: 'New Schedule' }));
    expect(createDlg()).toHaveTextContent('Adds one PM visit for the selected AHU on the chosen date');
    expect(createDlg()).toHaveTextContent('Existing visits are not changed');
    const add = within(createDlg()).getByRole('button', { name: 'Add visit' });
    expect(add).toBeDisabled();
    expect(within(createDlg()).getByRole('option', { name: 'AHU-02' })).toBeInTheDocument();
    fillCreate('ahu-2', `${Y}-${MM}-25`, '3');
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await okDialog('Visit added', `Visit on ${Y}-${MM}-25 added to AHU-02 — pending approval.`);
    expect(visits(api)[0].json).toEqual({ entityId: 'ahu-2', plannedDate: `${Y}-${MM}-25`, toleranceDays: 3 });
    // Nothing else is read or written: no "existing schedule" lookup, no create of a whole schedule, no edit.
    expect(api.calls('GET', /^\/api\/pm-schedules\/ahu-/)).toHaveLength(0);
    expect(api.calls('POST', '/api/pm-schedules')).toHaveLength(0);
    expect(api.calls('PUT', /\/edit$/)).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'New PM Schedule' })).toBeNull();
  });

  it('an AHU that already has visits gets a second one — never an "overwrite" of its first visit', async () => {
    const api = open(EDITOR, { entries: [entry('e1'), entry('e2', { plannedDate: day(12) })], extra: [visitRoute('PENDING_REVIEW')] });
    fireEvent.click(await screen.findByRole('button', { name: 'New Schedule' }));
    // Default tolerance (7) is sent when the operator leaves it.
    fillCreate('ahu-1', `${Y}-09-14`);
    fireEvent.click(within(createDlg()).getByRole('button', { name: 'Add visit' }));
    // Workflow ON (the kit default): the visit waits for the configured reviewer.
    await okDialog('Visit added', `Visit on ${Y}-09-14 added to AHU-01 — pending review by MANAGER.`);
    expect(visits(api)[0].json).toEqual({ entityId: 'ahu-1', plannedDate: `${Y}-09-14`, toleranceDays: 7 });
    expect(screen.queryByRole('heading', { name: /already exists|awaiting review/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Overwrite' })).toBeNull();
    expect(api.calls('PUT', /\/edit$/)).toHaveLength(0);
  });

  it('a Super Admin with the workflow off: the toast says the visit is approved; a review role left blank is not named', async () => {
    open(SA, { wf: WF_OFF, entries: [entry('e1')], extra: [visitRoute('APPROVED')] });
    fireEvent.click(await screen.findByRole('button', { name: 'New Schedule' }));
    fillCreate('ahu-2', `${Y}-${MM}-25`);
    fireEvent.click(within(createDlg()).getByRole('button', { name: 'Add visit' }));
    await okDialog('Visit added', `Visit on ${Y}-${MM}-25 added to AHU-02 — approved.`);
  });

  it('pending review with no review role configured says just "pending review"', async () => {
    open(EDITOR, { wf: { workflowEnabled: true, reviewRole: '', approvalRole: '' }, entries: [entry('e1')], extra: [visitRoute('PENDING_REVIEW')] });
    fireEvent.click(await screen.findByRole('button', { name: 'New Schedule' }));
    fillCreate('ahu-2', `${Y}-${MM}-25`);
    fireEvent.click(within(createDlg()).getByRole('button', { name: 'Add visit' }));
    await okDialog('Visit added', `Visit on ${Y}-${MM}-25 added to AHU-02 — pending review.`);
  });

  it('a date already scheduled (409 PM_VISIT_EXISTS) or an overlapping one (409 PM_VISIT_OVERLAP) is reported; the dialog stays for a new date', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], extra: [
      { method: 'POST', path: '/api/pm-schedules/visits', status: 409, times: 1, body: { error: 'PM_VISIT_EXISTS', message: `AHU-01 already has a visit on ${Y}-${MM}-15 in the ${Y} schedule.` } },
      { method: 'POST', path: '/api/pm-schedules/visits', status: 409, times: 1, body: { error: 'PM_VISIT_OVERLAP', message: 'This visit cannot be scheduled here.' } },
      { method: 'POST', path: '/api/pm-schedules/visits', status: 500, body: {} },
    ] });
    fireEvent.click(await screen.findByRole('button', { name: 'New Schedule' }));
    fillCreate('ahu-1', `${Y}-${MM}-15`);
    fireEvent.click(within(createDlg()).getByRole('button', { name: 'Add visit' }));
    await okDialog('Error', `AHU-01 already has a visit on ${Y}-${MM}-15`);
    expect(within(createDlg()).getByRole('button', { name: 'Add visit' })).toBeEnabled();
    fillCreate('ahu-1', `${Y}-${MM}-18`);
    fireEvent.click(within(createDlg()).getByRole('button', { name: 'Add visit' }));
    await okDialog('Error', 'This visit cannot be scheduled here.');
    fireEvent.click(within(createDlg()).getByRole('button', { name: 'Add visit' }));
    await okDialog('Error', 'Request failed: 500');
    expect(visits(api)).toHaveLength(3);
  });

  it('with CREATE_PM_SCHEDULE re-auth on, the visit is signed', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], reauthActions: ['CREATE_PM_SCHEDULE'], extra: [visitRoute('PENDING_REVIEW')] });
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'New Schedule' }));
    fillCreate('ahu-2', `${Y}-${MM}-25`);
    fireEvent.click(within(createDlg()).getByRole('button', { name: 'Add visit' }));
    await passReauth();
    await okDialog('Visit added');
    expectSigned(visits(api)[0]);
  });

  it('no AHUs known: the dialog says how to get one', async () => {
    open(EDITOR, { entries: [entry('e1')], ahus: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'New Schedule' }));
    expect(within(createDlg()).getByText('No AHU instances found. Create an AHU under a Block first.')).toBeInTheDocument();
  });

  it('Cancel and the backdrop close the dialog; a click inside does not', async () => {
    open(EDITOR, { entries: [entry('e1')] });
    fireEvent.click(await screen.findByRole('button', { name: 'New Schedule' }));
    fireEvent.click(within(createDlg()).getByRole('heading', { name: 'New PM Schedule' }));
    expect(screen.getByRole('heading', { name: 'New PM Schedule' })).toBeInTheDocument();
    fireEvent.click(within(createDlg()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'New PM Schedule' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New Schedule' }));
    fireEvent.click(createDlg().closest('.fixed') as HTMLElement);
    expect(screen.queryByRole('heading', { name: 'New PM Schedule' })).toBeNull();
  });

  it('without PM_CREATE there is no New Schedule', async () => {
    open(VIEWER, { entries: [entry('e1')] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    expect(screen.queryByRole('button', { name: 'New Schedule' })).toBeNull();
  });
});

// ─── Delete schedule (Super Admin only) ─────────────────────────────────────
describe('PM list — Delete schedule', () => {
  const delDlg = () => screen.getByRole('heading', { name: 'Delete PM schedule' }).closest('.max-w-md') as HTMLElement;

  it('only a Super Admin gets the per-AHU delete; it DELETEs the schedule and confirms', async () => {
    const api = open(SA, {
      entries: [entry('e1'), entry('e2', { plannedDate: day(12) })],
      extra: [{ method: 'DELETE', path: '/api/pm-schedules/s1', status: 204 }],
    });
    // One delete per AHU group, not per row.
    const btns = await screen.findAllByRole('button', { name: 'Delete schedule for AHU-01' });
    expect(btns).toHaveLength(1);
    fireEvent.click(btns[0]);
    expect(delDlg()).toHaveTextContent('Delete the PM schedule for "AHU-01"?');
    fireEvent.click(within(delDlg()).getByRole('button', { name: 'Delete schedule' }));
    await okDialog('Deleted', 'Schedule for "AHU-01" deleted');
    expect(api.calls('DELETE', '/api/pm-schedules/s1')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Delete PM schedule' })).toBeNull();
  });

  it('a PM in progress blocks the delete with a clear message; other refusals pass through', async () => {
    open(SA, {
      entries: [entry('e1')],
      extra: [
        { method: 'DELETE', path: '/api/pm-schedules/s1', status: 409, times: 1, body: { error: 'IN_PROGRESS', message: 'busy' } },
        { method: 'DELETE', path: '/api/pm-schedules/s1', status: 409, times: 1, body: { error: 'CONFLICT', message: 'An execution is In Progress' } },
        { method: 'DELETE', path: '/api/pm-schedules/s1', status: 500, body: {} },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete schedule for AHU-01' }));
    fireEvent.click(within(delDlg()).getByRole('button', { name: 'Delete schedule' }));
    await okDialog('Error', 'Cannot delete — "AHU-01" has a PM execution in progress. Wait for it to complete.');
    fireEvent.click(within(delDlg()).getByRole('button', { name: 'Delete schedule' }));
    await okDialog('Error', 'Cannot delete — "AHU-01" has a PM execution in progress.');
    fireEvent.click(within(delDlg()).getByRole('button', { name: 'Delete schedule' }));
    await okDialog('Error', 'Request failed: 500');
  });

  it('Cancel and the backdrop close the confirmation with nothing deleted', async () => {
    const api = open(SA, { entries: [entry('e1')] });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete schedule for AHU-01' }));
    fireEvent.click(within(delDlg()).getByRole('heading', { name: 'Delete PM schedule' }));
    fireEvent.click(within(delDlg()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Delete PM schedule' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete schedule for AHU-01' }));
    fireEvent.click(delDlg().closest('.fixed') as HTMLElement);
    expect(screen.queryByRole('heading', { name: 'Delete PM schedule' })).toBeNull();
    expect(api.calls('DELETE', /pm-schedules/)).toHaveLength(0);
  });
});

// ─── Upload ─────────────────────────────────────────────────────────────────
const csv = (name: string, content: string) => {
  const f = new File([content], name, { type: 'text/csv' });
  if (typeof (f as any).text !== 'function') (f as any).text = async () => content;
  return f;
};
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const choose = (f: File) => fireEvent.change(fileInput(), { target: { files: [f] } });
const uploadDlg = () => screen.getByRole('heading', { name: 'Upload PM Schedule' }).closest('.max-w-2xl') as HTMLElement;
const OK_UPLOAD = (plannedDates: string[], skipped: any[] = []) => ({
  method: 'POST', path: '/api/pm-schedules/upload',
  body: {
    imported: plannedDates.length, skipped: skipped.length,
    details: { imported: plannedDates.map((d, i) => ({ row: i + 2, ahuName: 'AHU-01', plannedDate: d, scheduleId: 's1', entryId: `n${i}` })), skipped },
  },
});

describe('PM list — Upload', () => {
  it('a CSV with future dates uploads straight away; the result lists errors; the range widens to show it', async () => {
    const api = open(EDITOR, {
      entries: [entry('e1')],
      extra: [OK_UPLOAD([`${Y - 1}-06-01`, `${Y + 1}-02-10`], [{ row: 4, reason: 'Unknown AHU: AHU-99' }])],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    expect(uploadDlg()).toHaveTextContent('CSV or XLSX • max 5 MB • entries go to review by MANAGER, then approval by QA');
    expect(uploadDlg()).toHaveTextContent('Accepts .csv, .xlsx');
    expect(fileInput()).toHaveAttribute('accept', '.csv,.xlsx');
    choose(csv('pm.csv', `# comment\nahu_name,scheduled_date\nAHU-01,${Y + 1}-02-10\n,\n`));
    expect(await within(uploadDlg()).findByText('Imported (pending review by MANAGER)')).toBeInTheDocument();
    expect(uploadDlg()).toHaveTextContent('Validation result — processed 3 rows');
    expect(uploadDlg()).toHaveTextContent('Row 4 — Unknown AHU: AHU-99');
    const [up] = api.calls('POST', '/api/pm-schedules/upload');
    expect(up.headers.authorization).toBe('Bearer test-token');
    expect(up.headers['x-reauth-password']).toBeUndefined();
    // The table now covers the uploaded span: last year through next year.
    await waitFor(() => expect(entryYears(api)).toEqual(expect.arrayContaining([String(Y - 1), String(Y), String(Y + 1)])));
    expect(screen.getByLabelText('PM schedule from date')).toHaveValue(`${Y - 1}-06-01`);
    expect(screen.getByLabelText('PM schedule to date')).toHaveValue(`${Y + 1}-02-10`);
    // Upload Another resets to the drop zone; Done closes.
    fireEvent.click(within(uploadDlg()).getByRole('button', { name: 'Upload Another' }));
    expect(within(uploadDlg()).getByText('Drag and drop or click to choose')).toBeInTheDocument();
    fireEvent.click(within(uploadDlg()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('heading', { name: 'Upload PM Schedule' })).toBeNull();
  });

  it('an upload resets a narrowed status tab to All so the new rows are visible', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], extra: [OK_UPLOAD([`${Y}-${MM}-12`])] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    fireEvent.click(screen.getByRole('button', { name: /^Rejected/ }));
    expect(await screen.findByText('No schedule entries found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload Schedule' }));
    choose(new File(['x'], 'pm.xlsx'));
    await within(uploadDlg()).findByText('Imported (pending review by MANAGER)');
    fireEvent.click(within(uploadDlg()).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('heading', { name: 'Upload PM Schedule' })).toBeNull();
    // Back on All: the approved row the Rejected tab hid is listed again.
    expect(await screen.findByText(shown(15))).toBeInTheDocument();
    expect(api.calls('POST', '/api/pm-schedules/upload')).toHaveLength(1);
  });

  it('past dates are listed for confirmation first: Cancel uploads nothing, Proceed Anyway uploads', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], extra: [OK_UPLOAD([])] });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    const content = 'ahu_name,scheduled_date\nAHU-01,2020-01-05\nAHU-02,05/01/2020\nAHU-03,someday\nAHU-04,2999-01-01\n';
    choose(csv('old.csv', content));
    const warn = (await screen.findByRole('heading', { name: 'Past Dates Detected' })).closest('.max-w-md') as HTMLElement;
    expect(within(warn).getByText('AHU-01').nextSibling).toHaveTextContent('2020-01-05');
    expect(within(warn).getByText('AHU-02').nextSibling).toHaveTextContent('05/01/2020');
    expect(within(warn).queryByText('AHU-03')).toBeNull();
    expect(within(warn).queryByText('AHU-04')).toBeNull();
    fireEvent.click(within(warn).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Past Dates Detected' })).toBeNull();
    expect(api.calls('POST', '/api/pm-schedules/upload')).toHaveLength(0);

    choose(csv('old.csv', content));
    fireEvent.click(await screen.findByRole('button', { name: 'Proceed Anyway' }));
    await within(uploadDlg()).findByText('Imported (pending review by MANAGER)');
    expect(uploadDlg()).toHaveTextContent('All rows passed validation — no errors.');
    expect(api.calls('POST', '/api/pm-schedules/upload')).toHaveLength(1);
  });

  it('past-date detection reads every header spelling the template has used', async () => {
    open(EDITOR, { entries: [entry('e1')] });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    for (const [head, row] of [
      ['ahuName,scheduledDate', 'AHU-A,2020-02-02'],
      ['AHU,date', 'AHU-B,2020/03/03'],
      ['AHU Name,Scheduled Date', 'AHU-C,04-04-2020'],
    ]) {
      choose(csv(`${head}.csv`, `${head}\n${row}\n`));
      const warn = (await screen.findByRole('heading', { name: 'Past Dates Detected' })).closest('.max-w-md') as HTMLElement;
      expect(warn).toHaveTextContent(row.split(',')[0]);
      expect(warn).toHaveTextContent(row.split(',')[1]);
      fireEvent.click(within(warn).getByRole('button', { name: 'Cancel' }));
    }
  });

  it('a CSV with only a header, or one that cannot be read, goes to the server unchecked', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], extra: [OK_UPLOAD([])] });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    choose(csv('h.csv', 'ahu_name,scheduled_date\n'));
    await within(uploadDlg()).findByText('Imported (pending review by MANAGER)');
    fireEvent.click(within(uploadDlg()).getByRole('button', { name: 'Upload Another' }));
    const broken = csv('b.csv', 'x');
    (broken as any).text = () => Promise.reject(new Error('unreadable'));
    choose(broken);
    await within(uploadDlg()).findByText('Imported (pending review by MANAGER)');
    expect(api.calls('POST', '/api/pm-schedules/upload')).toHaveLength(2);
  });

  it('.xls is refused with the server\'s instruction to save as .xlsx or .csv', async () => {
    open(EDITOR, {
      entries: [entry('e1')],
      extra: [{ method: 'POST', path: '/api/pm-schedules/upload', status: 400, body: { error: 'INVALID_FILE_TYPE', message: 'Old Excel .xls files cannot be read. Save the file as Excel Workbook (.xlsx) or as .csv and upload it again.' } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    // The picker filters .xls out, but drag-and-drop does not: the server is the guard.
    const zone = within(uploadDlg()).getByText('Drag and drop or click to choose').parentElement as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'legacy.xls')] } });
    expect(await within(uploadDlg()).findByText(/Old Excel \.xls files cannot be read/)).toBeInTheDocument();
    expect(within(uploadDlg()).queryByText('Imported (pending review by MANAGER)')).toBeNull();
  });

  it('a refusal without a message names the HTTP status', async () => {
    open(EDITOR, { entries: [entry('e1')], extra: [{ method: 'POST', path: '/api/pm-schedules/upload', status: 413, body: {} }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    choose(new File(['x'], 'big.xlsx'));
    expect(await within(uploadDlg()).findByText('Upload failed (HTTP 413)')).toBeInTheDocument();
  });

  it('drag over / leave / drop drive the drop zone; a drop with no file does nothing; a click opens the picker', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], extra: [OK_UPLOAD([])] });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    const zone = within(uploadDlg()).getByText('Drag and drop or click to choose').parentElement as HTMLElement;
    fireEvent.dragOver(zone);
    expect(within(zone).getByText('Drop the file here')).toBeInTheDocument();
    fireEvent.dragLeave(zone);
    expect(within(zone).getByText('Drag and drop or click to choose')).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(api.calls('POST', '/api/pm-schedules/upload')).toHaveLength(0);
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(zone);
    expect(pick).toHaveBeenCalled();
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'pm.xlsx')] } });
    await within(uploadDlg()).findByText('Imported (pending review by MANAGER)');
  });

  it('a Super Admin upload with the workflow off says the rows are approved directly; the upload is signed when its row is on', async () => {
    const api = open(SA, { wf: WF_OFF, entries: [entry('e1')], reauthActions: ['UPLOAD_PM_SCHEDULES'], extra: [OK_UPLOAD([])] });
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    expect(uploadDlg()).toHaveTextContent('entries you upload are approved directly');
    choose(new File(['x'], 'pm.xlsx'));
    await passReauth();
    await within(uploadDlg()).findByText('Imported (approved)');
    expect(api.calls('POST', '/api/pm-schedules/upload')[0].headers['x-reauth-password']).toBe('Secret@123');
  });

  it('cancelling the upload password prompt uploads nothing and leaves the drop zone usable', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], reauthActions: ['UPLOAD_PM_SCHEDULES'] });
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    choose(new File(['x'], 'pm.xlsx'));
    await screen.findByPlaceholderText('Enter your password');
    const box = screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement;
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    // A dismissed prompt is not an error: the drop zone comes back with no message (D-OPS-8).
    expect(await within(uploadDlg()).findByText('Drag and drop or click to choose')).toBeInTheDocument();
    expect(within(uploadDlg()).queryByText(/Cancelled/)).toBeNull();
    expect(api.calls('POST', '/api/pm-schedules/upload')).toHaveLength(0);
  });

  it('a wrong upload password keeps the prompt open (F3 regression: the upload error carries .error)', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], reauthActions: ['UPLOAD_PM_SCHEDULES'], extra: [
      { method: 'POST', path: '/api/pm-schedules/upload', status: 401, times: 1, body: { error: 'REAUTH_FAILED', message: 'Incorrect password' } },
      OK_UPLOAD([]),
    ] });
    await reauthReady(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    choose(new File(['x'], 'pm.xlsx'));
    await passReauth('wrong');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(within(uploadDlg()).queryByText('Incorrect password')).toBeNull();
    await passReauth('Secret@123');
    await within(uploadDlg()).findByText('Imported (pending review by MANAGER)');
    const posts = api.calls('POST', '/api/pm-schedules/upload');
    expect(posts.map((p) => p.headers['x-reauth-password'])).toEqual(['wrong', 'Secret@123']);
    expect(posts[1].form?.get('file')).toBeInstanceOf(File);
  });

  it('a server that demands re-auth the config did not (stale) gets the prompt retroactively', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], extra: [
      { method: 'POST', path: '/api/pm-schedules/upload', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } },
      OK_UPLOAD([]),
    ] });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    choose(new File(['x'], 'pm.xlsx'));
    await passReauth();
    await within(uploadDlg()).findByText('Imported (pending review by MANAGER)');
    expect(api.calls('POST', '/api/pm-schedules/upload')[1].headers['x-reauth-password']).toBe('Secret@123');
  });

  it('a viewer gets neither Upload nor Template', async () => {
    open(VIEWER, { entries: [entry('e1')] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    expect(screen.queryByRole('button', { name: 'Upload Schedule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Template' })).toBeNull();
  });
});

// ─── Template ───────────────────────────────────────────────────────────────
describe('PM list — Template download', () => {
  it('downloads the CSV template with the session token', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], extra: [{ path: '/api/pm-schedules/template.csv', body: 'ahu_name,scheduled_date' }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Template' }));
    await waitFor(() => expect(anchorDownloads()).toContain('pm-schedule-template.csv'));
    expect(api.calls('GET', '/api/pm-schedules/template.csv')[0].headers.authorization).toBe('Bearer test-token');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('a failed template download is reported as an error, not left inside the upload dialog', async () => {
    open(EDITOR, { entries: [entry('e1')], extra: [{ path: '/api/pm-schedules/template.csv', status: 500, body: {} }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Template' }));
    await okDialog('Template download failed', 'HTTP 500');
    expect(within(uploadDlg()).queryByText(/Failed to download template/)).toBeNull();
  });
});

// ─── Export ─────────────────────────────────────────────────────────────────
const exportAs = async (fmt: 'PDF' | 'Excel') => {
  fireEvent.click(await screen.findByRole('button', { name: /^Export$/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Export as ${fmt}`) }));
};

describe('PM list — Export', () => {
  it('PDF: reads every entry of the year, logs the export, then saves a landscape table with the approval trail', async () => {
    const api = open(VIEWER, {
      entries: [
        entry('e1', { reviewedByName: 'mgr1', approvalRemarks: null, reviewRemarks: 'looked fine' }),
        entry('e2', { approvalStatus: 'WEIRD', month: undefined, plannedDate: day(12), toleranceDays: undefined, submittedByName: null, approvedByName: null, ahuName: null }),
      ],
    });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    await exportAs('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({ reportKey: 'pm-schedule', title: `PM Schedule ${Y}`, subtitle: 'Total: 2 entries', orientation: 'landscape' });
    const [table] = report.tables();
    expect(table.head).toEqual(['S.No', 'AHU', 'Month', 'Planned', 'Tol', 'Status', 'Uploaded By', 'Reviewed By', 'Approved By', 'Remarks']);
    const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][M - 1];
    expect(table.body[0]).toEqual(['1', 'AHU-01', monthAbbr, shown(15), '5', 'Approved', 'uploader', 'mgr1', 'qa9', 'looked fine']);
    // Missing fields render as dashes / raw values, never "undefined".
    expect(table.body[1]).toEqual(['2', '-', 'Jan', shown(12), '-', 'WEIRD', '-', '-', '-', '-']);
    const [log] = api.calls('POST', '/api/audit/report-export-log');
    expect(log.json).toMatchObject({ reportType: 'PM Schedule', format: 'PDF', recordCount: 2 });
    expect(report.save.mock.calls[0][0]).toMatch(new RegExp(`^pm-schedule-${Y}_.*\\.pdf$`));
  });

  it('PDF pages past the server page and spans every year of a cross-year range', async () => {
    const api = open(VIEWER, {
      entries: [entry('e1')],
      exportPages: (req: MockRequest) => (req.query.get('page') === '1'
        ? { data: [entry(`y${req.query.get('year')}`)], total: 2_000_000 }
        : { data: [], total: 2_000_000 }),
    });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    fireEvent.change(screen.getByLabelText('PM schedule from date'), { target: { value: `${Y - 1}-12-01` } });
    await exportAs('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    const reads = api.calls('GET', '/api/pm-schedules/entries').filter((r) => r.query.get('page')).map((r) => `${r.query.get('year')}:${r.query.get('page')}`);
    expect(reads).toEqual([`${Y - 1}:1`, `${Y - 1}:2`, `${Y}:1`, `${Y}:2`]);
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({ title: `PM Schedule ${Y - 1}-${Y}`, subtitle: 'Total: 2 entries' });
  });

  it('nothing to export / over the export limit / a failing build are each reported and nothing is saved', async () => {
    open(VIEWER, { entries: [entry('e1'), entry('e2', { plannedDate: day(12) })], exportLimit: { maxRecords: 1, message: 'Too many: {count} > {max}' }, exportPages: () => ({ data: [] }) });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    await exportAs('PDF');
    await okDialog('Nothing to export', `No PM schedule entries for ${Y}`);
    // Excel checks the loaded list against the limit before anything is fetched.
    await exportAs('Excel');
    await okDialog('Export too large', 'Too many: 2 > 1');
    expect(report.save).not.toHaveBeenCalled();
  });

  it('PDF over the export limit is refused after the read, before any report is built', async () => {
    open(VIEWER, { entries: [entry('e1'), entry('e2', { plannedDate: day(12) })], exportLimit: { maxRecords: 1, message: 'Too many: {count} > {max}' } });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    await exportAs('PDF');
    await okDialog('Export too large', 'Too many: 2 > 1');
    expect(createReport).not.toHaveBeenCalled();
  });

  it('a PDF build failure says "Export failed"', async () => {
    open(VIEWER, { entries: [entry('e1')] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    vi.mocked(createReport).mockRejectedValueOnce(new Error('font missing'));
    await exportAs('PDF');
    await okDialog('Export failed', 'font missing');
  });

  it('with the export row on, cancelling the prompt exports nothing and shows no error', async () => {
    const api = open(VIEWER, { entries: [entry('e1')], reauthActions: ['EXPORT_PM_SCHEDULE'] });
    await reauthReady(api);
    await screen.findAllByRole('link', { name: 'AHU-01' });
    await exportAs('PDF');
    await screen.findByPlaceholderText('Enter your password');
    const box = screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement;
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(report.save).not.toHaveBeenCalled();
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Export failed' })).toBeNull();
    // Same for Excel: no workbook is fetched.
    await exportAs('Excel');
    await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(within(screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(api.calls('GET', '/api/pm-schedules/entries/export.xlsx')).toHaveLength(0);
  });

  it('Excel: one signed password covers the log and the workbook GET; one file per year', async () => {
    const api = open(VIEWER, {
      entries: [entry('e1')], reauthActions: ['EXPORT_PM_SCHEDULE'],
      extra: [{ path: '/api/pm-schedules/entries/export.xlsx', body: { xlsx: true } }],
    });
    await reauthReady(api);
    await screen.findAllByRole('link', { name: 'AHU-01' });
    fireEvent.change(screen.getByLabelText('PM schedule from date'), { target: { value: `${Y - 1}-12-01` } });
    await exportAs('Excel');
    await passReauth();
    await waitFor(() => expect(anchorDownloads()).toEqual(expect.arrayContaining([`pm-schedule-${Y - 1}.xlsx`, `pm-schedule-${Y}.xlsx`])));
    const gets = api.calls('GET', '/api/pm-schedules/entries/export.xlsx');
    expect(gets.map((g) => g.query.get('year'))).toEqual([String(Y - 1), String(Y)]);
    for (const g of gets) {
      expect(g.headers['x-reauth-password']).toBe('Secret@123');
      expect(g.headers.authorization).toBe('Bearer test-token');
    }
    const [log] = api.calls('POST', '/api/audit/report-export-log');
    expectSigned(log);
    expect(log.json).toMatchObject({ reportType: 'PM Schedule', format: 'Excel' });
  });

  it('an Excel download the server refuses says "Export failed"', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(VIEWER, { entries: [entry('e1')], extra: [{ path: '/api/pm-schedules/entries/export.xlsx', status: 500, body: {} }] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    await exportAs('Excel');
    await okDialog('Export failed', 'HTTP 500');
    expect(anchorDownloads()).toHaveLength(0);
  });
});
