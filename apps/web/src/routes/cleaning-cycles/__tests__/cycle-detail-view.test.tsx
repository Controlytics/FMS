import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC, LocationProbe, completedCycle, ISO } from './cycles-fixtures';
import { CycleDetailView } from '../cycle-detail-view';

usePageTestLifecycle();
// These pages chain many SWR reads; give them headroom when the machine is busy.
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

async function show(cycle: any, fallback?: any) {
  const api = mockApi([DT_UTC, ...baseRoutes()]);
  const view = renderPage(<><CycleDetailView cycle={cycle} fallback={fallback} /><LocationProbe /></>, { api });
  // the configured (UTC, 24h) format has loaded once the start time reads in it
  await screen.findAllByText('2026-10-01 08:00');
  return view;
}
const stageChip = (label: string) => screen.getAllByText((_, el) => el?.tagName === 'DIV' && el.textContent === label && el.className.includes('rounded-lg'))[0];

describe('CycleDetailView — info card', () => {
  it('a completed cycle: AHU, set, reason, block, dryer duration, end time and LAST-STAGE operator', async () => {
    const api = await show(completedCycle());
    expect(screen.getByRole('heading', { name: 'FLT-001' })).toBeInTheDocument();
    expect(screen.getByText('AHU: AHU-1')).toBeInTheDocument();
    expect(screen.getByText('Set A')).toHaveClass('bg-indigo-50');
    expect(screen.getAllByText('Completed')[0]).toBeInTheDocument();
    expect(screen.getByText('Preventive', { selector: 'div > span' })).toHaveClass('bg-blue-50');
    expect(screen.getByText('Block A')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByText('Completed time')).toBeInTheDocument();
    expect(screen.getByText('2026-10-01 12:00', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Completed by').nextSibling).toHaveTextContent('opr2');
    // completed stages carry the check mark, out-of-profile ones are NA
    expect(stageChip('Wash In').querySelector('svg')).not.toBeNull();
    expect(stageChip('Storage In · NA')).toHaveClass('line-through');
    expect(screen.queryByText('Pinned Versions')).toBeNull();
    expect(api.api.unmatched).toEqual([]);
  });

  it('an in-progress cycle shows the event count, pulses the current stage and has no end operator', async () => {
    await show({
      ...completedCycle({ status: 'IN_PROGRESS', completedAt: null, filterSet: 'SET_B', dryerDurationMinutes: null, cleaningReasonKey: 'ZZZ', cleaningReasonLabel: null }),
      events: completedCycle().events.slice(0, 2),
    });
    expect(screen.getByText('Set B')).toHaveClass('bg-purple-50');
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('2 events')).toBeInTheDocument();
    expect(screen.getByText('Completed by').nextSibling).toHaveTextContent('—');
    expect(screen.getByText('ZZZ')).toHaveClass('bg-slate-100');
    expect(screen.getByText('—', { selector: 'div.text-sm.font-medium' })).toBeInTheDocument(); // no dryer duration
    expect(stageChip('Dry In')).toHaveClass('animate-pulse');
    // the last event's dot pulses on an in-progress cycle
    expect(document.querySelectorAll('.animate-pulse.border-blue-400')).toHaveLength(1);
  });

  it('a terminated cycle shows the operator reason, Terminated labels and the terminal chip', async () => {
    await show({
      id: 'c', filterName: null, status: 'TERMINATED', terminationReason: 'Frame cracked', startedAt: ISO(8), terminatedAt: ISO(9),
      completedByUsername: 'qa1', profileStages: ['WASH_IN'], events: [],
    });
    expect(screen.getByRole('heading', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.getByText('Termination reason:').parentElement).toHaveTextContent('Frame cracked');
    expect(screen.getByText('Terminated time')).toBeInTheDocument();
    expect(screen.getByText('Terminated by').nextSibling).toHaveTextContent('qa1');
    expect(screen.getAllByText('Terminated').some((el) => el.className.includes('bg-red-50') && el.className.includes('font-bold'))).toBe(true);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // no reason, no block
  });

  it.each([
    ['RETIRED', 'Retired', { retiredBy: 'qa-retirer' }, 'qa-retirer', 'bg-amber-50'],
    ['REPLACED', 'Replaced', { replacedBy: 'qa-replacer' }, 'qa-replacer', 'bg-purple-50'],
  ])('a %s cycle names the audit performer from the fallback and is not given a termination reason', async (reason, label, fallback, who, cls) => {
    await show({ id: 'c', filterName: 'F', status: 'TERMINATED', terminationReason: reason, startedAt: ISO(8), completedAt: ISO(9), events: [] }, fallback);
    expect(screen.queryByText('Termination reason:')).toBeNull();
    expect(screen.getByText('Terminated by').nextSibling).toHaveTextContent(who);
    const chips = screen.getAllByText(label);
    expect(chips.some((el) => el.className.includes(cls) && el.className.includes('font-bold'))).toBe(true);
  });

  it('a manual status update is badged "Manual Update"; an unknown status keeps its own word', async () => {
    const { unmount } = await show({ _manual: true, id: 'm', filterName: 'F', status: 'COMPLETED', startedAt: ISO(8), events: [] });
    expect(screen.getByText('Manual Update')).toHaveClass('bg-orange-50');
    unmount();
    await show({ id: 'c', filterName: 'F', status: 'ON_HOLD', startedAt: ISO(8), cleaningJustification: 'Urgent clean before audit', events: [] });
    expect(screen.getByText('ON_HOLD', { selector: 'span' })).toHaveClass('bg-red-50');
    expect(screen.getByText('Urgent clean before audit')).toHaveClass('italic');
  });

  it('pinned versions deep-link to Version History', async () => {
    await show({
      ...completedCycle(), profileId: 'p1', profileVersion: 3, equipmentGroupId: 'eg1', equipmentGroupVersionPin: 2,
      checklistVersionPins: { 'chk-123456789': 5 },
    });
    expect(screen.getByText('Pinned Versions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline v3' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/version-history?entity=cleaning-profile&id=p1&v=3');
    fireEvent.click(screen.getByRole('button', { name: 'Equipment v2' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/version-history?entity=equipment-group&id=eg1&v=2');
    const chk = screen.getByRole('button', { name: 'Checklist v5' });
    expect(chk).toHaveAttribute('title', 'Checklist profile chk-1234… pinned at cycle start');
    fireEvent.click(chk);
    expect(screen.getByTestId('location')).toHaveTextContent('/version-history?entity=checklist-profile&id=chk-123456789&v=5');
  });

  it('an equipment pin without its group id is not offered; checklist pins alone still show the panel', async () => {
    await show({ ...completedCycle(), equipmentGroupVersionPin: 2, checklistVersionPins: { c1: 1 } });
    expect(screen.queryByRole('button', { name: /Equipment v/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pipeline v/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Checklist v1' })).toBeInTheDocument();
  });
});

describe('CycleDetailView — event timeline', () => {
  it('transitions: genesis reads "To Be Cleaned"; the two DRY_IN steps read Started / Ended; readings render by least count', async () => {
    await show(completedCycle());
    expect(screen.getByText('To Be Cleaned')).toBeInTheDocument();
    expect(screen.getByText('Dry In (Started)')).toBeInTheDocument();
    expect(screen.getByText('Dry In (Ended)')).toBeInTheDocument();
    expect(screen.getByText('Dryer Duration: 1h 30m')).toBeInTheDocument();
    expect(screen.getByText('Started: 2026-10-01 10:00')).toBeInTheDocument();
    // 6.123 at least count 0.1 prints 6.1; a reading without least count prints raw
    const air = screen.getByText('Compressed Air Pressure').parentElement!;
    expect(air).toHaveTextContent('6.1bar');
    expect(screen.getByText('RO Water Pressure').parentElement!).toHaveTextContent('2bar');
    expect(screen.getByText('Dryer Temperature').parentElement!).toHaveTextContent('55°C');
    expect(screen.getAllByText('by opr1')).toHaveLength(2);
    expect(screen.getAllByText('STATE TRANSITION')).toHaveLength(5);
  });

  it('renders every event kind: reason, approval stage, checklist answers, skipped checklists, deviation, remarks, extra attributes', async () => {
    await show({
      id: 'c', filterName: 'F', status: 'COMPLETED', startedAt: ISO(8), completedAt: ISO(12),
      cleaningReasonKey: 'CONTAMINATION', cleaningReasonLabel: 'Contamination',
      events: [
        { id: 'e1', eventType: 'CYCLE_STARTED', performedAt: ISO(8), performedBy: '12345678-aaaa', attributes: { cleaningReasonKey: 'TYPE_A', cleaningReasonLabel: 'Type A clean', clientOpId: 'x' } },
        { id: 'e2', eventType: 'APPROVAL_GRANTED', performedAt: ISO(9), performedByName: 'qa1', attributes: { stageKey: 'WASH_OUT', approvalId: 'a', attemptSeq: 1 } },
        { id: 'e3', eventType: 'APPROVAL_GRANTED', performedAt: ISO(9, 5), performedByName: 'qa1', attributes: { stageKey: 'VISUAL_CHECK' } },
        { id: 'e4', eventType: 'CHECKLIST_COMPLETED', performedAt: ISO(9, 10), performedByName: 'opr1',
          enrichedAnswers: [{ questionId: 'q1', question: 'Gasket ok?', answer: true }, { questionId: 'q2', question: 'Torn?', answer: false }, { questionId: 'q3', question: 'Notes', answer: 'clean' }] },
        { id: 'e5', eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: ISO(9, 20),
          attributes: { skippedChecklists: [{ checklistProfileName: 'Post-wash', afterStage: 'WASH_OUT' }, { afterStage: 'CUSTOM_STAGE' }, {}] } },
        { id: 'e6', eventType: 'BYPASS_DEVIATION', performedAt: ISO(9, 30), deviationDetails: { justification: 'Dryer down' }, remarks: 'Bypassed dry' },
        { id: 'e7', eventType: 'BYPASS_DEVIATION', performedAt: ISO(9, 40), deviationDetails: { code: 'D7' } },
        { id: 'e8', eventType: 'REMARK_ADDED', performedAt: ISO(10), attributes: { note: 'checked', count: 3, flag: false, nested: { a: 1 }, when: '2026-10-01T11:00:00Z', empty: null } },
        { id: 'e9', eventType: 'SOMETHING_NEW', performedAt: ISO(10, 30), fromState: 'STORAGE_IN' },
        { id: 'e10', eventType: 'CYCLE_COMPLETED', performedAt: ISO(12) },
        { id: 'e11', eventType: 'CYCLE_TERMINATED', performedAt: ISO(12, 1) },
      ],
    });
    // reason on CYCLE_STARTED comes from the event attributes first
    expect(screen.getByText('Type A clean')).toHaveClass('bg-purple-50');
    expect(screen.getByText('by 12345678')).toBeInTheDocument();
    expect(screen.getAllByText('Approved stage:')).toHaveLength(2);
    expect(screen.getByText('Wash Out', { selector: '.bg-emerald-50' })).toBeInTheDocument();
    expect(screen.getByText('VISUAL CHECK')).toBeInTheDocument();
    expect(screen.getByText('Checklist Responses')).toBeInTheDocument();
    expect(screen.getByText('Gasket ok?').nextSibling).toHaveTextContent('Yes');
    expect(screen.getByText('Torn?').nextSibling).toHaveTextContent('No');
    expect(screen.getByText('Notes').nextSibling).toHaveTextContent('clean');
    const skipped = screen.getAllByText(/Checklist skipped:/);
    expect(skipped[0]).toHaveTextContent('Checklist skipped: Post-wash after Wash Out — it was disabled');
    expect(skipped[1]).toHaveTextContent('Checklist skipped: unknown checklist after CUSTOM STAGE — it was disabled');
    expect(skipped[2]).toHaveTextContent('Checklist skipped: unknown checklist — it was disabled');
    expect(screen.getByText('Deviation: Dryer down')).toBeInTheDocument();
    expect(screen.getByText('Deviation: {"code":"D7"}')).toBeInTheDocument();
    expect(screen.getByText('Bypassed dry')).toHaveClass('italic');
    expect(screen.getByText('note: checked')).toBeInTheDocument();
    expect(screen.getByText('count: 3')).toBeInTheDocument();
    expect(screen.getByText('flag: false')).toBeInTheDocument();
    expect(screen.getByText('when: 2026-10-01 11:00')).toBeInTheDocument();
    expect(screen.queryByText(/nested:/)).toBeNull();
    expect(screen.queryByText(/clientOpId/)).toBeNull();
    // An event with a from-state but no to-state shows just the from label
    expect(screen.getByText('SOMETHING NEW').closest('.rounded-xl')!).toHaveTextContent('Storage In');
    expect(screen.getByText('CYCLE COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('CYCLE TERMINATED').closest('.rounded-xl')).toHaveClass('bg-red-50');
  });

  it('CYCLE_STARTED falls back to the cycle reason; readings fall back to instrument code / index and show provenance', async () => {
    await show({
      id: 'c', filterName: 'F', status: 'COMPLETED', startedAt: ISO(8), completedAt: ISO(9), cleaningReasonKey: 'ON_REQUEST',
      events: [
        { id: 'e1', eventType: 'CYCLE_STARTED', performedAt: ISO(8) },
        { id: 'e2', eventType: 'STATE_TRANSITION', fromState: null, toState: 'CUSTOM_STAGE', performedAt: ISO(8, 30), attributes: { instrumentReadings: [
          { instrumentCode: 'PG-01', value: 4, unit: 'psi', source: 'AUTO' },
          { value: 7, source: 'AUTO_OVERRIDDEN' },
          { description: 'Flow', instrumentCode: 'FM-2', value: 1.5, leastCount: 0.01, uom: 'm3/h' },
        ] } },
      ],
    });
    expect(screen.getByText('ON_REQUEST', { selector: '.rounded-full.px-2\\.5' })).toHaveClass('bg-amber-50');
    expect(screen.getByText('PG-01').parentElement).toHaveTextContent('4psiAuto');
    expect(screen.getByText('Instrument 2').parentElement).toHaveTextContent('7Auto · changed');
    expect(screen.getByText('FM-2')).toHaveClass('font-mono');
    expect(screen.getByText('Flow').parentElement).toHaveTextContent('1.50m3/h');
    expect(screen.getByText('CUSTOM STAGE')).toBeInTheDocument();
  });

  it('no events: just the card and an empty timeline', async () => {
    await show({ id: 'c', filterName: 'F', status: 'COMPLETED', startedAt: ISO(8) });
    expect(screen.getByText('Completed time').nextSibling).toHaveTextContent('—');
    await waitFor(() => expect(within(document.body).queryByText(/STATE TRANSITION/)).toBeNull());
  });
});

describe('CycleDetailView — fallbacks', () => {
  it('dryer duration from the DRY_IN event; unknown stage/reason keys render as words; a dryer start without a duration reads "—"', async () => {
    await show({
      id: 'c', filterName: 'F', status: 'COMPLETED', startedAt: ISO(8), completedAt: ISO(9), checklistVersionPins: {},
      events: [
        { id: 'e1', eventType: 'CYCLE_STARTED', performedAt: ISO(8), attributes: { cleaningReasonKey: 'ODD_REASON' } },
        { id: 'e2', eventType: 'STATE_TRANSITION', fromState: 'QUARANTINE_HOLD', toState: 'DRY_IN', performedAt: ISO(8, 10), attributes: { dryerDurationMinutes: 20 } },
        { id: 'e3', eventType: 'STATE_TRANSITION', fromState: 'DRY_IN', toState: 'DRY_IN', performedAt: ISO(8, 20), attributes: { action: 'DRYER_STARTED' } },
        { id: 'e4', eventType: 'REMARK_ADDED', fromState: 'ODD_STATE', performedAt: ISO(8, 30) },
      ],
    });
    expect(screen.getByText('20m', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('ODD_REASON')).toHaveClass('bg-slate-100');
    expect(screen.getByText('QUARANTINE HOLD')).toBeInTheDocument();
    expect(screen.getByText('Dryer Duration: —')).toBeInTheDocument();
    expect(screen.getByText('ODD STATE')).toBeInTheDocument();
    // an empty checklist-pin map is not "pinned versions"
    expect(screen.queryByText('Pinned Versions')).toBeNull();
  });
});
