import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StatCard } from '../stat-card';
import { PageHeader } from '../page-header';

const ICON = <path d="M5 13l4 4L19 7" />;

describe('StatCard', () => {
  it('shows the value and label, brand tile by default', () => {
    const { container } = render(<StatCard label="Retired" value={12} icon={ICON} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
    expect(container.querySelector('.bg-brand-50')).not.toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('keeps a semantic status colour when the page passes one', () => {
    const { container } = render(<StatCard label="Pending" value={3} icon={ICON} iconBg="bg-amber-50" iconColor="text-amber-600" />);
    expect(container.querySelector('.bg-amber-50')).not.toBeNull();
    expect(container.querySelector('.bg-brand-50')).toBeNull();
  });

  it('is one link when href is given (lg shows "View details")', () => {
    render(<MemoryRouter><StatCard label="Filters" value={40} icon={ICON} href="/filters" size="lg" /></MemoryRouter>);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/filters');
    expect(link).toHaveTextContent('View details');
  });
});

describe('PageHeader', () => {
  it('renders one h1 with the title, the subtitle and the actions', () => {
    render(<PageHeader title="Retirement List" subtitle="Retired filters" icon={ICON} actions={<button>Export</button>} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Retirement List');
    expect(screen.getByText('Retired filters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('works with a title only (no icon, subtitle or actions)', () => {
    const { container } = render(<PageHeader title="Plain" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Plain');
    expect(container.querySelector('svg')).toBeNull();
  });
});
