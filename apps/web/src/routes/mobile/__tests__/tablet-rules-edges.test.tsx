/**
 * Edges of the small tablet rule modules not reached by tablet-rules.test.ts,
 * plus the login card for a different user whose name the server did not send.
 */
import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { profileIdForTask } from '../task-first-stage';
import { interlockBannerTitle, interlockBannerDetail, interlockRefusalLine } from '../stage-interlock-notice';
import { MobileLoginPage } from '../mobile-login';
import { useMobileLifecycle, mobileRoutes, flush } from './support/mobile-kit';

useMobileLifecycle();

describe('task-first-stage — BY_BLOCK', () => {
  it('no rule for the AHU, its area or its block → null (the operator picks the station)', () => {
    expect(profileIdForTask({ ahuId: 'h', areaId: 'a', blockId: 'b' }, { mode: 'BY_BLOCK', rules: [{ matchValue: 'other', profileId: 'p' }] })).toBeNull();
    expect(profileIdForTask({ ahuId: null, areaId: null, blockId: null }, { mode: 'BY_BLOCK', rules: [{ matchValue: 'x', profileId: 'p' }] })).toBeNull();
    expect(profileIdForTask({ blockId: 'b' }, { mode: 'BY_BLOCK', rules: [{ matchValue: 'b', profileId: null }] })).toBeNull();
  });
});

describe('stage-interlock wording — fallbacks', () => {
  it('with no stage key or approver role the sentences still read', () => {
    expect(interlockBannerTitle({ stageKey: null, status: 'PENDING' })).toMatch(/awaiting approval$/);
    expect(interlockBannerTitle({ stageKey: 'DRY_OUT', status: 'REJECTED' })).toBe('Dry Out approval rejected');
    expect(interlockBannerDetail({ status: 'PENDING', approverRole: null })).toBe('An approver must verify and approve before this filter can continue.');
    expect(interlockBannerDetail({ status: 'REJECTED', approverRole: 'QA' })).toBe('Rejected — the filter has been sent back for re-cleaning.');
    expect(interlockRefusalLine('F-9', { stageKey: null, status: 'PENDING', approverRole: null })).toMatch(/is awaiting approval from an approver before this filter can continue\.$/);
  });
});

describe('tablet login — another user, name not sent', () => {
  it('the card still offers to log the other session out, naming it generically', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/auth/login', status: 409, body: { error: 'DIFFERENT_USER_SESSION_CONFLICT', message: 'busy', activeSession: {} } },
      ...mobileRoutes(),
    ]);
    renderPage(<MobileLoginPage />, { route: '/m/login', api });
    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'op1' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    const card = await screen.findByRole('alertdialog', { name: 'Another User is Logged In' });
    expect(card).not.toHaveTextContent('User:');
    expect(screen.getByRole('button', { name: 'Continue & Logout User' })).toBeInTheDocument();
    await flush();
  });
});
