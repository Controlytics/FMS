import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * The text-tile fallback when branding has NO logo URL. Through the real hooks
 * this branch cannot be reached — useBranding replaces an empty logoUrl with
 * the bundled '/logo.jpg' — so the two hooks the wrapper reads are replaced at
 * their module boundary here to exercise the component's own fallback.
 */
const state = vi.hoisted(() => ({ logoText: 'AC' as string | undefined }));
vi.mock('@/hooks/use-report-page-titles', () => ({
  useReportPageTitles: () => ({
    branding: { logoUrl: '', logoText: state.logoText },
    companyName: 'Acme Pharma',
    appName: 'FMS',
  }),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: null }) }));

import { ReportPageWrapper } from '../report-page-wrapper';

afterEach(() => { cleanup(); });

describe('ReportPageWrapper — no logo image', () => {
  it('draws the branding logo text in the header and footer tiles', () => {
    state.logoText = 'AC';
    render(<ReportPageWrapper title="T" totalRecords={0} page={1} totalPages={1}>x</ReportPageWrapper>);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getAllByText('AC')).toHaveLength(2);
  });

  it('falls back to "DL" when there is no logo text either', () => {
    state.logoText = '';
    render(<ReportPageWrapper title="T" totalRecords={0} page={1} totalPages={1}>x</ReportPageWrapper>);
    expect(screen.getAllByText('DL')).toHaveLength(2);
  });
});
