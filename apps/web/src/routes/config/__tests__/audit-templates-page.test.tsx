import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { AUDIT_TEMPLATE_DEFAULTS, AUDIT_TEMPLATE_CATEGORIES } from '@digilog/shared';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { AuditTemplatesConfigPage } from '../audit-templates';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(resetEnv);

const PATH = '/api/config/audit-templates';
const WAIT = { timeout: 5000 };
const CUSTOM = 'Custom: {actor} made "{targetUser}"';
const SAVED = { USER_CREATED: CUSTOM };

function setup(opts: { extra?: MockRoute[]; data?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.data === undefined ? SAVED : opts.data },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  const view = renderPage(<AuditTemplatesConfigPage />, { user: SUPER_ADMIN, api, route: '/config/display-settings' });
  return { api, view };
}

const loaded = () => screen.findByText('USER_CREATED', { selector: 'p' }, WAIT);
const rowOf = (key: string) => screen.getByText(key, { selector: 'p' }).closest('div.px-6') as HTMLElement;
const inputOf = (key: string) => within(rowOf(key)).getByRole('textbox') as HTMLInputElement;
const previewOf = (key: string) => (rowOf(key).querySelector('span.italic') as HTMLElement).textContent;
const saveButtons = () => screen.getAllByRole('button', { name: /Save Changes|Saving/ });
const topSave = () => saveButtons()[0];
const unsaved = () => screen.queryByText('You have unsaved changes.');

describe('Audit Text Templates', () => {
  it('shows a spinner until the stored templates arrive', async () => {
    const { view } = setup();
    expect(view.container.querySelector('svg.animate-spin')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset All' })).toBeNull();
    await loaded();
    expect(view.container.querySelector('svg.animate-spin')).toBeNull();
  });

  it('renders every category with its action count; the override shows with Reset, the rest as Default', async () => {
    const { api } = setup();
    await loaded();
    for (const cat of AUDIT_TEMPLATE_CATEGORIES) {
      const n = Object.values(AUDIT_TEMPLATE_DEFAULTS).filter((d) => d.category === cat).length;
      const heading = screen.getByRole('heading', { name: cat });
      expect(heading.nextElementSibling).toHaveTextContent(`${n} action${n > 1 ? 's' : ''}`);
    }
    // The stored override wins and is previewed with sample values.
    expect(inputOf('USER_CREATED').value).toBe(CUSTOM);
    expect(previewOf('USER_CREATED')).toBe('Custom: operator1 made "user123"');
    expect(within(rowOf('USER_CREATED')).getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    // An untouched key shows its default template and the Default marker.
    expect(inputOf('USER_UPDATED').value).toBe(AUDIT_TEMPLATE_DEFAULTS.USER_UPDATED.template);
    expect(within(rowOf('USER_UPDATED')).getByText('Default')).toBeInTheDocument();
    // Placeholder chips list what each template accepts.
    expect(within(rowOf('USER_CREATED')).getByText('{targetUser}')).toBeInTheDocument();
    // Nothing edited: Save disabled, no unsaved bar.
    expect(topSave()).toBeDisabled();
    expect(unsaved()).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('the replacement preview substitutes both filter names', async () => {
    setup();
    await loaded();
    expect(previewOf('FILTER_REPLACED')).toBe('Filter "L9/AHU-91/SB/00-05" replaced with "L9/AHU-91/SB/00-06" by operator1');
    // A template whose placeholders are all sampled renders no braces.
    expect(previewOf('LDAP_CONFIG_UPDATED')).toBe('LDAP configuration updated by operator1');
  });

  it('editing a template marks the page dirty and Save sends the full map, then refetches', async () => {
    const { api } = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(inputOf('USER_UPDATED'), { target: { value: '{actor} changed {targetUser} ({targetName}/{configKey}/{targetType})' } });
    expect(previewOf('USER_UPDATED')).toBe('operator1 changed user123 (Daily Check/password-policy/Template)');
    expect(within(rowOf('USER_UPDATED')).getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(unsaved()).toBeInTheDocument();
    expect(topSave()).not.toBeDisabled();
    const gets = api.calls('GET', PATH).length;

    // Save from the sticky bar.
    await act(async () => { fireEvent.click(saveButtons()[1]); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', PATH)[0].json).toEqual({
      USER_CREATED: CUSTOM,
      USER_UPDATED: '{actor} changed {targetUser} ({targetName}/{configKey}/{targetType})',
    });
    expect(api.calls('PUT', PATH)[0].headers['x-reauth-password']).toBeUndefined();
    expect(await screen.findByText('Audit text templates saved successfully.', undefined, WAIT)).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', PATH).length).toBeGreaterThan(gets), WAIT);
    expect(unsaved()).toBeNull();
    // Editing again clears the success message.
    fireEvent.change(inputOf('USER_UPDATED'), { target: { value: 'x {actor}' } });
    expect(screen.queryByText('Audit text templates saved successfully.')).toBeNull();
  });

  it('Reset restores one key to its default; saving sends the default', async () => {
    const { api } = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.click(within(rowOf('USER_CREATED')).getByRole('button', { name: 'Reset' }));
    expect(inputOf('USER_CREATED').value).toBe(AUDIT_TEMPLATE_DEFAULTS.USER_CREATED.template);
    expect(within(rowOf('USER_CREATED')).getByText('Default')).toBeInTheDocument();
    expect(unsaved()).toBeInTheDocument();
    await act(async () => { fireEvent.click(topSave()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', PATH)[0].json).toEqual({ USER_CREATED: AUDIT_TEMPLATE_DEFAULTS.USER_CREATED.template });
  });

  it('Reset All sends every template at its default', async () => {
    const { api } = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Reset All' }));
    expect(inputOf('USER_CREATED').value).toBe(AUDIT_TEMPLATE_DEFAULTS.USER_CREATED.template);
    await act(async () => { fireEvent.click(topSave()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    const sent = api.calls('PUT', PATH)[0].json;
    expect(Object.keys(sent).sort()).toEqual(Object.keys(AUDIT_TEMPLATE_DEFAULTS).sort());
    for (const [k, d] of Object.entries(AUDIT_TEMPLATE_DEFAULTS)) expect(sent[k]).toBe(d.template);
  });

  it('edits to several keys accumulate and are all sent', async () => {
    const { api } = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(inputOf('USER_UPDATED'), { target: { value: 'one {actor}' } });
    fireEvent.change(inputOf('LDAP_CONFIG_UPDATED'), { target: { value: 'two {actor}' } });
    fireEvent.change(inputOf('USER_UPDATED'), { target: { value: 'one again {actor}' } });
    await act(async () => { fireEvent.click(topSave()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', PATH)[0].json).toEqual({
      USER_CREATED: CUSTOM, USER_UPDATED: 'one again {actor}', LDAP_CONFIG_UPDATED: 'two {actor}',
    });
  });

  it('a category with one action is labelled in the singular, and an empty category is not shown', async () => {
    // Registry data injected for this render only (the live catalog has neither case).
    const cats = AUDIT_TEMPLATE_CATEGORIES as unknown as string[];
    const defs = AUDIT_TEMPLATE_DEFAULTS as Record<string, (typeof AUDIT_TEMPLATE_DEFAULTS)[string]>;
    cats.push('Solo Category', 'Empty Category');
    defs.SOLO_TEST_ACTION = { label: 'Solo Test', category: 'Solo Category' as never, template: 'Solo by {actor}', placeholders: ['actor'] };
    try {
      setup();
      await loaded();
      expect(screen.getByRole('heading', { name: 'Solo Category' }).nextElementSibling).toHaveTextContent(/^1 action$/);
      expect(previewOf('SOLO_TEST_ACTION')).toBe('Solo by operator1');
      expect(screen.queryByRole('heading', { name: 'Empty Category' })).toBeNull();
    } finally {
      cats.splice(cats.indexOf('Solo Category'), 2);
      delete defs.SOLO_TEST_ACTION;
    }
  });

  it('Discard throws away local edits', async () => {
    const { api } = setup();
    await loaded();
    fireEvent.change(inputOf('USER_CREATED'), { target: { value: 'temp {actor}' } });
    expect(unsaved()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(unsaved()).toBeNull();
    expect(inputOf('USER_CREATED').value).toBe(CUSTOM);
    expect(topSave()).toBeDisabled();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('a fresh install (nothing stored) shows every default; one edit sends only that key', async () => {
    const { api } = setup({ data: {}, extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    expect(inputOf('USER_CREATED').value).toBe(AUDIT_TEMPLATE_DEFAULTS.USER_CREATED.template);
    expect(screen.queryAllByRole('button', { name: 'Reset' })).toHaveLength(0);
    fireEvent.change(inputOf('USER_CREATED'), { target: { value: 'New {actor}' } });
    await act(async () => { fireEvent.click(topSave()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', PATH)[0].json).toEqual({ USER_CREATED: 'New {actor}' });
  });

  it('the server always demands a signature: prompt names the action, retry carries the password', async () => {
    const { api } = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(inputOf('USER_CREATED'), { target: { value: 'Signed {actor}' } });
    await act(async () => { fireEvent.click(topSave()); });
    expect(await screen.findByText(/Performing "Update Audit Templates" requires identity verification/, undefined, WAIT)).toBeInTheDocument();
    await signReauth('pw-at');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2), WAIT);
    const retry = api.calls('PUT', PATH)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-at');
    expect(retry.json).toEqual({ USER_CREATED: 'Signed {actor}', _currentPassword: 'pw-at' });
    expect(await screen.findByText('Audit text templates saved successfully.', undefined, WAIT)).toBeInTheDocument();
  });

  it('an up-front prompt that is cancelled sends nothing and frees the buttons', async () => {
    const { api } = setup({ reauth: ['UPDATE_AUDIT_TEMPLATES'] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0), WAIT);
    fireEvent.change(inputOf('USER_CREATED'), { target: { value: 'Cancelled {actor}' } });
    await act(async () => { fireEvent.click(topSave()); });
    await screen.findByPlaceholderText('Enter your password', undefined, WAIT);
    expect(topSave()).toHaveTextContent('Saving...');
    await cancelReauth();
    await waitFor(() => expect(topSave()).toHaveTextContent('Save Changes'), WAIT);
    expect(topSave()).not.toBeDisabled();
    expect(unsaved()).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('a refused save does not claim success and keeps the edits', async () => {
    const { api } = setup({ extra: [{ method: 'PUT', path: PATH, status: 500, body: { error: 'INTERNAL', message: 'db down' } }] });
    await loaded();
    fireEvent.change(inputOf('USER_CREATED'), { target: { value: 'Refused {actor}' } });
    await act(async () => { fireEvent.click(topSave()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    await waitFor(() => expect(topSave()).toHaveTextContent('Save Changes'), WAIT);
    expect(screen.queryByText('Audit text templates saved successfully.')).toBeNull();
    expect(inputOf('USER_CREATED').value).toBe('Refused {actor}');
    expect(unsaved()).toBeInTheDocument();
  });
});
