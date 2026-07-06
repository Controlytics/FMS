import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowChart } from '../FlowChart';
import type { FlowStep } from '../types';

const steps: FlowStep[] = [
  { label: 'Start Cycle', gate: ['FILTER_OPERATE'], kind: 'action' },
  { label: 'Submit Checklist', gate: ['FILTER_OPERATE'], kind: 'action',
    branch: { label: 'Bypass (deviation)', gate: ['FILTER_BYPASS'] } },
];

describe('FlowChart', () => {
  it('renders each step label', () => {
    render(<FlowChart steps={steps} />);
    expect(screen.getByText('Start Cycle')).toBeInTheDocument();
    expect(screen.getByText('Submit Checklist')).toBeInTheDocument();
  });

  it('renders derived role badges for a step (OPERATOR holds FILTER_OPERATE)', () => {
    render(<FlowChart steps={steps} />);
    expect(screen.getAllByText('Operator').length).toBeGreaterThan(0);
  });

  it('renders the branch label', () => {
    render(<FlowChart steps={steps} />);
    expect(screen.getByText('Bypass (deviation)')).toBeInTheDocument();
  });
});
