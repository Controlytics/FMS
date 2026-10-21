import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { DynamicConfigPage } from '../dynamic-config';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

afterEach(resetEnv);

const MANIFEST = '/api/config/registry/manifest';
const KEY = 'plant-settings';
const DYN = `/api/config/dynamic/${KEY}`;

/** One def exercising every editor the page knows. */
const PLANT = {
  moduleKey: KEY,
  moduleName: 'Plant Settings',
  description: 'Site-wide behaviour switches',
  icon: 'cog',
  category: 'System',
  requiresReauth: true,
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: false,
  settings: [
    { key: 'enabled', type: 'boolean', label: 'Feature Enabled', description: 'Turn the feature on', default: false },
    { key: 'auditOn', type: 'boolean', label: 'Audit Trail' },
    { key: 'threshold', type: 'number', label: 'Threshold', min: 1, max: 99, placeholder: '1-99', visibleWhen: { field: 'enabled', value: true } },
    { key: 'mode', type: 'select', label: 'Mode', required: true, options: [{ value: 'OFF', label: 'Off' }, { value: 'A', label: 'Mode A' }, { value: 'B', label: 'Mode B' }] },
    { key: 'altText', type: 'text', label: 'Alt Text', visibleWhen: { field: 'mode', value: 'OFF', operator: 'neq' } },
    { key: 'abNote', type: 'text', label: 'A/B Note', visibleWhen: { field: 'mode', value: ['A', 'B'], operator: 'in' } },
    { key: 'oddRule', type: 'text', label: 'Odd Rule', visibleWhen: { field: 'mode', value: 1, operator: 'gt' } },
    { key: 'approverRole', type: 'select', label: 'Approver Role', dynamicOptionsSource: '/api/roles/active', options: [{ value: 'QA', label: 'QA (static)' }] },
    { key: 'notifyRoles', type: 'multiselect', label: 'Notify Roles', dynamicOptionsSource: '/api/roles/active', group: 'Notifications' },
    { key: 'channels', type: 'multiselect', label: 'Channels', options: [{ value: 'EMAIL', label: 'Email' }, { value: 'SMS', label: 'SMS' }], group: 'Notifications' },
    { key: 'apiKey', type: 'secret', label: 'API Key', group: 'Integration' },
    { key: 'token', type: 'secret', label: 'Token', placeholder: 'paste token', group: 'Integration' },
    { key: 'endpoint', type: 'url', label: 'Endpoint', placeholder: 'https://', group: 'Integration', helpText: 'Must be reachable from the server' },
    { key: 'contact', type: 'email', label: 'Contact', group: 'Integration', width: 'half' },
    { key: 'notes', type: 'textarea', label: 'Notes', group: 'Advanced' },
    { key: 'mapping', type: 'json', label: 'Mapping', group: 'Advanced' },
    { key: 'brand', type: 'color', label: 'Brand Colour', group: 'Advanced' },
  ],
};
const ROLES = [
  { name: 'QA', displayName: 'Quality' },          // duplicate of the static QA -> kept once (static wins)
  { name: 'OPERATOR', displayName: 'Operator' },
];
const SAVED = {
  enabled: true, auditOn: false, threshold: 10, mode: 'A', altText: 'alt', abNote: 'note', approverRole: 'OPERATOR',
  notifyRoles: ['QA'], channels: ['EMAIL'], apiKey: '••••••••', endpoint: 'https://plant.local', contact: 'qa@plant.local',
  notes: 'hello', mapping: { a: 1 }, brand: '#112233',
};

function Pages() {
  return (
    <Routes>
      <Route path="/config/dynamic/:moduleKey" element={<DynamicConfigPage />} />
      <Route path="/config" element={<p>CONFIG INDEX</p>} />
    </Routes>
  );
}

function setup(opts: { user?: any; extra?: MockRoute[]; saved?: unknown; savedStatus?: number; manifest?: unknown[]; reauth?: string[]; key?: string; roles?: MockRoute } = {}) {
  const key = opts.key ?? KEY;
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: MANIFEST, body: opts.manifest ?? [PLANT] },
    { path: `/api/config/dynamic/${key}`, status: opts.savedStatus ?? 200, body: opts.saved ?? SAVED },
    opts.roles ?? { path: '/api/roles/active', body: ROLES },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<Pages />, { user: opts.user ?? SUPER_ADMIN, api, route: `/config/dynamic/${key}` });
  return api;
}

const block = (label: string) => screen.getByText(label, { selector: 'label' }).parentElement as HTMLElement;
const inputOf = (label: string) => block(label).querySelector('input, select, textarea') as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });
const loaded = () => waitFor(() => expect(inputOf('Threshold').value).toBe('10'));

describe('Dynamic config page', () => {
  it('renders the def grouped, with saved values in every editor type, and starts clean', async () => {
    const api = setup();
    expect(await screen.findByRole('heading', { name: 'Plant Settings' })).toBeInTheDocument();
    await loaded();
    expect(screen.getByText('Site-wide behaviour switches')).toBeInTheDocument();
    // Groups in declaration order, ungrouped first as "General".
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Integration')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect((block('Feature Enabled').querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(within(block('Feature Enabled')).getByText('Turn the feature on')).toBeInTheDocument();
    expect(within(block('Audit Trail')).getByText('Enable audit trail')).toBeInTheDocument();
    expect(inputOf('Mode').value).toBe('A');
    expect(block('Mode').querySelector('.text-red-500')).toHaveTextContent('*');
    expect(inputOf('Alt Text').value).toBe('alt');
    expect(inputOf('A/B Note').value).toBe('note');
    expect(screen.getByText('Odd Rule')).toBeInTheDocument(); // unknown operator -> shown
    expect(inputOf('API Key').type).toBe('password');
    expect(inputOf('API Key').placeholder).toBe('••••••••');
    expect(inputOf('Token').placeholder).toBe('paste token');
    expect(inputOf('Endpoint').type).toBe('url');
    expect(screen.getByText('Must be reachable from the server')).toBeInTheDocument();
    expect(inputOf('Contact').type).toBe('email');
    expect(block('Contact').className).toContain('w-1/2');
    expect(inputOf('Notes').value).toBe('hello');
    expect(inputOf('Mapping').value).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect((block('Brand Colour').querySelectorAll('input')[1] as HTMLInputElement).value).toBe('#112233');
    // Dynamic options merged with static ones, de-duplicated (static QA kept).
    await waitFor(() => expect(Array.from(inputOf('Approver Role').options).map((o) => o.textContent)).toEqual(['Select...', 'QA (static)', 'Operator']));
    expect(inputOf('Approver Role').value).toBe('OPERATOR');
    expect(within(block('Notify Roles')).getByRole('checkbox', { name: 'Quality' })).toBeChecked();
    expect(within(block('Notify Roles')).getByRole('checkbox', { name: 'Operator' })).not.toBeChecked();
    expect(saveBtn()).toBeDisabled();
    // The options source is fetched once even though two settings use it.
    expect(api.calls('GET', '/api/roles/active')).toHaveLength(1);
    expect(api.unmatched).toEqual([]);
  });

  it('visibleWhen hides and shows dependent settings as values change', async () => {
    setup();
    await loaded();
    fireEvent.click(block('Feature Enabled').querySelector('input')!);
    expect(screen.queryByText('Threshold')).toBeNull();
    fireEvent.change(inputOf('Mode'), { target: { value: 'OFF' } });
    expect(screen.queryByText('Alt Text')).toBeNull();
    expect(screen.queryByText('A/B Note')).toBeNull();
    fireEvent.change(inputOf('Mode'), { target: { value: 'B' } });
    expect(screen.getByText('Alt Text')).toBeInTheDocument();
    expect(screen.getByText('A/B Note')).toBeInTheDocument();
  });

  it('every editor feeds the saved body; the password goes in the body under UPDATE_CONFIG_PAGE', async () => {
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'], extra: [{ method: 'PUT', path: DYN, body: { ok: true } }] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await waitFor(() => expect(inputOf('Approver Role')).not.toBeDisabled());
    fireEvent.click(block('Audit Trail').querySelector('input')!);
    fireEvent.change(inputOf('Threshold'), { target: { value: '42' } });
    fireEvent.change(inputOf('Mode'), { target: { value: 'B' } });
    fireEvent.change(inputOf('Approver Role'), { target: { value: 'QA' } });
    fireEvent.click(within(block('Notify Roles')).getByRole('checkbox', { name: 'Quality' }));   // remove QA
    fireEvent.click(within(block('Notify Roles')).getByRole('checkbox', { name: 'Operator' }));  // add OPERATOR
    fireEvent.click(within(block('Channels')).getByRole('checkbox', { name: 'SMS' }));
    fireEvent.change(inputOf('API Key'), { target: { value: 'new-key' } });
    fireEvent.change(inputOf('Endpoint'), { target: { value: 'https://new.local' } });
    fireEvent.change(inputOf('Contact'), { target: { value: 'ops@plant.local' } });
    fireEvent.change(inputOf('Notes'), { target: { value: 'free text' } });
    fireEvent.change(inputOf('Mapping'), { target: { value: '{"b":2}' } });
    fireEvent.change(block('Brand Colour').querySelectorAll('input')[0], { target: { value: '#445566' } });
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/Performing "Update Configuration Page" requires identity verification/)).toBeInTheDocument();
    expect(api.calls('PUT', DYN)).toHaveLength(0);
    await signReauth('pw-dyn');
    await waitFor(() => expect(api.calls('PUT', DYN)).toHaveLength(1));
    const put = api.calls('PUT', DYN)[0];
    expect(put.headers['x-reauth-password']).toBeUndefined();
    expect(put.json).toEqual({
      ...SAVED,
      auditOn: true, threshold: 42, mode: 'B', approverRole: 'QA', notifyRoles: ['OPERATOR'], channels: ['EMAIL', 'SMS'],
      apiKey: 'new-key', endpoint: 'https://new.local', contact: 'ops@plant.local', notes: 'free text', mapping: { b: 2 },
      brand: '#445566', _currentPassword: 'pw-dyn',
    });
    expect(await screen.findByText('Settings saved successfully')).toBeInTheDocument();
    // Saved values are re-read.
    await waitFor(() => expect(api.calls('GET', DYN).length).toBeGreaterThan(1));
  });

  it('number fields send numbers or an empty string; invalid JSON is kept as typed', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: DYN, body: { ok: true } }] });
    await loaded();
    fireEvent.change(inputOf('Threshold'), { target: { value: '' } });
    fireEvent.change(inputOf('Mapping'), { target: { value: '{not json' } });
    fireEvent.change((block('Brand Colour').querySelectorAll('input')[1] as HTMLInputElement), { target: { value: '#abcdef' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', DYN)).toHaveLength(1));
    expect(api.calls('PUT', DYN)[0].json).toMatchObject({ threshold: '', mapping: '{not json', brand: '#abcdef' });
  });

  it('re-checking a multiselect box is not a change (order-insensitive dirty check)', async () => {
    setup();
    await loaded();
    const quality = () => within(block('Notify Roles')).getByRole('checkbox', { name: 'Quality' });
    await waitFor(() => expect(quality()).toBeChecked());
    fireEvent.click(within(block('Notify Roles')).getByRole('checkbox', { name: 'Operator' }));
    fireEvent.click(quality());
    fireEvent.click(quality());
    fireEvent.click(within(block('Notify Roles')).getByRole('checkbox', { name: 'Operator' }));
    expect(saveBtn()).toBeDisabled();
  });

  it('a refused save shows the server message; the next edit clears it', async () => {
    setup({ extra: [{ method: 'PUT', path: DYN, status: 400, body: { error: 'VALIDATION_ERROR', message: 'threshold must be <= 99' } }] });
    await loaded();
    fireEvent.change(inputOf('Threshold'), { target: { value: '500' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('threshold must be <= 99')).toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.change(inputOf('Threshold'), { target: { value: '50' } });
    expect(screen.queryByText('threshold must be <= 99')).toBeNull();
  });

  it('a REAUTH_REQUIRED the page did not foresee opens the prompt; cancel reports it', async () => {
    const api = setup({ extra: [reauthRequired('PUT', DYN)] });
    await loaded();
    fireEvent.change(inputOf('Threshold'), { target: { value: '11' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    expect(await screen.findByText(/Cancelled — password confirmation was not completed/)).toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
    expect(api.calls('PUT', DYN)).toHaveLength(1);
  });

  it('without a reauthAction the key falls back to UPDATE_<MODULE_KEY>', async () => {
    const legacy = { ...PLANT, moduleKey: 'my-mod', moduleName: 'My Module', reauthAction: undefined, settings: [{ key: 'name', type: 'text', label: 'Name' }] };
    const api = setup({ key: 'my-mod', manifest: [legacy], saved: { name: 'x' }, reauth: ['UPDATE_MY_MOD'], extra: [{ method: 'PUT', path: '/api/config/dynamic/my-mod', body: {} }] });
    await waitFor(() => expect(inputOf('Name').value).toBe('x'));
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(inputOf('Name'), { target: { value: 'y' } });
    fireEvent.click(saveBtn());
    // The prompt opens up front only because UPDATE_MY_MOD is the key asked for.
    expect(await screen.findByPlaceholderText('Enter your password')).toBeInTheDocument();
    expect(screen.getByText(/Performing "Save Configuration" requires identity verification/)).toBeInTheDocument();
    await signReauth('k');
    await waitFor(() => expect(api.calls('PUT', '/api/config/dynamic/my-mod')[0]?.json).toEqual({ name: 'y', _currentPassword: 'k' }));
  });

  it('the session module maps to UPDATE_SESSION_CONFIG', async () => {
    const session = { ...PLANT, moduleKey: 'session', moduleName: 'Session', reauthAction: null, settings: [{ key: 'hours', type: 'number', label: 'Hours' }] };
    const api = setup({ key: 'session', manifest: [session], saved: { hours: 8 }, reauth: ['UPDATE_SESSION_CONFIG'], extra: [{ method: 'PUT', path: '/api/config/dynamic/session', body: {} }] });
    await waitFor(() => expect(inputOf('Hours').value).toBe('8'));
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(inputOf('Hours'), { target: { value: '4' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/Performing "Update Session Config" requires identity verification/)).toBeInTheDocument();
  });

  it('a stored select value missing from the options is still shown, marked not found', async () => {
    setup({ saved: { ...SAVED, approverRole: 'RETIRED_ROLE' } });
    await loaded();
    await waitFor(() => expect(within(block('Approver Role')).getByRole('option', { name: 'RETIRED_ROLE (not found)' })).toBeInTheDocument());
    expect(inputOf('Approver Role').value).toBe('RETIRED_ROLE');
  });

  it('an options source that fails or returns nothing leaves "No options available"', async () => {
    const plant = {
      ...PLANT,
      settings: [
        { key: 'approverRole', type: 'select', label: 'Approver Role', dynamicOptionsSource: '/api/broken' },
        { key: 'notifyRoles', type: 'multiselect', label: 'Notify Roles', dynamicOptionsSource: '/api/empty' },
      ],
    };
    setup({ manifest: [plant], saved: {}, extra: [
      { path: '/api/broken', status: 500, body: { error: 'X', message: 'down' } },
      { path: '/api/empty', body: { nothing: true } },
    ] });
    await waitFor(() => expect(within(block('Approver Role')).getByRole('option', { name: 'No options available' })).toBeInTheDocument());
    expect(within(block('Notify Roles')).getByText('No options available')).toBeInTheDocument();
  });

  it('options sources may answer {data:[…]} and items map value/label from several shapes', async () => {
    const plant = { ...PLANT, settings: [{ key: 'pick', type: 'select', label: 'Pick', dynamicOptionsSource: '/api/things' }] };
    setup({ manifest: [plant], saved: {}, extra: [{ path: '/api/things', body: { data: [
      { value: 'v1', label: 'Label One' },
      { id: 7 },
      { name: 'n3', displayName: 'Display Three' },
      { name: 'n4' },
      {},
    ] } }] });
    await waitFor(() => expect(Array.from(inputOf('Pick').options).map((o) => o.textContent)).toEqual(
      ['Select...', 'Label One', '7', 'Display Three', 'n4', ''],
    ));
    // Nothing saved yet -> empty values, Save disabled until an edit.
    expect(saveBtn()).toBeDisabled();
    fireEvent.change(inputOf('Pick'), { target: { value: 'n3' } });
    expect(saveBtn()).not.toBeDisabled();
  });

  it('a def with no settings says it uses a custom page', async () => {
    setup({ manifest: [{ ...PLANT, settings: [] }] });
    expect(await screen.findByText('This module uses a custom configuration page.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(screen.getByText('CONFIG INDEX')).toBeInTheDocument();
  });

  it('an unregistered module key shows "Configuration Not Found"', async () => {
    const api = setup({ key: 'nope', manifest: [PLANT], saved: {} });
    await waitFor(() => expect(api.calls('GET', MANIFEST).length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { name: 'Configuration Not Found' })).toBeInTheDocument();
    expect(screen.getByText('Module "nope" is not registered.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(screen.getByText('CONFIG INDEX')).toBeInTheDocument();
  });

  it('a 403 on the saved values shows an insufficient-permissions notice, not a blank form', async () => {
    setup({ savedStatus: 403, saved: { error: 'FORBIDDEN', message: 'Super Admin only' } });
    expect(await screen.findByText('Insufficient permissions to view this configuration.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plant Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save Changes/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(screen.getByText('CONFIG INDEX')).toBeInTheDocument();
  });

  it('a 500 on the saved values raises a visible load error', async () => {
    setup({ savedStatus: 500, saved: { error: 'INTERNAL', message: 'database unavailable' } });
    expect(await screen.findByText('database unavailable')).toBeInTheDocument();
    expect(screen.getByText('Load Error')).toBeInTheDocument();
  });

  it('a role without CONFIG_UPDATE cannot save', async () => {
    setup({ user: { role: 'QA', permissions: ['CONFIG_READ'] } });
    await loaded();
    fireEvent.change(inputOf('Threshold'), { target: { value: '12' } });
    expect(saveBtn()).toBeDisabled();
    expect(saveBtn()).toHaveAttribute('title', 'CONFIG_UPDATE permission required');
  });

  it('CONFIG_UPDATE without SUPER_ADMIN can save', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] } });
    await loaded();
    fireEvent.change(inputOf('Threshold'), { target: { value: '12' } });
    expect(saveBtn()).not.toBeDisabled();
  });

  it('Back to Settings and Cancel both return to /config', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('CONFIG INDEX')).toBeInTheDocument();
  });

  it('the header Back to Settings button returns to /config', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(screen.getByText('CONFIG INDEX')).toBeInTheDocument();
  });
});
