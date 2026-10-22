import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  formatDuration, getStatusBadgeClass, getTransportBadgeClass, getMessageTypeBadgeClass,
  getStageBgClass, getStageTimelineClass, getStageDotClass,
} from '../helpers';
import { PipelineProgressBar } from '../components/PipelineProgressBar';
import { TraceDetailPanel } from '../components/TraceDetailPanel';
import type { PipelineTrace, StageResult } from '../types';

/**
 * Colour / label rules behind the debug-trace screen. Each class string is what
 * the operator sees as the badge / block colour, so a wrong mapping is a wrong
 * signal (a failure painted green).
 */
describe('debug helpers', () => {
  it('formats durations at each scale', () => {
    expect(formatDuration(0)).toBe('<1ms');
    expect(formatDuration(999)).toBe('999ms');
    expect(formatDuration(61_000)).toBe('61.00s');
  });

  it('status badges: green success, amber warnings, red failure, yellow DLQ, slate for anything else', () => {
    expect(getStatusBadgeClass('SUCCESS')).toContain('emerald');
    expect(getStatusBadgeClass('SUCCESS_WITH_WARNINGS')).toContain('amber');
    expect(getStatusBadgeClass('FAILED')).toContain('red');
    expect(getStatusBadgeClass('DLQ')).toContain('yellow');
    expect(getStatusBadgeClass('UNKNOWN' as PipelineTrace['finalStatus'])).toContain('slate');
  });

  it('transport + message-type badges are case-insensitive and fall back to slate', () => {
    expect(getTransportBadgeClass('mqtt')).toContain('brand');
    expect(getTransportBadgeClass('http')).toContain('blue');
    expect(getTransportBadgeClass('ws')).toContain('cyan');
    expect(getTransportBadgeClass('WEBSOCKET')).toContain('cyan');
    expect(getTransportBadgeClass('API')).toContain('slate');
    expect(getMessageTypeBadgeClass('telemetry')).toContain('brand');
    expect(getMessageTypeBadgeClass('Attributes')).toContain('teal');
    expect(getMessageTypeBadgeClass('rpc')).toContain('pink');
    expect(getMessageTypeBadgeClass('FILTER_ADVANCED')).toContain('slate');
  });

  it('stage colours for success / failed / skipped and an unknown status', () => {
    const unknown = 'PENDING' as StageResult['status'];
    expect(getStageBgClass('SUCCESS')).toBe('bg-emerald-500');
    expect(getStageBgClass('FAILED')).toBe('bg-red-500');
    expect(getStageBgClass('SKIPPED')).toBe('bg-slate-300');
    expect(getStageBgClass(unknown)).toBe('bg-slate-200');
    expect(getStageTimelineClass('SKIPPED')).toContain('slate-50');
    expect(getStageTimelineClass(unknown)).toContain('bg-white');
    expect(getStageDotClass('SKIPPED')).toContain('slate-300');
    expect(getStageDotClass(unknown)).toBe('bg-slate-200 border-slate-200');
  });
});

describe('PipelineProgressBar', () => {
  it('paints one block per stage by status and counts only successes', () => {
    const stages: StageResult[] = [
      { stage: 1, name: 'a', status: 'SUCCESS', durationMs: 1 },
      { stage: 2, name: 'b', status: 'FAILED', durationMs: 1 },
      { stage: 3, name: 'c', status: 'SKIPPED', durationMs: 0 },
    ];
    const { container } = render(<PipelineProgressBar stages={stages} />);
    expect(screen.getByText('1/11')).toBeInTheDocument();
    expect(container.querySelector('[title^="Stage 1: Auth & Rate Limit"]')).toHaveClass('bg-emerald-500');
    expect(container.querySelector('[title^="Stage 2: Schema Validation — FAILED"]')).toHaveClass('bg-red-500');
    expect(container.querySelector('[title^="Stage 3: Entity Resolution — SKIPPED"]')).toHaveClass('bg-slate-300');
    // index 6 has no STAGE_NAMES entry and was never reached
    expect(container.querySelector('[title="Stage 6: Stage 6 — Not reached"]')).toHaveClass('bg-slate-200');
  });
});

describe('TraceDetailPanel', () => {
  it('a FAILED trace with no error code or message shows no empty error banner', () => {
    const trace: PipelineTrace = {
      id: 'x', time: '2026-10-20T00:00:00Z', messageId: 'm-9', transport: 'API', messageType: 'X',
      stages: [], finalStatus: 'FAILED', totalDurationMs: 5, payloadSize: 0,
    };
    render(<TraceDetailPanel trace={trace} />);
    expect(screen.getByText('0 B')).toBeInTheDocument();
    expect(screen.getByText('0 / 11')).toBeInTheDocument();
    expect(screen.queryByText(/Failed at:/)).toBeNull();
    expect(screen.queryByText(/Warnings \(/)).toBeNull();
  });

  it('an error message without a code still shows the banner (and no failed-stage line when unknown)', () => {
    const trace: PipelineTrace = {
      id: 'y', time: '2026-10-20T00:00:00Z', messageId: 'm-10', transport: 'API', messageType: 'X',
      stages: [], finalStatus: 'FAILED', errorMessage: 'database timeout', totalDurationMs: 5,
    };
    render(<TraceDetailPanel trace={trace} />);
    expect(screen.getByText('database timeout')).toBeInTheDocument();
    expect(screen.queryByText(/Failed at:/)).toBeNull();
  });
});
