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

describe('FlowChart — non-permission access rendering', () => {
  it('renders a role badge for a SUPER_ADMIN-only gateRoles step, not "any user"', () => {
    const saOnly: FlowStep[] = [
      { label: 'Delete User', gate: [], gateRoles: ['SUPER_ADMIN'], kind: 'decision' },
    ];
    render(<FlowChart steps={saOnly} />);
    expect(screen.getByText('Super Admin')).toBeInTheDocument();
    expect(screen.queryByText('any user')).not.toBeInTheDocument();
    expect(screen.queryByText('Any signed-in user')).not.toBeInTheDocument();
  });

  it('renders both role badges for a multi-role gateRoles step', () => {
    const saAndAdmin: FlowStep[] = [
      { label: 'View System Health', gate: [], gateRoles: ['SUPER_ADMIN', 'ADMIN'], kind: 'system' },
    ];
    render(<FlowChart steps={saAndAdmin} />);
    expect(screen.getByText('Super Admin')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('renders the automatic chip and no role badge for access: "automatic"', () => {
    const automatic: FlowStep[] = [
      { label: 'Cycle auto-completes', gate: [], access: 'automatic', kind: 'system' },
    ];
    render(<FlowChart steps={automatic} />);
    expect(screen.getByText('Automatic — system')).toBeInTheDocument();
    for (const roleName of ['Super Admin', 'Admin', 'Supervisor', 'Maintenance', 'Operator', 'Viewer']) {
      expect(screen.queryByText(roleName)).not.toBeInTheDocument();
    }
  });

  it('renders the public chip for access: "public"', () => {
    const publicStep: FlowStep[] = [
      { label: 'Submit a request', gate: [], access: 'public', kind: 'action' },
    ];
    render(<FlowChart steps={publicStep} />);
    expect(screen.getByText('Anyone — no login required')).toBeInTheDocument();
  });

  it('renders "Any signed-in user" for access: "authenticated"', () => {
    const authStep: FlowStep[] = [
      { label: 'View Dashboard', gate: [], access: 'authenticated', kind: 'system' },
    ];
    render(<FlowChart steps={authStep} />);
    expect(screen.getByText('Any signed-in user')).toBeInTheDocument();
  });
});
