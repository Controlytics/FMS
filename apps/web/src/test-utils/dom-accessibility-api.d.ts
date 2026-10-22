// The ONE declaration of dom-accessibility-api for the web tests' a11y checks
// (components/__tests__/support/a11y.ts, routes/pm-schedules/__tests__/a11y-kit.ts,
// routes/users/__tests__/support/page-findings.ts).
//
// Why a declaration and not a devDependency (2026-10-22): the hoisted copy is
// 0.5.16, the one @testing-library/dom computes getByRole names with, and its
// package.json "exports" map has no "types" entry, so `moduleResolution:
// bundler` cannot see the types it ships (TS7016). Listing it in
// devDependencies at that version would not change that. 0.6.3 (jest-dom's
// copy) does export its types, but would compute names with a different
// version than getByRole. Declare the one function the checks use.
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(root: Element, options?: Record<string, unknown>): string;
}
