/**
 * SuperAdminRecordEditDialog + its helpers (coverage campaign 2026-10-21).
 *
 * The ONE Super Admin "Edit record" dialog behind six user-facing pages:
 * reason >= 5 chars, only CHANGED fields reach onSave, datetimes go out as
 * explicit-UTC ISO in the configured zone, and the save is re-auth gated
 * (SUPER_ADMIN_DATA_EDIT by default). Rendered through the page harness with
 * the real useReauth / useDatetimeFormat; only global `fetch` is stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useState, type ReactNode } from 'react';
import { swrConfig } from '@/lib/swr-config';
import { renderPage, mockApi } from '@/test-utils/page-harness';
import {
  SuperAdminRecordEditDialog, SuperAdminEditButton, PencilIcon, userOptions, useIsSuperAdmin, MIN_REASON_LEN,
  type EditFieldSpec, type SuperAdminRecordEditDialogProps,
} from '../super-admin-record-edit';

const DT = { dateFormat: 'DD/MM/YYYY', timeFormat: '24-hour', timezone: 'Asia/Kolkata' };

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

function setupApi(gated: string[] = []) {
  return mockApi([
    { path: '/api/config/datetime/current', body: DT },
    { path: '/api/config/action-reauth/my-actions', body: { actions: gated } },
  ]);
}
/** Wait until the zone config and the re-auth rows are in, so seeds and gating are final. */
async function settle(api: ReturnType<typeof mockApi>) {
  await waitFor(() => expect(api.calls('GET', '/api/config/datetime/current')).toHaveLength(1));
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions')).toHaveLength(1));
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

const FIELDS: EditFieldSpec[] = [
  { key: 'name', label: 'Name', type: 'text', required: true, suggestions: ['F-1', 'F-2'], help: 'As printed on the tag' },
  { key: 'qty', label: 'Quantity', type: 'number' },
  { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Anything else' },
  { key: 'at', label: 'Performed at', type: 'datetime' },
  { key: 'set', label: 'Filter set', type: 'select', options: [{ value: 'A', label: 'Set A' }, { value: 'B', label: 'Set B' }] },
  { key: 'active', label: 'Active', type: 'checkbox' },
  { key: 'locked', label: 'Locked field', type: 'text', disabled: true },
];
const INITIAL = { name: 'F-1', qty: 3, notes: null, at: '2026-09-05T08:00:00.000Z', set: 'A', active: true, locked: 'x' };

function open(over: Partial<SuperAdminRecordEditDialogProps> = {}, gated: string[] = []) {
  const api = setupApi(gated);
  const props: SuperAdminRecordEditDialogProps = {
    open: true, title: 'Edit retirement - F-1', fields: FIELDS, initial: INITIAL,
    onSave: vi.fn(async () => ({ id: 'r1' })), onSaved: vi.fn(), onClose: vi.fn(),
    ...over,
  };
  const view = renderPage(<SuperAdminRecordEditDialog {...props} />, { api, user: { role: 'SUPER_ADMIN' } });
  return { ...view, api, props };
}
const saveBtn = (label = 'Save changes') => screen.getByRole('button', { name: label });
const reason = () => screen.getByLabelText(/Reason for this change/);

describe('SuperAdminRecordEditDialog — rendering', () => {
  it('renders nothing when closed', async () => {
    const { container, api } = open({ open: false });
    await settle(api);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a named dialog with every field labelled and seeded (datetime in the configured zone)', async () => {
    const { api } = open();
    await settle(api);
    expect(screen.getByRole('dialog', { name: 'Edit retirement - F-1' })).toBeInTheDocument();
    expect(screen.getByText(/Super Admin edit - written to the database/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('F-1');
    expect(screen.getByText('As printed on the tag')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity')).toHaveValue(3);
    expect(screen.getByLabelText('Notes')).toHaveValue('');
    expect(screen.getByLabelText('Notes')).toHaveAttribute('placeholder', 'Anything else');
    expect(screen.getByLabelText('Performed at')).toHaveValue('2026-09-05T13:30'); // 08:00Z in IST
    expect(screen.getByLabelText('Filter set')).toHaveValue('A');
    expect(screen.getByLabelText('Active')).toBeChecked();
    expect(screen.getByLabelText('Locked field')).toBeDisabled();
    // Free-text suggestions ride on a datalist.
    const list = document.getElementById('sa-edit-list-name')!;
    expect([...list.querySelectorAll('option')].map((o) => o.value)).toEqual(['F-1', 'F-2']);
    // The text input with no suggestions has no list attribute.
    expect(screen.getByLabelText('Locked field')).not.toHaveAttribute('list');
    expect(screen.queryByText(/permanently breaks the audit hash chain/)).toBeNull();
  });

  it('shows the hash-chain warning and a custom subtitle when asked', async () => {
    const { api } = open({ chainWarning: true, subtitle: 'Edit the audit row' });
    await settle(api);
    expect(screen.getByText(/permanently breaks the audit hash chain/)).toBeInTheDocument();
    expect(screen.getByText('Edit the audit row')).toBeInTheDocument();
  });

  it('select: offers a blank option only when asked or when the value is not in the list', async () => {
    const { api } = open({
      fields: [
        { key: 'a', label: 'With blank', type: 'select', emptyOption: '(none)', options: [{ value: 'x', label: 'X' }] },
        { key: 'b', label: 'Known value', type: 'select', options: [{ value: 'x', label: 'X' }] },
        { key: 'c', label: 'Unknown value', type: 'select', options: [{ value: 'x', label: 'X' }] },
        { key: 'd', label: 'No options', type: 'select' },
      ],
      initial: { a: 'x', b: 'x', c: 'legacy', d: undefined },
    });
    await settle(api);
    const opts = (label: string) => [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opts('With blank')).toEqual(['(none)', 'X']);
    expect(opts('Known value')).toEqual(['X']);
    expect(opts('Unknown value')).toEqual(['-- select --', 'X']);
    expect(opts('No options')).toEqual(['-- select --']);
  });

  it('cascades: function options read the current values and showWhen hides a field until its parent is set', async () => {
    const fields: EditFieldSpec[] = [
      { key: 'block', label: 'Block', type: 'select', emptyOption: '--', options: [{ value: 'B1', label: 'Block 1' }] },
      { key: 'area', label: 'Area', type: 'select', showWhen: (v) => !!v.block, options: (v) => (v.block === 'B1' ? [{ value: 'A1', label: 'Area 1' }] : []) },
    ];
    const { api } = open({ fields, initial: { block: '', area: '' } });
    await settle(api);
    expect(screen.queryByLabelText('Area')).toBeNull();
    fireEvent.change(screen.getByLabelText('Block'), { target: { value: 'B1' } });
    expect([...(screen.getByLabelText('Area') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'A1']);
  });
});

describe('SuperAdminRecordEditDialog — saving', () => {
  it('Save stays disabled, explaining why, until something changed, required fields are filled and a reason is given', async () => {
    const { api } = open();
    await settle(api);
    expect(saveBtn()).toBeDisabled();
    expect(saveBtn()).toHaveAttribute('title', 'Nothing changed yet');
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: '' } });
    expect(saveBtn()).toHaveAttribute('title', 'Required: Name');
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'F-9' } });
    expect(saveBtn()).toHaveAttribute('title', 'Enter a reason');
    fireEvent.change(reason(), { target: { value: ' abc ' } }); // < MIN_REASON_LEN once trimmed
    expect(saveBtn()).toBeDisabled();
    fireEvent.change(reason(), { target: { value: 'Typo on tag' } });
    expect(saveBtn()).toBeEnabled();
    expect(saveBtn()).not.toHaveAttribute('title');
    expect(MIN_REASON_LEN).toBe(5);
  });

  it('sends ONLY the changed fields, converted (number, IST wall clock → UTC ISO, checkbox), with the trimmed reason', async () => {
    const onSave = vi.fn(async () => ({ id: 'r1', ok: true }));
    const { api, props } = open({ onSave });
    await settle(api);
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Performed at'), { target: { value: '2026-09-05T14:00' } });
    fireEvent.click(screen.getByLabelText('Active'));
    fireEvent.change(screen.getByLabelText('Filter set'), { target: { value: 'B' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'swapped' } });
    fireEvent.change(reason(), { target: { value: '  Corrected per logbook  ' } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      { qty: 7, at: '2026-09-05T08:30:00.000Z', active: false, set: 'B', notes: 'swapped' },
      'Corrected per logbook',
      undefined,
    );
    expect(props.onSaved).toHaveBeenCalledWith({ id: 'r1', ok: true });
  });

  it('a cleared number and a cleared datetime are sent as "" (the endpoint decides what blank means)', async () => {
    const onSave = vi.fn(async (_changed: Record<string, any>, _reason: string, _pw?: string) => ({}));
    const { api } = open({ onSave });
    await settle(api);
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Performed at'), { target: { value: '' } });
    fireEvent.change(reason(), { target: { value: 'clear both' } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual({ qty: '', at: '' });
  });

  it('a hidden (showWhen=false) field is never sent even if it differs from the seed', async () => {
    const onSave = vi.fn(async (_changed: Record<string, any>, _reason: string, _pw?: string) => ({}));
    const fields: EditFieldSpec[] = [
      { key: 'kind', label: 'Kind', type: 'select', options: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }] },
      { key: 'extra', label: 'Extra', type: 'text', showWhen: (v) => v.kind === 'A' },
    ];
    const { api } = open({ onSave, fields, initial: { kind: 'A', extra: 'keep' } });
    await settle(api);
    fireEvent.change(screen.getByLabelText('Extra'), { target: { value: 'edited' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'B' } });
    fireEvent.change(reason(), { target: { value: 'switch kind' } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual({ kind: 'B' });
  });

  it('onChange lets the page adjust dependent values (e.g. clear a child when the parent changes)', async () => {
    const onSave = vi.fn(async (_changed: Record<string, any>, _reason: string, _pw?: string) => ({}));
    const onChange = vi.fn((key: string, _v: unknown, next: Record<string, any>) => (key === 'name' ? { ...next, notes: 'auto' } : undefined));
    const { api } = open({ onSave, onChange });
    await settle(api);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'F-2' } });
    expect(screen.getByLabelText('Notes')).toHaveValue('auto');
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '4' } }); // onChange returns undefined → plain next
    expect(screen.getByLabelText('Quantity')).toHaveValue(4);
    fireEvent.change(reason(), { target: { value: 'renamed' } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual({ name: 'F-2', qty: 4, notes: 'auto' });
  });

  it('shows the server refusal in the dialog and lets the operator try again', async () => {
    const onSave = vi.fn(async () => { throw Object.assign(new Error('Name already in use'), { status: 409 }); });
    const { api, props } = open({ onSave, saveLabel: 'Save retirement' });
    await settle(api);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'F-2' } });
    fireEvent.change(reason(), { target: { value: 'rename it' } });
    fireEvent.click(saveBtn('Save retirement'));
    expect(await screen.findByText('Name already in use')).toBeInTheDocument();
    expect(saveBtn('Save retirement')).toBeEnabled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('a failure without a message reads "Save failed"', async () => {
    const onSave = vi.fn(async () => { throw {}; });
    const { api } = open({ onSave });
    await settle(api);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'F-2' } });
    fireEvent.change(reason(), { target: { value: 'rename it' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText('Save failed')).toBeInTheDocument();
  });

  it('shows "Saving..." and locks the form while the save is in flight', async () => {
    let release!: () => void;
    const onSave = vi.fn(() => new Promise((r) => { release = () => r({}); }));
    const { api, props } = open({ onSave });
    await settle(api);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'F-2' } });
    fireEvent.change(reason(), { target: { value: 'rename it' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByLabelText(/^Name/)).toBeDisabled();
    expect(reason()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  });

  it('Close (×) and Cancel both close without saving', async () => {
    const { api, props } = open();
    await settle(api);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('re-opening resets edits, the reason and any error to the record\'s values', async () => {
    const api = setupApi();
    const onSave = vi.fn(async () => { throw new Error('refused'); });
    function Host() {
      const [isOpen, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen((o) => !o)}>toggle</button>
          <SuperAdminRecordEditDialog open={isOpen} title="T" fields={FIELDS} initial={INITIAL} onSave={onSave} onClose={() => setOpen(false)} />
        </>
      );
    }
    renderPage(<Host />, { api });
    await settle(api);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'changed' } });
    fireEvent.change(reason(), { target: { value: 'half-typed' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText('refused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByLabelText(/^Name/)).toHaveValue('F-1');
    expect(reason()).toHaveValue('');
    expect(screen.queryByText('refused')).toBeNull();
  });
});

describe('SuperAdminRecordEditDialog — re-auth', () => {
  it('when SUPER_ADMIN_DATA_EDIT is on, prompts (labelled with the dialog title) and passes the password to onSave', async () => {
    const onSave = vi.fn(async () => ({ ok: 1 }));
    const { api, props } = open({ onSave }, ['SUPER_ADMIN_DATA_EDIT']);
    await settle(api);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'F-2' } });
    fireEvent.change(reason(), { target: { value: 'rename it' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/Performing "Edit retirement - F-1" requires identity verification/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ name: 'F-2' }, 'rename it', 'pw');
  });

  it('uses the page\'s own re-auth row when given (audit row edit = UPDATE_AUDIT_RECORD)', async () => {
    const onSave = vi.fn(async (_changed: Record<string, any>, _reason: string, _pw?: string) => ({}));
    const { api } = open({ onSave, reauthAction: 'UPDATE_AUDIT_RECORD' }, ['UPDATE_AUDIT_RECORD']);
    await settle(api);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'F-2' } });
    fireEvent.change(reason(), { target: { value: 'rename it' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/requires identity verification/)).toBeInTheDocument();
  });

  it('cancelling the password prompt returns to the editable form with no error', async () => {
    const onSave = vi.fn(async (_changed: Record<string, any>, _reason: string, _pw?: string) => ({}));
    const { api, props } = open({ onSave }, ['SUPER_ADMIN_DATA_EDIT']);
    await settle(api);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'F-2' } });
    fireEvent.change(reason(), { target: { value: 'rename it' } });
    fireEvent.click(saveBtn());
    await screen.findByText(/requires identity verification/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!);
    await waitFor(() => expect(saveBtn()).toBeEnabled());
    expect(screen.queryByText(/requires identity verification/)).toBeNull();
    expect(screen.queryByText('Save failed')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('SuperAdminEditButton is a labelled button that forwards the click', () => {
    const onClick = vi.fn();
    renderPage(<><SuperAdminEditButton onClick={onClick} /><SuperAdminEditButton onClick={onClick} title="Edit replacement" className="ml-2" /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit record (Super Admin)' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Edit replacement' })).toHaveClass('ml-2');
  });

  it('PencilIcon is decorative and takes a size class', () => {
    const { container } = renderPage(<><PencilIcon /><PencilIcon className="w-3 h-3" /></>);
    const svgs = container.querySelectorAll('svg');
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true');
    expect(svgs[0].getAttribute('class')).toBe('w-4 h-4');
    expect(svgs[1].getAttribute('class')).toBe('w-3 h-3');
  });

  it('userOptions labels "Full name (username)", falls back to the username, keys by id or username', () => {
    const users = [{ id: 1, username: 'jdoe', fullName: 'Jane Doe' }, { id: 'u2', username: 'op2' }];
    expect(userOptions(users)).toEqual([{ value: '1', label: 'Jane Doe (jdoe)' }, { value: 'u2', label: 'op2 (op2)' }]);
    expect(userOptions(users, 'username').map((o) => o.value)).toEqual(['jdoe', 'op2']);
    expect(userOptions(undefined as unknown as any[])).toEqual([]);
  });
});

describe('useIsSuperAdmin', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ ...swrConfig, provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
  );

  it('signed out: never asks the server who the user is', () => {
    // NOTE (defect L2 in the coverage report): with a stale cached SUPER_ADMIN
    // this hook still answers true while signed out — SWR hands back
    // `fallbackData` even for a null key. Not asserted here; tracked as a finding.
    const api = mockApi([]);
    const { result } = renderHook(() => useIsSuperAdmin(), { wrapper });
    expect(result.current).toBe(false); // no cache at all → false
    expect(api.requests).toHaveLength(0);
  });

  it('uses the cached user on first paint, then the server\'s answer', async () => {
    sessionStorage.setItem('access_token', 't');
    localStorage.setItem('digilog_cached_user', JSON.stringify({ role: 'SUPER_ADMIN' }));
    mockApi([{ path: '/api/auth/me', body: { role: 'ADMIN' } }]);
    const { result } = renderHook(() => useIsSuperAdmin(), { wrapper });
    expect(result.current).toBe(true);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('survives an unreadable cached user', async () => {
    sessionStorage.setItem('access_token', 't');
    localStorage.setItem('digilog_cached_user', '{not json');
    mockApi([{ path: '/api/auth/me', body: { role: 'SUPER_ADMIN' } }]);
    const { result } = renderHook(() => useIsSuperAdmin(), { wrapper });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });
});
