/**
 * D03-15 (operator rule: no unlabelled UI). Every control on these config pages
 * must carry a programmatic name a screen reader can announce. The fields were
 * visually labelled, but the <label> was never bound to its input (no
 * htmlFor/id), and the icon-only back links had no text at all.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { PasswordPolicyPage } from '../password-policy';
import { UserIdConfigPage } from '../user-id';
import { TabletAccessConfigPage } from '../tablet-access';
import { DatetimeConfigPage } from '../datetime';
import LdapConfigPage from '../ldap';
import { HelpArticlesPage } from '../help';
import { ActionReauthPage } from '../action-reauth';
import { NotificationRulesPage } from '../notification-rules';
import { EmailSettingsPage } from '../notification-settings/email-settings';
import { NotificationLogsPage } from '../notification-settings/notification-logs';
import { SUPER_ADMIN, commonRoutes, resetEnv } from './config-test-helpers';

vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(resetEnv);

/** Every interactive element under `root` that has no accessible name. */
function unnamedControls(root: ParentNode): string[] {
  const els = Array.from(root.querySelectorAll<HTMLElement>(
    'a[href], button, input:not([type=hidden]), select, textarea, [role=switch]',
  ));
  return els.filter((el) => {
    try { expect(el).toHaveAccessibleName(); return false; } catch { return true; }
  }).map((el) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 140));
}

const render = (ui: React.ReactElement, routes: MockRoute[], route = '/config') => {
  const api = mockApi([...routes, ...commonRoutes()]);
  renderPage(ui, { user: SUPER_ADMIN, api, route });
  return api;
};

describe('General & Password Settings — every field is named', () => {
  const SAVED = {
    minLength: 8, maxLength: 128,
    requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true,
    minUppercase: 1, minLowercase: 1, minNumbers: 1, minSpecialChars: 1,
    preventReuseCount: 12, cannotBeUserId: true, cannotContainUserId: true,
    maxFailedAttempts: 5, passwordExpiryDays: 90, expiryNotificationDays: 0,
    autoLogoutEnabled: true, idleTimeoutMinutes: 15, warningMinutes: 2,
  };

  it('the 12 number inputs are reachable by their label, carrying the stored value', async () => {
    render(<PasswordPolicyPage />, [{ path: '/api/config/password-policy', body: SAVED }], '/config/password-policy');
    const byName = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
    await waitFor(() => expect(byName('Minimum Length').value).toBe('8'));
    await waitFor(() => expect(byName('Idle Timeout').value).toBe('15'));
    expect(byName('Max Failed Login Attempts').value).toBe('5');
    expect(byName('Warning Before Logout').value).toBe('2');
    expect(byName('Maximum Length').value).toBe('128');
    expect(byName('Minimum uppercase letters').value).toBe('1');
    expect(byName('Minimum lowercase letters').value).toBe('1');
    expect(byName('Minimum numbers').value).toBe('1');
    expect(byName('Minimum special characters').value).toBe('1');
    expect(byName('Prevent Password Reuse').value).toBe('12');
    expect(byName('Password Expiry Period').value).toBe('90');
    expect(byName('Expiry Notification').value).toBe('0');
    expect(screen.getAllByRole('spinbutton')).toHaveLength(12);
  });

  it('the back link is named, and nothing on the page is unnamed', async () => {
    render(<PasswordPolicyPage />, [{ path: '/api/config/password-policy', body: SAVED }], '/config/password-policy');
    await waitFor(() => expect(screen.getAllByRole('spinbutton')).toHaveLength(12));
    expect(screen.getByRole('link', { name: 'Back to configuration' })).toHaveAttribute('href', '/config');
    expect(unnamedControls(document.body)).toEqual([]);
  });
});

describe('User ID configuration — every field is named', () => {
  const SAVED = {
    format: 'PREFIX_NUMBERS', length: 7, prefix: 'EMP', prefixSeparator: '-', letterCase: 'UPPERCASE',
    autoGenerate: true, startNumber: 1, customPattern: '', customPatternExample: '', customPatternDescription: '',
  };
  const routes = (data: unknown): MockRoute[] => [
    { path: '/api/config/user-id', body: data },
    { path: '/api/config/user-id/next', body: { autoGenerate: true, nextId: 'EMP-001' } },
  ];

  it('the selects and number inputs are reachable by their label', async () => {
    render(<UserIdConfigPage />, routes(SAVED), '/config/user-id');
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Format Type' }) as HTMLSelectElement).value).toBe('PREFIX_NUMBERS'));
    expect((screen.getByRole('spinbutton', { name: 'Fixed Length' }) as HTMLInputElement).value).toBe('7');
    expect((screen.getByRole('combobox', { name: 'Letter Case' }) as HTMLSelectElement).value).toBe('UPPERCASE');
    expect((screen.getByRole('textbox', { name: 'Prefix' }) as HTMLInputElement).value).toBe('EMP');
    expect((screen.getByRole('combobox', { name: 'Separator' }) as HTMLSelectElement).value).toBe('-');
    expect((screen.getByRole('spinbutton', { name: 'Start Number' }) as HTMLInputElement).value).toBe('1');
    expect(screen.getByRole('textbox', { name: 'User ID to test' })).toBeInTheDocument();
    expect(unnamedControls(document.body)).toEqual([]);
  });

  it('the custom-pattern fields are named too', async () => {
    render(<UserIdConfigPage />, routes({ ...SAVED, format: 'CUSTOM_PATTERN', customPattern: '[A-Z]{2}\\d{4}' }), '/config/user-id');
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Regex Pattern' }) as HTMLInputElement).value).toBe('[A-Z]{2}\\d{4}'));
    expect(screen.getByRole('textbox', { name: 'Example (for display)' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Description (for error messages)' })).toBeInTheDocument();
    expect(unnamedControls(document.body)).toEqual([]);
  });
});

describe('Tablet App Access — every toggle is named', () => {
  it('each feature switch and the "All" switch carry the feature and role in their name', async () => {
    render(<TabletAccessConfigPage />, [
      { path: '/api/config/tablet-access', body: { OPERATOR: ['login', 'filter_cleaning'] } },
      { path: '/api/roles/active', body: [{ name: 'OPERATOR', displayName: 'Operator' }, { name: 'QA', displayName: 'Quality' }] },
    ], '/config/tablet-access');
    expect(await screen.findByRole('button', { name: 'Login for Operator' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All features for Quality' })).toHaveAttribute('aria-pressed', 'false');
    expect(unnamedControls(document.body)).toEqual([]);
  });
});

describe('Config pages — the icon-only back link is named', () => {
  const back = async () => expect(await screen.findByRole('link', { name: 'Back to configuration' })).toHaveAttribute('href', '/config');

  it('Date/Time', async () => {
    render(<DatetimeConfigPage />, [{ path: '/api/config/datetime', body: { dateFormat: 'DD/MM/YYYY', timeFormat: '24-hour', timezone: 'UTC' } }]);
    await back();
  });

  it('LDAP', async () => {
    render(<LdapConfigPage />, [
      { path: '/api/ldap/config', body: { enabled: false } },
      { path: '/api/roles/active', body: [] },
    ]);
    await back();
  });

  it('Help articles', async () => {
    render(<HelpArticlesPage />, [{ path: '/api/help', body: [] }]);
    await back();
  });

  it('Action re-authentication', async () => {
    render(<ActionReauthPage />, [
      { path: '/api/config/action-reauth', body: {} },
      { path: '/api/roles/active', body: [] },
    ]);
    await back();
  });

  it('Notification rules', async () => {
    render(<NotificationRulesPage />, [
      { path: '/api/notification-rules', body: [] },
      { path: '/api/notification-rules/event-types', body: [] },
    ]);
    await back();
  });

  it('Notification channels (email / SMS)', async () => {
    render(<EmailSettingsPage />, [
      { path: '/api/notification-settings/email', body: {} },
    ]);
    await back();
  });

  it('Notification logs', async () => {
    render(<NotificationLogsPage />, [
      { path: /^\/api\/notification-settings\/logs\?/, body: { data: [], total: 0 } },
      { path: '/api/notification-settings/logs/stats', body: { total: 0 } },
    ]);
    await back();
  });
});

