/**
 * Bulk Upload on the Filters page. The upload + validate calls are multipart
 * (raw fetch with a FormData body), so the harness records them with
 * `json: undefined`; the FormData is read from the stubbed fetch's call list
 * (`rawCalls`) instead — a known harness gap for non-JSON bodies.
 */
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, role, passReauth } from './fm-test-kit';
import { setupApi, renderFilters, openBlock, openFiltersTab, rawCalls, card, waitForReauthConfig } from './filter-list-fixtures';

usePageTestLifecycle();

const UPLOADER = role('ADMIN', ['ASSET_READ', 'FILTER_BULK_UPLOAD']);
const XLSX = () => new File(['PK-fake-xlsx'], 'filters.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
const fileInput = () => document.getElementById('bulk-upload-file-input') as HTMLInputElement;
const pick = () => fireEvent.change(fileInput(), { target: { files: [XLSX()] } });
const formOf = (fragment: string, i = 0) => rawCalls(fragment)[i].init.body as FormData;

const VALIDATE_OK = {
  rows: [
    { name: 'PF-020', area: 'Area North', ahu: 'AHU-01', filterSet: 'A', micronSize: '10' },
    { name: 'PF-021', area: 'Area X', areaStatus: 'new', ahu: 'AHU-9', ahuStatus: 'new', filterSet: 'B', micronSize: '7' },
  ],
  results: [{ row: 3, status: 'error', error: 'Unknown micron size', column: 'micronSize', value: '7' }],
  newAreas: ['Area X'], newAhus: ['AHU-9'],
};

async function openUpload() {
  await openFiltersTab();
  fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
  return card('Bulk Upload Filters');
}

describe('Filters page — Bulk Upload', () => {
  it('block scope: lists area + ahu columns; validates the picked file and previews it with errors and new AHUs/areas', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: VALIDATE_OK }] });
    renderFilters(UPLOADER, api);
    const d = await openUpload();
    expect(d).toHaveTextContent('Into block Block Alpha');
    expect(d).toHaveTextContent('Any AHU or area that is not in block Block Alpha yet is created there.');
    expect(d).toHaveTextContent('Optional — an existing area');
    expect(d).toHaveTextContent('Process, Non Process'); // live dropdown values
    pick();
    expect(await within(d).findByText('This upload will also create:')).toBeInTheDocument();
    expect(d).toHaveTextContent('New areas (1): Area X');
    expect(d).toHaveTextContent('New AHUs (1): AHU-9');
    expect(within(d).getAllByText('new')).toHaveLength(2);
    expect(within(d).getByRole('button', { name: 'Upload 1 Filter' })).toBeEnabled();
    const fd = formOf('/bulk-upload-filters/validate');
    expect((fd.get('file') as File).name).toBe('filters.xlsx');
    expect(fd.get('blockId')).toBe('b1');
    expect(fd.get('ahuId')).toBeNull();
    expect(rawCalls('/bulk-upload-filters/validate')[0].init.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    // Change file → back to the picker
    fireEvent.click(within(d).getByRole('button', { name: 'Change file' }));
    expect(within(d).getByText('Click to select an .xlsx file')).toBeInTheDocument();
  });

  it('uploads: POST bulk-upload-filters (multipart) → results table with created / failed and created AHUs', async () => {
    const api = setupApi({ extra: [
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: { ...VALIDATE_OK, results: [] } },
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters', body: {
        created: 1, failed: 1, newAhus: ['AHU-9'], newAreas: [],
        results: [
          { row: 2, name: 'PF-020', status: 'success', id: 'abcdef1234567' },
          { row: 3, name: 'PF-021', status: 'error', error: 'Duplicate name', column: 'name', value: 'PF-021' },
        ],
      } },
    ] });
    renderFilters(UPLOADER, api);
    const d = await openUpload();
    pick();
    fireEvent.click(await within(d).findByRole('button', { name: 'Upload 2 Filters' }));
    expect(await within(d).findByText('Created', { selector: 'div' })).toBeInTheDocument();
    expect(d).toHaveTextContent('AHUs created (1): AHU-9');
    expect(d).toHaveTextContent('abcdef12');
    expect(d).toHaveTextContent('[name="PF-021"] Duplicate name');
    const fd = formOf('/bulk-upload-filters', 1);
    expect(rawCalls('/bulk-upload-filters')[1].url).toBe('/api/assets/instances/bulk-upload-filters');
    expect(fd.get('blockId')).toBe('b1');
    expect(rawCalls('/bulk-upload-filters')[1].init.headers).not.toHaveProperty('x-reauth-password');
    fireEvent.click(within(d).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('heading', { name: 'Bulk Upload Filters' })).toBeNull();
  });

  it('a refused upload (non re-auth) lands in the results panel; a REAUTH_REQUIRED re-prompts and resends signed', async () => {
    const api = setupApi({ extra: [
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: { ...VALIDATE_OK, results: [] } },
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } },
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters', status: 400, body: { error: 'TOO_MANY_ROWS', message: 'At most 200 rows per upload' } },
    ] });
    renderFilters(UPLOADER, api);
    const d = await openUpload();
    pick();
    fireEvent.click(await within(d).findByRole('button', { name: 'Upload 2 Filters' }));
    // first answer is REAUTH_REQUIRED → the preview stays behind the prompt
    await passReauth();
    expect(await within(d).findByText('At most 200 rows per upload')).toBeInTheDocument();
    expect(d).toHaveTextContent('Failed');
    const uploads = rawCalls('/bulk-upload-filters').filter((c) => !c.url.includes('/validate'));
    expect(uploads).toHaveLength(2);
    expect(uploads[1].init.headers).toMatchObject({ 'x-reauth-password': 'Secret@123' });
  });

  it('a network failure during upload is shown in the results panel', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: { ...VALIDATE_OK, results: [] } }] });
    renderFilters(UPLOADER, api);
    const d = await openUpload();
    pick();
    const btn = await within(d).findByRole('button', { name: 'Upload 2 Filters' });
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).endsWith('/bulk-upload-filters')) throw new TypeError('Failed to fetch');
      return orig(input, init);
    }) as any;
    fireEvent.click(btn);
    expect(await within(d).findByText('Failed to fetch')).toBeInTheDocument();
  });

  it('gated up front (BULK_UPLOAD_FILTERS): the first upload is already signed', async () => {
    const api = setupApi({
      base: { reauthActions: ['BULK_UPLOAD_FILTERS'] },
      extra: [
        { method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: { ...VALIDATE_OK, results: [] } },
        { method: 'POST', path: '/api/assets/instances/bulk-upload-filters', body: { created: 2, failed: 0, results: [] } },
      ],
    });
    renderFilters(UPLOADER, api);
    await waitForReauthConfig(api);
    const d = await openUpload();
    pick();
    fireEvent.click(await within(d).findByRole('button', { name: 'Upload 2 Filters' }));
    await passReauth();
    await waitFor(() => expect(d).toHaveTextContent('Created'));
    const upload = rawCalls('/bulk-upload-filters').find((c) => !c.url.includes('/validate'))!;
    expect(upload.init.headers).toMatchObject({ 'x-reauth-password': 'Secret@123' });
  });

  it('validation refusals: HTTP error text, server message, an empty sheet, a network error', async () => {
    const api = setupApi({ extra: [
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', status: 400, times: 1, body: { error: 'BAD_FILE', message: 'Not an .xlsx workbook' } },
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', status: 422, times: 1, body: {} },
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', times: 1, body: { rows: [], results: [{ row: 1, error: 'Header row missing "name"' }] } },
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', times: 1, body: { rows: [] } },
    ] });
    renderFilters(UPLOADER, api);
    const d = await openUpload();
    pick();
    expect(await within(d).findByText('Not an .xlsx workbook')).toBeInTheDocument();
    pick();
    expect(await within(d).findByText('Could not read file (HTTP 422)')).toBeInTheDocument();
    pick();
    expect(await within(d).findByText('Header row missing "name"')).toBeInTheDocument();
    pick();
    expect(await within(d).findByText('No data rows found in the file')).toBeInTheDocument();
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).includes('/validate')) throw new TypeError('Network down');
      return orig(input, init);
    }) as any;
    pick();
    expect(await within(d).findByText('Network down')).toBeInTheDocument();
    // a change event with no file does nothing
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(within(d).getByText('Network down')).toBeInTheDocument();
    fireEvent.click(within(d).getByRole('button', { name: 'Cancel' }));
  });

  it('template download: GET filter-upload-template.xlsx for the scope → a blob download', async () => {
    const api = setupApi({ extra: [{ path: '/api/assets/instances/filter-upload-template.xlsx', body: { fake: 'xlsx' } }] });
    renderFilters(UPLOADER, api);
    const d = await openUpload();
    fireEvent.click(within(d).getByRole('button', { name: 'Download Excel Template' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    const call = api.calls('GET', '/api/assets/instances/filter-upload-template.xlsx')[0];
    expect(call.query.get('blockId')).toBe('b1');
  });

  it('template download failures: 400 shows the server reason; 401 asks to log in; 500 shows the status; a throw shows its message', async () => {
    const api = setupApi({ extra: [
      { path: '/api/assets/instances/filter-upload-template.xlsx', status: 400, times: 1, body: { message: 'This block has no AHUs yet' } },
      { path: '/api/assets/instances/filter-upload-template.xlsx', status: 401, times: 1, body: { error: 'UNAUTHORIZED' } },
      { path: '/api/assets/instances/filter-upload-template.xlsx', status: 500, times: 1, body: { error: 'X' } },
    ] });
    renderFilters(UPLOADER, api);
    const d = await openUpload();
    const dl = () => fireEvent.click(within(d).getByRole('button', { name: 'Download Excel Template' }));
    dl();
    expect(await screen.findByText('This block has no AHUs yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    dl();
    expect(await screen.findByText('Session expired — please log in again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    dl();
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).includes('filter-upload-template')) throw new TypeError('Failed to fetch');
      return orig(input, init);
    }) as any;
    dl();
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
    expect(screen.getAllByText('Template download failed').length).toBeGreaterThanOrEqual(1);
  });

  it('AHU scope (from the diagram): the sheet has no area/ahu columns; FormData + template carry ahuId and blockId', async () => {
    const api = setupApi({ extra: [
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: { rows: [{ name: 'HF-030', filterSet: 'A' }], results: [] } },
      { path: '/api/assets/instances/filter-upload-template.xlsx', body: {} },
    ] });
    renderFilters(UPLOADER, api);
    await openBlock();
    fireEvent.click(screen.getByRole('button', { name: /AHU-02/ }));
    await screen.findByText('AHU: AHU-02');
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
    const d = card('Bulk Upload Filters');
    expect(d).toHaveTextContent('Into AHU AHU-02');
    expect(d).toHaveTextContent('Every filter in the file goes into AHU AHU-02.');
    expect(d).not.toHaveTextContent('Optional — an existing area');
    fireEvent.click(within(d).getByRole('button', { name: 'Download Excel Template' }));
    await waitFor(() => expect(api.calls('GET', '/api/assets/instances/filter-upload-template.xlsx')).toHaveLength(1));
    expect(api.calls('GET', '/api/assets/instances/filter-upload-template.xlsx')[0].query.get('ahuId')).toBe('h2');
    pick();
    expect(await within(d).findByText(/every filter goes into AHU/)).toBeInTheDocument();
    expect(within(d).queryByRole('columnheader', { name: 'ahu' })).toBeNull();
    const fd = formOf('/validate');
    expect(fd.get('ahuId')).toBe('h2');
    expect(fd.get('blockId')).toBe('b1');
  });

  it('Area scope: rows name their AHU; FormData carries areaId + blockId', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: { rows: [{ name: 'X' }], results: [] } }] });
    renderFilters(UPLOADER, api);
    await openBlock();
    fireEvent.click(screen.getByRole('button', { name: /Area North/ }));
    await screen.findByText('AREA: Area North');
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
    const d = card('Bulk Upload Filters');
    expect(d).toHaveTextContent('Into area Area North');
    expect(d).toHaveTextContent('An AHU that is not in area Area North yet is created there.');
    pick();
    await within(d).findByText('Change file');
    expect(formOf('/validate').get('areaId')).toBe('ar1');
    expect(formOf('/validate').get('blockId')).toBe('b1');
  });

  it('Bulk Upload is hidden without FILTER_BULK_UPLOAD', async () => {
    renderFilters(role('X', ['ASSET_READ']), setupApi());
    await openFiltersTab();
    expect(screen.queryByRole('button', { name: 'Bulk Upload' })).toBeNull();
  });
});
