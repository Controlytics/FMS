/**
 * Render helper + fixtures for the MobileWrapperPage suites (coverage campaign,
 * 2026-10-21). NOT a test file. The suites declare their own `vi.mock`s (see
 * any wrapper-*.test.tsx); this only builds the page and the data.
 *
 * Hierarchy used throughout (ids are short on purpose):
 *
 *   Block "North" (b1) ── Area "Clean Room A" (a1) ── AHU "AHU-01" (h1) ── F-101 (WASH_IN), F-102 (DRY_IN)
 *                     └─ AHU "AHU-02" (h2, parented DIRECTLY by the block) ── F-201 (no state)
 *   Block "South" (b2) ── Area "Pack Hall" (a2) ── AHU "AHU-03" (h3) ── F-301 (STORAGE_OUT), F-302 (PENDING approval)
 *   + a retired filter and a deactivated filter, which must never be listed.
 */
import { vi } from 'vitest';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { MobileWrapperPage } from '../../mobile-wrapper';
import { mobileRoutes, LocationProbe, OPERATOR, cacheUser, type MobileRouteOpts } from './mobile-kit';
import { setOnline } from './fakes';

export const B1 = { id: 'b1', name: 'North', templateId: 'tpl-block', parentId: null };
export const B2 = { id: 'b2', name: 'South', templateId: 'tpl-block', parentId: null };
export const A1 = { id: 'a1', name: 'Clean Room A', templateId: 'tpl-area', parentId: 'b1' };
export const A2 = { id: 'a2', name: 'Pack Hall', templateId: 'tpl-area', parentId: 'b2' };
export const H1 = { id: 'h1', name: 'AHU-01', templateId: 'tpl-ahu', parentId: 'a1' };
export const H2 = { id: 'h2', name: 'AHU-02', templateId: 'tpl-ahu', parentId: 'b1' };
export const H3 = { id: 'h3', name: 'AHU-03', templateId: 'tpl-ahu', parentId: 'a2' };
// lastCleanedAt: what /api/assets/instances attaches to every filter row
// (lib/last-cleaned.ts zipLastCleaned — the server's single source of truth).
export const F101 = {
  id: 'f101', name: 'F-101', templateId: 'tpl-filter', parentId: 'h1', currentLifecycleState: 'WASH_IN', lastCleanedAt: '2026-10-20T11:45:00.000Z',
  filterSet: 'SET_A', attributes: { ahuType: 'Recirc', filterType: 'HEPA', filterSize: '610x610', micronSize: '0.3', manufacturer: 'Camfil', note: { nested: true } },
};
export const F102 = { id: 'f102', name: 'F-102', templateId: 'tpl-filter', parentId: 'h1', currentLifecycleState: 'DRY_IN', lastCleanedAt: '2026-10-20T09:30:00.000Z', attributes: {} };
export const F201 = { id: 'f201', name: 'F-201', templateId: 'tpl-filter', parentId: 'h2', currentLifecycleState: null, attributes: { lastCleaningDate: '2026-01-05' } };
export const F301 = { id: 'f301', name: 'F-301', templateId: 'tpl-filter', parentId: 'h3', currentLifecycleState: 'STORAGE_OUT', attributes: { lastCleaningDate: 'NA' } };
export const F302 = { id: 'f302', name: 'F-302', templateId: 'tpl-filter', parentId: 'h3', currentLifecycleState: null, approvalStatus: 'PENDING_REVIEW', attributes: {} };
export const F_RETIRED = { id: 'fr', name: 'F-OLD', templateId: 'tpl-filter', parentId: 'h1', status: 'Retired', attributes: {} };
export const F_INACTIVE = { id: 'fi', name: 'F-OFF', templateId: 'tpl-filter', parentId: 'h1', isActive: false, attributes: {} };
export const INSTANCES = [B1, B2, A1, A2, H1, H2, H3, F101, F102, F201, F301, F302, F_RETIRED, F_INACTIVE];

export const IDENTIFIERS = [
  { id: 'i1', identifierType: 'RFID', identifierValue: 'E200A1', assetId: 'f101', asset: { id: 'f101', name: 'F-101' } },
  { id: 'i2', identifierType: 'RFID', identifierValue: 'E200B2', assetId: 'f201', asset: { id: 'f201', name: 'F-201' } },
  { id: 'i3', identifierType: 'RFID', identifierValue: 'E200B3', assetId: 'f201', asset: { id: 'f201', name: 'F-201' } },
  { id: 'i4', identifierType: 'RFID', identifierValue: 'E200H1', assetId: 'h1', asset: { id: 'h1', name: 'AHU-01' } },
  { id: 'i5', identifierType: 'RFID', identifierValue: 'E200GONE', assetId: 'deleted-asset', asset: { id: 'deleted-asset', name: 'gone' } },
  { id: 'i6', identifierType: 'QR', identifierValue: 'QR-301', assetId: 'f301', asset: { id: 'f301', name: 'F-301' } },
];

export interface WrapperOpts extends MobileRouteOpts {
  user?: TestUser;
  /** Render with no session at all (no token, no user). */
  signedOut?: boolean;
  routes?: MockRoute[];
  online?: boolean;
  /** Runs after the fetch stub is installed and before the first render. */
  beforeRender?: () => void;
  /** Mount on SWR's default cache so the page's global mutate(key) refreshes are observable. */
  globalCache?: boolean;
}

export function renderWrapper(o: WrapperOpts = {}) {
  if (o.online === false) setOnline(false);
  const api = mockApi([...(o.routes ?? []), ...mobileRoutes({ instances: INSTANCES, identifiers: IDENTIFIERS, ...o })]);
  const user = o.signedOut ? undefined : (o.user ?? OPERATOR);
  if (user) cacheUser(user);
  o.beforeRender?.();
  const view = renderPage(<><MobileWrapperPage /><LocationProbe /></>, { route: '/m', user, api, globalCache: o.globalCache });
  return view; // renderPage already carries `api`
}

/** Hold every request whose URL contains `fragment` until `gate` resolves (wraps the current fetch stub). */
export function gateFetch(fragment: string, gate: Promise<void>) {
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    if (String(input).includes(fragment)) await gate;
    return (real as any)(input, init);
  }));
}
