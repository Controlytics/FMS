import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { renderPage, mockApi, type MockApi } from '@/test-utils/page-harness';
import { ReportPageWrapper } from '../report-page-wrapper';

/**
 * On-screen report chrome. Rendered through the page harness so identity comes
 * from the real Branding + Report Page Titles requests and the "By:" line from
 * the real `/api/auth/me` (useAuth), with only fetch stubbed.
 */

let api: MockApi;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  cleanup();
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  api.restore();
  vi.restoreAllMocks();
});

function setup(branding: Record<string, unknown>, titles: Record<string, unknown> = {}) {
  api = mockApi([
    { path: '/api/config/branding', body: branding },
    { path: '/api/config/report-page-titles/current', body: titles },
  ]);
}

const wrapperProps = { title: 'Audit Trail', totalRecords: 42, page: 2, totalPages: 5 };

describe('ReportPageWrapper', () => {
  it('shows identity, title, the signed-in user and the record/page footer around the content', async () => {
    setup({ companyName: 'Acme Pharma', appName: 'FMS', logoUrl: '/uploads/logo.png' });
    renderPage(
      <ReportPageWrapper {...wrapperProps}><table aria-label="rows" /></ReportPageWrapper>,
      { api, user: { role: 'QA', fullName: 'Quinn Auditor', username: 'qa1' } },
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Audit Trail' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'rows' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Acme Pharma')).toHaveLength(2)); // header + footer
    expect(screen.getAllByText('FMS')).toHaveLength(2);
    await waitFor(() => expect(screen.getByText('By: Quinn Auditor')).toBeInTheDocument());
    expect(screen.getByText('42 records')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
    // Logo image in header and footer, with alt text.
    const logos = screen.getAllByRole('img', { name: 'Logo' });
    expect(logos).toHaveLength(2);
    expect(logos[0]).toHaveAttribute('src', '/uploads/logo.png');
  });

  it('Report Page Titles overrides win; "By:" falls back to the username', async () => {
    setup({ companyName: 'Acme Pharma', appName: 'FMS' }, { companyName: 'Report Co', appName: 'Report App' });
    renderPage(<ReportPageWrapper {...wrapperProps}>x</ReportPageWrapper>, { api, user: { role: 'QA', fullName: '', username: 'qa1' } });
    await waitFor(() => expect(screen.getAllByText('Report Co')).toHaveLength(2));
    expect(screen.getAllByText('Report App')).toHaveLength(2);
    expect(screen.queryByText('Acme Pharma')).toBeNull();
    await waitFor(() => expect(screen.getByText('By: qa1')).toBeInTheDocument());
  });

  it('with no user signed in there is no "By:" line', async () => {
    setup({ companyName: 'Acme Pharma', appName: 'FMS' });
    renderPage(<ReportPageWrapper {...wrapperProps}>x</ReportPageWrapper>, { api });
    await waitFor(() => expect(screen.getAllByText('Acme Pharma')).toHaveLength(2));
    expect(screen.queryByText(/^By:/)).toBeNull();
    expect(api.calls('GET', '/api/auth/me')).toHaveLength(0);
  });

  it('hideFooterStats drops the count/page row but keeps the footer identity', async () => {
    setup({ companyName: 'Acme Pharma', appName: 'FMS' });
    renderPage(<ReportPageWrapper {...wrapperProps} hideFooterStats>x</ReportPageWrapper>, { api });
    await waitFor(() => expect(screen.getAllByText('Acme Pharma')).toHaveLength(2));
    expect(screen.queryByText('42 records')).toBeNull();
    expect(screen.queryByText('Page 2 of 5')).toBeNull();
  });

  it('hideFooter drops the whole footer (identity appears once, in the header)', async () => {
    setup({ companyName: 'Acme Pharma', appName: 'FMS' });
    renderPage(<ReportPageWrapper {...wrapperProps} hideFooter>x</ReportPageWrapper>, { api });
    await waitFor(() => expect(screen.getAllByText('Acme Pharma')).toHaveLength(1));
    expect(screen.queryByText('42 records')).toBeNull();
    expect(screen.getAllByRole('img', { name: 'Logo' })).toHaveLength(1);
  });

  it('an empty application name hides the app line and its separator', async () => {
    setup({ companyName: 'Acme Pharma', appName: '' });
    const { container } = renderPage(<ReportPageWrapper {...wrapperProps}>x</ReportPageWrapper>, { api });
    await waitFor(() => expect(screen.getAllByText('Acme Pharma')).toHaveLength(2));
    // useBranding's default app name is "DigiLog"; an EMPTY string from the server
    // still merges over it, so neither the header line nor the "·" separator render.
    expect(screen.queryByText('DigiLog')).toBeNull();
    expect(container.textContent).not.toContain('·');
  });

  it('an empty branding logo falls back to the bundled /logo.jpg', async () => {
    setup({ companyName: 'Acme Pharma', logoUrl: '' });
    renderPage(<ReportPageWrapper {...wrapperProps}>x</ReportPageWrapper>, { api });
    await waitFor(() => expect(screen.getAllByText('Acme Pharma')).toHaveLength(2));
    expect(screen.getAllByRole('img', { name: 'Logo' }).map((i) => i.getAttribute('src'))).toEqual(['/logo.jpg', '/logo.jpg']);
  });
});
