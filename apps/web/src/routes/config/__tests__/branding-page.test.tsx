import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { getThemeById } from '@/lib/themes';
import { BrandingConfigPage } from '../branding';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';
import { spyConsoleError, expectSilentCancel } from './reauth-cancel-assertions';

vi.setConfig({ testTimeout: 30000 });
afterEach(() => { resetEnv(); vi.restoreAllMocks(); });

const PATH = '/api/config/branding';
const WAIT = { timeout: 5000 };
const SAVED = {
  appName: 'FilterOps', appTagline: 'Cleanroom filters', logoText: 'FO', logoUrl: '',
  browserTitle: 'Plant FMS', faviconUrl: '', companyName: 'Acme Pharma', version: '2.1',
  primaryColor: '#0e7490', secondaryColor: '#0891b2', accentColor: '#22d3ee',
  gradientStart: '#0e7490', gradientMiddle: '#0891b2', gradientEnd: '#22d3ee',
  loginBgStart: '#0f172a', loginBgEnd: '#164e63', colorTheme: 'ocean',
};

function Probe() { return <p data-testid="loc">{useLocation().pathname}</p>; }

function setup(opts: { extra?: MockRoute[]; data?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.data === undefined ? SAVED : opts.data },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<><BrandingConfigPage /><Probe /></>, { user: SUPER_ADMIN, api, route: '/config/appearance' });
  return api;
}

/** The text input under a field label (colour fields also carry a type=color twin). */
const field = (label: string) => (screen.getByText(label, { selector: 'label' }).parentElement as HTMLElement)
  .querySelector('input:not([type="color"])') as HTMLInputElement;
const colorPicker = (label: string) => (screen.getByText(label, { selector: 'label' }).parentElement as HTMLElement)
  .querySelector('input[type="color"]') as HTMLInputElement;
const fieldError = (label: string) => (screen.getByText(label, { selector: 'label' }).parentElement as HTMLElement)
  .querySelector('p.text-red-500');
const appName = () => screen.getByPlaceholderText('DigiLog') as HTMLInputElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });
const loaded = () => waitFor(() => expect(appName().value).toBe('FilterOps'), WAIT);
const themeBtn = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const isSelected = (name: string) => themeBtn(name).className.includes('ring-2');
const logoInput = () => document.getElementById('logo-upload') as HTMLInputElement;
const faviconInput = () => document.getElementById('favicon-upload') as HTMLInputElement;
const tabPreviewTitle = () => (screen.getByText('Preview', { selector: 'p' }).nextElementSibling as HTMLElement).querySelector('span') as HTMLElement;
const tabIcon = () => screen.getByAltText('Tab icon preview') as HTMLImageElement;

function file(name: string, type: string, size?: number) {
  const f = new File(['\x89PNG-bytes'], name, { type });
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
  return f;
}
async function pick(input: HTMLInputElement, files: File[]) {
  await act(async () => { fireEvent.change(input, { target: { files } }); });
}
async function submit() {
  await act(async () => { fireEvent.click(saveBtn()); });
}
const popup = (title: string) => screen.findByText(title, { selector: 'span' }, WAIT);

describe('Branding config page', () => {
  it('loads the stored branding into the form and the live previews, clean', async () => {
    const api = setup();
    await loaded();
    expect((screen.getByPlaceholderText('DL') as HTMLInputElement).value).toBe('FO');
    expect((screen.getByPlaceholderText('21 CFR Part 11 Compliant') as HTMLInputElement).value).toBe('Cleanroom filters');
    expect((screen.getByPlaceholderText('Company Name') as HTMLInputElement).value).toBe('Acme Pharma');
    expect((screen.getByPlaceholderText('1.0') as HTMLInputElement).value).toBe('2.1');
    expect(field('Primary Color').value).toBe('#0e7490');
    expect(colorPicker('Primary Color').value).toBe('#0e7490');
    expect(field('Background End').value).toBe('#164e63');

    // Login preview mirrors the identity fields; no logo -> the logo text tile.
    expect(screen.getByRole('heading', { name: 'FilterOps' })).toBeInTheDocument();
    expect(screen.getByText('Cleanroom filters', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Acme Pharma', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Version 2.1')).toBeInTheDocument();
    expect(screen.getAllByText('FO').length).toBe(2);
    expect(screen.queryByAltText('Logo preview')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();

    // Browser tab preview: stored title + the bundled icon (no favicon stored).
    expect(tabPreviewTitle()).toHaveTextContent('Plant FMS');
    expect(tabIcon().getAttribute('src')).toBe('/pwa-192x192.png');
    expect(screen.queryByRole('button', { name: /^Reset$/ })).toBeNull();

    expect(isSelected('Ocean')).toBe(true);
    expect(isSelected('Emerald')).toBe(false);
    expect(saveBtn()).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('previews fall back to their defaults for blank stored values', async () => {
    setup({ data: { ...Object.fromEntries(Object.keys(SAVED).map((k) => [k, ''])) } });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'DigiLog' })).toBeInTheDocument(), WAIT);
    expect(screen.getByText('21 CFR Part 11 Compliant', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Company Name', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Version 1.0')).toBeInTheDocument();
    expect(screen.getAllByText('DL').length).toBe(2);
    expect(tabPreviewTitle()).toHaveTextContent('Filter Management System');
    // No colorTheme stored -> Ocean is shown as the active theme.
    expect(isSelected('Ocean')).toBe(true);
  });

  it('a stored non-default theme is the one marked selected', async () => {
    setup({ data: { ...SAVED, colorTheme: 'emerald' } });
    await loaded();
    expect(isSelected('Emerald')).toBe(true);
    expect(isSelected('Ocean')).toBe(false);
  });

  it('editing a field enables Save; Save PUTs the whole branding object and confirms', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(appName(), { target: { value: 'FilterOps Pro' } });
    fireEvent.change(field('Tab Title'), { target: { value: 'Plant 7 FMS' } });
    expect(screen.getByRole('heading', { name: 'FilterOps Pro' })).toBeInTheDocument();
    expect(tabPreviewTitle()).toHaveTextContent('Plant 7 FMS');
    await waitFor(() => expect(saveBtn()).not.toBeDisabled(), WAIT);
    await submit();
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', PATH)[0].json).toEqual({ ...SAVED, appName: 'FilterOps Pro', browserTitle: 'Plant 7 FMS' });
    expect(api.calls('PUT', PATH)[0].headers['x-reauth-password']).toBeUndefined();
    expect(await popup('Success!')).toBeInTheDocument();
    expect(screen.getByText(/Branding configuration has been updated successfully/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Success!')).toBeNull();
    // The saved values are the new baseline: nothing left to save.
    await waitFor(() => expect(saveBtn()).toBeDisabled(), WAIT);
  });

  it('Escape dismisses the success popup', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(appName(), { target: { value: 'X' } });
    await submit();
    await popup('Success!');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Success!')).toBeNull(), WAIT);
  });

  it('schema validation shows each field error and sends nothing', async () => {
    const api = setup();
    await loaded();
    fireEvent.change(screen.getByPlaceholderText('DL'), { target: { value: '' } });
    fireEvent.change(appName(), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('21 CFR Part 11 Compliant'), { target: { value: 't'.repeat(101) } });
    fireEvent.change(screen.getByPlaceholderText('Company Name'), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('1.0'), { target: { value: '' } });
    fireEvent.change(field('Tab Title'), { target: { value: '' } });
    fireEvent.change(field('Primary Color'), { target: { value: 'blue' } });
    fireEvent.change(field('Secondary Color'), { target: { value: '#12' } });
    fireEvent.change(field('Accent Color'), { target: { value: 'red' } });
    await submit();
    await waitFor(() => expect(fieldError('App Name')).not.toBeNull(), WAIT);
    expect(fieldError('App Name')).toHaveTextContent(/at least 1 character/);
    expect(fieldError('Logo Text (fallback)')).toHaveTextContent(/at least 1 character/);
    expect(fieldError('App Tagline')).toHaveTextContent(/at most 100 character/);
    expect(fieldError('Company Name')).toHaveTextContent(/at least 1 character/);
    expect(fieldError('Version')).toHaveTextContent(/at least 1 character/);
    expect(fieldError('Tab Title')).toHaveTextContent(/at least 1 character/);
    expect(fieldError('Primary Color')).toHaveTextContent('Invalid');
    expect(fieldError('Secondary Color')).toHaveTextContent('Invalid');
    expect(fieldError('Accent Color')).toHaveTextContent('Invalid');
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('choosing a theme fills every colour from the preset and saves it', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    const emerald = getThemeById('emerald').colors;
    fireEvent.click(themeBtn('Emerald'));
    expect(isSelected('Emerald')).toBe(true);
    expect(isSelected('Ocean')).toBe(false);
    expect(field('Primary Color').value).toBe(emerald.primary);
    expect(field('Background Start').value).toBe(emerald.loginBgStart);
    await submit();
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', PATH)[0].json).toMatchObject({
      colorTheme: 'emerald',
      primaryColor: emerald.primary,
      secondaryColor: emerald.accent,
      accentColor: emerald.gradientTo,
      gradientStart: emerald.gradientFrom,
      gradientMiddle: emerald.accent,
      gradientEnd: emerald.gradientTo,
      loginBgStart: emerald.loginBgStart,
      loginBgEnd: emerald.loginBgEnd,
    });
  });

  it('typing gradient and login colours updates what is saved', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(field('Gradient Start'), { target: { value: '#111111' } });
    fireEvent.change(field('Gradient Middle'), { target: { value: '#222222' } });
    fireEvent.change(field('Gradient End'), { target: { value: '#333333' } });
    fireEvent.change(field('Background Start'), { target: { value: '#444444' } });
    fireEvent.change(field('Background End'), { target: { value: '#555555' } });
    await submit();
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', PATH)[0].json).toMatchObject({
      gradientStart: '#111111', gradientMiddle: '#222222', gradientEnd: '#333333', loginBgStart: '#444444', loginBgEnd: '#555555',
    });
  });

  describe('logo upload', () => {
    it('Upload Logo opens the file picker', async () => {
      setup();
      await loaded();
      const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
      fireEvent.click(screen.getByRole('button', { name: /Upload Logo/ }));
      expect(click).toHaveBeenCalledTimes(1);
      expect(click.mock.instances[0]).toBe(logoInput());
    });

    it('an image is read into a data URI, previewed, and saved; Remove clears it', async () => {
      const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
      await loaded();
      await pick(logoInput(), [file('logo.png', 'image/png')]);
      await waitFor(() => expect(screen.getAllByAltText('Logo preview')).toHaveLength(2), WAIT);
      for (const img of screen.getAllByAltText('Logo preview')) expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
      expect(screen.queryByText('FO', { selector: 'span' })).toBeNull();
      await waitFor(() => expect(saveBtn()).not.toBeDisabled(), WAIT);

      await submit();
      await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
      expect(api.calls('PUT', PATH)[0].json.logoUrl).toMatch(/^data:image\/png;base64,/);
      fireEvent.click(await screen.findByRole('button', { name: 'Done' }, WAIT));

      fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
      expect(screen.queryByAltText('Logo preview')).toBeNull();
      expect(logoInput().value).toBe('');
      expect(screen.getAllByText('FO').length).toBe(2);
      await submit();
      await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2), WAIT);
      expect(api.calls('PUT', PATH)[1].json.logoUrl).toBe('');
    });

    it('a non-image file is refused with a visible message', async () => {
      setup();
      await loaded();
      await pick(logoInput(), [file('notes.pdf', 'application/pdf')]);
      expect(await popup('Update Failed')).toBeInTheDocument();
      expect(screen.getByText('Please select an image file')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByText('Update Failed')).toBeNull();
      expect(screen.queryByAltText('Logo preview')).toBeNull();
      expect(saveBtn()).toBeDisabled();
    });

    it('an image over 2 MB is refused', async () => {
      setup();
      await loaded();
      await pick(logoInput(), [file('huge.png', 'image/png', 2 * 1024 * 1024 + 1)]);
      await popup('Update Failed');
      expect(screen.getByText('Logo image must be less than 2MB')).toBeInTheDocument();
      expect(screen.queryByAltText('Logo preview')).toBeNull();
    });

    it('closing the picker with no file changes nothing', async () => {
      setup();
      await loaded();
      await pick(logoInput(), []);
      expect(screen.queryByText('Update Failed')).toBeNull();
      expect(saveBtn()).toBeDisabled();
    });
  });

  describe('tab icon (favicon)', () => {
    it('Upload Icon opens the file picker', async () => {
      setup();
      await loaded();
      const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
      fireEvent.click(screen.getByRole('button', { name: /Upload Icon/ }));
      expect(click.mock.instances[0]).toBe(faviconInput());
    });

    it('an .ico with no MIME type is accepted by extension, previewed and saved; Reset restores the bundled icon', async () => {
      const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
      await loaded();
      await pick(faviconInput(), [file('favicon.ico', '')]);
      await waitFor(() => expect(tabIcon().getAttribute('src')).toMatch(/^data:/), WAIT);
      await submit();
      await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
      expect(api.calls('PUT', PATH)[0].json.faviconUrl).toMatch(/^data:/);
      fireEvent.click(await screen.findByRole('button', { name: 'Done' }, WAIT));

      fireEvent.click(screen.getByRole('button', { name: /^Reset$/ }));
      expect(tabIcon().getAttribute('src')).toBe('/pwa-192x192.png');
      expect(faviconInput().value).toBe('');
      await submit();
      await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2), WAIT);
      expect(api.calls('PUT', PATH)[1].json.faviconUrl).toBe('');
    });

    it('a PNG by MIME type is accepted', async () => {
      setup();
      await loaded();
      await pick(faviconInput(), [file('icon', 'image/png')]);
      await waitFor(() => expect(tabIcon().getAttribute('src')).toMatch(/^data:image\/png/), WAIT);
    });

    it('a non-image is refused', async () => {
      setup();
      await loaded();
      await pick(faviconInput(), [file('notes.txt', 'text/plain')]);
      await popup('Update Failed');
      expect(screen.getByText('Please select an image file (PNG, SVG or ICO)')).toBeInTheDocument();
      expect(tabIcon().getAttribute('src')).toBe('/pwa-192x192.png');
    });

    it('an icon over 200 KB is refused', async () => {
      setup();
      await loaded();
      await pick(faviconInput(), [file('big.png', 'image/png', 200 * 1024 + 1)]);
      await popup('Update Failed');
      expect(screen.getByText('Tab icon must be less than 200KB')).toBeInTheDocument();
    });

    it('closing the picker with no file changes nothing', async () => {
      setup();
      await loaded();
      await pick(faviconInput(), []);
      expect(screen.queryByText('Update Failed')).toBeNull();
      expect(saveBtn()).toBeDisabled();
    });
  });

  it('up-front signature: the prompt names Update Branding and the save carries the password', async () => {
    const api = setup({ reauth: ['UPDATE_BRANDING'], extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0), WAIT);
    fireEvent.change(appName(), { target: { value: 'Signed' } });
    await submit();
    expect(await screen.findByText(/Performing "Update Branding" requires identity verification/, undefined, WAIT)).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    await signReauth('pw-b');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    const put = api.calls('PUT', PATH)[0];
    expect(put.headers['x-reauth-password']).toBe('pw-b');
    expect(put.json).toEqual({ ...SAVED, appName: 'Signed', _currentPassword: 'pw-b' });
    expect(await popup('Success!')).toBeInTheDocument();
  });

  it('server demands a signature after the first attempt: prompt, then a signed retry', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(appName(), { target: { value: 'Retry' } });
    await submit();
    await signReauth('pw-r');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2), WAIT);
    expect(api.calls('PUT', PATH)[1].headers['x-reauth-password']).toBe('pw-r');
    expect(await popup('Success!')).toBeInTheDocument();
  });

  it('cancelling the signature sends nothing, keeps the edit and reports no failure (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ reauth: ['UPDATE_BRANDING'] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0), WAIT);
    fireEvent.change(appName(), { target: { value: 'Never saved' } });
    await submit();
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull(), WAIT);
    expectSilentCancel(consoleError);
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    expect(appName().value).toBe('Never saved');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('cancelling a server-demanded signature reports no failure either (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ extra: [reauthRequired('PUT', PATH)] });
    await loaded();
    fireEvent.change(appName(), { target: { value: 'Never saved' } });
    await submit();
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull(), WAIT);
    expectSilentCancel(consoleError);
    expect(api.calls('PUT', PATH)).toHaveLength(1);
    expect(appName().value).toBe('Never saved');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('a refused save shows the server message in the failure popup', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: { error: 'VALIDATION_ERROR', message: 'faviconUrl too long' } }] });
    await loaded();
    fireEvent.change(appName(), { target: { value: 'Bad' } });
    await submit();
    expect(await popup('Update Failed')).toBeInTheDocument();
    expect(screen.getByText('faviconUrl too long')).toBeInTheDocument();
    // Escape also dismisses it; the edit is still pending.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Update Failed')).toBeNull(), WAIT);
    expect(saveBtn()).not.toBeDisabled();
  });

  it('Cancel returns to the settings page', async () => {
    setup();
    await loaded();
    expect(screen.getByTestId('loc')).toHaveTextContent('/config/appearance');
    fireEvent.click(within(saveBtn().parentElement as HTMLElement).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/config$/);
  });
});
