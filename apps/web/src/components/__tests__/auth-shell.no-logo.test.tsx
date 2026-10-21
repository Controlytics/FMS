import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The logo-TEXT tile. Through the real useBranding this branch is unreachable
 * (an empty logoUrl is replaced with the bundled '/logo.jpg'), so useBranding is
 * replaced at its module boundary to exercise the component's own fallback.
 */
vi.mock('@/hooks/use-branding', () => ({
  useBranding: () => ({
    branding: { logoUrl: '', logoText: 'AP', appName: 'FilterOps', companyName: 'Acme Pharma', version: '1.0.0', appTagline: '' },
  }),
}));

import { AuthShell } from '../auth-shell';

afterEach(() => { cleanup(); });

describe('AuthShell — no logo image', () => {
  it('shows the logo text tile instead of an image', () => {
    render(<MemoryRouter><AuthShell title="Sign in">x</AuthShell></MemoryRouter>);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('AP')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
