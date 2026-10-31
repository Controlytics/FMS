import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { mockApi, renderPage, type TestUser } from '@/test-utils/page-harness';
import { commonConfigRoutes } from '@/routes/users/__tests__/support/page-findings';
import { CertificateExpiryBanner } from '../certificate-expiry-banner';

/**
 * Super Admin warning before the server's HTTPS certificate expires (2026-10-31).
 * The endpoint is SUPER_ADMIN-only, so no other role may even ask.
 */
const SA: TestUser = { id: 'u-sa', fullName: 'Asha Rao', role: 'SUPER_ADMIN', permissions: [] };
const OP: TestUser = { id: 'u-op', fullName: 'Op One', role: 'OPERATOR', permissions: [] };
const status = (daysLeft: number, warning = daysLeft <= 14) => ({
  path: '/api/system-health/certificate',
  body: { certificate: { subject: 'CN=fms.example.test', validTo: '2026-11-10T09:00:00.000Z', daysLeft }, warnDays: 14, warning },
});

afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); vi.unstubAllGlobals(); });

describe('certificate expiry banner', () => {
  it('warns a Super Admin within 14 days, naming the Start-menu tool', async () => {
    renderPage(<CertificateExpiryBanner />, { user: SA, api: mockApi([...commonConfigRoutes(), status(10)]) });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/expires in 10 days/);
    expect(alert).toHaveTextContent(/Change SSL certificate/);
    expect(alert.className).toMatch(/amber/);
  });

  it('says "expired" in red once the date has passed', async () => {
    renderPage(<CertificateExpiryBanner />, { user: SA, api: mockApi([...commonConfigRoutes(), status(-2)]) });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/expired on/);
    expect(alert).toHaveTextContent(/refuse the server/);
    expect(alert.className).toMatch(/red/);
  });

  it('shows nothing when the certificate is not due', async () => {
    const api = mockApi([...commonConfigRoutes(), status(300)]);
    renderPage(<CertificateExpiryBanner />, { user: SA, api });
    await waitFor(() => expect(api.calls('GET', '/api/system-health/certificate')).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never asks for another role', async () => {
    const api = mockApi([...commonConfigRoutes(), status(3)]);
    renderPage(<CertificateExpiryBanner />, { user: OP, api });
    await waitFor(() => expect(api.calls('GET', '/api/auth/me')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.calls('GET', '/api/system-health/certificate')).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
