/**
 * <Header> — menu toggle, notification bell with unread badge, user menu.
 * Real SWR (unread count, roles table) via the page harness; only fetch stubbed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { Header } from '../header';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';

type HeaderUser = React.ComponentProps<typeof Header>['user'];
const alice: NonNullable<HeaderUser> = { fullName: 'Alice Mary Doe', role: 'QA', username: '101114', email: 'alice@site.io', department: 'Quality' };

function Where() { return <p data-testid="path">{useLocation().pathname}</p>; }

/** Renders and waits until every request the header makes has been answered and rendered. */
async function renderHeader(user: HeaderUser, unread = 0, extra: { onLogout?: () => void; onMenuToggle?: () => void } = {}) {
  const onLogout = extra.onLogout ?? vi.fn();
  const onMenuToggle = extra.onMenuToggle ?? vi.fn();
  const api = mockApi([
    { path: '/api/notifications/unread-count', body: { count: unread } },
    { path: '/api/roles/active', body: [{ name: 'QA', displayName: 'Quality Assurance', color: 'bg-emerald-600' }] },
    { path: '/api/config/branding', body: { appName: 'Acme' } },
  ]);
  const view = renderPage(<><Header user={user} onLogout={onLogout} onMenuToggle={onMenuToggle} /><Where /></>, { route: '/audit', api });
  await waitFor(() => {
    expect(api.calls('GET', '/api/roles/active')).toHaveLength(1);
    expect(api.calls('GET', '/api/config/branding')).toHaveLength(1);
    if (user) expect(api.calls('GET', '/api/notifications/unread-count')).toHaveLength(1);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { ...view, api, onLogout, onMenuToggle };
}
const userMenuButton = () => screen.getByRole('button', { name: /Alice Mary Doe/ });

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn'); error = vi.spyOn(console, 'error'); });
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('Header', () => {
  it('signed out: only the menu toggle; no "Test setup" label; no unread-count request', async () => {
    const { api, onMenuToggle } = await renderHeader(undefined);
    // Removed 2026-10-22 (operator): fixed text that would also show on a customer install.
    expect(screen.queryByText('Test setup')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    expect(onMenuToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /notification/i })).toBeNull();
    await waitFor(() => expect(api.calls('GET', '/api/roles/active')).toHaveLength(1));
    expect(api.calls('GET', '/api/notifications/unread-count')).toHaveLength(0);
  });

  it('bell without unread items: named "Notifications", no badge; click opens /notifications', async () => {
    const { api } = await renderHeader(alice, 0);
    await waitFor(() => expect(api.calls('GET', '/api/notifications/unread-count')).toHaveLength(1));
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    expect(bell.querySelector('span')).toBeNull();
    fireEvent.click(bell);
    expect(screen.getByTestId('path')).toHaveTextContent('/notifications');
  });

  it('bell with unread items shows the count and says so in its name', async () => {
    await renderHeader(alice, 7);
    // A-L1: the name is a sentence, not the bare badge digits ("7, button").
    const bell = screen.getByRole('button', { name: '7 unread notifications' });
    expect(bell).toHaveAttribute('title', '7 unread notification(s)');
    expect(bell).toHaveTextContent('7');
    expect(bell.querySelector('span')).toHaveAttribute('aria-hidden', 'true');
  });

  it('caps the badge at 99+', async () => {
    await renderHeader(alice, 150);
    const bell = screen.getByTitle('150 unread notification(s)');
    expect(bell).toHaveTextContent('99+');
    expect(bell).not.toHaveTextContent('150');
  });

  it('user button shows initials, name and the role display name from the roles table', async () => {
    await renderHeader(alice);
    const btn = userMenuButton();
    expect(btn).toHaveTextContent('AM');
    await waitFor(() => expect(btn).toHaveTextContent('Quality Assurance'));
    fireEvent.click(btn);
    expect(screen.getAllByText('Quality Assurance')).toHaveLength(2);
  });

  it('a role missing from the roles table shows its raw name', async () => {
    const { api } = await renderHeader({ ...alice, role: 'CUSTOM_ROLE' });
    await waitFor(() => expect(api.calls('GET', '/api/roles/active')).toHaveLength(1));
    expect(userMenuButton()).toHaveTextContent('CUSTOM_ROLE');
    fireEvent.click(userMenuButton());
    expect(screen.getAllByText('CUSTOM_ROLE')).toHaveLength(2); // button + menu badge
  });

  it('a profile photo is loaded from the API host (relative upload paths are prefixed)', async () => {
    localStorage.setItem('digilog.serverUrl', 'https://192.168.1.53:3000');
    await renderHeader({ ...alice, photoUrl: '/uploads/photos/a.jpg' });
    const img = within(userMenuButton()).getByRole('img', { name: 'Alice Mary Doe' });
    expect(img).toHaveAttribute('src', 'https://192.168.1.53:3000/uploads/photos/a.jpg');
    expect(userMenuButton()).not.toHaveTextContent('AM');
  });

  it('an absolute photo URL is used as-is', async () => {
    await renderHeader({ ...alice, photoUrl: 'https://cdn.example/a.png' });
    expect(within(userMenuButton()).getByRole('img')).toHaveAttribute('src', 'https://cdn.example/a.png');
  });

  it('the user menu lists ID, email and department, and links to profile + change password', async () => {
    await renderHeader(alice);
    fireEvent.click(userMenuButton());
    expect(screen.getByText('User ID:').nextSibling).toHaveTextContent('101114');
    expect(screen.getByText('Email:').nextSibling).toHaveTextContent('alice@site.io');
    expect(screen.getByText('Department:').nextSibling).toHaveTextContent('Quality');
    expect(screen.getByRole('link', { name: 'My Profile' })).toHaveAttribute('href', '/profile');
    fireEvent.click(screen.getByRole('link', { name: 'Change Password' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/change-password');
    expect(screen.queryByRole('link', { name: 'My Profile' })).toBeNull(); // menu closed on navigation
  });

  it('the menu omits email and department when the user has none, and shows a photo in its header', async () => {
    await renderHeader({ fullName: 'Bob', role: 'QA', username: 'bob', photoUrl: 'https://x/b.png' });
    fireEvent.click(userMenuButton2('Bob'));
    expect(screen.queryByText('Email:')).toBeNull();
    expect(screen.queryByText('Department:')).toBeNull();
    expect(screen.getAllByRole('img', { name: 'Bob' })).toHaveLength(2);
  });

  it('My Profile closes the menu', async () => {
    await renderHeader(alice);
    fireEvent.click(userMenuButton());
    fireEvent.click(screen.getByRole('link', { name: 'My Profile' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/profile');
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
  });

  it('Logout closes the menu and calls onLogout', async () => {
    const { onLogout } = await renderHeader(alice);
    fireEvent.click(userMenuButton());
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
  });

  it('clicking outside the open menu closes it; the button toggles it', async () => {
    const { container } = await renderHeader(alice);
    fireEvent.click(userMenuButton());
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    fireEvent.click(container.querySelector('.fixed.inset-0')!);
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
    fireEvent.click(userMenuButton());
    fireEvent.click(userMenuButton());
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
  });

  it('single-word names give one initial; long names are cut to two', async () => {
    await renderHeader({ ...alice, fullName: 'operator' });
    expect(userMenuButton2('operator')).toHaveTextContent(/^O/);
  });

  // A-L2: the user menu is keyboard-dismissable and reports its state.
  it('the user-menu button exposes aria-haspopup / aria-expanded, and Escape closes the menu', async () => {
    await renderHeader(alice);
    const btn = userMenuButton();
    expect(btn).toHaveAttribute('aria-haspopup', 'true');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(btn); // focus returns to the opener
  });

  it('other keys do not close the menu, and Escape with the menu closed does nothing', async () => {
    await renderHeader(alice);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(userMenuButton());
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  it('the menu toggle reports whether the drawer is open and which element it controls', async () => {
    const api = mockApi([
      { path: '/api/roles/active', body: [] },
      { path: '/api/config/branding', body: {} },
    ]);
    // The parent owns the drawer state, as AppLayout does.
    function Shell() {
      const [open, setOpen] = useState(false);
      return <Header user={undefined} onLogout={vi.fn()} onMenuToggle={() => setOpen((o) => !o)} menuOpen={open} />;
    }
    renderPage(<Shell />, { api });
    const toggle = screen.getByRole('button', { name: 'Toggle menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'app-sidebar');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(api.calls('GET', '/api/config/branding')).toHaveLength(1));
  });

  it('every control has an accessible name (unread badge showing, user menu open)', async () => {
    const { container } = await renderHeader(alice, 3);
    fireEvent.click(userMenuButton());
    expectAllControlsNamed(container);
  });
});

function userMenuButton2(name: string) {
  return screen.getByRole('button', { name: new RegExp(name) });
}
