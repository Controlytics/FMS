/**
 * OQ-13 + OQ-06 (2026-10-19) — the My Tasks rules shared by web and tablet.
 *
 * OQ-13: a written-off visit ("not_performed") is terminal. The web card
 *        offered Perform on it (only `complete` was treated as finished).
 * OQ-06: the overdue acknowledgement is one dialog used by both clients; it
 *        posts the password to the acknowledge endpoint and only then lets the
 *        caller continue to cleaning.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const postWithReauth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ api: { postWithReauth } }));
vi.mock('@/hooks/use-can', () => ({ useCan: () => () => true }));
vi.mock('@/hooks/use-datetime-format', () => ({ useDatetimeFormat: () => ({ formatDate: String, formatDateTime: String }) }));

import { TaskCard } from '../index';
import { OverdueAckDialog } from '../overdue-ack-dialog';
import { isTaskTerminal, needsOverdueAck } from '../task-rules';

const baseTask = {
  entryId: 'e1', ahuId: 'a1', ahuName: 'AHU-07', areaId: null, areaName: null, blockId: 'b1', blockName: 'Block 1',
  plannedDate: '2026-10-01', toleranceDays: 3, windowStart: '2026-09-28', windowEnd: '2026-10-04',
  totalFilters: 4, cleanedCount: 0, filters: [],
};

function card(overallStatus: any, extra: any = {}) {
  const onPerform = vi.fn();
  render(
    <TaskCard task={{ ...baseTask, overallStatus, ...extra } as any} expanded={false} onToggle={() => {}}
      onPerform={onPerform} canPerform formatDate={String} formatDateTime={String} />,
  );
  return onPerform;
}

describe('TaskCard (web) — OQ-13', () => {
  it('a not-performed visit shows the amber chip and NO Perform button', () => {
    card('not_performed', { skipReason: 'Plant shutdown', skippedByName: 'qa1' });
    expect(screen.queryByRole('button', { name: /perform/i })).toBeNull();
    expect(screen.getAllByText(/not performed/i).length).toBeGreaterThan(0);
  });

  it('a pending visit still offers Perform', () => {
    const onPerform = card('pending');
    fireEvent.click(screen.getByRole('button', { name: /perform/i }));
    expect(onPerform).toHaveBeenCalled();
  });
});

describe('task-rules', () => {
  it('isTaskTerminal: complete and not_performed only', () => {
    expect(isTaskTerminal('complete')).toBe(true);
    expect(isTaskTerminal('not_performed')).toBe(true);
    for (const s of ['pending', 'in_progress', 'overdue', undefined]) expect(isTaskTerminal(s as any)).toBe(false);
  });

  it('needsOverdueAck: overdue + open, unacknowledged deviation', () => {
    const dev = { deviationId: 'd', status: 'OPEN', acknowledged: false };
    expect(needsOverdueAck({ overallStatus: 'overdue', deviation: dev })).toBe(true);
    expect(needsOverdueAck({ overallStatus: 'overdue', deviation: { ...dev, acknowledged: true } })).toBe(false);
    expect(needsOverdueAck({ overallStatus: 'overdue', deviation: { ...dev, status: 'CLOSED' } })).toBe(false);
    expect(needsOverdueAck({ overallStatus: 'pending', deviation: dev })).toBe(false);
    expect(needsOverdueAck({ overallStatus: 'overdue', deviation: null })).toBe(false);
  });
});

describe('OverdueAckDialog — OQ-06', () => {
  beforeEach(() => postWithReauth.mockReset());
  const task = { ahuName: 'AHU-07', totalFilters: 4, deviation: { deviationId: 'dev-1', deviationNumber: 'DEV-0001', overdueDays: 3 } };

  it('posts the password to the acknowledge endpoint, then continues', async () => {
    postWithReauth.mockResolvedValueOnce({ ok: true });
    const onAck = vi.fn();
    render(<OverdueAckDialog task={task} canConfirm onCancel={() => {}} onAcknowledged={onAck} />);
    expect(screen.getByText(/overdue by/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret@1' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm & continue/i }));
    await waitFor(() => expect(onAck).toHaveBeenCalled());
    expect(postWithReauth).toHaveBeenCalledWith('/api/pm-schedules/deviations/dev-1/acknowledge', {}, 'Secret@1');
  });

  it('a wrong password keeps the dialog open and does not continue', async () => {
    postWithReauth.mockRejectedValueOnce({ error: 'REAUTH_FAILED' });
    const onAck = vi.fn();
    render(<OverdueAckDialog task={task} canConfirm onCancel={() => {}} onAcknowledged={onAck} />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm & continue/i }));
    await waitFor(() => expect(screen.getByText(/incorrect password/i)).toBeInTheDocument());
    expect(onAck).not.toHaveBeenCalled();
  });
});
