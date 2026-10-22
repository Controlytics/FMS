/**
 * Tablet shell — every control on each screen the operator reaches from /m has
 * an accessible name (2026-10-22). One shared rule:
 * components/__tests__/support/a11y.ts. The cleaning page and Stage Approvals
 * are stubbed here; they have their own checks.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { useMobileLifecycle, flush, OPERATOR } from './support/mobile-kit';
import { renderWrapper } from './support/wrapper-harness';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/sync-since', async () => (await import('./support/fakes')).syncSinceModule);
vi.mock('@/lib/offline-sync-service', async (orig) => ({ ...(await orig() as any), syncAllDataForOffline: (await import('./support/fakes')).fakeSyncAllDataForOffline }));
vi.mock('@capacitor/app', async () => (await import('./support/fakes')).capacitorAppModule);
vi.mock('../mobile-operations', () => ({ MobileOperationsPage: () => <div data-testid="ops" /> }));
vi.mock('../../stage-approvals', () => ({ StageApprovalsPage: () => <div data-testid="stage-approvals" /> }));

useMobileLifecycle();

const REPLACER = { ...OPERATOR, permissions: [...OPERATOR.permissions!, 'FILTER_REPLACE'] };
const listNames = () => screen.queryAllByText(/^F-\d{3}$/, { selector: 'div.font-display' });
const TASK = { entryId: 'e1', ahuId: 'h1', ahuName: 'AHU-01', areaId: 'a1', areaName: 'Clean Room A', blockId: 'b1', blockName: 'North', overallStatus: 'pending', plannedDate: '2026-10-21', cleanedCount: 0, totalFilters: 2, filters: [] };
const RT = { id: 'rt1', ahuId: 'h1', ahuName: 'AHU-01', computedStatus: 'DUE', windowEnd: '2026-10-30', qty: 2, qtyRemaining: 2, total: 2, replaced: 0 };
const CYCLE = { id: 'c1', filterId: 'f101', cycleCode: 'CC-0001', status: 'COMPLETED', startedAt: '2026-10-20T08:00:00.000Z', completedAt: '2026-10-20T10:00:00.000Z', events: [] };

describe('every control on the tablet shell is named', () => {
  it('Home, with the header, the stations and the bottom navigation', async () => {
    renderWrapper({ due: { tasks: [TASK], overdue: [] } });
    await screen.findByText('Scan stations');
    await flush(50);
    expectAllControlsNamed();
  });

  it('Filter Status (cascade, stage chips, list) and its Scan RFID lookup', async () => {
    renderWrapper({ routes: [{ path: '/api/filters/cycles', body: { data: [CYCLE] } }] });
    fireEvent.click(await screen.findByRole('button', { name: /Status/ }));
    await screen.findByRole('heading', { name: 'Filter Status' });
    await waitFor(() => expect(screen.getAllByText(/^F-\d{3}$/).length).toBeGreaterThan(0));
    expectAllControlsNamed();
    // the searchable pickers carry their field name as well as their value
    expect(screen.getByRole('button', { name: 'AHU All' })).toHaveAttribute('aria-haspopup', 'listbox');
    expect(screen.getByRole('button', { name: 'Filter All' })).toHaveAttribute('aria-haspopup', 'listbox');
    fireEvent.click(screen.getByRole('button', { name: 'AHU All' }));
    expectAllControlsNamed(); // the open list and its search box too
    fireEvent.click(screen.getByRole('button', { name: 'AHU All' }));
    fireEvent.click(screen.getByRole('button', { name: /Scan RFID/ }));
    await screen.findByText('Look up filter by tag');
    expectAllControlsNamed();
  });

  it('the Filter Cleaning Record (dates, filter, cards)', async () => {
    renderWrapper({ routes: [{ path: '/api/filters/cycles', body: { data: [CYCLE] } }] });
    fireEvent.click(await screen.findByRole('button', { name: /Filter Cleaning Record/ }));
    await screen.findByRole('heading', { name: 'Filter Cleaning Record' });
    await screen.findAllByText('CC-0001');
    expectAllControlsNamed();
  });

  it('My Tasks (period, block / area / AHU filters, task cards)', async () => {
    renderWrapper({ due: { tasks: [TASK], overdue: [] } });
    fireEvent.click(await screen.findByRole('button', { name: /My Tasks/ }));
    await screen.findByRole('heading', { name: 'My Tasks' });
    await screen.findByRole('heading', { name: 'AHU-01' });
    expectAllControlsNamed();
  });

  it('RFID Assign: the list, then a chosen filter with its tag field', async () => {
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: /RFID Assign/ }));
    await screen.findByRole('heading', { name: 'Select filter' });
    await waitFor(() => expect(listNames().length).toBeGreaterThan(0));
    expectAllControlsNamed();
    // the names are the visible labels of the right fields
    expect(screen.getByRole('combobox', { name: 'Block' })).toHaveDisplayValue('All');
    expect(screen.getByRole('textbox', { name: 'Search by name' })).toHaveAttribute('placeholder', 'Type to narrow…');
    fireEvent.click(screen.getByText('F-101', { selector: 'div.font-display' }));
    await screen.findByPlaceholderText('Scan or enter tag value...');
    expectAllControlsNamed();
    expect(screen.getByRole('textbox', { name: 'Assign New Tag' })).toHaveAttribute('placeholder', 'Scan or enter tag value...');
  });

  it('Replace Filter: the list (with ticks), then the confirm panel', async () => {
    renderWrapper({ user: REPLACER });
    fireEvent.click(await screen.findByRole('button', { name: /Replace Filter/ }));
    await screen.findByRole('heading', { name: 'Replace — select filter' });
    await waitFor(() => expect(listNames().length).toBeGreaterThan(0));
    expectAllControlsNamed();
    expect(screen.getByRole('textbox', { name: 'Scan filter tag' })).toHaveAttribute('placeholder', 'Scan or type RFID/QR tag, then Enter');
    expect(screen.getByRole('combobox', { name: 'Filter' })).toHaveDisplayValue('All');
    fireEvent.click(screen.getByText('F-101', { selector: 'div.font-display' }));
    await screen.findByRole('heading', { name: 'Replace filter' });
    expectAllControlsNamed();
    expect(screen.getByRole('textbox', { name: /^Remarks/ })).toHaveAttribute('placeholder', 'Reason for replacement…');
  });

  it('Replacement tasks: the list, then performing one', async () => {
    renderWrapper({ replTasks: [RT] });
    const tile = await screen.findByRole('button', { name: /Replacement Tasks/ });
    await waitFor(() => expect(tile).toHaveTextContent('1'));
    fireEvent.click(tile);
    await screen.findByRole('heading', { name: 'Replacement Tasks' });
    expectAllControlsNamed();
    fireEvent.click(screen.getAllByText('AHU-01', { selector: 'div.font-display' })[0].closest('button')!);
    await screen.findByText(/filters still to replace/);
    expectAllControlsNamed();
  });

  it('Notifications', async () => {
    renderWrapper({ notifications: { data: [{ id: 'n1', title: 'PM overdue', message: 'AHU-01 is overdue', type: 'PM_OVERDUE', isRead: false, createdAt: '2026-10-21T08:00:00.000Z' }], unreadCount: 1 } });
    fireEvent.click(await screen.findByRole('button', { name: /Notifications|Alerts/ }));
    await screen.findByText('PM overdue');
    expectAllControlsNamed();
  });
});
