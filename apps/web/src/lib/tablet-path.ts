/**
 * True for the tablet app's routes: `/m` and anything under `/m/`.
 *
 * Never `startsWith('/m')` (2026-10-21): that also matched the desktop
 * `/my-tasks`, so a 401 there sent the operator to the TABLET login, and on a
 * tablet the desktop My Tasks page counted as a tablet route.
 */
export function isTabletPath(pathname: string): boolean {
  return pathname === '/m' || pathname.startsWith('/m/');
}
