/**
 * Fixtures + navigation helpers for the Filters page (filter-list.tsx) tests.
 * NOT a test file — imported by `filter-list-*.test.tsx`.
 *
 * The tree mirrors `/api/hierarchy/tree`: blocks → areas → ahus → filters, plus
 * AHUs directly under a block. Filters cover every approval status, a set-less
 * filter, an unknown lifecycle label, a lifecycle-RETIRED row and an inactive
 * row (which must not be listed).
 */
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { vi, expect } from 'vitest';
import { mockApi, renderPage, type MockApi, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { baseRoutes, type BaseRouteOpts } from './fm-test-kit';
import { FilterListPage } from '../filter-list';

// These are full-page renders of a 2.5k-line page; under a loaded machine the
// defaults (5 s per test, 1 s per findBy) flake. Applies only to files importing this.
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

export const F = {
  pf1: {
    id: 'f1', name: 'PF-001', filterSet: 'SET_A', currentLifecycleState: 'WASH_IN', approvalStatus: 'APPROVED', status: 'Active',
    attributes: { filterType: 'Pre', ahuType: 'Process', micronSize: '10', filterSize: '610x610', lastCleaningDate: '2026-09-01' },
    lastCleanedAt: '2026-10-01T10:00:00Z',
  },
  pf2: { id: 'f2', name: 'PF-002', filterSet: 'SET_B', currentLifecycleState: null, approvalStatus: 'APPROVED', status: 'Active', attributes: {} },
  pf3: { id: 'f3', name: 'PF-003', filterSet: 'SET_A', currentLifecycleState: null, approvalStatus: 'PENDING_REVIEW', status: 'Active', attributes: { filterType: 'HEPA' } },
  pf4: { id: 'f4', name: 'PF-004', filterSet: 'SET_B', currentLifecycleState: null, approvalStatus: 'PENDING_APPROVAL', status: 'Active', attributes: {} },
  pf5: { id: 'f5', name: 'PF-005', filterSet: 'SET_A', currentLifecycleState: null, approvalStatus: 'REJECTED', status: 'Active', attributes: { lastCleaningDate: 'NA' } },
  pf6: { id: 'f6', name: 'PF-006', filterSet: 'SET_A', currentLifecycleState: 'RETIRED', approvalStatus: 'APPROVED', status: 'Active', attributes: {} },
  pf9: { id: 'f9', name: 'PF-009', filterSet: 'SET_A', currentLifecycleState: null, approvalStatus: 'APPROVED', status: 'Active', attributes: {}, isActive: false },
  hf7: { id: 'f7', name: 'HF-007', filterSet: null, currentLifecycleState: 'CUSTOM_STATE', status: 'Active', attributes: { filterType: 'HEPA' } },
};

export function makeTree(opts: { ahu1Filters?: any[]; ahu2Filters?: any[] } = {}) {
  return [
    {
      id: 'b1', name: 'Block Alpha',
      areas: [
        {
          id: 'ar1', name: 'Area North',
          ahus: [{ id: 'h1', name: 'AHU-01', filters: opts.ahu1Filters ?? [F.pf1, F.pf2, F.pf3, F.pf4, F.pf5, F.pf6, F.pf9] }],
        },
        { id: 'ar2', name: 'Area Old', isActive: false, ahus: [] },
      ],
      ahus: [{ id: 'h2', name: 'AHU-02', filters: opts.ahu2Filters ?? [F.hf7] }],
    },
    { id: 'b2', name: 'Block Beta', areas: [], ahus: [] },
  ];
}

export const TEMPLATES = {
  data: [
    { id: 't-block', templateKind: 'BLOCK', attributeSchema: [] },
    {
      id: 't-area', templateKind: 'AREA', isActive: true,
      attributeSchema: [
        { fieldName: 'isCritical', dataType: 'BOOLEAN' },
        { fieldName: 'commissioned', dataType: 'DATE' },
        { fieldName: 'pressure', dataType: 'FLOAT', unit: 'Pa' },
      ],
    },
    {
      id: 't-ahu', templateKind: 'AHU',
      attributeSchema: [
        { fieldName: 'airFlow', dataType: 'NUMBER', required: true, unit: 'CFM' },
        { fieldName: 'roomClass', dataType: 'DROPDOWN', dropdownOptions: ['ISO 7', 'ISO 8'] },
        { fieldName: 'location_note', dataType: 'TEXT' },
      ],
    },
    { id: 't-filter', templateKind: 'FILTER' },
  ],
};

export const IDENTIFIERS = {
  data: [
    { id: 'id1', assetId: 'f1', identifierType: 'RFID', identifierValue: 'E200AA' },
    { id: 'id2', assetId: 'f2', identifierType: 'QR', identifierValue: 'QR-2', label: 'door' },
  ],
};

export const FIELD_OPTIONS = { value: { ahuType: ['Process', 'Non Process'], filterType: ['Pre', 'HEPA'], micronSize: ['10', '5'], filterSize: [] } };
export const REASONS = { reasons: [{ key: 'PM', name: 'Preventive', isActive: true }, { key: 'OLD', name: 'Old', isActive: false }] };

export interface SetupOpts {
  tree?: any;
  extra?: MockRoute[];
  base?: BaseRouteOpts;
  identifiers?: any;
}

/** Page routes; `extra` come FIRST so they override the defaults (first match wins). */
export function setupApi(o: SetupOpts = {}): MockApi {
  return mockApi([
    ...(o.extra ?? []),
    { path: '/api/hierarchy/tree', body: o.tree ?? makeTree() },
    { path: '/api/assets/templates', body: TEMPLATES },
    { path: '/api/assets/identifiers', body: o.identifiers ?? IDENTIFIERS },
    { path: '/api/filters/field-options', body: FIELD_OPTIONS },
    { path: '/api/filters/reasons', body: REASONS },
    { path: /^\/api\/assets\/instances\/f\d+$/, body: (r: any) => ({ id: r.path.split('/').pop(), approvalStatus: undefined }) },
    { path: '/api/assets/instances/pending-approval', body: { data: [] } },
    ...baseRoutes(o.base),
  ]);
}

export const ADMIN_ALL: TestUser = {
  role: 'ADMIN',
  permissions: ['ASSET_READ', 'FILTER_CREATE', 'FILTER_EDIT', 'FILTER_DELETE', 'FILTER_HIERARCHY_CREATE', 'FILTER_HIERARCHY_EDIT',
    'FILTER_HIERARCHY_DELETE', 'FILTER_RETIRE', 'FILTER_REPLACE', 'FILTER_STATUS_UPDATE', 'FILTER_RFID_MANAGE', 'FILTER_LIST_EXPORT',
    'FILTER_BULK_UPLOAD', 'FILTER_REVIEW', 'FILTER_APPROVE'],
};

export function renderFilters(user: TestUser, api: MockApi) {
  return renderPage(<FilterListPage />, { user, api, route: '/filters' });
}

/** Block grid → open a block (Structure tab). */
export async function openBlock(name = 'Block Alpha') {
  const card = await screen.findByRole('button', { name: new RegExp(name) });
  fireEvent.click(card);
  await screen.findByText('Hierarchy');
}

/** Open a block and switch to its Filters tab; waits for the first row. */
export async function openFiltersTab(name = 'Block Alpha', firstRow = 'PF-001') {
  await openBlock(name);
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  if (firstRow) await screen.findByText(firstRow);
}

/** The table row of a filter. */
export function row(name: string): HTMLElement {
  const cell = screen.getAllByText(name).find((el) => el.closest('tbody tr'));
  if (!cell) throw new Error(`row ${name} not found`);
  return cell.closest('tr') as HTMLElement;
}

/** The form control right after a <label> with this text inside `root`. */
export function field(label: string | RegExp, root: HTMLElement = document.body): HTMLElement {
  const lbl = within(root).getAllByText(label).find((el) => el.tagName === 'LABEL') ?? within(root).getByText(label);
  const ctrl = lbl.parentElement!.querySelector('input, select, textarea');
  if (!ctrl) throw new Error(`no control for ${String(label)}`);
  return ctrl as HTMLElement;
}

/** The fixed side panel / modal whose heading has this text. */
export function panel(heading: string | RegExp): HTMLElement {
  const h = screen.getByRole('heading', { name: heading });
  let el: HTMLElement | null = h;
  while (el && !(el.className && /fixed (top-0|inset-0)/.test(String(el.className)))) el = el.parentElement;
  return (el ?? h.parentElement!.parentElement!) as HTMLElement;
}

/** The mocked fetch calls for a URL fragment (for multipart / raw-fetch paths the harness can't JSON-parse). */
export function rawCalls(fragment: string): { url: string; init: RequestInit }[] {
  return vi.mocked(globalThis.fetch).mock.calls
    .map(([u, init]) => ({ url: String(u), init: (init ?? {}) as RequestInit }))
    .filter((c) => c.url.includes(fragment));
}

export async function waitForMe(api: MockApi) {
  await waitFor(() => expect(api.calls('GET', '/api/auth/me').length).toBeGreaterThan(0));
}

export async function waitForReauthConfig(api: MockApi) {
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
}


/** The open ReauthDialog's card. */
export function reauthBox(): HTMLElement {
  return screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement;
}

/** Dismiss the password prompt with its own Cancel button. */
export async function cancelReauth() {
  await screen.findByPlaceholderText('Enter your password');
  fireEvent.click(within(reauthBox()).getByRole('button', { name: 'Cancel' }));
}

/** A modal/dialog card located from its heading (the closest rounded card). */
export function card(heading: string | RegExp): HTMLElement {
  return screen.getByRole('heading', { name: heading }).closest('.rounded-2xl, .rounded-xl') as HTMLElement;
}

/** Re-render as a different user in the same test: drop the cached /me so the new role is used. */
export function switchUser(unmount: () => void) {
  unmount();
  localStorage.clear();
}
