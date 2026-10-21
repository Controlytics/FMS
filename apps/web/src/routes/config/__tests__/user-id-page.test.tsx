import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { UserIdConfigPage } from '../user-id';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

afterEach(resetEnv);

const PATH = '/api/config/user-id';
const NEXT = '/api/config/user-id/next';
const VALIDATE = '/api/config/user-id/validate';
const SAVED = {
  format: 'PREFIX_NUMBERS', length: 7, prefix: 'EMP', prefixSeparator: '-', letterCase: 'UPPERCASE',
  autoGenerate: true, startNumber: 1, customPattern: '', customPatternExample: '', customPatternDescription: '',
};

function setup(opts: { user?: any; extra?: MockRoute[]; data?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.data ?? SAVED },
    { path: NEXT, body: { autoGenerate: true, nextId: 'EMP-001' } },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<UserIdConfigPage />, { user: opts.user ?? SUPER_ADMIN, api, route: '/config/user-id' });
  return api;
}

const control = (label: string) => (screen.getByText(label).parentElement as HTMLElement).querySelector('select, input') as HTMLInputElement & HTMLSelectElement;
const preview = () => (screen.getByText('Example User ID based on current settings').previousElementSibling as HTMLElement).textContent;
const saveBtn = () => screen.getByRole('button', { name: /Save Configuration|Saving/ });
const autoGen = () => (screen.getByText('Enable auto-generation of User IDs').closest('label') as HTMLElement).querySelector('input') as HTMLInputElement;
const loaded = () => waitFor(() => expect(control('Format Type').value).toBe('PREFIX_NUMBERS'));

describe('User ID configuration page', () => {
  it('loads the stored format, previews it and shows the next auto-generated ID', async () => {
    const api = setup();
    await loaded();
    expect(control('Prefix').value).toBe('EMP');
    expect(control('Separator').value).toBe('-');
    expect(preview()).toBe('EMP-000');
    expect(screen.getByText('Prefix:').nextElementSibling).toHaveTextContent('EMP-');
    expect(await screen.findByText('EMP-001')).toBeInTheDocument();
    expect(control('Start Number').value).toBe('1');
    expect(saveBtn()).toBeDisabled();
    expect(screen.queryByText('Only Super Admin can modify User ID configuration')).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('does not ask for the next ID when auto-generation is off', async () => {
    const api = setup({ data: { ...SAVED, autoGenerate: false } });
    await loaded();
    expect(api.calls('GET', NEXT)).toHaveLength(0);
    expect(screen.queryByText('Start Number')).toBeNull();
    fireEvent.click(autoGen());
    expect(screen.getByText('Start Number')).toBeInTheDocument();
    fireEvent.change(control('Start Number'), { target: { value: '500' } });
    expect(control('Start Number').value).toBe('500');
    fireEvent.change(control('Start Number'), { target: { value: '' } });
    expect(control('Start Number').value).toBe('1');
  });

  it('the preview follows every format, prefix, separator, length and case', async () => {
    setup();
    await loaded();
    const fmt = control('Format Type');
    fireEvent.change(control('Prefix'), { target: { value: 'usr' } });
    expect(control('Prefix').value).toBe('USR'); // upper-cased as typed
    fireEvent.change(control('Separator'), { target: { value: '_' } });
    expect(preview()).toBe('USR_000');
    fireEvent.change(control('Separator'), { target: { value: '' } });
    expect(preview()).toBe('USR0000');
    fireEvent.change(fmt, { target: { value: 'PREFIX_LETTERS' } });
    expect(preview()).toBe('USRAAAA');
    fireEvent.change(control('Fixed Length'), { target: { value: '8' } });
    fireEvent.change(control('Separator'), { target: { value: '/' } });
    fireEvent.change(fmt, { target: { value: 'PREFIX_LETTERS_NUMBERS' } });
    expect(preview()).toBe('USR/AA11');
    fireEvent.change(control('Letter Case'), { target: { value: 'LOWERCASE' } });
    expect(preview()).toBe('usr/aa11');
    // Leaving the PREFIX_ family resets prefix + separator.
    fireEvent.change(fmt, { target: { value: 'NUMBERS_ONLY' } });
    expect(screen.queryByText('Separator')).toBeNull();
    expect(preview()).toBe('11111111');
    fireEvent.change(fmt, { target: { value: 'LETTERS_ONLY' } });
    expect(preview()).toBe('aaaaaaaa');
    fireEvent.change(fmt, { target: { value: 'LETTERS_NUMBERS' } });
    fireEvent.change(control('Letter Case'), { target: { value: 'UPPERCASE' } });
    expect(preview()).toBe('AAAA1111');
    expect(screen.getByText('Alphanumeric characters')).toBeInTheDocument();
    // Non-numeric length falls back to 6.
    fireEvent.change(control('Fixed Length'), { target: { value: '' } });
    expect(preview()).toBe('AAA111');
    expect(screen.getByText('User ID must be exactly 6 characters (including prefix if any)')).toBeInTheDocument();
  });

  it('a prefix longer than the length still previews at the fixed length', async () => {
    setup({ data: { ...SAVED, length: 3, prefix: 'LONGPFX' } });
    await waitFor(() => expect(control('Prefix').value).toBe('LONGPFX'));
    expect(preview()).toBe('LON');
  });

  it('a prefix format with no prefix previews digits only and hides the prefix row', async () => {
    setup({ data: { ...SAVED, prefix: '' } });
    await loaded();
    expect(preview()).toBe('0000000');
    expect(screen.queryByText('Prefix:')).toBeNull();
  });

  it('custom pattern shows its fields and previews the example (case applied, MIXED kept)', async () => {
    setup();
    await loaded();
    fireEvent.change(control('Format Type'), { target: { value: 'CUSTOM_PATTERN' } });
    expect(preview()).toBe('CUSTOM');
    fireEvent.change(control('Letter Case'), { target: { value: 'MIXED' } });
    expect(preview()).toBe('Custom');
    fireEvent.change(screen.getByPlaceholderText('e.g., [A-Z]{2}\\\\d{4}'), { target: { value: '^[A-Z]{2}\\d{4}$' } });
    fireEvent.change(screen.getByPlaceholderText('e.g., AB1234'), { target: { value: 'Ab1234' } });
    fireEvent.change(screen.getByPlaceholderText('e.g., 2 letters followed by 4 digits'), { target: { value: 'two letters + four digits' } });
    expect(preview()).toBe('Ab1234');
  });

  it('saves with PUT, blanking the prefix for a non-prefix format, and reports success', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(control('Format Type'), { target: { value: 'CUSTOM_PATTERN' } });
    fireEvent.change(screen.getByPlaceholderText('e.g., AB1234'), { target: { value: 'AB1234' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({
      ...SAVED, format: 'CUSTOM_PATTERN', prefix: '', prefixSeparator: '-', customPatternExample: 'AB1234',
    });
    expect(await screen.findByText('Configuration saved successfully!')).toBeInTheDocument();
    // Saved config is re-read.
    await waitFor(() => expect(api.calls('GET', PATH).length).toBeGreaterThan(1));
  });

  it('keeps the prefix when saving a prefix format; the notice clears after 4s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(control('Prefix'), { target: { value: 'QA' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json.prefix).toBe('QA');
    expect(await screen.findByText('Configuration saved successfully!')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(4100); });
    await waitFor(() => expect(screen.queryByText('Configuration saved successfully!')).toBeNull());
  });

  it('UPDATE_USERID_CONFIG signature: prompt first, then PUT with the password', async () => {
    const api = setup({ reauth: ['UPDATE_USERID_CONFIG'], extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(control('Fixed Length'), { target: { value: '9' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText(/Performing "Update User ID Config" requires identity verification/)).toBeInTheDocument();
    await signReauth('pw-uid');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    const put = api.calls('PUT', PATH)[0];
    expect(put.headers['x-reauth-password']).toBe('pw-uid');
    expect(put.json).toEqual({ ...SAVED, length: 9, _currentPassword: 'pw-uid' });
    expect(await screen.findByText('Configuration saved successfully!')).toBeInTheDocument();
  });

  it('cancelling a retroactive prompt leaves no message and keeps the edit savable', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH)] });
    await loaded();
    fireEvent.change(control('Fixed Length'), { target: { value: '9' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByText('Configuration saved successfully!')).toBeNull();
    expect(api.calls('PUT', PATH)).toHaveLength(1);
  });

  it('a refused save shows the error, which clears after 5s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: { error: 'VALIDATION_ERROR', message: 'length must be 3-20' } }] });
    await loaded();
    fireEvent.change(control('Fixed Length'), { target: { value: '25' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('length must be 3-20')).toBeInTheDocument();
    expect(err).toHaveBeenCalledWith('Failed to save:', expect.anything());
    await act(async () => { vi.advanceTimersByTime(5100); });
    await waitFor(() => expect(screen.queryByText('length must be 3-20')).toBeNull());
    err.mockRestore();
  });

  it('a refusal with an empty message falls back to a generic error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: { error: 'X', message: '' } }] });
    await loaded();
    fireEvent.change(control('Fixed Length'), { target: { value: '8' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('Failed to save configuration')).toBeInTheDocument();
    err.mockRestore();
  });

  it('Validate checks a typed ID against the server rules', async () => {
    const api = setup({
      extra: [
        { method: 'POST', path: VALIDATE, times: 1, body: { valid: true } },
        { method: 'POST', path: VALIDATE, times: 1, body: { valid: false, errors: ['Must start with EMP-', 'Must be 7 characters'] } },
        { method: 'POST', path: VALIDATE, times: 1, body: { valid: false } },
        { method: 'POST', path: VALIDATE, status: 500, body: { error: 'INTERNAL', message: 'boom' } },
      ],
    });
    await loaded();
    const input = screen.getByPlaceholderText('Enter User ID to test');
    const validate = () => screen.getByRole('button', { name: /Validate/ });
    expect(validate()).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(validate()).toBeDisabled();

    fireEvent.change(input, { target: { value: 'EMP-123' } });
    await act(async () => { fireEvent.click(validate()); });
    expect(await screen.findByText('Valid User ID')).toBeInTheDocument();
    expect(api.calls('POST', VALIDATE)[0].json).toEqual({ userId: 'EMP-123' });

    fireEvent.change(input, { target: { value: 'X1' } });
    expect(screen.queryByText('Valid User ID')).toBeNull(); // typing clears the old result
    await act(async () => { fireEvent.click(validate()); });
    expect(await screen.findByText('Invalid User ID')).toBeInTheDocument();
    expect(screen.getByText('Must start with EMP-')).toBeInTheDocument();
    expect(screen.getByText('Must be 7 characters')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'X2' } });
    await act(async () => { fireEvent.click(validate()); });
    expect(await screen.findByText('Invalid User ID')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();

    fireEvent.change(input, { target: { value: 'X3' } });
    await act(async () => { fireEvent.click(validate()); });
    expect(await screen.findByText('Validation failed')).toBeInTheDocument();
  });

  it('Cancel goes back in browser history', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(back).toHaveBeenCalled();
    back.mockRestore();
  });

  it('a role without CONFIG_UPDATE sees a read-only form with no Save', async () => {
    setup({ user: { role: 'QA', permissions: ['CONFIG_READ'] } });
    await loaded();
    expect(screen.getByText('Only Super Admin can modify User ID configuration')).toBeInTheDocument();
    expect(control('Format Type')).toBeDisabled();
    expect(control('Fixed Length')).toBeDisabled();
    expect(control('Prefix')).toBeDisabled();
    expect(control('Letter Case')).toBeDisabled();
    expect(autoGen()).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save Configuration/ })).toBeNull();
    // Testing an ID is still allowed.
    expect(screen.getByPlaceholderText('Enter User ID to test')).not.toBeDisabled();
  });

  it('CONFIG_UPDATE (without SUPER_ADMIN) unlocks editing', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] } });
    await loaded();
    expect(screen.queryByText('Only Super Admin can modify User ID configuration')).toBeNull();
    expect(control('Format Type')).not.toBeDisabled();
    expect(saveBtn()).toBeDisabled(); // nothing changed yet
  });
});
