/**
 * StageApprovalDetailsCard — the evidence an approver reads on a Wash Out /
 * Dry Out interlock (coverage campaign 2026-10-21). Rendered through the page
 * harness so times are formatted by the real useDatetimeFormat with the
 * configured zone from GET /api/config/datetime/current.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderPage, mockApi } from '@/test-utils/page-harness';
import { StageApprovalDetailsCard } from '../stage-approval-details';
import type { StageDetails } from '@/lib/stage-approval';

const DT = { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' };
const washOut: StageDetails = {
  cleaningReason: 'Preventive Maintenance',
  washIn: { at: '2026-09-05T08:00:00.000Z', by: 'op1', readings: [{ description: 'RO Water Pressure', value: 2.5, uom: 'bar', leastCount: 0.1 }] },
  washOut: { at: '2026-09-05T08:30:00.000Z', by: 'op2', readings: [] },
};

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const api = () => mockApi([{ path: '/api/config/datetime/current', body: DT }]);
/** Let the datetime-config fetch land so its state update happens inside act. */
async function settle(m: ReturnType<typeof api>) {
  await waitFor(() => expect(m.calls('GET', '/api/config/datetime/current')).toHaveLength(1));
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

describe('StageApprovalDetailsCard', () => {
  it('renders Wash In / Wash Out sections with times in the configured zone and format', async () => {
    const m = api();
    renderPage(<StageApprovalDetailsCard stageKey="WASH_OUT" details={washOut} />, { api: m, user: { role: 'QA' } });
    expect(screen.getByText('Wash In')).toBeInTheDocument();
    expect(screen.getByText('Wash Out')).toBeInTheDocument();
    expect(screen.getByText('RO Water Pressure')).toBeInTheDocument();
    expect(screen.getByText('2.5 bar')).toBeInTheDocument();
    expect(screen.getByText('Preventive Maintenance')).toBeInTheDocument();
    expect(screen.getByText('op1')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('2026-09-05 08:00')).toBeInTheDocument());
    expect(screen.getByText('2026-09-05 08:30')).toBeInTheDocument();
    await settle(m);
    // No edit affordance without onEdit.
    expect(screen.queryByRole('button', { name: /Edit stage details/ })).toBeNull();
  });

  it('renders nothing when there are no details and no edit action', async () => {
    const m = api();
    const { container } = renderPage(<StageApprovalDetailsCard stageKey="WASH_OUT" details={null} />, { api: m });
    await settle(m);
    expect(container.querySelector('[data-testid="stage-details"]')).toBeNull();
  });

  it('with an edit action but nothing recorded, says so instead of vanishing', async () => {
    const m = api();
    renderPage(<StageApprovalDetailsCard stageKey="STORAGE_IN" details={{ cleaningReason: null }} onEdit={vi.fn()} />, { api: m });
    await settle(m);
    expect(screen.getByText('No stage details recorded for this request.')).toBeInTheDocument();
  });

  it('puts ONE labelled Super Admin pencil on the first section only, and it calls onEdit', async () => {
    const onEdit = vi.fn();
    const m = api();
    renderPage(<StageApprovalDetailsCard stageKey="WASH_OUT" details={washOut} onEdit={onEdit} />, { api: m });
    await settle(m);
    const pencils = screen.getAllByRole('button', { name: 'Edit stage details (Super Admin)' });
    expect(pencils).toHaveLength(1);
    fireEvent.click(pencils[0]);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('uses the tablet (compact) text sizes when asked', async () => {
    const m = api();
    renderPage(<StageApprovalDetailsCard stageKey="WASH_OUT" details={washOut} compact />, { api: m });
    await settle(m);
    expect(screen.getByText('Wash In')).toHaveClass('text-[10px]');
    expect(screen.getByText('op1')).toHaveClass('text-[12px]');
  });

  it('desktop sizes by default', async () => {
    const m = api();
    renderPage(<StageApprovalDetailsCard stageKey="WASH_OUT" details={washOut} />, { api: m });
    await settle(m);
    expect(screen.getByText('Wash In')).toHaveClass('text-[11px]');
    expect(screen.getByText('op1')).toHaveClass('text-[13px]');
  });
});
