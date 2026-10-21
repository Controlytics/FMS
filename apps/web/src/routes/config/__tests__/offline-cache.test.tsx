import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockApi } from '@/test-utils/page-harness';
import { OfflineCacheConfigPage } from '../offline-cache';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(resetEnv);

const PATH = '/api/config/offline-cache';
const W = { timeout: 5000 };

function setup(opts: { data?: unknown; extra?: MockRoute[]; reauth?: string[]; user?: any } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.data ?? { cacheStalenessHours: 24, cacheHardCutoffHours: 48 } },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<OfflineCacheConfigPage />, { user: opts.user ?? SUPER_ADMIN, api, route: '/config/offline-cache' });
  return api;
}

async function catalogLoaded(api: MockApi) {
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const inputs = () => screen.getAllByRole('spinbutton') as HTMLInputElement[];
const staleness = () => inputs()[0];
const cutoff = () => inputs()[1];
const saveBtn = () => screen.getByRole('button', { name: /^Save$|Saving/ });
async function loaded() {
  await waitFor(() => expect(staleness().value).toBe('24'), W);
  expect(cutoff().value).toBe('48');
}
async function submit() {
  await act(async () => { fireEvent.click(saveBtn()); });
}

describe('Offline cache settings page', () => {
  it('a non-SUPER_ADMIN gets a refusal panel, not the form', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] } });
    expect(await screen.findByRole('heading', { name: 'SUPER_ADMIN only' }, W)).toBeInTheDocument();
    expect(screen.getByText('Offline cache settings can only be changed by the system owner.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Back to Configuration' })).toHaveAttribute('href', '/config');
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('loads both values for SUPER_ADMIN; Save is disabled and no Discard is offered until an edit', async () => {
    const api = setup();
    expect(screen.getByRole('heading', { name: 'Offline Cache & Lockout' })).toBeInTheDocument();
    await loaded();
    expect(screen.getByText(/Current: 24h\./)).toBeInTheDocument();
    expect(screen.getByText(/Current: 48h\./)).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
    expect(screen.getByRole('link', { name: '← Configuration' })).toHaveAttribute('href', '/config');
    expect(api.unmatched).toEqual([]);
  });

  it('an edit enables Save and Discard; Discard restores the loaded values', async () => {
    setup();
    await loaded();
    fireEvent.change(staleness(), { target: { value: '12' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    expect(screen.getByText(/Current: 12h\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(staleness().value).toBe('24'));
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('values outside 0.01..168 are blocked by the inputs\' own min/max, nothing is sent', async () => {
    const api = setup();
    await loaded();
    fireEvent.change(staleness(), { target: { value: '0' } });
    fireEvent.change(cutoff(), { target: { value: '500' } });
    expect(staleness().validity.rangeUnderflow).toBe(true);
    expect(cutoff().validity.rangeOverflow).toBe(true);
    await submit();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    expect(screen.queryByText('Offline cache settings updated.')).toBeNull();
  });

  it('blank values pass the browser check but are refused by the form schema with a message each', async () => {
    const api = setup();
    await loaded();
    fireEvent.change(staleness(), { target: { value: '' } });
    fireEvent.change(cutoff(), { target: { value: '' } });
    await submit();
    await waitFor(() => expect(document.querySelectorAll('span.text-red-600')).toHaveLength(2), W);
    for (const s of Array.from(document.querySelectorAll('span.text-red-600'))) expect(s.textContent).not.toBe('');
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('Save PUTs the numbers, confirms, and leaves the form clean', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(cutoff(), { target: { value: '72.5' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await submit();
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), W);
    expect(api.calls('PUT', PATH)[0].json).toEqual({ cacheStalenessHours: 24, cacheHardCutoffHours: 72.5 });
    expect(await screen.findByText('Offline cache settings updated.', undefined, W)).toBeInTheDocument();
    await waitFor(() => expect(saveBtn()).toBeDisabled());
    expect(cutoff().value).toBe('72.5');
  });

  it('a refused save shows the server message', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 403, body: { error: 'FORBIDDEN', message: 'Only the system owner may change this' } }] });
    await loaded();
    fireEvent.change(cutoff(), { target: { value: '30' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await submit();
    expect(await screen.findByText('Only the system owner may change this', undefined, W)).toBeInTheDocument();
    expect(screen.queryByText('Offline cache settings updated.')).toBeNull();
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(staleness(), { target: { value: '6' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await submit();
    await signReauth('pw-oc');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2), W);
    const retry = api.calls('PUT', PATH)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-oc');
    expect(retry.json).toEqual({ cacheStalenessHours: 6, cacheHardCutoffHours: 48, _currentPassword: 'pw-oc' });
    expect(await screen.findByText('Offline cache settings updated.', undefined, W)).toBeInTheDocument();
  });

  it('signature required up front names UPDATE_OFFLINE_CACHE_CONFIG; cancel sends nothing', async () => {
    const api = setup({ reauth: ['UPDATE_OFFLINE_CACHE_CONFIG'] });
    await loaded();
    await catalogLoaded(api);
    fireEvent.change(staleness(), { target: { value: '6' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await submit();
    expect(await screen.findByText(/Performing "Update Offline Cache Config" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    expect(screen.queryByText('Offline cache settings updated.')).toBeNull();
    // The edit is kept, so it can be saved again.
    expect(staleness().value).toBe('6');
    expect(saveBtn()).not.toBeDisabled();
  });
});
