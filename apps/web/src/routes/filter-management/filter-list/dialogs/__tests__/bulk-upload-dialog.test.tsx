import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { usePageTestLifecycle } from '../../../__tests__/fm-test-kit';
import { BulkUploadDialog, type BulkUploadScopeKind } from '../BulkUploadDialog';
import type { BulkUploadStep } from '../../types';

usePageTestLifecycle();

const OPTS = { ahuType: ['Supply', 'Return'], filterType: ['HEPA'], micronSize: ['0.3', '10'], filterSize: [] };
const EMPTY_OPTS = { ahuType: [], filterType: [], micronSize: [], filterSize: [] };

function renderDialog(over: Partial<React.ComponentProps<typeof BulkUploadDialog>> & { step: BulkUploadStep; scope?: BulkUploadScopeKind }) {
  const cb = { onFileSelect: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn(), onChangeFile: vi.fn(), onDownloadTemplate: vi.fn() };
  const view = render(<BulkUploadDialog scope="block" scopeName="Block A" file={null} rows={[]} error="" results={[]} created={0} failed={0}
    newAreas={[]} newAhus={[]} fieldOptions={OPTS} {...cb} {...over} />);
  return { ...view, cb };
}

/** The column-reference grid as [label, hint] pairs. */
function columnRef() {
  const grid = screen.getByText(/Excel Columns/).nextElementSibling as HTMLElement;
  const cells = Array.from(grid.children).map((c) => c.textContent);
  const out: [string, string][] = [];
  for (let i = 0; i < cells.length; i += 2) out.push([cells[i]!, cells[i + 1]!]);
  return out;
}

describe('BulkUploadDialog — select step', () => {
  it('block scope: explains area/AHU creation and lists every column with live dropdown values', () => {
    const { cb } = renderDialog({ step: 'select' });
    expect(screen.getByRole('heading', { name: 'Bulk Upload Filters' })).toBeInTheDocument();
    expect(screen.getByText('Into block Block A')).toBeInTheDocument();
    expect(screen.getByText(/Each row names its AHU, and optionally its area/)).toBeInTheDocument();
    expect(columnRef()).toEqual([
      ['name', 'Filter Name — required, must be unique'],
      ['area', 'Optional — an existing area, or a new name to create it in this block'],
      ['ahu', 'Required — an existing AHU, or a new name to create it in this block'],
      ['filterSet', 'A or B (required — set per row in the Excel column)'],
      ['ahuType', 'Supply, Return'],
      ['filterType', 'HEPA'],
      ['micronSize', '0.3, 10 (µm)'],
      ['filterSize', 'Free text — physical dimensions (e.g. 610×610×292mm)'],
      ['lastCleaningDate', 'YYYY-MM-DD or NA'],
    ]);
    expect(screen.getByText('Click to select an .xlsx file')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Download Excel Template/ }));
    expect(cb.onDownloadTemplate).toHaveBeenCalledTimes(1);
    // the upload area is a proxy for the hidden file input
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByText('Click to select an .xlsx file'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const input = document.getElementById('bulk-upload-file-input') as HTMLInputElement;
    expect(input).toHaveAttribute('accept', expect.stringContaining('.xlsx'));
    const file = new File(['x'], 'filters.xlsx');
    fireEvent.change(input, { target: { files: [file] } });
    expect(cb.onFileSelect).toHaveBeenCalledTimes(1);
    // no Upload button until a preview exists
    expect(screen.queryByRole('button', { name: /^Upload/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it('area scope: no area column; AHUs are created in the area', () => {
    renderDialog({ step: 'select', scope: 'area', scopeName: 'Area North', fieldOptions: EMPTY_OPTS });
    expect(screen.getByText('Into area Area North')).toBeInTheDocument();
    expect(screen.getByText(/An AHU that is not in area/)).toBeInTheDocument();
    const cols = columnRef();
    expect(cols.map(([k]) => k)).toEqual(['name', 'ahu', 'filterSet', 'ahuType', 'filterType', 'micronSize', 'filterSize', 'lastCleaningDate']);
    expect(cols[1][1]).toBe('Required — an existing AHU, or a new name to create it in this area');
    // no master data configured
    expect(cols[3][1]).toBe('—');
    expect(cols[5][1]).toBe('— (µm)');
  });

  it('AHU scope: no area / ahu columns; every row lands in the AHU; the chosen file and a parse error are shown', () => {
    renderDialog({ step: 'select', scope: 'ahu', scopeName: 'AHU-1', file: new File(['x'], 'ahu1.xlsx'), error: 'Only .xlsx files are accepted' });
    expect(screen.getByText('Into AHU AHU-1')).toBeInTheDocument();
    expect(screen.getByText(/Every filter in the file goes into AHU/)).toBeInTheDocument();
    expect(columnRef().map(([k]) => k)).toEqual(['name', 'filterSet', 'ahuType', 'filterType', 'micronSize', 'filterSize', 'lastCleaningDate']);
    expect(screen.getByText('ahu1.xlsx')).toBeInTheDocument();
    expect(screen.getByText('Only .xlsx files are accepted')).toBeInTheDocument();
  });
});

describe('BulkUploadDialog — preview step', () => {
  const ROWS = [
    { name: 'F-1', area: 'Area N', areaStatus: 'new', ahu: 'AHU-9', ahuStatus: 'new', filterSet: 'A', ahuType: 'Supply', filterType: 'HEPA', micronSize: '0.3', filterSize: '610', lastCleaningDate: 'NA' },
    { name: 'F-2', area: '', ahu: 'AHU-1', ahuStatus: 'existing', filterSet: 'Z' },
    { name: 'F-3', ahu: 'AHU-1', filterSet: 'B' },
  ];
  const ERRORS = [{ row: 3, status: 'error', error: 'filterSet must be A or B', column: 'filterSet', value: 'Z' }, { row: 2, status: 'ok' }];

  it('marks invalid rows, flags new areas/AHUs, counts only valid rows for upload', () => {
    const { cb } = renderDialog({ step: 'preview', rows: ROWS, results: ERRORS, newAreas: ['Area N'], newAhus: ['AHU-9'] });
    expect(screen.getByText((_, el) => el?.tagName === 'P' && /Review before import — the area \/ ahu columns show where each filter will land/.test(el.textContent ?? ''))).toBeInTheDocument();
    const creates = screen.getByText('This upload will also create:').parentElement!;
    expect(creates).toHaveTextContent('New areas (1): Area N');
    expect(creates).toHaveTextContent('New AHUs (1): AHU-9');
    expect(screen.getByText(/Validation result — processed 3 rows/)).toBeInTheDocument();
    expect(screen.getByText('Valid (will import)')).toBeInTheDocument();
    expect(screen.getByText(/Row 3/).parentElement).toHaveTextContent('Row 3 · column filterSet · value “Z” — filterSet must be A or B');

    const table = screen.getAllByRole('table')[0];
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
      ['S.No', 'name', 'area', 'ahu', 'filterSet', 'ahuType', 'filterType', 'micronSize', 'filterSize', 'lastCleaningDate']);
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows[0]).toHaveTextContent('Area Nnew');
    expect(within(bodyRows[0]).getAllByText('new')).toHaveLength(2);
    expect(bodyRows[1].className).toContain('bg-red-50'); // spreadsheet row 3 = preview row 2
    expect(within(bodyRows[1]).queryByText('new')).toBeNull();
    expect(within(bodyRows[1]).getAllByText('--').length).toBeGreaterThan(0);
    expect(bodyRows[2].className).not.toContain('bg-red-50');

    const upload = screen.getByRole('button', { name: /Upload 2 Filters/ });
    expect(upload).toBeEnabled();
    fireEvent.click(upload);
    expect(cb.onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Change file' }));
    expect(cb.onChangeFile).toHaveBeenCalledTimes(1);
  });

  it('AHU scope preview has no area/ahu columns; one valid row reads "Filter" (singular)', () => {
    renderDialog({ step: 'preview', scope: 'ahu', scopeName: 'AHU-1', rows: [ROWS[2]], results: [] });
    expect(screen.getByText(/every filter goes into AHU/)).toBeInTheDocument();
    expect(screen.queryByText('This upload will also create:')).toBeNull();
    const table = screen.getAllByRole('table')[0];
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).not.toContain('ahu');
    expect(screen.getByRole('button', { name: /Upload 1 Filter$/ })).toBeEnabled();
  });

  it('with every row invalid there is nothing to upload', () => {
    renderDialog({ step: 'preview', rows: [ROWS[1]], results: [{ row: 2, status: 'error', error: 'bad' }], newAhus: ['AHU-X'] });
    expect(screen.getByText('This upload will also create:').parentElement!).toHaveTextContent('New AHUs (1): AHU-X');
    expect(screen.queryByText(/New areas/)).toBeNull();
    expect(screen.getByRole('button', { name: /Upload 0 Filters/ })).toBeDisabled();
  });
});

describe('BulkUploadDialog — uploading + results', () => {
  it('uploading shows a progress line with the valid-row count', () => {
    renderDialog({ step: 'uploading', rows: [{ name: 'a' }, { name: 'b' }], results: [] });
    expect(screen.getByText('Creating 2 filter(s)...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull();
  });

  it('results: tiles, created areas/AHUs, and each row\'s outcome with column/value detail', () => {
    const { cb } = renderDialog({
      step: 'results', created: 2, failed: 3, newAreas: ['Area N'], newAhus: [],
      results: [
        { row: 2, name: 'F-1', status: 'success', id: 'abcdef1234567890' },
        { row: 3, name: 'F-2', status: 'error', error: 'Duplicate name', column: 'name', value: 'F-2' },
        { row: 4, name: 'F-3', status: 'error', error: 'Required', column: 'ahu' },
        { row: 5, name: 'F-4', status: 'error', error: 'Server error' },
        { row: 6, name: 'F-5', status: 'success' },
      ],
    });
    expect(screen.getByText('Created', { selector: 'div' }).previousElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Failed', { selector: 'div' }).previousElementSibling).toHaveTextContent('3');
    expect(screen.getByText(/Areas created/).parentElement).toHaveTextContent('Areas created (1): Area N');
    expect(screen.queryByText(/AHUs created/)).toBeNull();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('2F-1Createdabcdef12');
    expect(rows[1]).toHaveTextContent('[name="F-2"] Duplicate name');
    expect(rows[2]).toHaveTextContent('[ahu] Required');
    expect(rows[3]).toHaveTextContent('FailedServer error');
    expect(rows[4]).toHaveTextContent('6F-5Created');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it('results with nothing created shows only the failure tile; header X closes', () => {
    const { cb } = renderDialog({ step: 'results', created: 0, failed: 1, results: [{ row: 2, name: 'F', status: 'error', error: 'x' }] });
    expect(screen.queryByText('Created', { selector: 'div' })).toBeNull();
    expect(screen.getByText('Failed', { selector: 'div' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it('results with nothing failed shows only the created tile and no new-entity box', () => {
    renderDialog({ step: 'results', created: 1, failed: 0, results: [{ row: 2, name: 'F', status: 'success', id: 'id-1' }] });
    expect(screen.queryByText('Failed', { selector: 'div' })).toBeNull();
    expect(screen.queryByText(/created \(/)).toBeNull();
  });
});
