// dom-accessibility-api ships types, but its package.json "exports" map hides
// them from `moduleResolution: bundler` (TS7016). Declare the one function the
// page-findings helper uses.
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(root: Element, options?: Record<string, unknown>): string;
}
